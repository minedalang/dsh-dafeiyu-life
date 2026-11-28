"""Diagnostics opt-out does not affect actual reply and video operations."""
import ast
import importlib.util
import json
import os
from datetime import datetime
from pathlib import Path
import re
import sys
import stat
import uuid
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'vendor/bilibili-mcp/mcp_server.py'
parsed=ast.parse(SOURCE.read_text(encoding='utf8'))
names={'_record_mention_event','_public_no_mention_reason','_append_home','_append_runtime_duty_log','_valid_bv'}
nodes=[n for n in parsed.body if isinstance(n,ast.FunctionDef) and n.name in names]

class DiagnosticSwitchTests(unittest.TestCase):
 def setUp(self):
  self.temp=TemporaryDirectory();self.base=Path(self.temp.name)
  self.scope={'datetime':datetime,'json':json,'os':os,'sys':sys,'stat':stat,'uuid':uuid,'re':re,'Path':Path,'_DUTY_HOME':self.base,'_BV_PATTERN':re.compile(r'^BV[0-9A-Za-z]{10}$')}
  exec(compile(ast.Module(body=nodes,type_ignores=[]),str(SOURCE),'exec'),self.scope)
  self.f=self.scope['_record_mention_event']
  self.diag={'reason':'ai_declined','mode':'ai','selected_count':0,'configured_count':1}
  self.payload={'success':True,'rpid':123,'mention_delivery':'none','dynamic_sync':{'status':'api_accepted_unverified'}}
 def tearDown(self):self.temp.cleanup()
 def read(self):
  paths=list((self.base/'mention-diagnostics').glob('*.jsonl'))
  return [json.loads(x) for line in paths[0].read_text('utf8').splitlines() if (x:=line)] if paths else []
 def test_both_disabled_produces_no_diagnostics(self):
  with patch.dict(os.environ,{'BILI_MENTION_DIAG_ENABLED':'0','BILI_DYNAMIC_DIAG_ENABLED':'0'}):
   self.f(self.payload,'BV1pXHK6mE6z',0,self.diag,True,True,'同步原因')
  self.assertEqual(self.read(),[])
  self.assertFalse((self.base/'duty.log').exists())
 def test_dynamic_only_redacts_mention_fields(self):
  with patch.dict(os.environ,{'BILI_MENTION_DIAG_ENABLED':'0','BILI_DYNAMIC_DIAG_ENABLED':'1'}):
   self.f(self.payload,'BV1pXHK6mE6z',0,self.diag,True,True,'同步原因')
   self.f(self.payload,'BV1pXHK6mE6z',123,self.diag,False,False,'')
  records=self.read();self.assertEqual(len(records),1)
  self.assertFalse(records[0]['mention_diag_enabled'])
  self.assertTrue(records[0]['dynamic_diag_enabled'])
  self.assertNotIn('reason',records[0]);self.assertEqual(records[0]['dynamic_status'],'api_accepted_unverified')
  self.assertFalse((self.base/'duty.log').exists())
 def test_mention_only_redacts_dynamic_fields(self):
  with patch.dict(os.environ,{'BILI_MENTION_DIAG_ENABLED':'1','BILI_DYNAMIC_DIAG_ENABLED':'0'}):
   self.f(self.payload,'BV1pXHK6mE6z',0,self.diag,True,True,'同步原因')
  records=self.read();self.assertEqual(len(records),1)
  self.assertEqual(records[0]['reason'],'ai_declined')
  self.assertNotIn('dynamic_status',records[0])
  self.assertIn('@诊断',(self.base/'duty.log').read_text('utf8'))
 def test_vision_log_switch_leaves_analyzer_call_alone(self):
  spec=importlib.util.spec_from_file_location('pv_v2456',ROOT/'lib/preview_vision.py')
  mod=importlib.util.module_from_spec(spec)
  with patch.object(sys,'path',[str(ROOT/'lib'),*sys.path]):
   spec.loader.exec_module(mod)
  with patch.dict(os.environ,{'BILI_VISION_DIAG_ENABLED':'0'}):
   mod.record_vision_event(self.base,'BV1pXHK6mE6z','frames_ready')
  self.assertFalse((self.base/'vision-events').exists())
  with patch.dict(os.environ,{'BILI_VISION_DIAG_ENABLED':'1'}):
   mod.record_vision_event(self.base,'BV1pXHK6mE6z','frames_ready')
  self.assertEqual(len(list((self.base/'vision-events').glob('*.jsonl'))),1)

if __name__=='__main__': unittest.main()
