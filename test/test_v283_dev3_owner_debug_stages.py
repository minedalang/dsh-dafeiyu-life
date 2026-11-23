"""Safe one-shot MCP progress markers never expose arbitrary Python output."""
import ast
import io
import os
import unittest
import sys
import json
import time
from pathlib import Path
from contextlib import redirect_stderr
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
import preview_vision as pv

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'vendor' / 'bilibili-mcp' / 'mcp_server.py'
TREE = ast.parse(SOURCE.read_text(encoding='utf8'))
FUNCTION = next(item for item in TREE.body if isinstance(item, ast.FunctionDef)
                and item.name == '_owner_debug_stage')
ENV = {'os': os}
exec(compile(ast.Module(body=[FUNCTION], type_ignores=[]), str(SOURCE), 'exec'), ENV)


class SafeProgressTests(unittest.TestCase):
    def run_stage(self, enabled, phase):
        output = io.StringIO()
        with patch.dict(os.environ, {'DSH_OWNER_VIDEO_DEBUG_STAGE': enabled}):
            with redirect_stderr(output):
                ENV['_owner_debug_stage'](phase)
        return output.getvalue()

    def test_default_mcp_emits_no_progress(self):
        self.assertEqual(self.run_stage('0', 'model-running'), '')
        self.assertEqual(self.run_stage('', 'frames-reading'), '')

    def test_ollama_markers_are_private_allowlisted_and_off_by_default(self):
        stream = io.StringIO()
        with patch.dict(os.environ, {'DSH_OWNER_VIDEO_DEBUG_STAGE':'0'}), redirect_stderr(stream):
            pv._owner_debug_ollama('request-start',1)
        self.assertEqual(stream.getvalue(),'')
        with patch.dict(os.environ, {'DSH_OWNER_VIDEO_DEBUG_STAGE':'1'}), redirect_stderr(stream):
            pv._owner_debug_ollama('request-start',1)
            pv._owner_debug_ollama('request-failed',1,'ollama_request_timeout',8000)
            pv._owner_debug_ollama('password=secret',2)
            pv._owner_debug_ollama('request-failed',2,'BV_SECRET_TOKEN')
        self.assertEqual(stream.getvalue(),
            'DSH_OWNER_DEBUG_OLLAMA:1:request-start:none:0\n'
            'DSH_OWNER_DEBUG_OLLAMA:1:request-failed:ollama_request_timeout:8000\n')

    def test_debug_budget_is_fixed_and_normal_life_has_no_override(self):
        with patch.dict(os.environ, {'DSH_OWNER_VIDEO_DEBUG_STAGE':'0',
                                      'DSH_OWNER_DEBUG_VISION_BUDGET_SEC':'360'}):
            self.assertIsNone(pv._owner_debug_deadline())
        with patch.dict(os.environ, {'DSH_OWNER_VIDEO_DEBUG_STAGE':'1',
                                      'DSH_OWNER_DEBUG_VISION_BUDGET_SEC':'360'}):
            self.assertAlmostEqual(pv._owner_debug_deadline(),pv._OWNER_DEBUG_IMPORT_AT+360)
        with patch.dict(os.environ, {'DSH_OWNER_VIDEO_DEBUG_STAGE':'1',
                                      'DSH_OWNER_DEBUG_VISION_BUDGET_SEC':'540'}):
            self.assertEqual(pv._owner_debug_deadline(), pv._OWNER_DEBUG_IMPORT_AT+1)

    def test_local_ollama_http_and_parse_receipts_without_network_or_model_text(self):
        class Reply:
            def __enter__(self):return self
            def __exit__(self,*_):return None
            def read(self,*_):return json.dumps({'done':True,'done_reason':'stop',
                'message':{'content':'画面中有内容 SECRET'}}).encode()
        class Opener:
            def open(self,req,timeout=None):
                self.timeout=timeout
                return Reply()
        events=io.StringIO()
        frame={'second':1,'bytes':b'fake'}
        with patch.dict(os.environ, {'DSH_OWNER_VIDEO_DEBUG_STAGE':'1',
            'DSH_OWNER_DEBUG_VISION_BUDGET_SEC':'360','BILI_VISION_LOCAL_THINKING':'off'}), \
                patch('urllib.request.build_opener',return_value=Opener()), redirect_stderr(events):
            response=pv._call_local_ollama([frame],'qwen3.5:2b')
        self.assertIn('SECRET',response)
        receipt=events.getvalue()
        self.assertIn(':request-start:none:',receipt)
        self.assertIn(':http-received:none:',receipt)
        self.assertIn(':response-parsed:none:',receipt)
        self.assertIn(':response-validated:none:',receipt)
        self.assertNotIn('SECRET',receipt)

    def test_ollama_budget_exhaustion_never_sends_http_request(self):
        with patch.dict(os.environ,{'DSH_OWNER_VIDEO_DEBUG_STAGE':'1',
           'DSH_OWNER_DEBUG_VISION_BUDGET_SEC':'1'}), \
           patch.object(pv,'_OWNER_DEBUG_IMPORT_AT',time.monotonic()-5), \
           patch('urllib.request.build_opener') as opener:
            with self.assertRaises(pv.VisionServiceError) as err:
                pv._call_local_ollama([{'second':1,'bytes':b'fake'}],'qwen3.5:2b')
        self.assertEqual(err.exception.code,'vision_board_deadline')
        opener.assert_not_called()

    def test_only_fixed_operational_markers(self):
        self.assertEqual(self.run_stage('1', 'frames-settled'),
                         'DSH_OWNER_DEBUG_STAGE:frames-settled\n')
        self.assertEqual(self.run_stage('1', 'model-running'),
                         'DSH_OWNER_DEBUG_STAGE:model-running\n')
        self.assertEqual(self.run_stage('1', 'BVSECRET_ACCOUNT_PASSWORD'), '')
        self.assertEqual(self.run_stage('1', 'model-running\npassword=secret'), '')


if __name__ == '__main__':
    unittest.main()
