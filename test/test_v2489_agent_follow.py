"""No-network tests for Bilibili agent follow/unfollow safety gates."""
import ast
import asyncio
import json
import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'vendor/bilibili-mcp/mcp_server.py').read_text('utf8')
NAME={'_relation_claim','_relation_finish','_coordinated_relation','bili_follow_creator','bili_unfollow_creator'}
NODES=[]
for node in ast.parse(SOURCE).body:
    if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in NAME:
        node.decorator_list=[];NODES.append(node)
CODE=compile(ast.fix_missing_locations(ast.Module(body=NODES,type_ignores=[])),'<follow-test>','exec')
BV='BV1pXHK6mE6z'

class FakeVideo:
    owner=234
    def __init__(self,bvid,credential):self.bvid=bvid
    async def get_info(self):return {'owner':{'mid':self.owner}}

class FakeUser:
    writes=[]
    on_change=None
    def __init__(self,uid,credential):self.uid=uid
    async def modify_relation(self,relation):
        self.writes.append((self.uid,relation))
        if self.on_change:self.on_change(relation)

class TestFollow(unittest.TestCase):
    def setUp(self):
        self.dir=tempfile.TemporaryDirectory();self.addCleanup(self.dir.cleanup)
        self.file=str(Path(self.dir.name)/'actions.sqlite3')
        self.env=patch.dict(os.environ,{'BILI_AGENT_FOLLOW_ENABLED':'1'});self.env.start();self.addCleanup(self.env.stop)
        FakeUser.writes=[]
        FakeUser.on_change=staticmethod(lambda rel:setattr(self,'relation',2 if rel=='follow' else 0))
        self.source_selected=True;self.relation=0;self.actor=123
        credential=SimpleNamespace(dedeuserid='123')
        def conn():
            c=sqlite3.connect(self.file,timeout=8)
            c.row_factory=sqlite3.Row
            return c
        @contextmanager
        def verified_outbound(kind,target,content,home=None):
            class Claim:
                def confirm(self,receipt):
                    if not receipt:raise ValueError('receipt required')
            yield Claim()
        self.scope={'_DUTY_HOME':self.dir.name,'outbound_reservation':verified_outbound,'datetime':datetime,'sqlite3':sqlite3,'json':json,'os':os,'_action_conn':conn,
            '_guard':lambda name:'', '_selected_for_creator_encounter':lambda bv:self.source_selected,
            '_valid_bv':lambda bv:bv,'get_cred':lambda:credential,
            'video':SimpleNamespace(Video=FakeVideo),
            'user':SimpleNamespace(User=FakeUser,RelationType=SimpleNamespace(SUBSCRIBE='follow',UNSUBSCRIBE='unfollow')),
            '_single_creator_relation':lambda cred,target:self.relation}
        exec(CODE,self.scope)
    def call(self,name,*args):return json.loads(asyncio.run(self.scope[name](*args)))
    def test_switch_and_selected_video_gate(self):
        with patch.dict(os.environ,{'BILI_AGENT_FOLLOW_ENABLED':'0'}):
            r=self.call('bili_follow_creator',BV,'我很喜欢这个up主的创作')
            self.assertFalse(r['ok']);self.assertEqual(FakeUser.writes,[])
        self.source_selected=False
        r=self.call('bili_follow_creator',BV,'我很喜欢这个up主的创作')
        self.assertFalse(r['ok']);self.assertEqual(FakeUser.writes,[])
    def test_only_creator_and_self_rejected(self):
        FakeVideo.owner=123
        try:
            self.assertFalse(self.call('bili_follow_creator',BV,'这位UP做的视频很有意思')['ok'])
            self.assertEqual(FakeUser.writes,[])
        finally:FakeVideo.owner=234
    def test_follow_once_never_refollow_after_unknown_response(self):
        r=self.call('bili_follow_creator',BV,'喜欢其持续制作的原创视频')
        self.assertTrue(r['ok']);self.assertEqual(r['uid'],234)
        self.assertEqual(FakeUser.writes,[(234,'follow')])
        r=self.call('bili_follow_creator',BV,'他的视频以后还想一直看')
        self.assertFalse(r['ok']);self.assertEqual(len(FakeUser.writes),1)
    def test_existing_manual_follow_never_unfollowed(self):
        self.relation=2
        r=self.call('bili_follow_creator',BV,'我喜欢他长久的创作风格')
        self.assertFalse(r['ok']);self.assertEqual(r['skipped'],'already-followed-or-blocked')
        self.assertFalse(self.call('bili_unfollow_creator',234,'不再感兴趣，经过考虑')['ok'])
        self.assertEqual(FakeUser.writes,[])
    def test_unfollow_requires_seven_days_and_own_follow(self):
        r=self.call('bili_follow_creator',BV,'持续关注这个UP今后的创作')
        self.assertTrue(r['ok'])
        self.relation=2
        self.assertFalse(self.call('bili_unfollow_creator',234,'不再适合我的兴趣方向')['ok'])
        c=self.scope['_action_conn']()
        with c:
            c.execute('UPDATE creator_relations SET followed_at=? WHERE target=?',((datetime.now()-timedelta(days=9)).isoformat(),234))
        c.close()
        r=self.call('bili_unfollow_creator',234,'已经有很久不再关注这个方向')
        self.assertTrue(r['ok']);self.assertEqual(FakeUser.writes[-1],(234,'unfollow'))
        self.assertFalse(self.call('bili_unfollow_creator',234,'重复尝试取关')['ok'])

if __name__=='__main__':unittest.main()
