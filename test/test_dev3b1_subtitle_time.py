"""Run the real MCP subtitle function with offline Bilibili/aiohttp stubs."""
import ast
import asyncio
import json
import re
import sys
import types
import unittest
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / 'vendor' / 'bilibili-mcp' / 'mcp_server.py'


class MockVideo:
    def __init__(self, **kwargs):
        pass

    async def get_info(self):
        return {'cid': 9, 'title': '离线字幕测试'}

    async def get_subtitle(self, cid):
        return {'subtitles': [{'lan': 'ai-zh', 'lan_doc': '中文', 'subtitle_url': '//example.invalid/caption.json'}]}


class MockReply:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def json(self):
        return {'body': [{'from': 1.25, 'to': 2.50, 'content': '  第一句  '},
                         {'from': 2.50, 'to': 4.75, 'content': '第二句'},
                         {'from': -4, 'to': 0, 'content': '无效'},
                         {'from': 5, 'to': 2, 'content': '倒序'}] +
                        [{'from': n + 20, 'to': n + 21, 'content': '一' * 200}
                         for n in range(200)]}


class MockSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    def get(self, url):
        assert url == 'https://example.invalid/caption.json'
        return MockReply()


class TimedSubtitleTests(unittest.TestCase):
    def test_normalizes_only_official_seconds_and_preserves_text(self):
        tree = ast.parse(SRC.read_text('utf8'), filename=str(SRC))
        func = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'bili_subtitle')
        func.decorator_list = []
        isolated = ast.fix_missing_locations(ast.Module(body=[func], type_ignores=[]))
        scope = {'re': re, 'json': json, 'video': types.SimpleNamespace(Video=MockVideo),
                 'get_cred': lambda: None, '_remember_video_context': lambda *_: None}
        exec(compile(isolated, str(SRC), 'exec'), scope)
        fake = types.ModuleType('aiohttp')
        fake.ClientSession = MockSession
        previous = sys.modules.get('aiohttp')
        sys.modules['aiohttp'] = fake
        try:
            reply = asyncio.run(scope['bili_subtitle']('BV1234567890'))
        finally:
            if previous is None:
                sys.modules.pop('aiohttp', None)
            else:
                sys.modules['aiohttp'] = previous
        value = json.loads(reply)
        self.assertEqual(value['subtitle_evidence'], 'caption_text')
        self.assertEqual(value['timed_segments'][0],
                         {'startSeconds': 1.25, 'endSeconds': 2.5, 'text': '第一句'})
        self.assertEqual(len(value['timed_segments']), 160)
        self.assertGreaterEqual(value['timed_segments'][-1]['startSeconds'], 219)
        self.assertLessEqual(len(value['timed_segments'][-1]['text']), 180)
        self.assertGreater(value['segments'], len(value['timed_segments']))
        self.assertIn('第二句', value['text'])
        self.assertFalse(value['can_claim_audio_listened'])


if __name__ == '__main__':
    unittest.main()
