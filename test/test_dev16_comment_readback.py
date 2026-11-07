import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('dev16_video_verify',ROOT/'lib'/'video-action-verify.py')
verify_module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_module)
BV='BV1abcde1234'
BODY='这期视频的镜头真有意思，还想多看看。'
RPID='987654321098765'

class Readback(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory()
  self.cred=Path(self.tmp.name)/'cred.json'
  self.cred.write_text(json.dumps({'dedeuserid':'12345','sessdata':'SESSION'}))
  self.calls=[]
 def tearDown(self):self.tmp.cleanup()
 def fetch(self,author='12345',text=BODY,rpid=RPID,invisible=0,found=True):
  values=[{'code':0,'data':{'aid':88888}}, {'code':0,'data':{'replies':[
   {'rpid_str':rpid,'member':{'mid':author},'content':{'message':text},'invisible':invisible}] if found else []}}]
  def open_(req,timeout=8):
   self.calls.append((req.full_url,req.get_method()))
   data=values.pop(0)
   class Response:
    def __enter__(self):return self
    def __exit__(self,*exc):return False
    def read(self,size=0):return json.dumps(data).encode()
   return Response()
  return open_
 def call(self,**kwargs):
  return verify_module.verify(self.cred,'video_comment',BV,'12345',receipt_id=RPID,expected_text=BODY,**kwargs)
 def test_only_exact_author_id_and_text_is_verified(self):
  self.assertTrue(self.call(opener=self.fetch())['verified'])
  self.assertTrue(all(method=='GET' for _,method in self.calls))
  self.assertIn('mode=2',self.calls[1][0])
 def test_other_account_is_not_verified(self):
  self.assertFalse(self.call(opener=self.fetch(author='9999'))['verified'])
 def test_other_text_is_not_verified(self):
  self.assertFalse(self.call(opener=self.fetch(text='别人发的相似评论'))['verified'])
 def test_other_id_is_not_verified(self):
  self.assertFalse(self.call(opener=self.fetch(rpid='123456789'))['verified'])
 def test_invisible_is_not_public_confirmation(self):
  self.assertFalse(self.call(opener=self.fetch(invisible=1))['verified'])
 def test_not_found_is_unknown_not_send_failure(self):
  self.assertFalse(self.call(opener=self.fetch(found=False))['verified'])
 def test_bad_receipt_and_mismatched_login_do_not_network(self):
  trap=lambda *args,**kwargs:self.fail('network should not be called')
  self.assertFalse(verify_module.verify(self.cred,'video_comment',BV,'12345',receipt_id='0',expected_text=BODY,opener=trap)['verified'])
  self.assertFalse(verify_module.verify(self.cred,'video_comment',BV,'54321',receipt_id=RPID,expected_text=BODY,opener=trap)['verified'])
 def test_existing_video_kinds_keep_their_contract(self):
  def get_(req,timeout):
   class R:
    def __enter__(self):return self
    def __exit__(self,*exc):return False
    def read(self,n):return b'{"code":0,"data":1}'
   return R()
  self.assertTrue(verify_module.verify(self.cred,'video_like',BV,'12345',opener=get_)['verified'])

if __name__=='__main__':unittest.main()
