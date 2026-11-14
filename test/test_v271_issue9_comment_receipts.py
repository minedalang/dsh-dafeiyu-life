"""GitHub #9: outgoing comment text, image receipt, UID mention verification."""
import ast
import datetime
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

SOURCE = Path(__file__).resolve().parents[1] / 'vendor/bilibili-mcp/mcp_server.py'
TREE = ast.parse(SOURCE.read_text(encoding='utf8'))
NAMES = {'_safe_line', '_record_comment_in_ledger', '_resolve_verified_mention_names'}
BLOCK = ast.Module(body=[node for node in TREE.body if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in NAMES],type_ignores=[])

class IssueNineCommentReceiptTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.names_seen=[]
        self.platform_name = '平台真实用户名'
        self.lookup_failure = False
        outer=self
        class FakeUser:
            def __init__(self,uid,credential):
                outer.names_seen.append(uid)
            async def get_user_info(self):
                if outer.lookup_failure: raise OSError('platform unavailable')
                return {'name':outer.platform_name}
        def append(rel,text):
            file=self.home/rel;file.parent.mkdir(parents=True,exist_ok=True)
            with file.open('a',encoding='utf8') as f:f.write(text)
        self.scope={
            'datetime':datetime.datetime,'re':re,'sys':sys,
            'user':SimpleNamespace(User=FakeUser),
            '_valid_bv':lambda bv:bv if re.fullmatch(r'BV[0-9A-Za-z]{10}',str(bv)) else (_ for _ in ()).throw(ValueError('bad bv')),
            '_read_home':lambda rel,cap=22000:(self.home/rel).read_text(encoding='utf8') if (self.home/rel).exists() else '',
            '_append_home':append,
        }
        exec(compile(BLOCK,'issue9-extracted-functions','exec'),self.scope)
        self.bv='BV1234567890'

    def rows(self):
        path=self.home/'seen.md'
        return path.read_text(encoding='utf8').splitlines() if path.exists() else []

    def record(self,payload,text,recipient=None):
        self.scope['_record_comment_in_ledger'](payload,self.bv,0,text,0,recipient)

    def test_long_comment_saved_without_20_char_truncation_or_table_injection(self):
        comment='平台已接受这段正文。'+'长文字真正文'*65+'|插入表格\n第二行'
        self.record({'success':True,'rpid':'1234567890123'},comment)
        rows=self.rows()
        line=next(x for x in rows if x.startswith('| BV'))
        self.assertIn('长文字真正文'*65,line)
        self.assertIn('／插入表格 第二行',line)
        self.assertEqual(len([x for x in rows if x.startswith('| BV')]),1)
        self.assertNotIn('|插入表格\n',line)

    def test_image_receipt_bound_to_same_comment_row_only_after_success(self):
        self.record({'success':True,'rpid':'1234567890124',
            'meme_image':{'name':'猫咪/大笑','status':'submitted_unverified'}},'真实文字')
        line=next(x for x in self.rows() if '1234567890124' in x)
        self.assertIn('meme_image_name=猫咪/大笑',line)
        self.assertIn('meme_status=submitted_unverified',line)
        self.assertIn('真实文字',line)
        self.record({'success':False,'rpid':'1234567890125',
            'meme_image':{'name':'猫咪/大笑','status':'submitted_unverified'}},'失败')
        self.assertNotIn('1234567890125','\n'.join(self.rows()))
        self.record({'success':True,'rpid':'1234567890126',
            'meme_image':{'name':'猫咪/大笑','status':'receipt_unverified'}},'未确证')
        line=next(x for x in self.rows() if '1234567890126' in x)
        self.assertNotIn('meme_image_name=',line)

    def test_untrusted_image_path_never_written(self):
        self.record({'success':True,'rpid':'1234567890127',
            'meme_image':{'name':'../etc/passwd','status':'submitted_unverified'}},'正文')
        self.assertNotIn('meme_image_name=','\n'.join(self.rows()))

    async def test_uid_name_is_resolved_even_when_alias_is_not_uid_placeholder(self):
        result=await self.scope['_resolve_verified_mention_names'](
            [{'name':'主人资料里的昵称','uid':'123456789'}],object())
        self.assertEqual(result,[{'name':'平台真实用户名','uid':'123456789','configuredName':'主人资料里的昵称'}])
        self.assertEqual(self.names_seen,[123456789])

    async def test_lookup_error_or_invalid_remote_username_cannot_use_alias(self):
        self.lookup_failure=True
        result=await self.scope['_resolve_verified_mention_names']([{'name':'主人别名','uid':'123456789'}],object())
        self.assertEqual(result,[])
        self.lookup_failure=False;self.platform_name='evil@name'
        result=await self.scope['_resolve_verified_mention_names']([{'name':'主人别名','uid':'123456789'}],object())
        self.assertEqual(result,[])
        self.assertEqual(self.scope['_resolve_verified_mention_names'].__name__,'_resolve_verified_mention_names')

if __name__=='__main__':unittest.main()
