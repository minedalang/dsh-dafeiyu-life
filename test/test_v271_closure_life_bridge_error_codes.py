"""Real Python MCP bridge request function; fake localhost and HTTP errors only."""
import ast
import io
import json
import os
import re
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

SOURCE=(Path(__file__).resolve().parents[1]/'vendor/bilibili-mcp/mcp_server.py').read_text('utf8')
TREE=ast.parse(SOURCE)
FN=next(n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name=='_life_video_request')
CODE=compile(ast.fix_missing_locations(ast.Module(body=[FN],type_ignores=[])),'<bridge-error>', 'exec')

class FakeOpener:
    def __init__(self, reason):self.reason=reason
    def open(self, req, timeout=0):
        raise urllib.error.HTTPError(req.full_url,409,'Conflict',{},
            io.BytesIO(json.dumps({'ok':False,'reason':self.reason}).encode('utf8')))

class BridgeErrors(unittest.TestCase):
    def setUp(self):
        self.ctx={'os':os,'re':re,'urllib':urllib,'json':json}
        exec(CODE,self.ctx)
        self.env={'BILI_LIFE_ACTION_URL':'http://127.0.0.1:12345',
                  'BILI_LIFE_ACTION_TOKEN':'a'*64}
    def call(self,reason,route='/life-action'):
        with patch.dict(os.environ,self.env),patch.object(urllib.request,'build_opener',return_value=FakeOpener(reason)):
            return self.ctx['_life_video_request'](route,{'uid':'12345678'})
    def test_distinguish_declined_and_technical_gate(self):
        for code in ('life-declined-video-action','life-not-ready','life-cross-channel-rest','life-choice-review-required'):
            self.assertEqual(self.call(code),{'ok':False,'reason':code})
    def test_untrusted_denial_never_leaks(self):
        self.assertEqual(self.call('PRIVATE_ACCESS_TOKEN'),{'ok':False,'reason':'Life 授权不可核验'})
        self.assertEqual(self.call('life-declined-video-action','/life-comment-review'),
                         {'ok':False,'reason':'Life 授权不可核验'})
    def test_review_reason_is_read_only(self):
        self.assertEqual(self.call('comment-selection-not-confirmed','/life-comment-review'),
                         {'ok':False,'reason':'comment-selection-not-confirmed'})
    def test_no_endpoint_never_contacts_external_network(self):
        with patch.dict(os.environ,{'BILI_LIFE_ACTION_URL':'https://evil.invalid','BILI_LIFE_ACTION_TOKEN':'a'*64}):
            self.assertEqual(self.ctx['_life_video_request']('/life-action',{}),
                             {'ok':False,'reason':'Life 视频写入授权服务未就绪'})

if __name__=='__main__':unittest.main()
