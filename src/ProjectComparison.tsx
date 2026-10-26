import { useState } from "react";
import type { ProjectState } from "../shared/projects.mjs";
import { compareProfiles } from "./project-comparison";
import { Modal } from "./project-components";
import { saveText } from "./files";

export default function ProjectComparison({
  data,
  active,
  close,
}: {
  data: ProjectState;
  active: string;
  close: () => void;
}) {
  const [ids, setIds] = useState(() => {
    const first =
      data.profiles.find((item) => item.id === active)?.id ||
      data.profiles[0].id;
    return [
      first,
      ...data.profiles
        .filter((item) => item.id !== first)
        .slice(0, 1)
        .map((item) => item.id),
    ];
  });
  const [onlyChanged, setOnlyChanged] = useState(true),
    [error, setError] = useState("");
  const report = ids.length >= 2 ? compareProfiles(data, ids) : null;
  return (
    <Modal title="对比方案" close={close} wide>
      <p className="pc-muted">
        选择 2–4
        个独立档案，按项目编码对齐，比较项目有无、名称、分组、说明、启停、地址模板、查询参数和最终入口，以及各方案的变量。这里只读取已保存的数据。
      </p>
      <div className="pc-compare-picks">
        {data.profiles.map((profile) => (
          <label key={profile.id}>
            <input
              type="checkbox"
              checked={ids.includes(profile.id)}
              disabled={!ids.includes(profile.id) && ids.length >= 4}
              onChange={(event) =>
                setIds((values) =>
                  event.target.checked
                    ? [...values, profile.id]
                    : values.filter((id) => id !== profile.id),
                )
              }
            />
            {profile.name}
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={onlyChanged}
            onChange={(event) => setOnlyChanged(event.target.checked)}
          />
          只看差异
        </label>
      </div>
      {!report && <p role="status">请选择至少两个方案。</p>}
      {report && (
        <div className="pc-comparison">
          <table>
            <thead>
              <tr>
                <th>变量 / 项目编码</th>
                {report.profiles.map((profile) => (
                  <th key={profile.id}>
                    {profile.name}
                    <small>
                      {profile.projects} 个项目 ·{" "}
                      {profile.description || "无说明"}
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.variables
                .filter((row) => !onlyChanged || row.different)
                .map((row) => (
                  <tr key={`v:${row.key}`}>
                    <th>变量 · {row.key}</th>
                    {row.values.map((value, index) => (
                      <td key={index}>
                        {value === undefined ? (
                          <strong className="pc-invalid">未定义</strong>
                        ) : value === "" ? (
                          <em>空字符串</em>
                        ) : (
                          <code>{value}</code>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              {report.projects
                .filter((row) => !onlyChanged || row.different)
                .map((row) => (
                <tr key={`p:${row.code}`}>
                    <th>项目 · {row.code}</th>
                    {row.values.map((value, index) => (
                      <td key={index}>
                        {value === null ? (
                          <strong className="pc-invalid">此方案无此项目</strong>
                        ) : (
                          <>
                            <strong>
                              {value.name} ·{" "}
                              {value.enabled ? "已启用" : "已停用"}
                            </strong>
                            <small>
                              分组：{value.group || "未分组"} · 说明：
                              {value.description || "无"}
                            </small>
                            <small>地址模板</small>
                            <code>{value.template}</code>
                            <small>查询参数（含停用项）</small>
                            {value.query.length ? (
                              value.query.map((row, i) => (
                                <code key={i}>
                                  {row.enabled ? "启用" : "停用"} · {row.key} ={" "}
                                  {row.value}
                                </code>
                              ))
                            ) : (
                              <small>无参数</small>
                            )}
                            <small>最终入口</small>
                            <code>{value.url || "无法解析"}</code>
                            {value.error && (
                              <p className="pc-invalid">{value.error}</p>
                            )}
                            {value.missing.length > 0 && (
                              <p className="pc-invalid">
                                缺失变量：{value.missing.join("、")}
                              </p>
                            )}
                          </>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
          {onlyChanged &&
            !report.variables.some((row) => row.different) &&
            !report.projects.some((row) => row.different) && (
              <p>所选方案的项目和变量没有差异。</p>
            )}
        </div>
      )}
      {error && (
        <p role="alert" className="pc-invalid">
          {error}
        </p>
      )}
      <footer>
        <button className="text-button" onClick={close}>
          关闭
        </button>
        <button
          className="secondary-button"
          disabled={!report}
          onClick={() =>
            void saveText(
              JSON.stringify(report, null, 2),
              "devkit-scheme-comparison.json",
            ).catch((error) => setError(String(error)))
          }
        >
          导出差异报告
        </button>
      </footer>
    </Modal>
  );
}
