import subprocess
import shutil
import sys
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class AndroidConfigTests(unittest.TestCase):
    def test_metadata_permissions_and_wake_lock_are_applied(self):
        with tempfile.TemporaryDirectory() as tmp:
            android = Path(tmp)
            app = android / 'app'
            (app / 'src/main/res/values').mkdir(parents=True)
            (app / 'src/main/java/com/example').mkdir(parents=True)
            (app / 'build.gradle').write_text('''android {\n defaultConfig {\n  applicationId "com.old.app"\n  versionCode 1\n  versionName "1.0"\n }\n}\n''', encoding='utf-8')
            (app / 'src/main/AndroidManifest.xml').write_text('''<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest>''', encoding='utf-8')
            (app / 'src/main/java/com/example/MainActivity.java').write_text('''package com.example;\nimport com.getcapacitor.BridgeActivity;\npublic class MainActivity extends BridgeActivity {}\n''', encoding='utf-8')
            result = subprocess.run([
                sys.executable, str(ROOT / 'scripts/configure_android.py'),
                '--android-dir', str(android), '--app-name', 'Nexa Demo',
                '--package-id', 'com.nexa.demo', '--version', '1.2.3',
                '--version-code', '9', '--internet-mode', 'online',
                '--camera', '--wake-lock', '--vibrate',
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            gradle = (app / 'build.gradle').read_text(encoding='utf-8')
            self.assertIn('applicationId "com.nexa.demo"', gradle)
            self.assertIn('versionCode 9', gradle)
            manifest = ET.parse(app / 'src/main/AndroidManifest.xml').getroot()
            ns = '{http://schemas.android.com/apk/res/android}name'
            permissions = {node.get(ns) for node in manifest.findall('uses-permission')}
            self.assertTrue({'android.permission.INTERNET', 'android.permission.CAMERA', 'android.permission.WAKE_LOCK', 'android.permission.VIBRATE'} <= permissions)
            java = (app / 'src/main/java/com/example/MainActivity.java').read_text(encoding='utf-8')
            self.assertIn('FLAG_KEEP_SCREEN_ON', java)

    def test_offline_cache_generator_adds_service_worker(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'index.html').write_text('<!doctype html><title>test</title>', encoding='utf-8')
            (root / 'app.js').write_text('console.log("ok")', encoding='utf-8')
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/enable_offline.py'), str(root)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((root / 'sw.js').is_file())
            html = (root / 'index.html').read_text(encoding='utf-8')
            self.assertIn("navigator.serviceWorker.register('./sw.js')", html)
            worker = (root / 'sw.js').read_text(encoding='utf-8')
            self.assertIn("CACHE='nexabuild-offline-v2'", worker)
            self.assertIn('./app.js', worker)
            self.assertNotIn('./large.mp4', worker)
            self.assertIn('catch{return Response.error();}', worker)
            node = shutil.which('node')
            if node:
                check = subprocess.run([node, '--check', str(root / 'sw.js')], capture_output=True, text=True)
                self.assertEqual(check.returncode, 0, check.stderr)

    def test_next_static_export_out_directory_is_supported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive_path = root / 'next-export.zip'
            with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('package.json', '{"scripts":{"build":"next build"}}')
                archive.writestr('next.config.js', 'module.exports = { output: "export" }')
                archive.writestr('out/index.html', '<!doctype html><title>Exported</title>')
                archive.writestr('out/_next/static/app.js', 'console.log("built")')
            out = root / 'www'
            result = subprocess.run([
                sys.executable, str(ROOT / 'scripts/prepare_site.py'),
                '--zip', str(archive_path), '--out', str(out),
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((out / 'index.html').is_file())
            self.assertTrue((out / '_next/static/app.js').is_file())

    def test_angular_nested_browser_output_is_selected_over_source_shell(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive_path = root / 'angular.zip'
            with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('index.html', '<!doctype html><div id="app">SOURCE SHELL</div>')
                archive.writestr('package.json', '{"scripts":{"build":"ng build"}}')
                archive.writestr('angular.json', '{"projects":{}}')
                archive.writestr('dist/demo/browser/index.html', '<!doctype html><title>ANGULAR OUTPUT</title>')
                archive.writestr('dist/demo/browser/main.js', 'console.log("angular")')
            out = root / 'www'
            result = subprocess.run([
                sys.executable, str(ROOT / 'scripts/prepare_site.py'),
                '--zip', str(archive_path), '--out', str(out),
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            page = (out / 'index.html').read_text(encoding='utf-8')
            self.assertIn('ANGULAR OUTPUT', page)
            self.assertNotIn('SOURCE SHELL', page)
            self.assertTrue((out / 'main.js').is_file())

    def test_framework_source_without_compiled_output_is_rejected_clearly(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive_path = root / 'vite-source.zip'
            with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('index.html', '<!doctype html><div id="app"></div>')
                archive.writestr('package.json', '{"scripts":{"build":"vite build"}}')
                archive.writestr('vite.config.js', 'export default {}')
            result = subprocess.run([
                sys.executable, str(ROOT / 'scripts/prepare_site.py'),
                '--zip', str(archive_path), '--out', str(root / 'www'),
            ], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('source framework', result.stderr.lower())

    def test_zip_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive_path = root / 'unsafe.zip'
            with zipfile.ZipFile(archive_path, 'w') as archive:
                archive.writestr('../escape.txt', 'nope')
            result = subprocess.run([
                sys.executable, str(ROOT / 'scripts/prepare_site.py'),
                '--zip', str(archive_path), '--out', str(root / 'www'),
            ], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('keluar', result.stderr.lower())

    def test_included_sample_project_prepares_as_static_site(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'www'
            result = subprocess.run([
                sys.executable, str(ROOT / 'scripts/prepare_site.py'),
                '--zip', str(ROOT / 'Sample-Web-Project.zip'), '--out', str(out),
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            page = (out / 'index.html').read_text(encoding='utf-8')
            self.assertIn('NEXABUILD · SAMPLE WEB PROJECT', page)
            self.assertIn('uji interaksi', page.lower())

    def test_upload_chunk_reassembly_checks_manifest_size_and_sha256(self):
        import hashlib
        import json
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            upload_id = 'b2e7c7de-a1e4-4d6d-9a62-59b5b1cc2b6f'
            upload = root / 'incoming'
            (upload / 'parts').mkdir(parents=True)
            payload = b'PK\x03\x04' + b'example-site-payload' * 300
            chunk_size = 2 * 1024 * 1024
            (upload / 'parts/part-000.bin').write_bytes(payload)
            manifest = {
                'schemaVersion': 1, 'uploadId': upload_id, 'byteSize': len(payload),
                'sha256': hashlib.sha256(payload).hexdigest(), 'chunkSize': chunk_size,
                'chunkCount': 1, 'parts': [{'index': 0, 'name': 'part-000.bin', 'size': len(payload)}],
            }
            (upload / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            out = root / 'result.zip'
            args = [sys.executable, str(ROOT / 'scripts/reassemble_upload.py'), '--upload-dir', str(upload),
                    '--output', str(out), '--upload-id', upload_id, '--expected-size', str(len(payload)),
                    '--expected-sha256', manifest['sha256'], '--expected-chunks', '1']
            passed = subprocess.run(args, capture_output=True, text=True)
            self.assertEqual(passed.returncode, 0, passed.stderr)
            self.assertEqual(out.read_bytes(), payload)
            bad_args = args.copy(); bad_args[bad_args.index('--expected-sha256') + 1] = '0' * 64
            failed = subprocess.run(bad_args, capture_output=True, text=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn('SHA-256', failed.stderr)
            self.assertFalse(out.exists())

    def test_native_flutter_android_and_react_native_sources_are_not_wrapped_as_static_sites(self):
        cases = {
            'flutter': {'pubspec.yaml': 'name: example\n', 'build/web/index.html': '<!doctype html><title>web</title>'},
            'android': {'settings.gradle': 'rootProject.name = "Example"', 'app/src/main/AndroidManifest.xml': '<manifest />', 'app/src/main/assets/public/index.html': '<!doctype html>'},
            'react-native': {'package.json': '{"dependencies":{"react-native":"1.0.0"}}', 'index.js': 'AppRegistry.registerComponent("x",()=>App);', 'web/index.html': '<!doctype html>'},
        }
        for name, files in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); archive = root / f'{name}.zip'
                with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zf:
                    for file_name, content in files.items(): zf.writestr(file_name, content)
                result = subprocess.run([sys.executable, str(ROOT / 'scripts/prepare_site.py'), '--zip', str(archive), '--out', str(root / 'out')], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('terdeteksi', result.stderr.lower())

    def test_apk_verifier_checks_signature_package_permissions_and_launcher_resources(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); tools = root / 'tools'; tools.mkdir()
            apk = root / 'sample.apk'; apk.write_bytes(b'PK' + b'0' * 4096)
            signer = tools / 'apksigner'
            signer.write_text('#!/usr/bin/env python3\nprint("Verifies")\n', encoding='utf-8'); signer.chmod(0o755)
            aapt = tools / 'aapt'
            aapt.write_text('''#!/usr/bin/env python3
import sys
args=sys.argv[1:]
if args[:2] == ["dump", "badging"]:
 print("package: name='com.nexa.demo' versionCode='12' versionName='1.2.0'")
 print("application-label:'Nexa Demo'")
 print("application-icon-160:'res/mipmap-mdpi-v4/ic_launcher.png'")
elif args[:2] == ["dump", "permissions"]:
 print("uses-permission: name='android.permission.INTERNET'")
 print("uses-permission: name='android.permission.ACCESS_NETWORK_STATE'")
 print("uses-permission: name='android.permission.CAMERA'")
elif args[:1] == ["list"]:
 print("AndroidManifest.xml\\nclasses.dex\\nresources.arsc\\nres/mipmap-mdpi-v4/ic_launcher.png")
else: raise SystemExit(3)
''', encoding='utf-8'); aapt.chmod(0o755)
            command = [sys.executable, str(ROOT / 'scripts/verify_apk.py'), '--apk', str(apk),
                       '--package-id', 'com.nexa.demo', '--version', '1.2.0', '--version-code', '12',
                       '--internet-mode', 'online', '--camera', '--build-tools', str(tools)]
            passed = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(passed.returncode, 0, passed.stderr)
            self.assertIn('signature=verified', passed.stdout)
            bad = command.copy(); bad[bad.index('--version-code') + 1] = '13'
            failed = subprocess.run(bad, capture_output=True, text=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn('Metadata APK tidak cocok', failed.stderr)

    def test_zip_duplicate_casefold_paths_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); archive = root / 'duplicate.zip'
            with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zf:
                zf.writestr('index.html', '<!doctype html>')
                zf.writestr('INDEX.HTML', '<!doctype html>')
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/prepare_site.py'), '--zip', str(archive), '--out', str(root / 'out')], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('duplikat', result.stderr.lower())

if __name__ == '__main__':
    unittest.main()
