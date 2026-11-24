import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectTools } from './detection';
import { tools, type ToolId } from './tools';
import { workspaceModules, type WorkspaceModuleId } from './catalog';

// Prefer the actual tool's example. Generators, file pickers and ambiguous free text
// use the discovery input documented in the overview instead.
const examples: Partial<Record<ToolId, string>> = {
  base64: '5L2g5aW9', gzip: 'H4sIAAAAAAACA/NIzcnJBwCCidH3BQAAAA==',
  unicode: '\\u4F60\\u597D', diff: '第一行\n第二行', regex: '/订单\\d+/g',
  ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAV', password: '生成密码', uuid: '生成 UUID',
  'css-flex': '.items { display: flex; }', 'qr-code': 'https://example.org/',
  'encoding-repair': 'notes.txt', 'pixel-diff': 'screen.png', 'image-compress': 'photo.jpg',
  'favicon-kit': 'icon.png', 'file-signature': 'sample.bin', 'jar-inspect': 'service.jar',
  'parquet-view': 'users.pq', 'excel-inspect': 'report.xlsx', 'cert-inspect': 'root.der',
  'zip-inventory': 'archive.zip',
};
const workspaces: Record<WorkspaceModuleId, string> = {
  logs: '[WARN] cache unavailable', http: 'GET /hello HTTP/1.1', monitor: 'tcp://localhost:8080',
  git: 'git status', projects: '{"format":"devkit-project-center"}', knowledge: '# 交接记录', 'project-todos': '- [ ] 核对订单',
  'file-shares': 'D:\\资料\\年度报告', transfer: 'report.xlsx', mock: '{"type":"object","properties":{}}',
  whiteboard: '设计稿.png', nginx: 'server { listen 80; }', jar: 'java -jar app.jar', 'lan-hosts': 'ssh dev@server',
};

describe('总览匹配清单', () => {
  const guide = readFileSync(new URL('../docs/overview-matching.md', import.meta.url), 'utf8');
  it.each(tools)('$name 有内容或操作示例，清单与名称入口均可用', t => {
    const source = examples[t.id] ?? t.sample;
    const matches = detectTools(source);
    expect(matches, source).toContainEqual(expect.objectContaining({ id: t.id, kind: 'tool' }));
    expect(new Set(matches.map(s => s.id)).size).toBe(matches.length);
    expect(detectTools(t.name)[0]).toMatchObject({ id: t.id, kind: 'tool' });
    expect(guide).toContain(t.name + '（`' + t.id + '`）');
  });
  it.each(workspaceModules)('$name 能按内容和名称导航', w => {
    expect(detectTools(workspaces[w.id])).toContainEqual(expect.objectContaining({ id: w.id, kind: 'workspace' }));
    expect(detectTools(w.name)[0]).toMatchObject({ id: w.id, kind: 'workspace' });
    expect(guide).toContain(w.name + '（`' + w.id + '`）');
  });
});

