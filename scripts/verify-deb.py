import io
import json
import re
import shutil
import struct
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath


def validate_data_entries(entries):
    roots = [PurePosixPath(name) for name in ['opt/devkit', 'usr/bin', 'usr/share']]
    directories = {PurePosixPath('.')}
    seen = set()
    for entry in entries:
        path = PurePosixPath(entry.name)
        if entry.name.rstrip('/') != f'./{path.as_posix()}' or '..' in path.parts or '\\' in entry.name:
            raise ValueError(f'Unsafe archive path: {entry.name}')
        if not entry.isdir() and not entry.isfile():
            raise ValueError(f'Unsupported archive entry: {entry.name}')
        allowed = any(root in path.parents or entry.isdir() and (path == root or path in root.parents) for root in roots)
        if not allowed:
            raise ValueError(f'Unexpected application path: {entry.name}')
        if path in seen:
            raise ValueError(f'Duplicate archive path: {entry.name}')
        if path.parent not in directories:
            raise ValueError(f'Missing prior parent directory for {entry.name}: {path.parent}')
        if entry.uid != 0 or entry.gid != 0:
            raise ValueError(f'Archive entry is not root owned: {entry.name}')
        if entry.isdir():
            if entry.mode != 0o755:
                raise ValueError(f'Unexpected directory permissions: {entry.name}')
            directories.add(path)
        seen.add(path)


def extract_data_archive(archive, destination):
    entries = archive.getmembers()
    validate_data_entries(entries)
    for entry in entries:
        target = destination.joinpath(*PurePosixPath(entry.name).parts)
        if entry.isdir():
            target.mkdir()
        else:
            with archive.extractfile(entry) as source, target.open('xb') as output:
                shutil.copyfileobj(source, output)
    return entries


def verify(source):
    with source.open('rb') as stream:
        if stream.read(8) != b'!<arch>\n':
            raise ValueError('Not a Debian ar archive')
        members = {}
        while header := stream.read(60):
            if len(header) != 60 or header[-2:] != b'`\n':
                raise ValueError('Invalid ar header')
            name = header[:16].decode().strip().rstrip('/')
            size = int(header[48:58])
            members[name] = stream.read(size)
            if size % 2:
                stream.read(1)
    assert members['debian-binary'] == b'2.0\n'
    with tarfile.open(fileobj=io.BytesIO(members['control.tar.gz']), mode='r:gz') as archive:
        control = archive.extractfile('./control').read().decode()
        preinst = archive.extractfile('./preinst').read().decode()
        postinst = archive.extractfile('./postinst').read().decode()
        dependencies = re.search(r'^Depends: (.*)$', control, re.MULTILINE)[1]
        assert not re.search(r'webkit|javascriptcore|libsoup', dependencies, re.IGNORECASE)
        assert not re.search(r'\b(apt|apt-get|curl|wget)\b', preinst)
        assert not re.search(r'\b(apt|apt-get|curl|wget)\b', postinst)
        assert 'configs=/opt/devkit/configs' in postinst and 'SUDO_UID' in postinst
        assert not re.search(r'(?m)^\s*chown\s+-[^\n]*R', postinst)
        assert 'Package: devkit\n' in control
        architecture = re.search(r'^Architecture: (.+)$', control, re.MULTILINE)[1]
    with tarfile.open(fileobj=io.BytesIO(members['data.tar.xz']), mode='r:xz') as archive:
        with tempfile.TemporaryDirectory(prefix='devkit-deb-verify-') as temporary:
            entries = extract_data_archive(archive, Path(temporary))
        sandbox = archive.getmember('./opt/devkit/chrome-sandbox')
        assert sandbox.mode == 0o4755
        executable = archive.extractfile('./opt/devkit/devkit').read(64)
        assert executable[:4] == b'\x7fELF'
        assert struct.unpack_from('<H', executable, 18)[0] == (183 if architecture == 'arm64' else 62)
        report = json.load(archive.extractfile('./usr/share/doc/devkit/runtime-report.json'))
        assert report['webKitRequired'] is False
        assert archive.getmember('./opt/devkit/resources/app.asar').size > 0
        launcher = archive.extractfile('./usr/bin/devkit').read().decode()
        assert '/opt/devkit/devkit' in launcher
        assert '--no-sandbox' not in launcher
    print(json.dumps({ 'package': str(source), 'architecture': architecture, 'minimumGlibc': report['minimumGlibc'], 'files': sum(entry.isfile() for entry in entries), 'directories': sum(entry.isdir() for entry in entries), 'emptyRootExtraction': True, 'noWebKitDependency': True, 'noSystemLibraryFiles': True, 'sandboxMode': '4755 root:root' }, indent=2))


if __name__ == '__main__':
    verify(Path(sys.argv[1]))
