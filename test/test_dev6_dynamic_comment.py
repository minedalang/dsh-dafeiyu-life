"""dev.6 dynamic comments: actual Python function tests without network/API credentials."""
import ast
import asyncio
import json
import os
import re
import types
import unittest
from pathlib import Path
from unittest.mock import patch

SERVER = Path(__file__).resolve().parents[1] / 'vendor' / 'bilibili-mcp' / 'mcp_server.py'
FUNC = {'_checked_dynamic_id', '_dynamic_comment_area', '_get_dynamic_comment_area',
        '_safe_dynamic_reply','_find_dynamic_target','bili_dynamic_comment_context',
        'bili_dynamic_comment_manual'}


def make_env(info=None, rows=None, response=None):
    writes, claims, finished = [], [], []
    did='1264976926524571648'
    base = info if info is not None else {'item':{'id_str':did,'type':'DYNAMIC_TYPE_WORD',
       'basic':{'comment_type':17,'comment_id_str':'1264976926524000000','rid_str':'1264976926524999999'}}}
    results = rows if rows is not None else [{'rpid_str':'1234567890123456789','member':{'mid':'900','uname':'朋友'},
       'content':{'message':'五条悟和宿傩谁强？'}}]

    class Dynamic:
        def __init__(self,dynamic_id,credential=None):
            assert dynamic_id==int(did)
        async def get_info(self):return base
    class Comment:
        def __init__(self,oid,type_,rpid,credential=None): pass
        async def get_sub_comments(self,page_index=1,page_size=20):return {'root':None,'replies':[]}
    async def get_comments(**kwargs):
        assert kwargs['oid']==1264976926524000000
        assert kwargs['type_']=='dynamic'
        return {'replies':results}
    async def send_comment(**kwargs):
        writes.append(kwargs)
        return response if response is not None else {'code':0,'data':{'rpid_str':'2234567890123456789'}}
    def claim(uid,kind,target,body,daily_limit):
        claims.append((uid,kind,target,body,daily_limit))
        return {'ok':True,'body_hash':'hashed','day':'2026-11-01'}
    def finish(*args):finished.append(args)
    def tool():return lambda fn:fn
    env={'__name__':'__isolated_dynamic_test__','re':re,'os':os,'json':json,'tool':tool,
        'get_cred':lambda:types.SimpleNamespace(dedeuserid='12345'),
        'dynamic':types.SimpleNamespace(Dynamic=Dynamic),
        'comment':types.SimpleNamespace(Comment=Comment, get_comments=get_comments,
                 send_comment=send_comment,OrderType=types.SimpleNamespace(TIME='time'),
                 CommentResourceType=types.SimpleNamespace(DYNAMIC='dynamic',DYNAMIC_DRAW='draw')),
        '_guard':lambda name:'','_claim_session_manual_action':claim,'_finish_session_manual_action':finish}
    root=ast.parse(SERVER.read_text(encoding='utf8'))
    nodes=[n for n in root.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in FUNC]
    code=compile(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])),str(SERVER),'exec')
    exec(code,env)
    return env,writes,claims,finished

class DynamicTests(unittest.TestCase):
    def test_type_and_oid_are_from_verified_detail(self):
        env,*_=make_env()
        area=env['_dynamic_comment_area']({'item':{'id_str':'1264976926524571648',
            'type':'DYNAMIC_TYPE_WORD','basic':{'comment_type':17,'comment_id_str':'1264976926524000000',
            'rid_str':'1264976926524999999'}}},'1264976926524571648')
        self.assertEqual(area['oid'],'1264976926524000000')
        self.assertEqual(area['resource_type'],'dynamic')
        with self.assertRaises(ValueError):env['_dynamic_comment_area']({'item':{'id_str':'other','basic':{'comment_type':17}}},'1264976926524571648')
        with self.assertRaises(ValueError):env['_dynamic_comment_area']({'item':{'id_str':'1264976926524571648','type':'DYNAMIC_TYPE_AV','basic':{'comment_type':1,'rid_str':'121'}}},'1264976926524571648')
        with self.assertRaises(ValueError):env['_dynamic_comment_area']({'item':{'id_str':'1264976926524571648','type':'DYNAMIC_TYPE_WORD','basic':{'comment_type':11,'comment_id_str':'123'}}},'1264976926524571648')
        with self.assertRaises(ValueError):env['_checked_dynamic_id']('1264976926524571648.0')

    def test_read_then_reply_honors_target_and_confirm(self):
        env,writes,claims,finished=make_env()
        with patch.dict(os.environ,{'BILI_SESSION_MANUAL_ACTIONS_ENABLED':'1','BILI_COMMENT_DAILY_LIMIT':'5'}):
            ctx=json.loads(asyncio.run(env['bili_dynamic_comment_context']('1264976926524571648','1234567890123456789')))
            self.assertTrue(ctx['ok']);self.assertEqual(ctx['oid'],'1264976926524000000')
            rejected=json.loads(asyncio.run(env['bili_dynamic_comment_manual']('1264976926524571648','我觉得五条悟更强','1234567890123456789',confirm=False)))
            self.assertFalse(rejected['ok']);self.assertEqual(len(writes),0)
            result=json.loads(asyncio.run(env['bili_dynamic_comment_manual']('1264976926524571648','我觉得五条悟更强','1234567890123456789',confirm=True)))
        self.assertEqual(result['sentRpid'],'2234567890123456789')
        self.assertEqual(result['action'],'dynamic-reply')
        self.assertEqual(writes[0]['oid'],1264976926524000000)
        self.assertEqual(writes[0]['root'],1234567890123456789)
        self.assertIsNone(writes[0]['parent'])
        self.assertEqual(claims[0][1],'comment')
        self.assertEqual(finished[0][5],'ok')

    def test_missing_target_and_uncertain_receipt_never_blind_send(self):
        env,writes,claims,finished=make_env(rows=[])
        with patch.dict(os.environ,{'BILI_SESSION_MANUAL_ACTIONS_ENABLED':'1'}):
            result=json.loads(asyncio.run(env['bili_dynamic_comment_manual']('1264976926524571648','回复','1234567890123456789',confirm=True)))
        self.assertFalse(result['ok']);self.assertEqual(writes,[])
        env,writes,claims,finished=make_env(response={'code':-403})
        with patch.dict(os.environ,{'BILI_SESSION_MANUAL_ACTIONS_ENABLED':'1'}):
            result=json.loads(asyncio.run(env['bili_dynamic_comment_manual']('1264976926524571648','顶层评论',confirm=True)))
        self.assertFalse(result['ok']);self.assertTrue(result['no_retry'])
        self.assertEqual(len(writes),1)
        self.assertEqual(finished[0][5],'uncertain')

if __name__=='__main__':unittest.main()
