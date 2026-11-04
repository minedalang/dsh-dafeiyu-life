"""Isolated API-contract tests for the actual Python MCP read path (no B站 network)."""
import ast
import asyncio
import hashlib
import hmac
import json
import re
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

SOURCE = (Path(__file__).resolve().parents[1] / 'vendor/bilibili-mcp/mcp_server.py').read_text('utf-8')
NAMES = {'_discussion_account_tag', '_discussion_receipt', '_discussion_prompt_note', '_discussion_note_rejection',
         '_discussion_store_provisional', '_discussion_report_without_note_receipts', 'bili_report_append',
         'bili_comments', 'bili_comment_thread', 'bili_discussion_note'}
TREE = ast.parse(SOURCE)
NODES = []
for node in TREE.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in NAMES:
        node.decorator_list = []
        NODES.append(node)
assert len(NODES) == len(NAMES), 'real MCP functions must exist'
CODE = compile(ast.fix_missing_locations(ast.Module(body=NODES, type_ignores=[])), '<v271-discussion>', 'exec')


class _Video:
    def __init__(self, bvid, credential):
        self.bvid = bvid

    async def get_info(self):
        return {'aid': 42}


class _Comment:
    def __init__(self, oid, type_, rpid, credential):
        self.rpid = rpid

    async def get_sub_comments(self, page_index, page_size):
        return {'root': {'rpid': self.rpid, 'member': {'uname': 'root author', 'mid': 999},
                         'content': {'message': 'private-looking third-party text'}},
                'replies': [{'rpid': 400 + self.rpid, 'member': {'uname': 'user', 'mid': 888},
                             'content': {'message': 'reply secret abc'}}]}


class DiscussionTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.records = []
        self.break_read = False
        self.empty = False
        self.account = '111'

        async def get_comments(**kwargs):
            self.calls.append(kwargs)
            if self.break_read:
                raise RuntimeError('B站 -412')
            if self.empty:
                return {'replies': []}
            return {'replies': [{'rpid': i + 1, 'member': {'uname': 'a', 'mid': 999},
                                'content': {'message': 'READ-THIRD-PARTY-SECRET'}, 'rcount': 2}
                                for i in range(10)]}

        scope = {
            'json': json, 're': re, 'hashlib': hashlib, 'hmac': hmac, 'datetime': datetime, 'asyncio': asyncio,
            '_DISCUSSION_VIDEO_ROUND': True, '_DISCUSSION_LIST_CACHE': {},
            '_DISCUSSION_ROOTS': {}, '_DISCUSSION_THREADS': {}, '_DISCUSSION_NOTED': set(),
            '_DISCUSSION_REPORT_UNNOTED': set(),
            '_DISCUSSION_MAX_VIDEOS': 6, '_DISCUSSION_MAX_THREADS': 2,
            '_ALLOWED': {'bili_discussion_note', 'bili_report_append'},
            'load_credential': lambda: SimpleNamespace(dedeuserid=self.account, sessdata='FAKE_TEST_SECRET'),
            'get_cred': lambda: 'fake', '_guard': lambda name: '',
            '_append_home': lambda filename, text: self.records.append((filename, text)),
            '_remember_video_context': lambda *args: None,
            'video': SimpleNamespace(Video=_Video),
            'comment': SimpleNamespace(get_comments=get_comments, Comment=_Comment,
                                       CommentResourceType=SimpleNamespace(VIDEO=1),
                                       OrderType=SimpleNamespace(LIKE=1)),
        }
        exec(CODE, scope)
        self.s = scope
        self.bv = 'BV1234567890'

    def go(self, coro):
        return json.loads(asyncio.run(coro))

    def test_success_is_independent_read_and_thread_uses_actual_root(self):
        first = self.go(self.s['bili_comments'](self.bv, num=10))
        self.assertTrue(first['read_evidence']['verified'])
        self.assertEqual(first['count'], 10)
        self.assertIn('bili_discussion_note', first['optional_reflection'])
        self.assertIn('不要为记录而编造', first['optional_reflection'])
        self.assertEqual(len(self.calls), 1)
        again = self.go(self.s['bili_comments'](self.bv, num=10))
        self.assertEqual(again, first)
        self.assertEqual(len(self.calls), 1, 'same BV must not fetch again')
        self.assertEqual(self.go(self.s['bili_comment_thread'](self.bv, 50))['status'], 'unverified_root')
        self.assertEqual(self.go(self.s['bili_comment_thread']('BV0000000000', 1))['status'], 'unverified_root')
        thread = self.go(self.s['bili_comment_thread'](self.bv, 1, num=10))
        self.assertEqual(thread['read_evidence']['type'], 'comment_thread_read')
        self.assertEqual(thread['root'], '1')
        self.assertEqual(self.go(self.s['bili_comment_thread'](self.bv, 1)), thread)
        self.assertEqual(len(self.s['_DISCUSSION_THREADS']), 1)
        self.go(self.s['bili_comment_thread'](self.bv, 2))
        self.assertEqual(self.go(self.s['bili_comment_thread'](self.bv, 3))['status'], 'budget_exhausted')
        note = self.go(self.s['bili_discussion_note'](self.bv, 'curious', '这里为什么有不同意见？'))
        self.assertTrue(note['ok'])
        self.assertTrue(note['not_external_fact'])
        self.assertTrue(note['not_publicly_sent'])
        self.assertEqual(self.go(self.s['bili_discussion_note'](self.bv, 'amused'))['ok'], False)
        text = ''.join(r[1] for r in self.records)
        self.assertNotIn('READ-THIRD-PARTY-SECRET', text)
        self.assertNotIn('reply secret', text)
        self.assertNotIn('999', text)
        self.assertNotIn('111', text)
        self.assertNotIn('FAKE_TEST_SECRET', text)
        self.assertIn('comment_thread_read', text)
        self.assertIn('provisional_fish_reaction', text)

    def test_api_failure_not_empty_and_cannot_record_thought(self):
        self.break_read = True
        result = self.go(self.s['bili_comments'](self.bv, 10))
        self.assertIn('-412', result['error'])
        self.assertEqual(result['count'], 0)
        self.assertFalse(result['read_evidence']['verified'])
        self.assertFalse(self.go(self.s['bili_discussion_note'](self.bv, 'curious'))['ok'])
        self.assertIn('missing_read', ''.join(x[1] for x in self.records))
        self.assertIn('partial_failure', ''.join(x[1] for x in self.records))
        self.assertEqual(self.go(self.s['bili_comment_thread'](self.bv, 1))['status'], 'unverified_root')

    def test_empty_success_is_not_api_failure(self):
        self.empty = True
        result = self.go(self.s['bili_comments'](self.bv, 10))
        self.assertEqual(result['count'], 0)
        self.assertNotIn('optional_reflection', result)
        self.assertNotIn('error', result)
        self.assertTrue(result['read_evidence']['verified'])
        self.assertTrue(self.go(self.s['bili_discussion_note'](self.bv, 'none'))['ok'])

    def test_budget_unrelated_to_external_write_and_sensitive_note_rejected(self):
        for i in range(6):
            bv = f'BV{i:010d}'
            self.assertEqual(self.go(self.s['bili_comments'](bv, 10))['count'], 10)
        self.assertEqual(self.go(self.s['bili_comments']('BVaaaaaaaaaa', 10))['status'], 'budget_exhausted')
        self.assertEqual(len(self.calls), 6)
        self.assertFalse(self.go(self.s['bili_discussion_note']('BV0000000000','curious','https://bad.example/'))['ok'])
        self.assertFalse(self.go(self.s['bili_discussion_note']('BV0000000000','curious','用户 123456789'))['ok'])
        self.assertFalse(self.go(self.s['bili_discussion_note']('BV0000000000','true', ''))['ok'])

    def test_failed_note_diagnostics_only_expose_reason_not_private_arguments(self):
        self.go(self.s['bili_comments'](self.bv, 10))
        private = 'https://dont-store.example/?user=11223344'
        result = self.go(self.s['bili_discussion_note'](self.bv, 'curious', private))
        self.assertFalse(result['ok'])
        result2 = self.go(self.s['bili_discussion_note'](self.bv, 'wrong', 'some feeling'))
        self.assertFalse(result2['ok'])
        serialized = ''.join(row[1] for row in self.records)
        self.assertIn('provisional_note_rejected', serialized)
        self.assertIn('invalid_question', serialized)
        self.assertIn('invalid_reaction', serialized)
        self.assertNotIn(private, serialized)
        self.assertNotIn('some feeling', serialized)

    def test_report_can_attach_optional_real_note_without_extra_tool_call(self):
        self.go(self.s['bili_comments'](self.bv, 10))
        result = self.go(self.s['bili_report_append']('### 日报', [
            {'bvid': self.bv, 'reaction': 'curious', 'question': '不同意见为什么这么多？'}]))
        self.assertEqual(result['ok'], True)
        self.assertEqual(result['discussionNotes']['saved'], 1)
        self.assertEqual(sum('provisional_fish_reaction' in x[1] for x in self.records), 1)
        self.assertTrue(any(x[0].startswith('out/') for x in self.records))
        again = self.go(self.s['bili_discussion_note'](self.bv, 'curious'))
        self.assertFalse(again['ok'], 'same BV should not double write through two paths')

    def test_report_does_not_invent_or_bypass_optional_note_gate(self):
        text = self.go(self.s['bili_report_append']('纯日报'))
        self.assertTrue(text['ok'])
        self.assertEqual(len(self.records), 1, 'no extra entry without model choice')
        # Report still succeeds, but an unverified BV cannot produce a note.
        out = self.go(self.s['bili_report_append']('日报', [
            {'bvid': self.bv, 'reaction': 'curious', 'question': '无阅读不能记录'}]))
        self.assertEqual(out['discussionNotes']['saved'], 0)
        self.assertEqual(out['discussionNotes']['rejected'], 1)
        self.assertFalse(any('provisional_fish_reaction' in x[1] for x in self.records))
        self.go(self.s['bili_comments'](self.bv, 10))
        self.s['_ALLOWED'] = {'bili_report_append'}
        gated = self.go(self.s['bili_report_append']('日报', [
            {'bvid': self.bv, 'reaction': 'curious'}]))
        self.assertTrue(gated['discussionNotes']['blocked'])
        self.assertEqual(sum('provisional_fish_reaction' in x[1] for x in self.records), 0)

    def test_report_without_optional_note_emits_nonsubjective_diagnostic_once(self):
        self.go(self.s['bili_comments'](self.bv, 10))
        self.go(self.s['bili_report_append']('日报'))
        self.go(self.s['bili_report_append']('第二次日报'))
        rows = [json.loads(r[1]) for r in self.records if 'provisional_note_not_provided' in r[1]]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['bvid'], self.bv)
        self.assertEqual(rows[0]['status'], 'not_provided')
        self.assertNotIn('question', rows[0])
        self.assertFalse(any('provisional_fish_reaction' in r[1] for r in self.records))

    def test_report_rejects_private_payload_and_limits_attached_notes(self):
        self.go(self.s['bili_comments'](self.bv, 10))
        bad = 'https://dont-store.example/?uid=9999999999'
        out = self.go(self.s['bili_report_append']('日报', [
            {'bvid': self.bv, 'reaction': 'curious', 'question': bad},
            {'bvid': self.bv, 'reaction': 'invalid', 'question': 'test'},
            {'bvid': 'BV9999999999', 'reaction': 'curious', 'question': 'third'}]))
        self.assertEqual(out['discussionNotes']['saved'], 0)
        self.assertEqual(out['discussionNotes']['rejected'], 2)
        self.assertNotIn(bad, '\n'.join(x[1] for x in self.records))
        self.assertFalse(any('provisional_fish_reaction' in x[1] for x in self.records))

    def test_unselected_optional_note_does_not_generate_fake_event(self):
        out = self.go(self.s['bili_comments'](self.bv, 10))
        self.assertIn('optional_reflection', out)
        self.assertEqual(len(self.records), 1)
        self.assertNotIn('provisional_fish_reaction', self.records[0][1])

    def test_other_channels_keep_original_thread_behavior(self):
        self.s['_DISCUSSION_VIDEO_ROUND'] = False
        result = self.go(self.s['bili_comment_thread'](self.bv, 987))
        self.assertEqual(result['root'], '987')
        self.assertNotIn('read_evidence', result)
        self.assertEqual(self.records, [])


if __name__ == '__main__':
    unittest.main()
