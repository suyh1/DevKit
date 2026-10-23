import hashlib
import io
import json
import re
import struct
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath


def add_bytes(archive, name, contents, mode=0o644):
    data = contents.encode('utf-8') if isinstance(contents, str) else contents
    entry = tarfile.TarInfo(name)
    entry.size = len(data)
    entry.mode = mode
    entry.uid = entry.gid = 0
    entry.uname = entry.gname = 'root'
    archive.addfile(entry, io.BytesIO(data))


def add_ar(output, name, data):
    header = f'{name + "/":<16}{0:<12}{0:<6}{0:<6}{100644:<8}{len(data):<10}`\n'
    output.write(header.encode('ascii'))
    output.write(data)
    if len(data) % 2:
        output.write(b'\n')


def write_data_archive(archive, runtime, launcher, desktop, icon, report):
    sources = sorted(runtime.rglob('*'))
    if any(source.is_symlink() for source in sources):
        raise ValueError('Runtime symlinks are not supported')
    extra_files = {
        'usr/bin/devkit': (launcher, 0o755),
        'usr/share/applications/devkit.desktop': (desktop, 0o644),
        'usr/share/icons/hicolor/128x128/apps/devkit.png': (icon, 0o644),
        'usr/share/doc/devkit/runtime-report.json': (json.dumps(report, indent=2), 0o644),
    }
    directories = set()
    for source in sources:
        target = PurePosixPath('opt/devkit') / source.relative_to(runtime).as_posix()
        if source.is_dir():
            directories.add(target)
        elif not source.is_file():
            raise ValueError(f'Unsupported runtime entry: {source}')
        directories.update(target.parents)
    for name in extra_files:
        directories.update(PurePosixPath(name).parents)
    directories.discard(PurePosixPath('.'))
    for directory in sorted(directories, key=lambda path: (len(path.parts), path.as_posix())):
        entry = tarfile.TarInfo(f'./{directory.as_posix()}')
        entry.type = tarfile.DIRTYPE
        entry.mode = 0o755
        entry.uid = entry.gid = 0
        entry.uname = entry.gname = 'root'
        archive.addfile(entry)
    for source in sources:
        if not source.is_file():
            continue
        name = source.relative_to(runtime).as_posix()
        entry = archive.gettarinfo(str(source), f'./opt/devkit/{name}')
        entry.uid = entry.gid = 0
        entry.uname = entry.gname = 'root'
        entry.mtime = 0
        entry.mode = 0o4755 if name == 'chrome-sandbox' else 0o755 if name == 'devkit' or source.suffix == '.so' or name == 'chrome_crashpad_handler' else 0o644
        with source.open('rb') as stream:
            archive.addfile(entry, stream)
    for name, (contents, mode) in extra_files.items():
        add_bytes(archive, f'./{name}', contents, mode)


def runtime_report(runtime, arch):
    executable = runtime / 'devkit'
    contents = executable.read_bytes()
    machine = 183 if arch == 'arm64' else 62
    if contents[:4] != b'\x7fELF' or contents[4] != 2 or contents[5] != 1 or struct.unpack_from('<H', contents, 18)[0] != machine:
        raise ValueError(f'Expected a Linux {arch} ELF executable')
    versions = set()
    binaries = []
    for source in runtime.rglob('*'):
        if not source.is_file():
            continue
        with source.open('rb') as stream:
            if stream.read(4) != b'\x7fELF':
                continue
            stream.seek(0)
            binary = stream.read()
        versions.update(match.decode('ascii') for match in re.findall(rb'GLIBC_(\d+\.\d+(?:\.\d+)?)\x00', binary))
        binaries.append(str(source.relative_to(runtime)))
    minimum = max(versions, key=lambda version: tuple(map(int, version.split('.'))))
    if tuple(map(int, minimum.split('.'))) > (2, 31):
        raise ValueError(f'Runtime requires GLIBC {minimum}, newer than the configured Kylin V10 baseline; do not upgrade the target OS to work around this')
    return { 'architecture': arch, 'minimumGlibc': minimum, 'elfFiles': binaries, 'webKitRequired': False, 'targetMachineTested': False }


def configs_postinst():
    return '''#!/bin/sh
set -eu
configs=/opt/devkit/configs
# User data is created by the installer, never packaged or removed by dpkg.
if [ -L "$configs" ]; then
  echo 'DevKit configs must be a real directory, not a symbolic link.' >&2
  exit 1
fi
if [ ! -d "$configs" ]; then
  mkdir -m 700 "$configs"
fi
owner=$(stat -c %u "$configs")
candidate=${SUDO_UID:-${PKEXEC_UID:-}}
case "$candidate" in ''|*[!0-9]*) candidate=0 ;; esac
# Preserve existing ownership. Never choose an arbitrary logged-in account.
if [ "$owner" -eq 0 ] && [ "$candidate" -ge 1000 ] && getent passwd "$candidate" >/dev/null; then
  chown "$candidate" "$configs"
fi
if [ "$(stat -c %u "$configs")" -eq 0 ]; then
  echo 'DevKit configs: /opt/devkit/configs is root-owned. Before launching as your normal user, run: sudo chown -R YOUR_USER /opt/devkit/configs'
fi
'''


