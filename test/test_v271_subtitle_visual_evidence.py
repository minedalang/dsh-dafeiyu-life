"""Offline evidence boundary tests; no Bilibili login, model, or MCP install."""
import ast
import asyncio
import importlib.util
import json
import os
import sys
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / 'vendor' / 'bilibili-mcp'
SPEC = importlib.util.spec_from_file_location('visual_fallback_evidence', TOOLS / 'vision_fallback_evidence.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class Block:
    def __init__(self, type, text='', data=''):
        self.type, self.text, self.data = type, text, data


class CallToolResult:
    def __init__(self, content, isError=False):
        self.content, self.isError = content, isError


def _load_production_helpers():
    # Compile exactly the production functions without importing network/MCP libs.
    code = ast.parse((TOOLS / 'mcp_server.py').read_text(encoding='utf8'))
    names = {'_subtitle_visual_fallback', '_subtitle_no_text'}
    defs = [item for item in code.body if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name in names]
    assert {item.name for item in defs} == names
    ns = {'json': json, 'TextContent': Block, 'CallToolResult': CallToolResult,
          'classify_visual_fallback': MODULE.classify_visual_fallback}
    exec(compile(ast.Module(body=defs, type_ignores=[]), str(TOOLS / 'mcp_server.py'), 'exec'), ns)
    return ns


class EvidenceTests(unittest.TestCase):
    def test_subtitle_missing_with_disabled_or_unrequested_vision_never_claims_video(self):
        helper = _load_production_helpers()['_subtitle_no_text']
        for requested, reason in ((False, 'not_requested'), (True, 'vision_disabled')):
            data = json.loads(helper('BV1234567890', '该视频没有字幕', requested=requested))
            self.assertEqual(data['visual_fallback'], 'not_attempted')
            self.assertEqual(data['reason'], reason)
            self.assertEqual(data['subtitle_evidence'], 'none')
            self.assertFalse(data['can_claim_audio_listened'])
            self.assertFalse(data['can_claim_full_video_watched'])

    def test_frames_must_really_be_returned_to_claim_preview_frames(self):
        result = CallToolResult([Block('text', json.dumps({'ok': True, 'status': 'frames_ready'})),
                                 Block('text', '一帧低清预览'), Block('image', data='fake')])
        classified = MODULE.classify_visual_fallback(result)
        self.assertEqual(classified['visual_fallback'], 'frames_returned')
        self.assertEqual(classified['visual_evidence'], 'low_resolution_frames')
        self.assertEqual(classified['preview_images_returned'], 1)
        self.assertFalse(classified['can_claim_full_video_watched'])
        self.assertEqual(MODULE.classify_visual_fallback(result.content[0].text)['visual_fallback'], 'failed')
        self.assertEqual(MODULE.classify_visual_fallback(CallToolResult(result.content, isError=True))['visual_evidence'], 'none')

    def test_independent_model_description_and_failed_run_are_distinct(self):
        good = MODULE.classify_visual_fallback(json.dumps({'ok': True, 'status': 'analyzed',
                                                            'description': '两张低清帧上有蓝色背景'}))
        self.assertEqual(good['visual_fallback'], 'model_description_returned')
        self.assertEqual(good['visual_evidence'], 'unverified_low_resolution_description')
        for payload in [
            {'ok': False, 'status': 'no_images_confirmed', 'description': '伪造'},
            {'ok': True, 'status': 'cached', 'description': ''},
            {'ok': True, 'status': 'frames_ready'},
            {'ok': False, 'status': 'vision_config_error'},
            {'ok': False, 'status': 'daily_limit'},
        ]:
            classified = MODULE.classify_visual_fallback(json.dumps(payload))
            self.assertEqual(classified['visual_evidence'], 'none')
            self.assertFalse(classified['can_claim_audio_listened'])
            self.assertIn(classified['visual_fallback'], ('blocked', 'failed'))

    def test_live_subtitle_fallback_preserves_images_but_tells_truth_about_source(self):
        ns = _load_production_helpers()
        result = CallToolResult([Block('text', json.dumps({'ok': True, 'status': 'frames_ready'})),
                                 Block('image', data='fake')])
        async def fake_preview(_bvid):
            return result
        ns['_subtitle_visual_fallback'].__globals__['bili_preview_vision'] = fake_preview
        output = asyncio.run(ns['_subtitle_visual_fallback']('BV1234567890', '没有字幕'))
        self.assertEqual(len(output.content), 3)
        self.assertEqual(output.content[-1].type, 'image')
        marker = json.loads(output.content[0].text)
        self.assertEqual(marker['subtitle_evidence'], 'none')
        self.assertEqual(marker['visual_fallback'], 'frames_returned')
        self.assertFalse(marker['can_claim_audio_listened'])
        self.assertFalse(marker['can_claim_full_video_watched'])
        self.assertIn('低清', marker['note'])

    def test_failed_subtool_cannot_be_described_as_visual_success(self):
        ns = _load_production_helpers()
        async def fake_preview(_bvid):
            return CallToolResult([Block('text', json.dumps({'ok': False, 'status': 'daily_limit'}))], isError=True)
        ns['_subtitle_visual_fallback'].__globals__['bili_preview_vision'] = fake_preview
        output = asyncio.run(ns['_subtitle_visual_fallback']('BV1234567890', '字幕轨不可用'))
        self.assertTrue(output.isError)
        marker = json.loads(output.content[0].text)
        self.assertEqual(marker['visual_fallback'], 'blocked')
        self.assertEqual(marker['visual_evidence'], 'none')
        self.assertFalse(marker['can_claim_full_video_watched'])

    def test_actual_subtitle_tool_does_not_launch_vision_without_opt_in(self):
        source = ast.parse((TOOLS / 'mcp_server.py').read_text(encoding='utf8'))
        node = next(item for item in source.body if isinstance(item, ast.AsyncFunctionDef) and item.name == 'bili_subtitle')
        node.decorator_list = []  # tests exercise the production body without MCP registration
        ns = _load_production_helpers()
        calls = []

        class Video:
            async def get_info(self):
                return {'cid': 18, 'title': '真实标题'}

            async def get_subtitle(self, cid):
                return {'subtitles': []}

        async def fallback(bvid, message):
            calls.append(bvid)
            return {'fake': 'called'}

        ns.update({'video': SimpleNamespace(Video=lambda **_kw: Video()),
                   'get_cred': lambda: object(), 'os': os, 're': __import__('re'),
                   '_subtitle_visual_fallback': fallback})
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(TOOLS / 'mcp_server.py'), 'exec'), ns)
        with patch.dict(os.environ, {'BILI_VISION_ENABLED': '1'}):
            no_opt_in = json.loads(asyncio.run(ns['bili_subtitle']('BV1234567890', False)))
            self.assertEqual(no_opt_in['reason'], 'not_requested')
            self.assertEqual(calls, [])
            attempted = asyncio.run(ns['bili_subtitle']('BV1234567890', True))
            self.assertEqual(attempted, {'fake': 'called'})
            self.assertEqual(calls, ['BV1234567890'])
        with patch.dict(os.environ, {'BILI_VISION_ENABLED': '0'}):
            blocked = json.loads(asyncio.run(ns['bili_subtitle']('BV1234567890', True)))
            self.assertEqual(blocked['reason'], 'vision_disabled')
            self.assertEqual(calls, ['BV1234567890'])

    def test_empty_subtitle_track_does_not_enter_verified_context(self):
        source = ast.parse((TOOLS / 'mcp_server.py').read_text(encoding='utf8'))
        node = next(item for item in source.body if isinstance(item, ast.AsyncFunctionDef) and item.name == 'bili_subtitle')
        node.decorator_list = []
        ns = _load_production_helpers()
        saved = []
        class Video:
            async def get_info(self):
                return {'cid': 18, 'title': '真实标题'}
            async def get_subtitle(self, cid):
                return {'subtitles': [{'lan': 'zh', 'subtitle_url': 'https://example.invalid/sub.json'}]}
        class Response:
            async def __aenter__(self): return self
            async def __aexit__(self, *args): return False
            async def json(self): return {'body': [{'content': '字幕 by X'}]}
        class Session:
            async def __aenter__(self): return self
            async def __aexit__(self, *args): return False
            def get(self, _url): return Response()
        ns.update({'video': SimpleNamespace(Video=lambda **_kw: Video()),
                   'get_cred': lambda: object(), 'os': os, 're': __import__('re'),
                   '_remember_video_context': lambda *args: saved.append(args)})
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(TOOLS / 'mcp_server.py'), 'exec'), ns)
        with patch.dict(sys.modules, {'aiohttp': SimpleNamespace(ClientSession=Session)}):
            result = json.loads(asyncio.run(ns['bili_subtitle']('BV1234567890', False)))
        self.assertEqual(result['subtitle_evidence'], 'none')
        self.assertEqual(result['visual_fallback'], 'not_attempted')
        self.assertEqual(saved, [])

    def test_production_wiring_and_explicit_permission_remain(self):
        source = (TOOLS / 'mcp_server.py').read_text(encoding='utf8')
        self.assertIn("if auto_vision_on_missing and os.environ.get('BILI_VISION_ENABLED') == '1':", source)
        self.assertIn('return await _subtitle_visual_fallback(', source)
        self.assertIn("'subtitle_evidence': 'none'", source)
        self.assertIn('"subtitle_evidence": "caption_text"', source)
        self.assertIn("@_gate_read('bili_subtitle')", source)
        self.assertNotIn("@_gate_read('bili_preview_vision')", source)
        state = (ROOT / 'lib' / 'state.mjs').read_text(encoding='utf8')
        index = (ROOT / 'index.js').read_text(encoding='utf8')
        self.assertIn('vision_fallback_evidence.py', state)
        self.assertIn('vision_fallback_evidence.py', index)


if __name__ == '__main__':
    unittest.main()
