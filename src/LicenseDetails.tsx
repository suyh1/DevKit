import FloatingDetails from './FloatingDetails';
import licenseText from '../LICENSE?raw';

export default function LicenseDetails() {
  return <FloatingDetails className="license-details"><summary>非商业许可</summary>
    <p>DevKit 采用 PolyForm Noncommercial License 1.0.0，可按条款用于个人学习、非商业项目等用途。商业用途需另行取得授权。分发时请附上许可条款或其链接，并保留要求的声明。</p>
    <pre lang="en">{licenseText}</pre>
  </FloatingDetails>;
}
