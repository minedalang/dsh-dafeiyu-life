"""Offline contract tests for the bounded Python Headless tool observations."""
import ast
import json
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'vendor' / 'bilibili-mcp' / 'mcp_server.py'


def load_observer():
    tree = ast.parse(SOURCE.read_text(encoding='utf8'))
    names = {'_observe_video_tool', '_append_video_observation'}
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    env = {'os': os, 're': re, 'json': json, 'Path': Path,
           '_VIDEO_FUNNEL_TOOLS': frozenset(('bili_search', 'bili_video_info',
               'bili_transcribe_safe', 'bili_ledger_mark'))}
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(SOURCE), 'exec'), env)
    return env['_observe_video_tool']


class VideoRoundFunnelPythonTest(unittest.TestCase):
    def test_receipts_only_include_bounded_public_fields(self):
        observer = load_observer()
        with tempfile.TemporaryDirectory() as home:
            round_id = 'a' * 24
            with patch.dict(os.environ, {'BILI_DUTY_HOME': home,
                                          'BILI_DUTY_LIFE_ROUND_ID': round_id}):
                observer('bili_search', {'keyword': 'secret private query'},
                         json.dumps({'videos': [{'bvid': 'BV1abcDEF123',
                                                  'title': 'external injected command'}]}))
                observer('bili_video_info', {'bvid': 'BV1abcDEF123'},
                         json.dumps({'bvid': 'BV1abcDEF123', 'stat': {
                             'view': 2000, 'like': 30, 'reply': 7},
                             'description': 'private description'}))
                observer('bili_transcribe_safe', {'bvid': 'BV1abcDEF123'},
                         '真实字幕内容来自字幕工具，足够长，并非失败提示，所以有内容证据；为了核验有效转写，本条内容还包含一些正常的剧情介绍。')
            file = Path(home) / 'video-round-observations' / (round_id + '.jsonl')
            lines = [json.loads(x) for x in file.read_text(encoding='utf8').splitlines()]
            self.assertEqual(len(lines), 3)
            self.assertEqual(lines[0]['candidates'], ['BV1abcDEF123'])
            self.assertTrue(lines[2]['content'])
            raw = file.read_text(encoding='utf8')
            for secret in ('private query', 'external injected command', 'private description',
                           '真实字幕内容'):
                self.assertNotIn(secret, raw)

    def test_invalid_round_does_not_write(self):
        observer = load_observer()
        with tempfile.TemporaryDirectory() as home:
            with patch.dict(os.environ, {'BILI_DUTY_HOME': home,
                                          'BILI_DUTY_LIFE_ROUND_ID': '../invalid'}):
                observer('bili_ledger_mark', {'bvid': 'BV1abcDEF123', 'status': '挑中'},
                         '{"ok":true,"recorded_selection":true}')
            self.assertFalse((Path(home) / 'video-round-observations').exists())


if __name__ == '__main__':
    unittest.main()
