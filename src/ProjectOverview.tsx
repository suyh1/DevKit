import { Modal } from './project-components';
import { useCardLight } from './tool-card-motion';
import { useEffect, useState, useRef } from 'react';
import type { Project } from '../shared/projects.mjs';
import { workspaceSearch, type WorkspaceResult } from './workspace-links';
import { RelatedLink } from './related-workspaces';
import { remoteAccess, canReadWorkspaceLogs } from './workspace-remote';
import { monitorRequest, type MonitorState } from './monitor-api';
import { jarRequest, type JarState, type JarStatus } from './jar-api';
import { nginxRequest, type NginxState, type NginxStatus } from './nginx-api';
import { apiLibrary } from './api-library';
import Skeleton from './Skeleton';
import './workbench-extensions.css';

const modules = ['http', 'jar', 'nginx', 'monitor'] as const;
type Module = (typeof modules)[number];
const labels = { http: 'API 项目', jar: '后端服务', nginx: 'Nginx 实例', monitor: '监控项' };
const allowed = (module: Module) => !remoteAccess() || !!remoteAccess()?.services?.[module]?.enabled;

export function ResourceFields({
  project,
  change,
}: {
  project: Project;
  change: (value: NonNullable<Project['resources']>) => void;
}) {
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false);
  const [items, setItems] = useState<WorkspaceResult[]>([]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setItems([]);
    void workspaceSearch(
      modules.filter(allowed),
      (rows) => {
        if (live) setItems((all) => [...all, ...rows.filter((row) => row.id)]);
      },
      true,
    ).finally(() => {
      if (live) setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [open]);
  return (
    <details className="devkit-panel" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>关联运维资源</summary>
      {loading && <small>正在读取可用资源…</small>}
      <div className="devkit-fields">
        {modules.filter(allowed).map((module) => {
          const id = project.resources?.[module] || '',
            choices = items.filter((row) => row.page === module);
          return (
            <label key={module}>
              {labels[module]}
              <select
                value={id}
                onChange={(e) => {
                  const next = { ...project.resources };
                  if (e.target.value) next[module] = e.target.value;
                  else delete next[module];
                  change(next);
                }}
              >
                <option value="">未关联</option>
                {id && !choices.some((r) => r.id === id) && (
                  <option value={id}>
                    {id} · {loading ? '正在读取' : '当前不可用'}
                  </option>
                )}
                {choices.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.label} · {r.detail}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    </details>
  );
}

type Card = { module: Module; id: string; name: string; detail: string; fault?: string };
const states: Record<string, string> = {
  running: '运行中',
  stopped: '已停止',
  exited: '已退出',
  up: '正常',
  down: '故障',
  pending: '待确认',
  paused: '已暂停',
  maintenance: '维护中',
  unknown: '待确认',
  stale: '已过期',
};
export function ProjectOverview({
  project,
  profileId,
  url,
}: {
  project: Project;
  profileId: string;
  url: string;
}) {
  const [open, setOpen] = useState(false),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const grid = useRef<HTMLDivElement>(null);
  useCardLight(grid, open && !loading && cards.length > 0, '[data-resource-card]');
  const links = project.resources;
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setCards([]);
    async function load(module: Module): Promise<Card[]> {
      const id = links?.[module];
      if (!allowed(module) || (!id && module !== 'monitor')) return [];
      if (module === 'monitor') {
        const state = await monitorRequest<MonitorState>('get');
        const cards = state.monitors
          .filter(
            (m) =>
              m.id === id ||
              (m.source?.type === 'project' &&
                m.source.profileId === profileId &&
                m.source.projectId === project.id),
          )
          .map((m) => ({
            module,
            id: m.id,
            name: m.name,
            detail: states[m.state] || m.state,
            fault:
              m.incidents[0] &&
              new Date(m.incidents[0].start).toLocaleString() + ' · ' + m.incidents[0].detail,
          }));
        if (id && !cards.some((c) => c.id === id))
          return [...cards, { module, id, name: labels[module], detail: '已移除或无权查看' }];
        return cards;
      }
      if (!id) return [];
      if (module === 'http') {
        const api = (await apiLibrary('get-library')).state.projects.find((item) => item.id === id);
        return [
          {
            module,
            id,
            name: api?.name || labels[module],
            detail: api ? api.endpoints.length + ' 个接口' : '已移除或无权查看',
          },
        ];
      }
      const scope = id.includes(':')
        ? { scope: 'inventory-host', hostId: id.split(':')[0] }
        : { scope: 'inventory-local' };
      const inventory =
        module === 'jar'
          ? await jarRequest<JarState>('get', scope)
          : await nginxRequest<NginxState>('get', scope);
      const instance = inventory.instances.find((item) => item.id === id);
      if (!instance) return [{ module, id, name: labels[module], detail: '已移除或当前不可用' }];
      const statuses =
        module === 'jar'
          ? await jarRequest<JarStatus[]>('statuses', scope)
          : await nginxRequest<NginxStatus[]>('statuses', scope);
      return [
        {
          module,
          id,
          name: instance.name,
          detail: states[statuses.find((s) => s.id === id)?.state || 'unknown'] || '状态不可用',
        },
      ];
    }
    void Promise.all(
      modules.map((module) =>
        load(module).catch(() => [
          { module, id: links?.[module] || '', name: labels[module], detail: '读取失败，请刷新重试' },
        ]),
      ),
    ).then((all) => {
      if (live) {
        setCards(all.flat());
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [open, revision, links, profileId, project.id]);
  return (
    <>
      <button className="text-button pc-overview-trigger" onClick={() => setOpen(true)}>
        运维总览
      </button>
      {open && (
        <Modal wide title={project.name + ' · 运维总览'} close={() => setOpen(false)}>
          <div className="devkit-panel">
            <p>{url || '入口地址待配置'}</p>
            <button className="text-button" disabled={loading} onClick={() => setRevision((r) => r + 1)}>
              刷新运行状态
            </button>
            {loading ? (
              <Skeleton kind="list" label="读取关联资源…" />
            ) : (
              <div ref={grid} className="devkit-bento">
                {cards.map((card) => (
                  <section data-resource-card key={card.module + card.id}>
                    <strong>{card.name}</strong>
                    <p>{card.detail}</p>
                    {card.fault && <p>最近故障 · {card.fault}</p>}
                    {card.id && (
                      <RelatedLink onOpen={() => setOpen(false)} page={card.module} id={card.id}>
                        打开{labels[card.module]}
                      </RelatedLink>
                    )}
                    {(card.module === 'jar' || card.module === 'nginx') &&
                      card.id &&
                      canReadWorkspaceLogs(card.module) && (
                        <RelatedLink onOpen={() => setOpen(false)} page="logs" id={'instance:' + card.id}>
                          查看日志
                        </RelatedLink>
                      )}
                  </section>
                ))}
                {!cards.length && <p>在项目编辑窗口的「关联运维资源」中选择实例。</p>}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
