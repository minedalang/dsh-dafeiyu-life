"""Evaluate the real MCP selected-video marker offline, no network or sender."""
import ast
import asyncio
import json
import os
import re
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SOURCE = (Path(__file__).resolve().parents[1] / 'vendor/bilibili-mcp/mcp_server.py').read_text('utf-8')
TREE = ast.parse(SOURCE)
FUNC = next(n for n in TREE.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'bili_ledger_mark')
FUNC.decorator_list = []
CODE = compile(ast.fix_missing_locations(ast.Module(body=[FUNC], type_ignores=[])), '<bili_ledger_mark>', 'exec')


class LedgerCommentReviewTests(unittest.TestCase):
    def setUp(self):
        self.lines = []
        self.requests = []
        self.ctx = {'asyncio': asyncio, 'json': json, 'os': os, 're': re, 'datetime': datetime,
            '_guard': lambda n: '', '_valid_bv': lambda v: v if re.fullmatch(r'BV[0-9A-Za-z]{10}', v) else (_ for _ in ()).throw(ValueError('bad-bv')),
            '_safe_line': lambda text, limit=80: str(text)[:limit],
            '_read_home': lambda *_: ''.join(self.lines),
            '_append_home': lambda _path, s: self.lines.append(s),
            'get_cred': lambda: SimpleNamespace(dedeuserid='1234567'),
            '_life_video_request': self.request}
        exec(CODE, self.ctx)

    def request(self, route, payload):
        self.requests.append((route, payload))
        return {'ok': True}

    def call(self, decision='', status='挑中', bvid='BV1abcde1234'):
        return json.loads(asyncio.run(self.ctx['bili_ledger_mark'](bvid, 'video title', 'uploader', status, decision)))

    def test_attached_readonly_review_after_real_marker(self):
        with patch.dict(os.environ, {'BILI_DUTY_LIFE_ROUND_ID': 'c'*24}):
            r = self.call('pass')
        self.assertTrue(r['ok'])
        self.assertFalse(r['already_seen'])
        self.assertTrue(r['comment_review']['ok'])
        self.assertEqual(len(self.lines), 1)
        self.assertEqual(self.requests, [('/life-comment-review', {
            'uid': '1234567', 'roundId':'c'*24, 'bvid':'BV1abcde1234', 'decision':'pass'})])
        self.assertEqual(self.call('want')['comment_review']['reason'], 'comment-selection-not-confirmed')
        self.assertEqual(len(self.requests), 1, 'already-seen video cannot be reclassified')

    def test_invalid_or_skipped_never_creates_review(self):
        with patch.dict(os.environ, {'BILI_DUTY_LIFE_ROUND_ID': 'c'*24}):
            self.assertFalse(self.call('want', '跳过')['ok'])
            self.assertFalse(self.call('unknown')['ok'])
            self.assertTrue(self.call('', '跳过')['ok'])
        self.assertEqual(self.requests, [])
        self.assertEqual(len(self.lines), 1)

    def test_no_round_keeps_pick_and_reports_review_failure_without_send(self):
        with patch.dict(os.environ, {'BILI_DUTY_LIFE_ROUND_ID': ''}):
            r = self.call('insufficient')
        self.assertTrue(r['ok'])
        self.assertEqual(r['comment_review']['reason'], 'comment-review-not-current')
        self.assertEqual(len(self.lines),1)
        self.assertEqual(self.requests,[])


if __name__ == '__main__':
    unittest.main()
