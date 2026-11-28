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

if __name__=='__main__':unittest.main()
