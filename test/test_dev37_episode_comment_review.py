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
        self.pre_round_picked = set()
        self.recorded = set()
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
        bvid = payload['bvid']
        if bvid in self.pre_round_picked or not any(
            re.search(r'\|\s*'+re.escape(bvid)+r'\s*\|', line) and
            re.search(r'\|\s*(?:挑中|值得看|可以看)\s*\|\s*$', line)
            for line in self.lines):
            return {'ok': False, 'reason': 'comment-selection-not-confirmed'}
        if bvid in self.recorded:
            return {'ok': False, 'reason': 'comment-review-already-recorded'}
        self.recorded.add(bvid)
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
        with patch.dict(os.environ, {'BILI_DUTY_LIFE_ROUND_ID': 'c'*24}):
            again = self.call('want')
        self.assertTrue(again['already_seen'])
        self.assertEqual(again['comment_review']['reason'], 'comment-review-already-recorded')
        self.assertEqual(len(self.lines), 1, 'no duplicate canonical selection rows')
        self.assertEqual(len(self.requests), 2, 'host must enforce exactly-once review')

    def test_repeated_marker_can_attach_first_review_to_current_round_pick(self):
        # Regression for the reported "picked=1, reviewRejected=1" trace:
        # model first picks a video, then thinks about a comment.
        with patch.dict(os.environ, {'BILI_DUTY_LIFE_ROUND_ID': 'c'*24}):
            first = self.call('')
            later = self.call('insufficient')
        self.assertTrue(first['ok'])
        self.assertFalse(first['already_seen'])
        self.assertTrue(later['already_seen'])
        self.assertTrue(later['comment_review']['ok'])
        self.assertEqual(len(self.lines), 1)
        self.assertEqual(len(self.requests), 1)

    def test_previously_selected_video_cannot_fake_a_new_round_review(self):
        self.lines.append('| 2026-11-07 | BV1abcde1234 | old video | uploader | 挑中 |\n')
        self.pre_round_picked.add('BV1abcde1234')
        with patch.dict(os.environ, {'BILI_DUTY_LIFE_ROUND_ID': 'c'*24}):
            out = self.call('want')
        self.assertTrue(out['already_seen'])
        self.assertEqual(out['comment_review']['reason'], 'comment-selection-not-confirmed')
        self.assertEqual(len(self.lines), 1)

    def test_previously_watched_or_skipped_may_be_explicitly_selected_in_current_round(self):
        # A prior non-pick must not hide a new explicit selection.
        # explicit selection. The host still requires active round, account,
        # fresh canonical pick and independent Life write permission.
        for row in ('| 2026-11-08 | BV1abcde1234 | title | uploader | 看过 |\n',
                    '| 2026-11-08 | BV1abcde1234 | title | uploader | 跳过 |\n'):
            self.lines[:] = [row]
            self.requests.clear()
            self.recorded.clear()
            with patch.dict(os.environ, {'BILI_DUTY_LIFE_ROUND_ID': 'c'*24}):
                out = self.call('want')
            self.assertTrue(out['already_seen'])
            self.assertTrue(out['recorded_selection'])
            self.assertTrue(out['comment_review']['ok'])
            self.assertEqual(len(self.lines), 2)
            self.assertTrue(self.lines[-1].strip().endswith('| 挑中 |'))

    def test_prior_published_comment_remains_duplicate_protected(self):
        self.lines[:] = ['| BV1abcde1234 | 322469935296 | 0 | 2026-10-31 | comment |\n']
        with patch.dict(os.environ, {'BILI_DUTY_LIFE_ROUND_ID': 'c'*24}):
            out = self.call('want')
        self.assertTrue(out['already_seen'])
        self.assertFalse(out['recorded_selection'])
        self.assertEqual(out['comment_review']['reason'], 'comment-selection-not-confirmed')
        self.assertEqual(len(self.lines), 1)

    def test_old_pick_never_becomes_new_round_review(self):
        self.lines[:] = ['| 2026-10-30 | BV1abcde1234 | old | uploader | 挑中 |\n']
        self.pre_round_picked.add('BV1abcde1234')
        with patch.dict(os.environ, {'BILI_DUTY_LIFE_ROUND_ID': 'c'*24}):
            out = self.call('want')
        self.assertTrue(out['already_seen'])
        self.assertFalse(out['recorded_selection'])
        self.assertEqual(out['comment_review']['reason'], 'comment-selection-not-confirmed')
        self.assertEqual(len(self.lines), 1)

    def test_ambiguous_positive_selection_marker_fails_loudly(self):
        with patch.dict(os.environ, {'BILI_DUTY_LIFE_ROUND_ID': 'c'*24}):
            out = self.call('', '挑中·值得看')
        self.assertFalse(out['ok'])
        self.assertIn('精确', out['error'])
        self.assertEqual(self.lines, [])
        self.assertEqual(self.requests, [])

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
