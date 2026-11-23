import type { NoticeKind } from './ToastStack';
import { Copy, Github, ArrowUpRight } from 'lucide-react';
import { MotionButton } from './Motion';
import { copyText } from './motion-primitives';
import { isProjectDesktop, openProjectUrl } from './project-api';
import LicenseDetails from './LicenseDetails';
import packageInfo from '../package.json';

export default function AboutDetails({ onNotice }: { onNotice: (message: string, kind: NoticeKind) => void }) {
  return (
    <dl className="about-details">
      <div><dt>版本</dt><dd>{packageInfo.version}</dd></div>
      <div><dt>软件许可</dt><dd><LicenseDetails /></dd></div>
      <div><dt>作者</dt><dd>{packageInfo.author.name}</dd></div>
      <div><dt>联系邮箱</dt><dd className="about-contact">
        <span>{packageInfo.author.email}</span>
        <MotionButton type="button" variant="copy" className="secondary-button" onClick={async () => {
          try { await copyText(packageInfo.author.email); onNotice('联系邮箱已复制', 'success'); }
          catch (error) { onNotice(error instanceof Error ? error.message : '无法复制联系邮箱', 'error'); }
        }}><Copy size={14} aria-hidden="true" />复制邮箱</MotionButton>
      </dd></div>
      <div><dt>项目地址</dt><dd>
        <a className="about-repository" href={packageInfo.homepage} target="_blank" rel="noopener noreferrer"
          aria-label="在浏览器打开 DevKit 的 GitHub 仓库" onClick={event => {
            if (!isProjectDesktop()) return;
            event.preventDefault();
            void openProjectUrl(packageInfo.homepage).catch(() => onNotice('无法打开 DevKit 的 GitHub 仓库', 'error'));
          }}>
          <Github size={16} aria-hidden="true" />
          <span>{packageInfo.homepage}</span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </dd></div>
    </dl>
  );
}
