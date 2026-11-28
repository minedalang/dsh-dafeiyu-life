"""Fixed-loopback local visual inference safety tests (no external connections)."""
import base64
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
from preview_vision import _call_local_ollama

class FakeReply:
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def read(self, n): return json.dumps({'message':{'content':'观察到一个浅色画面'}}).encode('utf8')

class LocalVision(unittest.TestCase):
    def test_model_allowlist_rejects_unapproved_without_network(self):
        with patch('urllib.request.build_opener') as opener:
            with self.assertRaisesRegex(ValueError,'白名单'):
                _call_local_ollama([{'second':2,'bytes':b'img'}], 'evil/path')
            opener.assert_not_called()

    def test_chat_is_loopback_only_with_time_markers(self):
        class Opener:
            def open(self, req, timeout=None):
                self_req=req
                assert req.full_url=='http://127.0.0.1:11434/api/chat'
                assert 0 < timeout <= 140  # Current local storyboard inference hard cap
                body=json.loads(self_req.data)
                assert body['model']=='qwen3.5:4b'
                assert body['stream'] is False
                assert '分镜图1' in body['messages'][0]['content'] and '[2] 秒' in body['messages'][0]['content']
                assert base64.b64decode(body['messages'][0]['images'][0])==b'img'
                return FakeReply()
        with patch('urllib.request.build_opener',return_value=Opener()):
            result=_call_local_ollama([{'second':2,'bytes':b'img'}],'qwen3.5:4b')
            self.assertIn('浅色',result)

# Offline llama.cpp probe uses real loopback HTTP, not a real model.
import importlib.util
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from contextlib import contextmanager
from functools import partial
import subprocess
import preview_vision as pv

PROBE_PATH = Path(__file__).resolve().parents[1] / 'tools' / 'llama-vision-probe.py'
spec = importlib.util.spec_from_file_location('llama_vision_probe', PROBE_PATH)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

@contextmanager
def fake_llama(replies):
    seen = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            seen.append((self.path, self.headers.get('Authorization'), body))
            status, response = replies[min(len(seen)-1, len(replies)-1)]
            self.send_response(status)
            if status == 302: self.send_header('Location', '/not-allowed')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode('utf8'))
    with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try: yield server.server_port, seen
        finally:
            server.shutdown()
            thread.join()

def reply(text, finish='stop', **message):
    return (200, {'choices':[{'finish_reason':finish,'message':{'content':text,**message}}],
                  'usage':{'prompt_tokens':42,'completion_tokens':24}})

def cells(n=12):
    return '\n'.join(f'R{i//4+1}C{i%4+1}：模拟可见图形描述。' for i in range(n))

