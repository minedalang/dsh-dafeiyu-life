"""No real B站 calls: verify exact reply target before recording identity."""
import ast
import asyncio
from datetime import datetime
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest

FILE=Path(__file__).resolve().parents[1]/'vendor/bilibili-mcp/mcp_server.py'
NEEDED={'_verified_video_reply_recipient','_record_comment_in_ledger','_read_home','_append_home','_safe_line','_valid_bv'}
TREE=ast.parse(FILE.read_text(encoding='utf8'))
CODE=compile(ast.Module(body=[x for x in TREE.body if isinstance(x,(ast.FunctionDef,ast.AsyncFunctionDef)) and x.name in NEEDED],type_ignores=[]),str(FILE),'exec')
BV='BV17x411w7KC'

class Comment:
    def __init__(self, oid,type_,rpid,credential):self.rpid=str(rpid)
    async def get_sub_comments(self,page_index,page_size):
        return {'root':{'rpid':self.rpid,'member':{'mid':'987654321','uname':'根作者'},'content':{'message':'楼主的回复'}},
            'replies':[
                {'rpid':'321906225297','member':{'mid':'485221842','uname':'真正的目标'},'content':{'message':'我选蓝色'}},
                {'rpid':'321906225298','member':{'mid':'7777777','uname':'另一条'},'content':{'message':'随便看看'}}]}
class FakeModule:
    class CommentResourceType:VIDEO=1
    Comment=Comment

class RecipientTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.home=Path(self.temp.name)
        self.scope={'json':json,'re':re,'os':os,'sys':sys,'Path':Path,'_DUTY_HOME':self.home,
                    'datetime':datetime,'comment':FakeModule,'_BV_PATTERN':re.compile(r'^BV[0-9A-Za-z]{10}$')}
        exec(CODE,self.scope)
        self.verify=self.scope['_verified_video_reply_recipient']
        self.write=self.scope['_record_comment_in_ledger']
    def tearDown(self):self.temp.cleanup()
    def text(self):return (self.home/'seen.md').read_text('utf8') if (self.home/'seen.md').exists() else ''
    def test_exact_nested_target_not_root_or_other_commenter(self):
        x=asyncio.run(self.verify(117499517475828,321906225297,321900000000,object()))
        self.assertEqual((x['uid'],x['name'],x['comment']),('485221842','真正的目标','我选蓝色'))
        self.write({'success':True,'rpid':'322430862001'},BV,321906225297,'好呀',321900000000,x)
        self.assertIn('recipient_uid=485221842',self.text())
        self.assertIn('recipient_name=真正的目标',self.text())
        self.assertNotIn('recipient_uid=987654321',self.text())
    def test_reply_to_top_uses_exact_root_comment(self):
        x=asyncio.run(self.verify(117499517475828,321900000000,0,object()))
        self.assertEqual(x['uid'],'987654321')
    def test_unverified_target_remains_unknown(self):
        x=asyncio.run(self.verify(117499517475828,321906225299,321900000000,object()))
        self.assertIsNone(x)
        self.write({'success':True,'rpid':'322430862002'},BV,321906225299,'不能猜对方',321900000000,x)
        self.assertNotIn('recipient_uid=',self.text())
    def test_failures_or_bad_receipts_never_create_metadata(self):
        self.write({'success':False,'rpid':'322430862003'},BV,321906225297,'未发送',321900000000,{'uid':'485221842'})
        self.write({'success':True},BV,321906225297,'没有出站 ID',321900000000,{'uid':'485221842'})
        self.assertNotIn('recipient_uid=',self.text())
    def test_unverified_uid_in_model_input_cannot_enter_record(self):
        self.write({'success':True,'rpid':'322430862004'},BV,321906225297,'你好',321900000000,
                   {'uid':'../../123','name':'伪造'})
        self.assertNotIn('recipient_uid=',self.text())

if __name__=='__main__':unittest.main()
