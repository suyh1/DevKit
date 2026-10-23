import contextlib
import importlib.util
import io
import struct
import tarfile
import tempfile
import unittest
import os
import subprocess
import shutil
from pathlib import Path


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(f'{name}.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


builder = load_script('make-deb')
verifier = load_script('verify-deb')


def directory(name):
    entry = tarfile.TarInfo(name)
    entry.type = tarfile.DIRTYPE
    entry.mode = 0o755
    return entry


class DebPackagingTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('sh'), 'Shell required for isolated postinst fixture')
    def test_configs_postinst_ownership_and_existing_data(self):
        for owner, sudo_uid, expected in [('0', '1000', '1000'), ('1001', '1000', '1001'), ('0', '0', '0'), ('0', 'invalid;command', '0')]:
            with self.subTest(owner=owner, sudo_uid=sudo_uid), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                configs = root / 'configs'
                configs.mkdir()
                (configs / 'projects.json').write_text('keep data')
                binary = root / 'bin'
                binary.mkdir()
                scripts = {
                    'stat': '#!/bin/sh\nif [ -f "$STATE" ]; then cat "$STATE"; else printf "%s" "$OWNER"; fi\n',
                    'getent': '#!/bin/sh\nexit 0\n',
                    'chown': '#!/bin/sh\nprintf "%s" "$1" > "$STATE"\nprintf "%s\\n" "$@" > "$CALLS"\n',
                }
                for name, source in scripts.items():
                    (binary / name).write_text(source, newline='\n')
                    (binary / name).chmod(0o755)
                script = root / 'postinst'
                shell_bin = '/' + binary.drive[0].lower() + binary.as_posix()[2:] if os.name == 'nt' else binary.as_posix()
                source = builder.configs_postinst().replace('configs=/opt/devkit/configs', f"configs='{configs.as_posix()}'")
                source = source.replace('set -eu', f"set -eu\nPATH='{shell_bin}':$PATH\nexport PATH")
                script.write_text(source, newline='\n')
                env = {**os.environ, 'PATH': str(binary) + os.pathsep + os.environ['PATH'], 'OWNER': owner, 'SUDO_UID': sudo_uid, 'PKEXEC_UID': '', 'STATE': (root / 'state').as_posix(), 'CALLS': (root / 'calls').as_posix()}
                result = subprocess.run(['sh', '-x', str(script)], env=env, check=True, capture_output=True)
                actual = (root / 'state').read_text() if (root / 'state').exists() else owner
                self.assertEqual(actual, expected, result.stdout.decode(errors='replace') + result.stderr.decode(errors='replace'))
                self.assertEqual((configs / 'projects.json').read_text(), 'keep data')
                if expected != owner:
                    self.assertEqual((root / 'calls').read_text().splitlines(), [expected, configs.as_posix()])

    @unittest.skipIf(os.name == 'nt', 'POSIX symlink fixture runs in Linux CI')
    def test_configs_postinst_rejects_symbolic_link(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / 'target'
            target.mkdir()
            (root / 'configs').symlink_to(target, target_is_directory=True)
            script = root / 'postinst'
            script.write_text(builder.configs_postinst().replace('configs=/opt/devkit/configs', f"configs='{root / 'configs'}'"))
            result = subprocess.run(['sh', str(script)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('symbolic link', result.stderr)

    def test_file_only_archive_rejects_missing_parent(self):
        entry = tarfile.TarInfo('./opt/devkit/chrome-sandbox')
        with self.assertRaisesRegex(ValueError, 'Missing prior parent directory'):
            verifier.validate_data_entries([entry])

    def test_directory_must_precede_children(self):
        entries = [directory('./opt/devkit'), directory('./opt')]
        with self.assertRaisesRegex(ValueError, 'Missing prior parent directory'):
            verifier.validate_data_entries(entries)

    def test_file_cannot_substitute_for_directory(self):
        entries = [directory('./opt'), directory('./opt/devkit'),
                   tarfile.TarInfo('./opt/devkit/resources'), tarfile.TarInfo('./opt/devkit/resources/app.asar')]
        with self.assertRaisesRegex(ValueError, 'Missing prior parent directory'):
            verifier.validate_data_entries(entries)

    def test_duplicate_directory_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate archive path'):
            verifier.validate_data_entries([directory('./opt'), directory('./opt')])

    def test_unsafe_paths_rejected(self):
        for name in ['/opt', './opt/../lib', './opt//devkit', './opt\\devkit', './usr/lib']:
            with self.subTest(path=name), self.assertRaises(ValueError):
                verifier.validate_data_entries([directory(name)])

    def test_links_and_incorrect_permissions_rejected(self):
        for entry_type, mode in [(tarfile.SYMTYPE, 0o755), (tarfile.LNKTYPE, 0o755), (tarfile.DIRTYPE, 0o777)]:
            entry = directory('./opt')
            entry.type = entry_type
            entry.mode = mode
            with self.subTest(entry_type=entry_type, mode=mode), self.assertRaises(ValueError):
                verifier.validate_data_entries([entry])

    def test_real_builder_roundtrip_into_empty_root(self):
        for arch, machine, deb_arch in [('arm64', 183, 'arm64'), ('x64', 62, 'amd64')]:
            with self.subTest(architecture=arch), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                runtime = root / 'runtime'
                (runtime / 'resources').mkdir(parents=True)
                (runtime / 'locales').mkdir()
                executable = bytearray(64)
                executable[:6] = b'\x7fELF\x02\x01'
                struct.pack_into('<H', executable, 18, machine)
                (runtime / 'devkit').write_bytes(executable + b'GLIBC_2.25\x00')
                (runtime / 'chrome-sandbox').write_bytes(b'sandbox fixture')
                (runtime / 'resources/app.asar').write_bytes(b'asar fixture')
                (root / 'build/icons').mkdir(parents=True)
                (root / 'build/icons/128x128.png').write_bytes(b'icon fixture')
                with contextlib.redirect_stdout(io.StringIO()) as output:
                    package = builder.build_package(runtime, '1.1.0', arch, root)
                    verifier.verify(package)
                self.assertEqual(package.name, f'DevKit_1.1.0-1_{deb_arch}.deb')
                self.assertIn('"emptyRootExtraction": true', output.getvalue())
                buffer = io.BytesIO()
                with tarfile.open(fileobj=buffer, mode='w') as archive:
                    builder.write_data_archive(archive, runtime, 'launcher', 'desktop', b'icon', {})
                buffer.seek(0)
                with tarfile.open(fileobj=buffer, mode='r') as archive:
                    destination = root / 'extracted'
                    destination.mkdir()
                    verifier.extract_data_archive(archive, destination)
                self.assertTrue((destination / 'opt/devkit/locales').is_dir())
                self.assertEqual((destination / 'opt/devkit/resources/app.asar').read_bytes(), b'asar fixture')
                self.assertEqual((destination / 'usr/bin/devkit').read_text(), 'launcher')
                self.assertTrue((destination / 'usr/share/icons/hicolor/128x128/apps/devkit.png').is_file())

    def test_invalid_version_rejected(self):
        for version in ['1.1.0-0', '1.1.0-../bad', '1.1', '1.1.0\n']:
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, 'Invalid package version'):
                builder.build_package(Path('.'), version, 'arm64', Path('.'))


if __name__ == '__main__':
    unittest.main()