class LlamaProbeTests(unittest.TestCase):
    def analyze(self, model, replies, n=24):
        boards, truth = probe.fixture_boards(n)
        with fake_llama(replies) as (port, seen):
            calls=[]
            infer=partial(pv._call_local_ollama, _lab_transport=probe.llama_transport(port,'local-test',calls), _lab_thinking='off')
            text, receipts=pv._analyze_local_storyboards(boards,model,_lab_infer=infer)
        return boards, truth, seen, calls, text, receipts

    def test_two_board_wire_payload_and_shared_parser(self):
        for model in ('qwen3.5:4b','openbmb/minicpm-v4.7:1b'):
            with self.subTest(model=model):
                boards,truth,seen,calls,text,receipts=self.analyze(model,[reply('分镜图1：\n'+cells()+'\n分镜图2：\n'+cells())])
                self.assertEqual(len(seen),1)
                path,key,body=seen[0]
                self.assertEqual((path,key),('/v1/chat/completions','Bearer local-test'))
                self.assertEqual(body['model'],model)
                self.assertEqual(body['chat_template_kwargs'],{'enable_thinking':False})
                parts=body['messages'][0]['content']
                self.assertIn('分镜图2',parts[0]['text'])
                self.assertEqual([base64.b64decode(x['image_url']['url'].split(',',1)[1]) for x in parts[1:]],[b['bytes'] for b in boards])
                self.assertTrue(all(r['status']=='analyzed' for r in receipts),receipts)
                self.assertEqual(receipts[1]['times'],[t['second'] for t in truth[12:]])
                self.assertEqual(calls[0]['outputTokens'],24)

    def test_2b_single_and_partial_not_promoted(self):
        _,_,seen,_,_,receipts=self.analyze('qwen3.5:2b',[reply(cells()),reply(cells(9))])
        self.assertEqual([len(x[2]['messages'][0]['content'])-1 for x in seen],[1,1])
        self.assertEqual([r['status'] for r in receipts],['analyzed','incomplete'])
        self.assertEqual(len(receipts[1]['partialCells']),9)

    def test_incomplete_pair_recovers_only_failed_board(self):
        _,_,seen,_,_,receipts=self.analyze('qwen3.5:4b',[reply('分镜图1：\n'+cells()+'\n分镜图2：\n'+cells(9)),reply(cells())])
        self.assertEqual(len(seen),2)
        self.assertEqual([r['modelAttempts'] for r in receipts],[1,2])
        self.assertTrue(all(r['status']=='analyzed' for r in receipts),receipts)

    def test_reasoning_only_and_length_never_count_as_observation(self):
        for response in (reply('',reasoning_content=cells()),reply(cells(),'length')):
            with self.subTest(response=response):
                _,_,_,_,text,receipts=self.analyze('qwen3.5:2b',[response],12)
                self.assertEqual(text,'')
                self.assertEqual(receipts[0]['status'],'incomplete')

    def test_transport_error_stops_remaining_boards(self):
        _,_,seen,_,text,receipts=self.analyze('qwen3.5:2b',[(503,{})])
        self.assertEqual(len(seen),1)
        self.assertEqual(text,'')
        self.assertTrue(receipts[1]['skippedAfterFailure'])

    def test_redirect_never_followed(self):
        _,_,seen,_,text,receipts=self.analyze('qwen3.5:2b',[(302,{})],12)
        self.assertEqual(len(seen),1)
        self.assertEqual(text,'')
        self.assertEqual(receipts[0]['status'],'incomplete')

    def test_owned_child_cleanup(self):
        child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])
        try: probe.stop_child(child);self.assertIsNotNone(child.poll())
        finally:
            if child.poll() is None: child.kill();child.wait()

