import licenseText from '../LICENSE?raw';
import packageInfo from '../package.json';

export default function LicenseDetails() {
  return <details className="license-details"><summary>{packageInfo.license} License · 查看许可全文</summary>
    <p>可使用、修改和分发 DevKit，包括商业使用。分发副本或软件的实质部分时须保留版权和许可声明。软件按原样提供。</p>
    <pre lang="en">{licenseText}</pre>
  </details>;
}
