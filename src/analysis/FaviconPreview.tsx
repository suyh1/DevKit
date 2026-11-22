import { useState } from 'react';
import { AppWindow, Braces, Code2, FileImage, FolderArchive, Images, X } from 'lucide-react';
import { faviconSizes } from './images';
const demoIcon = new URL('../../app-icon.svg', import.meta.url).href;

export default function FaviconPreview({
  src,
  name,
  hasFile,
}: {
  src: string;
  name: string;
  hasFile: boolean;
}) {
  const [failed, setFailed] = useState('');
  const image = hasFile ? src : demoIcon;
  const valid = image && image !== failed;
  const title = name || (hasFile ? '应用' : 'DevKit');
  const icon = valid ? (
    <img src={image} alt="" onError={() => setFailed(image)} />
  ) : (
    <FileImage aria-hidden="true" />
  );
  return (
    <>
      <div className="file-panel-title">
        <AppWindow size={18} />
        <h2>图标预览</h2>
        <small>{hasFile ? (valid ? '当前母图' : '无法预览') : '示例母图'}</small>
      </div>
      <div className="favicon-stage">
        <figure className="favicon-browser">
          <div className="favicon-window" aria-hidden="true">
            <div className="favicon-window-bar">
              <i />
              <i />
              <i />
            </div>
            <div className="favicon-tab">
              {icon}
              <span>{title}</span>
              <X size={11} />
            </div>
            <div className="favicon-page">
              <i />
              <i />
            </div>
          </div>
          <figcaption>浏览器标签</figcaption>
        </figure>
        <figure className="favicon-app">
          <div className="favicon-app-icon">{icon}</div>
          <span title={title}>{title}</span>
          <figcaption>应用图标</figcaption>
        </figure>
      </div>
      <div className="favicon-package">
        <h3>
          <FolderArchive size={16} />
          打包内容
        </h3>
        <ul>
          <li>
            <Images />
            <div>
              PNG 图标<small>{faviconSizes.join(' / ')} px</small>
            </div>
          </li>
          <li>
            <FileImage />
            <div>
              favicon.ico<small>16 / 32 / 48 px</small>
            </div>
          </li>
          <li>
            <Braces />
            <div>
              site.webmanifest<small>应用名称与图标路径</small>
            </div>
          </li>
          <li>
            <Code2 />
            <div>
              links.html<small>页面引用片段</small>
            </div>
          </li>
        </ul>
      </div>
    </>
  );
}