def build_package(runtime, version, arch, root):
    if arch not in ['arm64', 'x64']:
        raise ValueError('Unsupported architecture')
    deb_arch = 'arm64' if arch == 'arm64' else 'amd64'
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[1-9]\d*)?', version):
        raise ValueError('Invalid package version')
    if '-' not in version:
        version += '-1'
    destination = root / 'artifacts' / f'linux-{arch}'
    destination.mkdir(parents=True, exist_ok=True)
    report = runtime_report(runtime, arch)
    installed_kib = sum(source.stat().st_size for source in runtime.rglob('*') if source.is_file()) // 1024 + 1
    dependencies = ', '.join([
        f'libc6 (>= {report["minimumGlibc"]})', 'libgtk-3-0 (>= 3.24)', 'libnss3', 'libnspr4',
        'libatk1.0-0', 'libatk-bridge2.0-0', 'libatspi2.0-0', 'libcups2', 'libdrm2',
        'libdbus-1-3', 'libx11-6', 'libxcb1', 'libxcomposite1', 'libxdamage1',
        'libxext6', 'libxfixes3', 'libxrandr2', 'libgbm1', 'libexpat1',
        'libxkbcommon0', 'libasound2', 'libpango-1.0-0', 'libcairo2', 'libglib2.0-0',
    ])
    control = '\n'.join([
        'Package: devkit', f'Version: {version}', f'Architecture: {deb_arch}',
        'Maintainer: DevKit maintainers <devkit@localhost>', 'Section: devel', 'Priority: optional',
        f'Installed-Size: {installed_kib}', f'Depends: {dependencies}',
        'Conflicts: devkit-kylin', 'Replaces: devkit-kylin',
        'Description: DevKit offline developer workbench with bundled Chromium',
        ' Includes Chromium. Does not require WebKitGTK or download software during installation.', '',
    ])
    launcher = '#!/bin/sh\nif [ "$(id -u)" -eq 0 ]; then\n  echo "Please launch DevKit as a normal desktop user, without sudo." >&2\n  exit 1\nfi\nexec /opt/devkit/devkit "$@"\n'
    desktop = '[Desktop Entry]\nType=Application\nName=DevKit\nName[zh_CN]=DevKit 开发工作台\nComment=Offline developer workbench\nExec=/usr/bin/devkit\nIcon=devkit\nTerminal=false\nCategories=Development;Utility;\nStartupWMClass=devkit\n'
    preinst = f'#!/bin/sh\nset -eu\nif [ "$(dpkg --print-architecture)" != {deb_arch} ]; then\n  echo "DevKit requires {deb_arch}." >&2\n  exit 1\nfi\ncurrent=$(getconf GNU_LIBC_VERSION | cut -d " " -f 2)\nif ! dpkg --compare-versions "$current" ge "{report["minimumGlibc"]}"; then\n  echo "DevKit requires glibc >= {report["minimumGlibc"]}; OS libraries will not be changed." >&2\n  exit 1\nfi\n'
    with tempfile.TemporaryDirectory(prefix='devkit-deb-') as temporary:
        temporary = Path(temporary)
        data_path = temporary / 'data.tar.xz'
        with tarfile.open(data_path, 'w:xz', preset=6) as archive:
            write_data_archive(archive, runtime, launcher, desktop, (root / 'build/icons/128x128.png').read_bytes(), report)
        control_buffer = io.BytesIO()
        with tarfile.open(fileobj=control_buffer, mode='w:gz') as archive:
            add_bytes(archive, './control', control)
            add_bytes(archive, './preinst', preinst, 0o755)
            add_bytes(archive, './postinst', configs_postinst(), 0o755)
        package = destination / f'DevKit_{version}_{deb_arch}.deb'
        with package.open('wb') as output:
            output.write(b'!<arch>\n')
            add_ar(output, 'debian-binary', b'2.0\n')
            add_ar(output, 'control.tar.gz', control_buffer.getvalue())
            add_ar(output, 'data.tar.xz', data_path.read_bytes())
    (destination / 'runtime-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    digest = hashlib.sha256(package.read_bytes()).hexdigest()
    (destination / 'SHA256SUMS').write_text(f'{digest}  {package.name}\n', encoding='ascii')
    print(f'Built {package} ({package.stat().st_size / 1024 / 1024:.1f} MiB); minimum GLIBC {report["minimumGlibc"]}')
    return package


def main():
    package = build_package(Path(sys.argv[1]).resolve(), sys.argv[2], sys.argv[3], Path(__file__).resolve().parent.parent)
    subprocess.run([sys.executable, str(Path(__file__).with_name('verify-deb.py')), str(package)], check=True)


if __name__ == '__main__':
    main()