class NativeProductionAdapterTests(unittest.TestCase):
    def test_actual_adaptive_pipeline_uses_native_alias_and_original_evidence(self):
        from tempfile import TemporaryDirectory
        import adaptive_video as av
        from test_v283_dev3_visual_board_alignment import board, fake_frames, BV
        with TemporaryDirectory() as home, fake_llama([reply(cells())]) as (port, seen), \
             patch.object(av, 'acquire_adaptive_frames', side_effect=lambda *a, **kw: fake_frames([board(0),board(1)])) as acquire, \
             patch.object(pv, '_capture_actual_video_images', return_value=None):
            session = pv.NativeVisionSession(port, 'a'*64, 'qwen3.5-2b')
            kwargs = dict(perception_source='adaptive', enabled=True, provider='llama.cpp', model=session.model, max_frames=24)
            denied = pv.analyze_perception(BV, home, **kwargs)
            self.assertEqual(denied['status'], 'vision_model_unavailable')
            acquire.assert_not_called()
            out = pv.analyze_perception(BV, home, _native_session=session, **kwargs)
            self.assertEqual(out['status'], 'analyzed', out)
            self.assertEqual([r['status'] for r in out['visionBoardReceipts']], ['analyzed']*2)
            self.assertEqual(len(seen), 2)
            for path, key, body in seen:
                self.assertEqual((path, key, body['model']), ('/v1/chat/completions', 'Bearer '+'a'*64, 'qwen3.5-2b'))
                self.assertEqual(body['chat_template_kwargs'], {'enable_thinking':False})
                self.assertEqual(len(body['messages'][0]['content']), 2)
            self.assertEqual(pv.analyze_perception(BV, home, _native_session=session, **kwargs)['status'], 'cached')
            self.assertEqual(pv.analyze_perception(BV, home, **kwargs)['status'], 'vision_model_unavailable')
            # A native cache must not impersonate an Ollama observation.
            with patch.object(pv, '_call_local_ollama', side_effect=ValueError('no answer')) as old:
                result = pv.analyze_perception(BV, home, **dict(kwargs, provider='ollama'))
                self.assertNotEqual(result['status'], 'cached')
                old.assert_called()

    def test_preview_pipeline_and_wrong_model_rejected_before_network(self):
        from tempfile import TemporaryDirectory
        from test_v281_dev3b16_preview_storyboard import fake_api, image_fetch, BV
        with TemporaryDirectory() as home, fake_llama([reply(cells())]) as (port, seen), \
             patch.object(pv, '_json_api', side_effect=fake_api) as api, \
             patch.object(pv, '_safe_api_get', side_effect=image_fetch):
            session = pv.NativeVisionSession(port, 'b'*64, 'qwen3.5-2b')
            kwargs = dict(enabled=True, provider='llama.cpp', storyboard=True, max_frames=12, _native_session=session)
            self.assertEqual(pv.analyze_preview(BV, home, model='qwen3.5:4b', **kwargs)['status'], 'vision_model_unavailable')
            api.assert_not_called()
            out = pv.analyze_preview(BV, home, model=session.model, **kwargs)
            self.assertEqual(out['status'], 'analyzed', out)
            self.assertEqual(len(seen), 1)

    def test_native_never_accepts_truncation_reasoning_or_redirect(self):
        for response in (reply('partial','length'), reply('',reasoning_content=cells()), (302,{})):
            with self.subTest(response=response), fake_llama([response]) as (port, seen):
                session = pv.NativeVisionSession(port, 'c'*64, 'qwen3.5-2b')
                with self.assertRaises((ValueError,pv.VisionServiceError)):
                    session.infer([{'second':2,'bytes':b'img'}], session.model)
                self.assertEqual(len(seen), 1)

    def test_native_credentials_are_not_configurable_urls(self):
        for port,key,model in [(0,'a'*64,'qwen3.5-2b'),(1234,'http://example.com','qwen3.5-2b'),(1234,'a'*64,'../weights')]:
            with self.assertRaises(ValueError): pv.NativeVisionSession(port,key,model)

    def test_scoped_worker_requires_exact_model_and_one_tool(self):
        import os
        env = dict(BILI_MCP_TOOLS='bili_preview_vision', BILI_JS_MCP_ADAPTER='0', BILI_VISION_MODE='independent_local', BILI_VISION_PROVIDER='llama.cpp', DSH_NATIVE_VISION_PORT='12345', DSH_NATIVE_VISION_KEY='a'*64, DSH_NATIVE_VISION_MODEL='qwen3.5-2b', BILI_VISION_MODEL='qwen3.5:2b')
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(pv.NativeVisionSession.from_scoped_worker().model, 'qwen3.5:2b')
        for delta in ({'BILI_MCP_TOOLS':'*'}, {'BILI_JS_MCP_ADAPTER':'1'}, {'BILI_VISION_MODEL':'qwen3.5:4b'}, {'DSH_NATIVE_VISION_KEY':''}):
            with patch.dict(os.environ, dict(env, **delta), clear=True):
                with self.assertRaises(ValueError): pv.NativeVisionSession.from_scoped_worker()

    def test_mcp_native_route_settles_platform_read_before_inference(self):
        import ast, asyncio, os, re
        from tempfile import TemporaryDirectory
        import adaptive_video as av
        from test_v283_dev3_visual_board_alignment import board, fake_frames, BV
        tree = ast.parse((Path(__file__).resolve().parents[1]/'vendor/bilibili-mcp/mcp_server.py').read_text(encoding='utf8'))
        fn = next(x for x in tree.body if isinstance(x, ast.AsyncFunctionDef) and x.name=='bili_preview_vision')
        fn.decorator_list=[]
        active=[]; receipts=[]; attempts=[]
        @contextmanager
        def reserve(*args, **kwargs):
            active.append(1)
            try: yield lambda result: receipts.append(result)
            finally: active.pop()
        with TemporaryDirectory() as home, fake_llama([reply(cells())]) as (port, seen), patch.object(av, 'acquire_adaptive_frames', side_effect=lambda *a, **kw: fake_frames([board(0)])), patch.object(pv, '_capture_actual_video_images', return_value=None):
            ns=dict(os=os,re=re,json=json,asyncio=asyncio,_guard=lambda *_:None,_DUTY_HOME=Path(home),_VISION_BVS_PER_RUN=set(),_owner_debug_stage=lambda *_:None,shared_read_budget=reserve,public_read_reservation=reserve,_record_production_vision_attempt=lambda *a:attempts.append(a))
            exec(compile(ast.Module(body=[fn],type_ignores=[]),'mcp-test','exec'),ns)
            env=dict(BILI_VISION_ENABLED='1',BILI_VISION_MODE='independent_local',BILI_VISION_PROVIDER='llama.cpp',BILI_VISION_MODEL='qwen3.5:2b',BILI_MCP_TOOLS='bili_preview_vision',BILI_JS_MCP_ADAPTER='0',DSH_NATIVE_VISION_PORT=str(port),DSH_NATIVE_VISION_KEY='a'*64,DSH_NATIVE_VISION_MODEL='qwen3.5-2b')
            with patch.dict(os.environ,dict(env,DSH_NATIVE_VISION_KEY=''),clear=True):
                out=json.loads(asyncio.run(ns['bili_preview_vision'](BV,perception_source='adaptive')))
                self.assertEqual(out['status'],'vision_model_unavailable');self.assertEqual(receipts,[])
            transport=pv.NativeVisionSession._transport
            def checked(session,payload,timeout):
                self.assertEqual(active,[]);self.assertEqual(len(receipts),1)
                return transport(session,payload,timeout)
            with patch.dict(os.environ,env,clear=True),patch.object(pv.NativeVisionSession,'_transport',checked):
                out=json.loads(asyncio.run(ns['bili_preview_vision'](BV,perception_source='adaptive')))
                self.assertEqual(out['status'],'analyzed',out);self.assertEqual(out['provider'],'llama.cpp')
                self.assertEqual(len(seen),1);self.assertEqual(len(attempts),1)

    def test_native_round_bridge_only_selected_adaptive_and_no_fallback(self):
        import ast, asyncio, os, re
        tree = ast.parse((Path(__file__).resolve().parents[1]/'vendor/bilibili-mcp/mcp_server.py').read_text(encoding='utf8'))
        funcs = [x for x in tree.body if getattr(x, 'name', '') in ('bili_preview_vision','_native_round_observe')]
        for fn in funcs: fn.decorator_list=[]
        selected = [False]
        ns = dict(os=os,re=re,json=json,asyncio=asyncio,_guard=lambda *_:None,_VISION_BVS_PER_RUN=set(),_selected_in_current_video_round=lambda bv:selected[0])
        exec(compile(ast.Module(body=funcs,type_ignores=[]),'mcp-test','exec'),ns)
        bv='BV1234567890'
        with fake_llama([(200,{'ok':True,'bvid':bv,'status':'analyzed'})]) as (port, seen), patch.dict(os.environ,dict(BILI_VISION_ENABLED='1',BILI_VISION_MODE='independent_native',BILI_DUTY_VIDEO_PICK_FLOW='1',DSH_NATIVE_ROUND_PORT=str(port),DSH_NATIVE_ROUND_TOKEN='a'*64),clear=True):
            invoke=lambda **kw:json.loads(asyncio.run(ns['bili_preview_vision'](bv,**kw)))
            self.assertFalse(invoke(perception_source='adaptive')['ok']);self.assertEqual(seen,[])
            selected[0]=True
            self.assertFalse(invoke()['ok']);self.assertEqual(seen,[])
            self.assertTrue(invoke(perception_source='adaptive',view_depth='deep')['ok'])
            self.assertEqual(seen,[('/observe','Bearer '+'a'*64,{'bvid':bv,'view_depth':'deep'})])
            with patch.dict(os.environ,{'DSH_NATIVE_ROUND_TOKEN':''}):
                self.assertFalse(invoke(perception_source='adaptive')['ok'])
            self.assertEqual(len(seen),1)

if __name__=='__main__':unittest.main()
