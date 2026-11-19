import ast
import asyncio
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SOURCE = (Path(__file__).resolve().parents[1] / 'vendor/bilibili-mcp/mcp_server.py').read_text(encoding='utf8')
TREE = ast.parse(SOURCE)
FUNCS = []
for node in TREE.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in {'_record_asr_attempt', '_asr_failure_category', '_hidden_windows_child', 'bili_transcribe_safe'}:
        node.decorator_list = []
        FUNCS.append(node)
COMPILED = compile(ast.Module(body=FUNCS, type_ignores=[]),'<isolated-whisper>','exec')
class TestAsrDeadline(unittest.TestCase):
    def test_bounded_deadline_and_private_phase_diagnostics(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            # Match the production interpreter location on both platforms.
            local_python = root / '.venv-asr' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
            local_python.parent.mkdir(parents=True)
            local_python.write_text('fake')
            (root/'asr.py').write_text('fake')
            state={'deadline':None}
            async def fail(argv,*,cwd,timeout_seconds):
                state['deadline']=timeout_seconds
                raise subprocess.TimeoutExpired(argv,timeout_seconds,stderr=b'[asr] \xe5\x85\x88\xe4\xb8\x8b\xe9\x9f\xb3\xe9\xa2\x91\xe2\x80\xa6\nprivate text')
            ns={'__builtins__':__builtins__,'_DUTY_HOME':root,'os':os,'json':json,
                '_run_bounded_asr_process':fail,
                'asyncio':asyncio,'subprocess':subprocess,'_guard':lambda _:None,
                '_valid_bv':lambda value:value}
            exec(COMPILED,ns)
            with patch.dict(os.environ,{'BILI_ASR_ENABLED':'1','BILI_ASR_MODEL':'small','BILI_ASR_TIMEOUT_SECONDS':'9999'}):
                r=json.loads(asyncio.run(ns['bili_transcribe_safe']('BV1234567890')))
            self.assertEqual(state['deadline'],600)
            self.assertEqual(r['status'],'asr_timeout')
            self.assertEqual(r['phase'],'audio-download')
            self.assertNotIn('private text',json.dumps(r))
            saved=(root/'asr-last-run.json').read_text(encoding='utf8')
            self.assertIn('timeout-audio-download',saved)
            self.assertNotIn('private text',saved)
