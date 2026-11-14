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
                assert timeout<=70
                body=json.loads(self_req.data)
                assert body['model']=='qwen3.5:4b'
                assert body['stream'] is False
                assert '约 2 秒' in body['messages'][0]['content']
                assert base64.b64decode(body['messages'][0]['images'][0])==b'img'
                return FakeReply()
        with patch('urllib.request.build_opener',return_value=Opener()):
            result=_call_local_ollama([{'second':2,'bytes':b'img'}],'qwen3.5:4b')
            self.assertIn('浅色',result)

if __name__=='__main__':unittest.main()
