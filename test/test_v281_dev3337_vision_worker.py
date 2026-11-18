"""Only new read-only vision worker/host-runtime surface: no external network/model calls."""
import json
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent

class VisionWorkerSafety(unittest.TestCase):
    def launch(self, payload):
        p=subprocess.run([sys.executable,str(ROOT/'lib'/'vision_dsh.py'),'--describe-stdin','--home',str(ROOT)],
                         input=payload,encoding='utf8',capture_output=True,timeout=10)
        self.assertEqual(p.returncode,0)
        return json.loads(p.stdout)

    def test_bad_video_id_denied_before_fetch(self):
        r=self.launch(json.dumps({'bvid':'not-a-BV'}))
        self.assertEqual(r['status'],'invalid_vision_worker_request')

    def test_bad_json_denied(self):
        r=self.launch('{malformed')
        self.assertEqual(r['status'],'invalid_vision_worker_request')

    def test_oversize_denied(self):
        r=self.launch('x'*5000)
        self.assertEqual(r['status'],'invalid_vision_worker_request')

    def test_unsupported_mode_denied(self):
        p=subprocess.run([sys.executable,str(ROOT/'lib'/'vision_dsh.py'),'--home',str(ROOT)],
                         encoding='utf8',capture_output=True,timeout=10)
        self.assertEqual(json.loads(p.stdout)['status'],'unsupported_vision_worker_mode')

    def test_production_mcp_requires_selected_worker(self):
        text=(ROOT/'vendor'/'bilibili-mcp'/'mcp_server.py').read_text(encoding='utf8')
        self.assertIn("os.environ.get('BILI_VISION_PYTHON_REQUIRED')=='1'",text)
        self.assertIn('subprocess.run([vision_python,str(script)',text)
        self.assertIn('stderr=subprocess.DEVNULL',text)

if __name__=='__main__': unittest.main()
