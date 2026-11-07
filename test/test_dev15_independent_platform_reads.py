import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT=Path(__file__).resolve().parents[1]
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'lib'/file)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
v=load('video_verify','video-action-verify.py')
d=load('dynamic_verify','daily-dynamic-verify.py')

class Context:
    def __init__(self):self.td=tempfile.TemporaryDirectory();self.cred=Path(self.td.name)/'cred.json';self.cred.write_text(json.dumps({'dedeuserid':'12345','sessdata':'test'}));self.urls=[]
    def close(self):self.td.cleanup()
    def opener(self,responses):
        def open_url(request,timeout):
            self.urls.append((request.full_url,request.get_method()))
            value=responses.pop(0)
            class Response:
                def __enter__(self):return self
                def __exit__(self,*args):return False
                def read(self,n=0):return json.dumps(value).encode('utf-8')
            return Response()
        return open_url

class IndependentReadTest(unittest.TestCase):
    def setUp(self):self.ctx=Context()
    def tearDown(self):self.ctx.close()
    def test_like_confirmed_only_by_get(self):
        result=v.verify(self.ctx.cred,'video_like','BV1abcde1234','12345',opener=self.ctx.opener([{'code':0,'data':1}]))
        self.assertTrue(result['verified']);self.assertEqual(self.ctx.urls[0][1],'GET')
    def test_like_unliked_is_not_confirmed(self):
        self.assertFalse(v.verify(self.ctx.cred,'video_like','BV1abcde1234','12345',opener=self.ctx.opener([{'code':0,'data':0}]))['verified'])
    def test_collect_queries_aid_then_favoured(self):
        self.assertTrue(v.verify(self.ctx.cred,'video_collect','BV1abcde1234','12345',opener=self.ctx.opener([
          {'code':0,'data':{'aid':2468}}, {'code':0,'data':{'favoured':True}}]))['verified'])
        self.assertEqual(len(self.ctx.urls),2)
    def test_follow_checks_original_creator_and_relation(self):
        self.assertTrue(v.verify(self.ctx.cred,'video_follow','BV1abcde1234','12345',opener=self.ctx.opener([
          {'code':0,'data':{'owner':{'mid':9999}}},{'code':0,'data':{'attribute':2}}]))['verified'])
    def test_unfollow_only_confirmed_if_no_relation(self):
        self.assertTrue(v.verify(self.ctx.cred,'video_unfollow','9999','12345',opener=self.ctx.opener([
          {'code':0,'data':{'attribute':0}}]))['verified'])
        self.assertFalse(v.verify(self.ctx.cred,'video_unfollow','9999','12345',opener=self.ctx.opener([
          {'code':0,'data':{'attribute':2}}]))['verified'])
    def test_wrong_account_or_target_never_network(self):
        self.assertFalse(v.verify(self.ctx.cred,'video_follow','BV1abcde1234','12346',opener=lambda *a: self.fail('network'))['verified'])
        self.assertFalse(v.verify(self.ctx.cred,'video_like','hello','12345',opener=lambda *a: self.fail('network'))['verified'])
    def test_dynamic_complete_identity_author_and_text(self):
        sample={'code':0,'data':{'item':{'id_str':'1234567890123456789','modules':{
          'module_author':{'mid':'12345'},'module_dynamic':{'desc':{'text':'这是一条已经发出的生活动态文本，要匹配原稿。'}}}}}}
        text='这是一条已经发出的生活动态文本，要匹配原稿。'
        self.assertTrue(d.verify(self.ctx.cred,'1234567890123456789','12345',text,opener=self.ctx.opener([sample]))['verified'])
        sample['data']['item']['modules']['module_author']['mid']='9999'
        self.assertFalse(d.verify(self.ctx.cred,'1234567890123456789','12345',text,opener=self.ctx.opener([sample]))['verified'])
    def test_dynamic_text_or_id_mismatch_fails_closed(self):
        sample={'code':0,'data':{'item':{'id_str':'1234567890123456789','modules':{
          'module_author':{'mid':'12345'},'module_dynamic':{'desc':{'text':'这条不是原来的动态文本，虽然内容格式看起来相似。'}}}}}}
        self.assertFalse(d.verify(self.ctx.cred,'1234567890123456789','12345','这是一段完全不同的正文内容，不可当作成功发送。',opener=self.ctx.opener([sample]))['verified'])

if __name__=='__main__':unittest.main()