describe('推荐顺序和打开方式', () => {
  it.each(['#36c', '#3366cc88', 'rgba(20, 70, 80, .5)', 'hsl(120 50% 50%)', 'rebeccapurple', '336699'])(
    '%s 带入六种颜色工具', value => {
      const colors = detectTools(value).filter(s => s.id.startsWith('color-'));
      expect(colors).toHaveLength(6);
      expect(colors.every(s => s.kind === 'tool' && s.input === value)).toBe(true);
    },
  );
  it('按 Git 输入打开正确视图，并保留本机工具匹配', () => {
    for (const [source, gitMode] of [['git status', 'changes'], ['diff --git a/a b/a', 'changes'], ['git log --graph', 'history'], ['git switch demo', 'refs'], ['git stash list', 'stash']])
      expect(detectTools(source)).toContainEqual(expect.objectContaining({ id: 'git', gitMode }));
    expect(detectTools('feat: 完成搜索').map(s => s.id)).toContain('changelog');
    expect(detectTools('*.log').map(s => s.id)).not.toContain('git');
    for(const [command,seed] of [['git push',{mode:'changes',push:true}],['git merge feature/demo',{mode:'refs',branch:'feature/demo'}],['git clone https://git.example/team/demo.git',{mode:'changes',clone:'https://git.example/team/demo.git'}],['git log -- "src/file name.ts"',{mode:'history',path:'src/file name.ts'}]] as const)
      expect(detectTools(command)[0]).toMatchObject({id:'git',gitSeed:seed});
    const id = 'ffb7a698-c851-4294-94f4-5651e4b33fe9';
    expect(detectTools('https://kit.example/#git/' + id)[0]).toMatchObject({ id: 'git', resourceId: id });
    expect(detectTools('digital art').map(s => s.id)).not.toContain('git');
  });
  it('替换操作打开服务列表，JAR 路径保留登记、归档检查与传输入口', () => {
    for (const command of ['替换服务文件', '替换 JAR', '恢复服务备份', '恢复 JAR 备份']) {
      expect(detectTools(command)[0]).toMatchObject({ id: 'jar', kind: 'workspace' });
      expect(detectTools(command)[0]).not.toHaveProperty('service');
    }
    const jar = '/srv/订单 服务/app.jar', matches = detectTools('"' + jar + '"');
    expect(matches).toContainEqual(expect.objectContaining({ id: 'jar', service: { kind: 'jar', jar } }));
    expect(matches.map(m => m.id)).toEqual(expect.arrayContaining(['jar-inspect', 'zip-inventory', 'file-shares', 'transfer']));
  });
  it('从脚本命令带入启动方式、含空格的脚本路径和逐行参数', () => {
    expect(detectTools('python3 "/srv/my app/main.py" --port 9000')).toContainEqual(expect.objectContaining({
      id: 'jar', service: { kind: 'script', script: '/srv/my app/main.py', args: '--port\n9000' },
    }));
    expect(detectTools('java -Xmx1g -jar app.jar --port 9000')).toContainEqual(expect.objectContaining({
      id: 'jar', service: { kind: 'jar', jar: 'app.jar', jvm: '-Xmx1g', args: '--port\n9000' },
    }));
    expect(detectTools('npm run dev -- --host 0.0.0.0')).toContainEqual(expect.objectContaining({
      id: 'jar', service: { kind: 'npm', script: 'dev', args: '--host\n0.0.0.0' },
    }));
    expect(detectTools('node --version').some(match => match.id === 'jar')).toBe(false);
    expect(detectTools('后端管理')[0].id).toBe('jar');
  });
  it('从 CSS 声明带入实际色值，并区分纯数字状态码', () => {
    expect(detectTools('--brand: #237abc;')[0]).toMatchObject({ id: 'color-convert', input: '#237abc' });
    expect(detectTools('404').map(s => s.id)).not.toContain('color-convert');
  });
  it('识别复制的带引号路径和指向共享栏目的链接', () => {
    const file = detectTools('"D:\\资料\\年度 报表.xlsx"');
    expect(file.map(s => s.id)).toEqual(expect.arrayContaining(['excel-inspect', 'file-shares', 'transfer']));
    const [first] = detectTools('https://kit.example/#knowledge/doc1').filter(s => s.kind === 'workspace');
    expect(first.id).toBe('knowledge');
  });
  it('JSON 专用格式优先，同一契约同时匹配共享栏目', () => {
    const original = '{"openapi":"3.0.0","paths":{}}';
    const matches = detectTools(original);
    expect(matches[0]).toMatchObject({ id: 'openapi-diff', input: original });
    expect(matches.filter(s => s.kind === 'workspace').map(s => s.id)).toEqual(['http', 'mock']);
    expect(detectTools('{"type":"object","properties":{}}')[0]).toMatchObject({ id: 'mock-data', options: { source: 'schema' } });
  });
  it('按原始输入设置 TSV、YAML、经纬度、数值和正则选项', () => {
    expect(detectTools('name\tqty\n一\t2')[0]).toMatchObject({ id: 'csv-json', options: { delimiter: 'tab' } });
    expect(detectTools('name: 工具')[0]).toMatchObject({ id: 'yaml', options: { mode: 'yaml-json' } });
    expect(detectTools('116.5,39.9')[0]).toMatchObject({ options: { lon: '116.5', lat: '39.9' } });
    expect(detectTools('1.25rem')[0]).toMatchObject({ id: 'css-unit', options: { from: 'rem', to: 'px' } });
    expect(detectTools('/订单\\d+/gi')[0]).toMatchObject({ id: 'regex', input: '', options: { pattern: '订单\\d+', flags: 'gi' } });
    expect(detectTools('192.168.1.1')[0]).toMatchObject({ id: 'ipv4', input: '192.168.1.1/32' });
  });
  it('名称、文件、共享栏目只打开入口', () => {
    expect(detectTools('生成 UUID')[0]).not.toHaveProperty('input');
    for (const result of detectTools('设计稿.png')) expect(result).not.toHaveProperty('input');
    const url = 'https://example.org/search?q=secret';
    expect(detectTools(url).filter(s => s.kind === 'workspace').every(s => !('input' in s))).toBe(true);
  });
  it('排除无效色值、地址、非法子网和二进制伪文本', () => {
    for (const source of ['#12xy56', 'rgb(1 2)', '随意聊聊 #fff']) expect(detectTools(source).map(s => s.id)).not.toContain('color-convert');
    expect(detectTools('http://?').map(s => s.id)).not.toContain('url-inspect');
    expect(detectTools('999.2.1.1/34').map(s => s.id)).not.toContain('ipv4');
    expect(detectTools('//8=').map(s => s.id)).not.toContain('base64');
    expect(detectTools('\uFEFF{"id":1}').map(s => s.id)).toContain('invisible');
  });
});
