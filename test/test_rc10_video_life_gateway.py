"""Load the actual Python video-authorization wrapper without importing optional Bilibili SDKs."""
import ast
import asyncio
import inspect
import json
import os
import unittest
from functools import wraps
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SRC = Path(__file__).resolve().parents[1] / 'vendor' / 'bilibili-mcp' / 'mcp_server.py'
TOP = ast.parse(SRC.read_text(encoding='utf-8'))
NAMES = {'tool', '_life_video_authorize', '_life_video_result'}
FUNCTIONS = []
for node in TOP.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in NAMES:
        copy = ast.parse(ast.unparse(node)).body[0]
        copy.decorator_list = []
        FUNCTIONS.append(copy)
CODE = compile(ast.fix_missing_locations(ast.Module(body=FUNCTIONS, type_ignores=[])), str(SRC), 'exec')


class ToolWrapperTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.calls = []
        self.reports = []
        self.gateway_result = {'ok': True, 'grant': 'one-time'}
        fake_cred = lambda: SimpleNamespace(dedeuserid='23456')
        self.ns = dict(asyncio=asyncio, json=json, os=os, wraps=wraps, inspect=inspect,
                       _ALLOWED=set(),
                       _LIFE_VIDEO_WRITES={'bili_video_like', 'bili_video_collect',
                           'bili_follow_creator', 'bili_unfollow_creator',
                           'bili_favorite_folder_delete', 'bili_reply'},
                       mcp=SimpleNamespace(tool=lambda: lambda func: func),
                       _guard=lambda name: '',
                       get_cred=fake_cred)
        async def fake_request(route, payload):
            self.calls.append((route, payload))
            if route == '/life-action-result':
                self.reports.append(payload)
                return {'ok': True}
            return self.gateway_result
        async def fake_to_thread(fn, *args):
            return await fake_request(*args)
        self.ns['_life_video_request'] = lambda route, payload: None
        with patch.object(asyncio, 'to_thread', new=fake_to_thread):
            exec(CODE, self.ns)
        self.thread_patch = patch.object(asyncio, 'to_thread', new=fake_to_thread)
        self.thread_patch.start()
        self.addCleanup(self.thread_patch.stop)

    async def test_no_life_approval_means_no_platform_call(self):
        self.gateway_result = {'ok': False, 'reason': 'Life 想休息'}
        invoked = []
        async def bili_video_like(bvid, reason=''):
            invoked.append(bvid)
            return json.dumps({'ok': True})
        fn = self.ns['tool']()(bili_video_like)
        result = json.loads(await fn('BV1abcde1234', '喜欢这条'))
        self.assertFalse(result['ok'])
        self.assertTrue(result['blocked'])
        self.assertEqual(invoked, [])
        self.assertEqual(self.reports, [])

    async def test_life_grant_still_uses_original_platform_guard_and_reports_result(self):
        invoked = []
        async def bili_video_collect(bvid, folder_title, reason=''):
            invoked.append((bvid, folder_title))
            return json.dumps({'ok': True, 'collected': True})
        fn = self.ns['tool']()(bili_video_collect)
        self.assertEqual(json.loads(await fn('BV1abcde1234', '宝藏', '想收藏'))['ok'], True)
        self.assertEqual(invoked, [('BV1abcde1234', '宝藏')])
        self.assertEqual(self.calls[0][1]['tool'], 'bili_video_collect')
        self.assertEqual(self.reports[0]['uid'], '23456')
        self.assertTrue(self.reports[0]['ok'])

    async def test_unfollow_uses_account_uid_not_target_uid_for_result(self):
        async def bili_unfollow_creator(uid, reason):
            return json.dumps({'ok': False, 'status': 'uncertain-no-retry'})
        fn = self.ns['tool']()(bili_unfollow_creator)
        await fn(667788, '不再关注')
        self.assertEqual(self.calls[0][1]['target'], '667788')
        self.assertEqual(self.reports[0]['uid'], '23456')
        self.assertFalse(self.reports[0]['ok'])

    async def test_host_comment_path_preserves_existing_host_life_gate(self):
        invoked = []
        async def bili_reply(bvid, text, rpid=0):
            invoked.append((bvid, text))
            return json.dumps({'success': True})
        fn = self.ns['tool']()(bili_reply)
        with patch.dict(os.environ, {'BILI_JS_MCP_ADAPTER': '1'}):
            self.assertTrue(json.loads(await fn('BV1abcde1234', '你好'))['success'])
        self.assertEqual(invoked, [('BV1abcde1234', '你好')])
        self.assertEqual(self.calls, [])
        self.assertEqual(self.reports, [])

    async def test_autonomous_comment_path_requires_life(self):
        self.gateway_result = {'ok': False, 'reason': 'defer'}
        called = []
        async def bili_reply(bvid, text, rpid=0):
            called.append(bvid)
            return json.dumps({'success': True})
        fn = self.ns['tool']()(bili_reply)
        with patch.dict(os.environ, {'BILI_JS_MCP_ADAPTER': '0'}):
            result = json.loads(await fn('BV1abcde1234', '想说一句'))
        self.assertTrue(result['blocked'])
        self.assertEqual(called, [])


if __name__ == '__main__':
    unittest.main()
