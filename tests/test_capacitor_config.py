import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "write_capacitor_config.py"

class CapacitorConfigTests(unittest.TestCase):
    def test_writes_valid_json_without_typescript(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "www").mkdir()
            (root / "www" / "index.html").write_text("<!doctype html><title>Demo</title>", encoding="utf-8")
            result = subprocess.run([sys.executable, str(SCRIPT), "--app-id", "com.nexa.demo", "--app-name", "Nexa Demo", "--web-dir", "www"], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            config = json.loads((root / "capacitor.config.json").read_text(encoding="utf-8"))
            self.assertEqual(config, {"appId": "com.nexa.demo", "appName": "Nexa Demo", "webDir": "www"})
            self.assertFalse((root / "capacitor.config.ts").exists())

    def test_rejects_invalid_application_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "www").mkdir()
            (root / "www" / "index.html").write_text("ok", encoding="utf-8")
            result = subprocess.run([sys.executable, str(SCRIPT), "--app-id", "com..broken", "--app-name", "Demo", "--web-dir", "www"], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn("Application ID tidak valid", result.stderr)

    def test_rejects_web_directory_without_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "www").mkdir()
            result = subprocess.run([sys.executable, str(SCRIPT), "--app-id", "com.nexa.demo", "--app-name", "Demo", "--web-dir", "www"], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn("webDir", result.stderr)

if __name__ == "__main__":
    unittest.main()
