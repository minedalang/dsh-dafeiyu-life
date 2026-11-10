"""Isolated tests of the real MCP read-only comment consideration function.

Never imports Bilibili network dependencies and never invokes external writes.
"""
import ast
import asyncio
import json
import os
import re
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SOURCE = (Path(__file__).resolve().parents[1] / 'vendor/bilibili-mcp/mcp_server.py').read_text(encoding='utf-8')
TREE = ast.parse(SOURCE)
FUNCTION = next(n for n in TREE.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'bili_comment_consideration')
FUNCTION.decorator_list = []
CODE = compile(ast.fix_missing_locations(ast.Module(body=[FUNCTION], type_ignores=[])), '<bili_comment_consideration>', 'exec')


class CommentConsiderationTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.uid = '1234567'
        self.paused = False
        def request(route, payload):
            self.requests.append((route, dict(payload)))
            return {'ok': True, 'recorded': True}
        self.ctx = {'asyncio': asyncio, 'json': json, 'os': os, 're': re,
                    'get_cred': lambda: SimpleNamespace(dedeuserid=self.uid),
                    '_guard': lambda action: json.dumps({'ok': False, 'blocked': True}) if self.paused else '',
                    '_valid_bv': lambda bvid: bvid if re.fullmatch(r'BV[0-9A-Za-z]{10}', bvid) else (_ for _ in ()).throw(ValueError('invalid BV')),
                    '_life_video_request': request}
        exec(CODE, self.ctx)

    def call(self, bvid='BV1abcde1234', decision='consider', reason='short', draft='我想回应视频里真实看到的细节', evidence='本轮字幕读到主题与具体场面，评论区也有真实讨论'):
        return json.loads(asyncio.run(self.ctx['bili_comment_consideration'](bvid, decision, reason, draft, evidence)))

    def test_review_is_not_write_and_does_not_send_reason_or_model_text(self):
        with patch.dict(os.environ, {'BILI_DUTY_LIFE_ROUND_ID': 'a' * 24}):
            result = self.call(reason='PRIVATE_MODEL_REASON')
        self.assertTrue(result['ok'])
        self.assertTrue(result['recorded'])
        self.assertEqual(self.requests, [('/life-comment-review', {'uid':'1234567',
            'roundId':'a'*24, 'bvid':'BV1abcde1234', 'decision':'consider',
            'draft':'我想回应视频里真实看到的细节', 'evidence':'本轮字幕读到主题与具体场面，评论区也有真实讨论'})])
        self.assertNotIn('PRIVATE_MODEL_REASON', json.dumps(self.requests))
        self.assertNotIn('commentText', json.dumps(self.requests))
        self.assertEqual(result['decision'], '')  # fake backend has not returned Life's decision
        self.assertNotIn('/life-action', self.requests[0][0])

    def test_no_round_identity_or_invalid_bv_or_decision_fails_closed(self):
        with patch.dict(os.environ, {'BILI_DUTY_LIFE_ROUND_ID':''}):
            self.assertFalse(self.call()['ok'])
        with patch.dict(os.environ, {'BILI_DUTY_LIFE_ROUND_ID':'f'*24}):
            self.assertFalse(self.call(bvid='BV-nope')['ok'])
            self.assertFalse(self.call(decision='write')['ok'])
            self.assertFalse(self.call(decision='want')['ok'])
            self.assertFalse(self.call(reason='x'*161)['ok'])
        self.assertEqual(self.requests, [])

    def test_paused_guard_never_sends_even_read_only_receipt(self):
        self.paused = True
        with patch.dict(os.environ, {'BILI_DUTY_LIFE_ROUND_ID':'f'*24}):
            self.assertFalse(self.call()['ok'])
        self.assertEqual(self.requests, [])


if __name__ == '__main__':
    unittest.main()
