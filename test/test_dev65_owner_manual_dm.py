"""Pure no-network tests of the Python second identity guard."""
import ast,json,os,tempfile,unittest,re
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'vendor/bilibili-mcp/mcp_server.py').read_text('utf8')
TREE=ast.parse(SOURCE)
GUARD=next(x for x in TREE.body if isinstance(x,ast.FunctionDef) and x.name=='_verified_existing_dm_recipient')
GUARD.decorator_list=[]
COMPILED=compile(ast.fix_missing_locations(ast.Module(body=[GUARD],type_ignores=[])),'guard','exec')
class VerifiedExistingDmTests(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.addCleanup(self.t.cleanup)
  self.root=Path(self.t.name)
  self.account='12345';self.recipient='67890';self.name='入站联系人甲'
  d=self.root/'accounts'/self.account/'runtime';d.mkdir(parents=True)
  self.file=d/'dm-autoreply-state.json'
  self.person={'nickname':self.name,'seen':['source-id'],
    'history':[{'role':'user','at':1794315585000,'text':'PRIVATE MESSAGE'}],
    'lastRepliedAt':0}
  self.save()
  self.scope={'re':re,'json':json,'_DUTY_HOME':self.root}
  exec(COMPILED,self.scope)
 def save(self):self.file.write_text(json.dumps({'people':{self.recipient:self.person}},ensure_ascii=False),'utf8')
 def verify(self,source='source-id',name=None):
  return self.scope['_verified_existing_dm_recipient'](self.account,self.recipient,name or self.name,source)
 def test_real_incoming_is_eligible_and_private_text_is_not_returned(self):
  self.assertTrue(self.verify())
 def test_wrong_source_account_name_and_no_contact_fail(self):
  for source in ['wrong','']:
   with self.assertRaises(ValueError):self.verify(source=source)
  with self.assertRaises(ValueError):self.verify(name='冒名昵称')
  with self.assertRaises(ValueError):self.scope['_verified_existing_dm_recipient']('99999',self.recipient,self.name,'source-id')
  self.person['dmContactBoundaries']={self.account:{'status':'stop'}};self.save()
  with self.assertRaises(ValueError):self.verify()
 def test_previously_replied_does_not_replay(self):
  self.person['lastRepliedAt']=1794315585001;self.save()
  with self.assertRaises(ValueError):self.verify()
 def test_python_manual_sender_shares_same_dm_duplicate_ledger_and_no_whitelist_override(self):
  new=next(n for n in TREE.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='bili_reply_existing_dm_manual')
  txt=ast.get_source_segment(SOURCE,new)
  self.assertIn("_claim_session_manual_action(account,'dm'",txt)
  self.assertIn("BILI_JS_MCP_ADAPTER",txt)
  self.assertIn("confirm is not True",txt)
  old=next(n for n in TREE.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='bili_send_message_manual')
  self.assertIn('BILI_SESSION_DM_ALLOWED_UIDS',ast.get_source_segment(SOURCE,old))
if __name__=='__main__':unittest.main()

class ManualSendExecutionTests(VerifiedExistingDmTests):
 def setUp(self):
  super().setUp()
  import asyncio,types
  self.asyncio=asyncio
  sender=next(n for n in TREE.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='bili_reply_existing_dm_manual')
  sender.decorator_list=[]
  compiled=compile(ast.fix_missing_locations(ast.Module(body=[sender],type_ignores=[])),'sender','exec')
  self.calls=0;self.claims=[];self.finishes=[]
  async def mock_send(receiver_uid,text):
   self.calls+=1
   return json.dumps({'success':True,'msg_id':'123456'})
  def claim(account,kind,target,body,limit,**kwargs):
   self.claims.append((account,kind,target,limit,body,kwargs))
   if len(self.claims)>1:return {'ok':False,'already':True}
   return {'ok':True,'body_hash':'dummyhash','day':'2026-11-11'}
  def finish(*args):self.finishes.append(args)
  self.scope.update({'os':os,'get_cred':lambda:types.SimpleNamespace(dedeuserid=self.account),
      '_guard':lambda name:'','_claim_session_manual_action':claim,
      '_finish_session_manual_action':finish,'bili_send_message':mock_send})
  exec(compiled,self.scope)
 def send(self,confirm=True,name=None,source='source-id'):
  with patch.dict(os.environ,{'BILI_JS_MCP_ADAPTER':'1','BILI_SESSION_MANUAL_EXISTING_DM_REPLY_ENABLED':'1',
    'BILI_SESSION_MANUAL_ACTIONS_ENABLED':'1','BILI_SESSION_DM_DAILY_LIMIT':'5'}):
   raw=self.asyncio.run(self.scope['bili_reply_existing_dm_manual'](int(self.recipient),name or self.name,source,'只回复一次',confirm))
  return json.loads(raw)
 def test_manual_send_has_one_platform_write_and_shares_dm_quota_ledger(self):
  first=self.send();self.assertTrue(first['ok']);self.assertEqual(self.calls,1)
  self.assertEqual(self.claims[0][1],'dm')
  self.assertEqual(self.claims[0][4],'inbound:source-id')
  self.assertTrue(self.claims[0][5].get('unique_target_day'))
  self.assertEqual(self.finishes[0][-2],'ok')
  again=self.send();self.assertFalse(again['ok']);self.assertEqual(self.calls,1)
 def test_missing_owner_confirm_or_wrong_message_never_calls_platform(self):
  self.assertFalse(self.send(confirm=False)['ok'])
  self.assertFalse(self.send(source='another-id')['ok'])
  self.assertEqual(self.calls,0)

class MainSessionDmClaimIsolationTests(unittest.TestCase):
 def setUp(self):
  import sqlite3,hashlib
  from datetime import datetime
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  nodes=[n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name in ('_action_conn','_claim_session_manual_action')]
  compiled=compile(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])),'claim','exec')
  self.scope={'sqlite3':sqlite3,'hashlib':hashlib,'datetime':datetime,'_DUTY_HOME':Path(self.temp.name),
              '_ACTION_DB_NAME':'video-actions.sqlite3'}
  exec(compiled,self.scope)
 def test_ordinary_manual_dm_same_recipient_prevents_exceptional_refill(self):
  claim=self.scope['_claim_session_manual_action']
  first=claim('123','dm','67890','first ordinary manual message',5)
  self.assertTrue(first['ok'])
  blocked=claim('123','dm','67890','inbound:source-id',5,unique_target_day=True)
  self.assertTrue(blocked.get('already'))
 def test_inbound_exception_cannot_repeat_with_another_text_or_source(self):
  claim=self.scope['_claim_session_manual_action']
  one=claim('123','dm','67890','inbound:first',5,unique_target_day=True)
  self.assertTrue(one['ok'])
  two=claim('123','dm','67890','inbound:second',5,unique_target_day=True)
  self.assertTrue(two.get('already'))
  other=claim('124','dm','67890','inbound:first',5,unique_target_day=True)
  self.assertTrue(other['ok'])
