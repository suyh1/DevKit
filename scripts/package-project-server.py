"""Package the shared browser workspaces and their built-in Node server."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

root = Path(__file__).resolve().parent.parent
subprocess.run([os.environ.get('DEVKIT_NODE', 'node'), str(root / 'scripts/update-readme.mjs')], cwd=root, check=True)
metadata = json.loads((root / 'package.json').read_text(encoding='utf-8'))
version = metadata['version']
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
package.update({key: metadata[key] for key in ('author', 'license')})


def write_bundle(bundle):
    for asset in sorted(assets):
        source = (root / 'dist' / asset).resolve()
        if not source.is_relative_to((root / 'dist').resolve()):
            raise ValueError('Unsafe asset path')
        bundle.write(source, f'dist/{asset}')
    bundle.writestr('dist/.vite/manifest.json', json.dumps(entries, ensure_ascii=False))
    for folder in ['server', 'shared']:
        for source in sorted((root / folder).iterdir()):
            if source.suffix in {'.mjs', '.sh', '.ps1'} and not source.name.endswith(('.check.mjs', '.test.mjs')):
                bundle.write(source, f'{folder}/{source.name}')
    for name in json.loads((root / 'scripts/ssh-runtime.json').read_text(encoding='utf-8')):
        source_folder = root / 'node_modules' / name
        if not (source_folder / 'package.json').is_file():
            raise FileNotFoundError(f'Missing SSH dependency: {source_folder}')
        for source in sorted(source_folder.rglob('*')):
            parts = source.relative_to(source_folder).parts
            if source.is_file() and not {'node_modules', 'build', 'test', 'examples'}.intersection(parts) and source.suffix != '.node':
                bundle.write(source, source.relative_to(root).as_posix())
    bundle.writestr('package.json', json.dumps(package, indent=2))
    bundle.write(root / 'docs/project-center.md', 'GUIDE.zh-CN.md')
    bundle.write(root / 'README.md', 'README.md')
    bundle.write(root / 'LICENSE', 'LICENSE')
    for guide in sorted((root / 'docs').rglob('*.md')):
        if guide.name != 'README.template.md':
            bundle.write(guide, guide.relative_to(root).as_posix())
    bundle.writestr('README.txt', 'DevKit Shared Workspaces\nRequires Node.js 24+ on the HOST only. Clients need only a modern browser.\nNo npm install, build, Python or Electron needed for this ZIP.\n\nWindows PowerShell:\n$env:DEVKIT_PROJECT_PASSWORD="replace-with-a-separate-password"\n$env:DEVKIT_SHARE_PROJECTS="true"\nnode server/start.mjs\n\nLinux:\nDEVKIT_PROJECT_PASSWORD="replace-with-a-separate-password" DEVKIT_SHARE_PROJECTS=true node server/start.mjs\n\nDefault: 0.0.0.0:8765. Select at least one service on first start.\nHOST, PORT, DEVKIT_PROJECT_DATA and DEVKIT_PROJECT_EDIT=true are optional.\nDEVKIT_SHARE_NGINX=true, DEVKIT_SHARE_HTTP=true, DEVKIT_SHARE_JAR=true DEVKIT_SHARE_MONITOR=true and DEVKIT_SHARE_LOGS=true opt in to more workspaces.\nDEVKIT_PROJECT_PROBE=true permits project probes.\nDEVKIT_NGINX_EDIT=true / DEVKIT_NGINX_CONTROL=true grant Nginx edit / execution independently.\nDEVKIT_HTTP_EDIT=true / DEVKIT_HTTP_SEND=true grant HTTP edit / sending independently.\nDEVKIT_JAR_EDIT=true / DEVKIT_JAR_CONTROL=true grant JAR edit / execution (including console input and system startup) independently.\nDEVKIT_MONITOR_EDIT=true / DEVKIT_MONITOR_CONTROL=true grant monitor edit / scheduling controls independently.\nDEVKIT_LOGS_JAR=true / DEVKIT_LOGS_NGINX=true grant log source categories; DEVKIT_LOGS_EXPORT=true grants bounded exports.\nRunning JAR applications also requires Java on the host.\nLater starts reuse saved choices; explicit true/false environment variables override individual choices.\nPaths and HTTP requests refer to this host. See docs/workspace-sharing.md.\nData defaults to ./configs beside server/. Close both hosts before copying configs between installations. No user data is included in this archive.\nOnly for trusted LANs; HTTP is not encrypted. See GUIDE.zh-CN.md.\n')


with tempfile.TemporaryDirectory(prefix='project-server-', dir=output) as directory:
    scratch = Path(directory)
    runtimes = scratch / 'ssh-node'
    subprocess.run([os.environ.get('DEVKIT_NODE', 'node'), str(root / 'scripts/stage-ssh-node.mjs'), str(runtimes)], cwd=root, check=True)
    temporary_archive = scratch / archive.name
    with zipfile.ZipFile(temporary_archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        write_bundle(bundle)
        for source in sorted(runtimes.iterdir()):
            bundle.write(source, f'ssh-node/{source.name}', compress_type=zipfile.ZIP_STORED if source.suffix == '.gz' else zipfile.ZIP_DEFLATED)
    with zipfile.ZipFile(temporary_archive) as bundle:
        assert bundle.testzip() is None
        assert 'dist/index.html' not in bundle.namelist()
        assert not any('tool.worker-' in name for name in bundle.namelist())
        for target in ['win32-x64', 'linux-x64', 'linux-arm64']:
            assert bundle.getinfo(f'ssh-node/{target}.gz').file_size > 0
            assert bundle.getinfo(f'ssh-node/{target}.LICENSE').file_size > 0
    temporary_archive.replace(archive)
with archive.open('rb') as packaged:
    checksum = hashlib.sha256()
    for chunk in iter(lambda: packaged.read(1024 * 1024), b''):
        checksum.update(chunk)
    digest = checksum.hexdigest()
(output / 'PROJECT-SERVER-SHA256SUMS').write_text(f'{digest}  {archive.name}\n', encoding='ascii')
(output / 'project-server.json').write_text(json.dumps({'version': version, 'name': archive.name, 'bytes': archive.stat().st_size, 'sha256': digest, 'nodeRuntimeIncluded': False, 'requiredHostNode': '24+', 'remoteNodeRuntimeTargets': ['win32-x64', 'linux-x64', 'linux-arm64'], 'architecture': 'portable JavaScript'}, indent=2), encoding='utf-8')
shutil.copyfile(root / 'README.md', output / 'README.md')
shutil.copyfile(root / 'LICENSE', output / 'LICENSE')
shutil.copytree(root / 'docs', output / 'docs', dirs_exist_ok=True, ignore=shutil.ignore_patterns('README.template.md'))
subprocess.run([os.environ.get('DEVKIT_NODE', 'node'), str(root / 'scripts/clean-artifacts.mjs'), '--retention-only'], cwd=root, check=True)
print(f'Built {archive.name}: {archive.stat().st_size} bytes, SHA256 {digest}')
