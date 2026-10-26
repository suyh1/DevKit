"""Package the shared browser workspaces and their built-in Node server."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

root = Path(__file__).resolve().parent.parent
subprocess.run([os.environ.get('DEVKIT_NODE', 'node'), str(root / 'scripts/update-readme.mjs')], cwd=root, check=True)
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
manifest = json.loads((root / 'dist/.vite/manifest.json').read_text(encoding='utf-8'))
entries, assets = {}, {'portal.html'}


def include(key):
    if key in entries:
        return
    entry = manifest[key]
    entries[key] = entry
    assets.add(entry['file'])
    assets.update(entry.get('css', []))
    assets.update(entry.get('assets', []))
    for dependency in entry.get('imports', []) + entry.get('dynamicImports', []):
        include(dependency)


include('portal.html')
output = root / f'artifacts/release-{version}'
output.mkdir(parents=True, exist_ok=True)
archive = output / f'DevKit_ProjectCenter_{version}_node24.zip'
package = {'name': 'devkit-project-center', 'version': version, 'private': True, 'type': 'module', 'engines': {'node': '>=24'}, 'scripts': {'start': 'node server/start.mjs'}}
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
    for asset in sorted(assets):
        source = (root / 'dist' / asset).resolve()
        if not source.is_relative_to((root / 'dist').resolve()):
            raise ValueError('Unsafe asset path')
        bundle.write(source, f'dist/{asset}')
    bundle.writestr('dist/.vite/manifest.json', json.dumps(entries, ensure_ascii=False))
    for folder in ['server', 'shared']:
        for source in sorted((root / folder).glob('*.mjs')):
            if not source.name.endswith(('.check.mjs', '.test.mjs')):
                bundle.write(source, f'{folder}/{source.name}')
    bundle.writestr('package.json', json.dumps(package, indent=2))
    bundle.write(root / 'docs/project-center.md', 'GUIDE.zh-CN.md')
    bundle.write(root / 'README.md', 'README.md')
    for guide in sorted((root / 'docs').rglob('*.md')):
        if guide.name != 'README.template.md':
            bundle.write(guide, guide.relative_to(root).as_posix())
    bundle.writestr('README.txt', 'DevKit Project Center\nRequires Node.js 24+ on the HOST only. Clients need only a modern browser.\nNo npm install, build, Python or Electron needed for this ZIP.\n\nWindows PowerShell:\n$env:DEVKIT_PROJECT_PASSWORD="replace-with-a-separate-password"\nnode server/start.mjs\n\nLinux:\nDEVKIT_PROJECT_PASSWORD="replace-with-a-separate-password" node server/start.mjs\n\nDefault: 0.0.0.0:8765, read-only.\nHOST, PORT, DEVKIT_PROJECT_DATA and DEVKIT_PROJECT_EDIT=true are optional.\nDEVKIT_SHARE_NGINX=true and DEVKIT_SHARE_HTTP=true opt in to more workspaces.\nDEVKIT_NGINX_CONTROL=true additionally permits Nginx commands for editors.\nPaths and HTTP requests refer to this host. See docs/workspace-sharing.md.\nData defaults to ./configs beside server/. Close both hosts before copying configs between installations. No user data is included in this archive.\nOnly for trusted LANs; HTTP is not encrypted. See GUIDE.zh-CN.md.\n')
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert 'dist/index.html' not in bundle.namelist()
    assert not any('tool.worker-' in name for name in bundle.namelist())
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(output / 'PROJECT-SERVER-SHA256SUMS').write_text(f'{digest}  {archive.name}\n', encoding='ascii')
(output / 'project-server.json').write_text(json.dumps({'version': version, 'name': archive.name, 'bytes': archive.stat().st_size, 'sha256': digest, 'nodeRuntimeIncluded': False, 'requiredHostNode': '24+', 'architecture': 'portable JavaScript'}, indent=2), encoding='utf-8')
shutil.copyfile(root / 'README.md', output / 'README.md')
shutil.copytree(root / 'docs', output / 'docs', dirs_exist_ok=True, ignore=shutil.ignore_patterns('README.template.md'))
print(f'Built {archive.name}: {archive.stat().st_size} bytes, SHA256 {digest}')
