"""No-network safety tests: extract new MCP video action functions without importing Bilibili SDK."""
import ast
import asyncio
import json
import os
import re
import sqlite3
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'vendor/bilibili-mcp/mcp_server.py').read_text('utf8')
FUNCTIONS={'_selected_owned','_record_owned_selection','_selected_for_reaction','_action_conn','_claim_video_action','_finish_video_action',
           '_check_reaction','_folder_title','_styled_auto_folder_title','_favorite_new_private','_ensure_ai_folder','bili_video_like','bili_video_collect'}
TREE=ast.parse(SOURCE)
BODY=[]
for node in TREE.body:
    if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in FUNCTIONS:
        node.decorator_list=[]
        BODY.append(node)
COMPILED=compile(ast.fix_missing_locations(ast.Module(body=BODY,type_ignores=[])),'<actions>','exec')
BV='BV1pXHK6mE6z'

class DummyVideo:
    likes=[];favs=[]
    def __init__(self,bvid,credential):self.bvid=bvid
    async def like(self,status):self.likes.append((self.bvid,status))
    async def set_favorite(self,add_media_ids):self.favs.append((self.bvid,add_media_ids));return {'code':0}

class DummyFolders:
    folders=[];created=[]
    async def get_video_favorite_list(self,uid,credential):return {'list':self.folders}
    async def create_video_favorite_list(self,title,introduction,private,credential):
        self.created.append((title,private));i=100+len(self.created)
        self.folders.append({'id':i,'title':title})
        return {'id':i}

class AutonomousTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.home=Path(self.tmp.name)
        DummyVideo.likes=[];DummyVideo.favs=[];DummyFolders.folders=[];DummyFolders.created=[]
        self.env=patch.dict(os.environ,{'BILI_AUTO_VIDEO_LIKE':'1','BILI_AUTO_VIDEO_COLLECT':'1'})
        self.env.start();self.addCleanup(self.env.stop)
        credential=SimpleNamespace(dedeuserid='1234')
        self.scope={'sqlite3':sqlite3,'re':re,'os':os,'json':json,'datetime':datetime,'Path':Path,
            '_DUTY_HOME':self.home,'_ACTION_DB_NAME':'video-actions.sqlite3',
            'get_cred':lambda:credential,'_valid_bv':lambda x: x if re.fullmatch(r'BV[0-9A-Za-z]{10}',x) else (_ for _ in()).throw(ValueError('bad BV')),
            '_safe_line':lambda x,n=80:str(x)[:n], '_guard':lambda name:'',
            'favorite_list':DummyFolders(),'video':SimpleNamespace(Video=DummyVideo)}
        exec(COMPILED,self.scope)

    def call(self,name,*args):return json.loads(asyncio.run(self.scope[name](*args)))

    def mark_selected(self):
        self.scope['_record_owned_selection'](BV)

    def test_no_selected_video_no_action(self):
        x=self.call('bili_video_like',BV,'内容确实不错')
        self.assertFalse(x['ok']);self.assertEqual(DummyVideo.likes,[])
        self.assertFalse((self.home/'video-actions.sqlite3').exists())

    def test_like_only_once_and_switch_gate(self):
        self.mark_selected()
        self.assertTrue(self.call('bili_video_like',BV,'细节很有意思')['liked'])
        self.assertFalse(self.call('bili_video_like',BV,'依然很有意思')['ok'])
        self.assertEqual(len(DummyVideo.likes),1)
        with patch.dict(os.environ,{'BILI_AUTO_VIDEO_LIKE':'0'}):
            self.assertFalse(self.call('bili_video_like','BV1sTHP66E5j','不会点赞哦')['ok'])

    def test_collect_private_named_folder_and_prevent_duplicate(self):
        self.mark_selected()
        self.assertTrue(self.call('bili_video_collect',BV,'AI模型娘','以后还想重看')['collected'])
        self.assertEqual(DummyFolders.created,[('大肥鱼·AI模型娘',True)])
        self.assertEqual(DummyVideo.favs,[(BV,[101])])
        x=self.call('bili_video_collect',BV,'料理','还想再次重看')
        self.assertFalse(x['ok']);self.assertEqual(len(DummyVideo.favs),1)
        self.assertEqual(len(DummyFolders.created),1)

    def test_existing_folder_reused_and_no_injection_title(self):
        self.mark_selected()
        DummyFolders.folders=[{'id':444,'title':'大肥鱼·料理'}]
        x=self.call('bili_video_collect',BV,'料理','以后照着学做菜')
        self.assertTrue(x['ok']);self.assertFalse(x['created'])
        self.assertEqual(DummyVideo.favs,[(BV,[444])]);self.assertEqual(DummyFolders.created,[])
        self.assertRaises(ValueError,self.scope['_folder_title'],'../../危险')
        self.assertRaises(ValueError,self.scope['_folder_title'],'x')

    def test_auto_folder_name_reflects_public_persona_and_interests_not_manual(self):
        with patch.dict(os.environ,{'BILI_FISH_FAVORITE_STYLE':'playful','BILI_FISH_FAVORITE_INTERESTS':'料理、游戏'},clear=False):
            self.assertEqual(self.scope['_styled_auto_folder_title']('料理'),'大肥鱼·料理·快乐收藏')
            self.assertEqual(self.scope['_styled_auto_folder_title']('AI模型娘'),'大肥鱼·AI模型娘·鱼鱼宝藏')
            self.assertLessEqual(len(self.scope['_styled_auto_folder_title']('十二生肖周边收藏小铺')),20)
            self.assertEqual(self.scope['_folder_title']('料理'),'大肥鱼·料理')

    def test_quota_maximum_and_report_fallback(self):
        # No ledger/report: no operation even when user explicitly turns on the feature.
        self.assertFalse(self.call('bili_video_collect',BV,'料理','以后还想重看')['ok'])
        self.mark_selected()
        uid='1234'
        for k in range(5):
            name=f'BV1xxxxxxxx{k}'
            self.assertIsNone(self.scope['_claim_video_action'](uid,name,'collect',5))
        self.assertTrue(self.scope['_claim_video_action'](uid,'BV1xxxxxxxX','collect',5)['limit'])

if __name__=='__main__':unittest.main()
