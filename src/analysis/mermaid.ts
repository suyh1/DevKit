import diagramScript from 'mermaid/dist/mermaid.min.js?url';
type Mermaid = {
  initialize: (o: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
};
let engine: Promise<Mermaid> | undefined;
function renderer() {
  return (engine ??= new Promise<Mermaid>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = diagramScript;
    script.onload = () => {
      const api = (window as unknown as { mermaid: Mermaid }).mermaid;
      api.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        flowchart: { htmlLabels: false },
        maxTextSize: 100000,
      });
      resolve(api);
    };
    script.onerror = () => {
      engine = undefined;
      reject(Error('本地图形引擎加载失败'));
    };
    document.head.append(script);
  }));
}

export async function renderDiagram(source: string) {
  if (typeof document === 'undefined') throw Error('Mermaid 绘图需要桌面或浏览器工作台');
  if (source.length > 100000) throw Error('图形源码上限 100,000 字符');
  if (/%%\s*\{|^\s*---|(?:https?:|data:|javascript:|<img\b|<script\b)/im.test(source))
    throw Error('离线绘图不读取外部资源或图内配置');
  const api = await renderer(),
    id = 'diagram' + crypto.randomUUID().replaceAll('-', '');
  const result = await api.render(id, source);
  if (result.svg.length > 4_000_000) throw Error('SVG 超过 4,000,000 字符，请缩小图形');
  return result.svg;
}
