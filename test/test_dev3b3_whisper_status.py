"""Exercise actual MCP functions without launching DSH or downloading media."""
import ast
import asyncio
import json
import subprocess
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'vendor' / 'bilibili-mcp' / 'mcp_server.py').read_text(encoding='utf8')
TREE = ast.parse(SOURCE)
NAMES = {'_record_asr_attempt', '_asr_failure_category', '_hidden_windows_child', 'bili_transcribe_safe'}
FUNCS = []
for node in TREE.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in NAMES:
        node.decorator_list = []
        FUNCS.append(node)
assert len(FUNCS) == 4
COMPILED = compile(ast.Module(body=FUNCS, type_ignores=[]), '<mcp-whisper>', 'exec')

class WhisperRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        (self.home / '.venv-asr' / 'bin').mkdir(parents=True)
        (self.home / '.venv-asr' / 'bin' / 'python').write_text('fake')
        (self.home / 'asr.py').write_text('fake')
        self.argv = []
        def fake_run(argv, **kw):
            self.argv.append(argv)
            receipt = {'bvid': 'BV1234567890', 'source':'local-asr',
                'asr_evidence': 'faster-whisper-machine-transcript', 'text':'PRIVATE SPOKEN CONTENT',
                'timed_segments':[{'startSeconds':1,'endSeconds':2,'text':'SECRET'}]}
            return types.SimpleNamespace(returncode=0, stdout=json.dumps(receipt), stderr='')
        self.fake_run = fake_run
        self.namespace = {
            '__builtins__': __builtins__,
            '_DUTY_HOME': self.home,
            'os': __import__('os'), 'json': json, 'asyncio': asyncio,
            'subprocess': subprocess, '_guard': lambda _: None,
            '_valid_bv': lambda value: value if value == 'BV1234567890' else (_ for _ in ()).throw(ValueError('bad BV')),
        }
        exec(COMPILED, self.namespace)

    def tearDown(self):
        self.tmp.cleanup()

    def call(self):
        with patch.object(subprocess, 'run', self.fake_run):
            return json.loads(asyncio.run(self.namespace['bili_transcribe_safe']('BV1234567890')))

    def test_disabled_creates_no_false_history(self):
        with patch.dict(__import__('os').environ, {'BILI_ASR_ENABLED':'0','BILI_ASR_MODEL':'medium'}):
            raw = asyncio.run(self.namespace['bili_transcribe_safe']('BV1234567890'))
        self.assertIn('未授权',raw)
        self.assertFalse((self.home/'asr-last-run.json').exists())

    def test_configured_model_reaches_actual_subprocess_and_only_safe_status_saved(self):
        with patch.dict(__import__('os').environ, {'BILI_ASR_ENABLED':'1','BILI_ASR_MODEL':'medium'}):
            receipt = self.call()
        self.assertEqual(receipt['text'],'PRIVATE SPOKEN CONTENT')
        self.assertEqual(self.argv[-1][-2:],['--model','medium'])
        disk=(self.home/'asr-last-run.json').read_text()
        meta=json.loads(disk)
        self.assertEqual(meta['outcome'],'success')
        self.assertEqual(meta['model'],'medium')
        self.assertEqual(meta['segments'],1)
        self.assertNotIn('BV123',disk)
        self.assertNotIn('PRIVATE',disk)
        self.assertNotIn('SECRET',disk)

    def test_failure_records_failed_without_false_success(self):
        self.fake_run=lambda args,**kw: types.SimpleNamespace(returncode=1,stdout='',stderr='secret')
        with patch.dict(__import__('os').environ, {'BILI_ASR_ENABLED':'1','BILI_ASR_MODEL':'small'}):
            receipt = self.call()
        self.assertFalse(receipt['ok'])
        meta=json.loads((self.home/'asr-last-run.json').read_text())
        self.assertEqual(meta['outcome'],'failed')
        self.assertEqual(meta['reason'],'process-failed')
        self.assertEqual(receipt['reasonCode'],'process-failed')
        self.assertNotIn('secret',json.dumps(meta))

if __name__ == '__main__': unittest.main()
