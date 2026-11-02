"""2.6.1-dev.1: real Python function behavior, simulated Bilibili SDK (no network)."""
import ast
import asyncio
import json
import os
import re
import sqlite3
import tempfile
import unittest
from pathlib import Path
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'vendor/bilibili-mcp/mcp_server.py').read_text('utf8')
NEEDED={'_action_conn','_folder_title','_styled_auto_folder_title','_favorite_new_private','_ensure_ai_folder',
        '_check_reaction','_selected_for_reaction','_claim_video_action','_finish_video_action',
        'bili_video_collect','bili_fish_created_folders','bili_favorite_folder_delete'}
tree=ast.parse(SOURCE)
body=[]
for node in tree.body:
    if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in NEEDED:
        node.decorator_list=[]
        body.append(node)
PROGRAM=compile(ast.fix_missing_locations(ast.Module(body=body,type_ignores=[])),'dev1-safe-actions','exec')
BV='BV1pXHK6mE6z'

class FakeVideo:
    def __init__(self,bvid,credential):self.bvid=bvid
    async def set_favorite(self,add_media_ids):return {'code':0}

class FakeFolders:
    def __init__(self):self.folders=[];self.created=[];self.deleted=[];self.fail_after=False
    async def get_video_favorite_list(self,uid,credential):
        if self.fail_after:raise RuntimeError('模拟网络断开')
        return {'list':[dict(x) for x in self.folders]}
    async def create_video_favorite_list(self,title,introduction,private,credential):
        fid=101+len(self.created)
        self.created.append((title,private,fid))
        self.folders.append({'id':fid,'title':title,'mid':1234,'attr':3 if private else 1,'media_count':2})
        return {'id':fid}
    async def delete_video_favorite_list(self,media_ids,credential):
        self.deleted.append(list(media_ids))
        self.folders=[x for x in self.folders if x['id'] not in media_ids]
        return {'code':0}

class FreedomTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.home=Path(self.temp.name)
        self.folders=FakeFolders()
        self.env=patch.dict(os.environ,{'BILI_AUTO_VIDEO_COLLECT':'1','BILI_FISH_FOLDER_DELETE':'1','BILI_FISH_FOLDER_VISIBILITY':'auto'})
        self.env.start();self.addCleanup(self.env.stop)
        cred=SimpleNamespace(dedeuserid='1234')
        self.scope={'sqlite3':sqlite3,'re':re,'os':os,'json':json,'datetime':datetime,'Path':Path,
           '_DUTY_HOME':self.home,'_ACTION_DB_NAME':'video-actions.sqlite3','get_cred':lambda:cred,
           '_valid_bv':lambda v:v if re.fullmatch(r'BV[0-9A-Za-z]{10}',v) else (_ for _ in ()).throw(ValueError('bad BV')),
           '_safe_line':lambda v,n=100:str(v).strip()[:n], '_guard':lambda name:'',
           'favorite_list':self.folders,'video':SimpleNamespace(Video=FakeVideo)}
        exec(PROGRAM,self.scope)
    def call(self,name,*args,**kwargs):return json.loads(asyncio.run(self.scope[name](*args,**kwargs)))
    def mark(self,bv=BV):
        d=self.home/'out';d.mkdir(exist_ok=True)
        (d/(datetime.now().strftime('%Y-%m-%d')+'.md')).write_text('### '+bv+'\n','utf8')
    def test_automatic_public_and_private_and_forced_policies(self):
        self.mark()
        result=self.call('bili_video_collect',BV,'料理','想给大家分享自己发现的食谱',visibility='public')
        self.assertTrue(result['ok']);self.assertFalse(self.folders.created[0][1])
        self.assertFalse(result['new_folder_private'])
        with patch.dict(os.environ,{'BILI_FISH_FOLDER_VISIBILITY':'private'}):
            self.assertTrue(self.scope['_favorite_new_private']('public'))
        with patch.dict(os.environ,{'BILI_FISH_FOLDER_VISIBILITY':'public'}):
            self.assertFalse(self.scope['_favorite_new_private']('private'))
        with patch.dict(os.environ,{'BILI_FISH_FOLDER_VISIBILITY':'invalid'}):
            self.assertTrue(self.scope['_favorite_new_private']('public'))
    def test_default_choice_private_and_no_rewrite_existing(self):
        self.mark()
        first=self.call('bili_video_collect',BV,'料理','这次想自己留着收藏')
        self.assertTrue(first['new_folder_private'])
        self.assertEqual(len(self.folders.created),1)
        second=asyncio.run(self.scope['_ensure_ai_folder'](SimpleNamespace(), '1234','料理',True,visibility='public'))
        self.assertFalse(second[2]);self.assertEqual(self.folders.created[0][1],True)
    def test_deletion_only_logged_owned_correct_id_and_title(self):
        self.folders.folders=[{'id':300,'title':'大肥鱼·未知','mid':1234,'attr':1,'media_count':3}]
        self.assertFalse(self.call('bili_favorite_folder_delete',300,'不再需要这些内容的收藏夹')['ok'])
        self.assertEqual(self.folders.deleted,[])
        self.mark()
        self.call('bili_video_collect',BV,'料理','是值得以后回顾的收藏视频')
        self.assertEqual(len(self.call('bili_fish_created_folders')['folders']),1)
        self.folders.folders[-1]['title']='改名了'
        self.assertFalse(self.call('bili_favorite_folder_delete',101,'这类兴趣已经改变不再需要')['ok'])
        self.folders.folders[-1]['title']='大肥鱼·料理'
        ok=self.call('bili_favorite_folder_delete',101,'我现在不再想保留这类收藏内容了')
        self.assertTrue(ok['deleted']);self.assertEqual(self.folders.deleted,[[101]])
        self.assertFalse(self.call('bili_favorite_folder_delete',101,'再删一次看看效果')['ok'])
    def test_forced_off_and_uncertain_no_retry(self):
        self.mark();self.call('bili_video_collect',BV,'料理','以后还想重看的食谱')
        with patch.dict(os.environ,{'BILI_FISH_FOLDER_DELETE':'0'}):
            self.assertFalse(self.call('bili_favorite_folder_delete',101,'这个收藏夹我想自己整理删除了')['ok'])
        original=self.folders.delete_video_favorite_list
        async def delete_but_disconnect(media_ids,credential):
            await original(media_ids,credential)
            self.folders.fail_after=True
        self.folders.delete_video_favorite_list=delete_but_disconnect
        uncertain=self.call('bili_favorite_folder_delete',101,'这个收藏夹我想自己整理删除了')
        self.assertTrue(uncertain['uncertain']);self.assertTrue(uncertain['no_retry'])
        self.folders.fail_after=False
        self.assertFalse(self.call('bili_favorite_folder_delete',101,'重复之前的删除请求再试试看')['ok'])
    def test_no_account_mixup_and_default_folder(self):
        self.mark();self.call('bili_video_collect',BV,'料理','以后还想看相关食谱')
        self.folders.folders[-1]['mid']=9999
        self.assertFalse(self.call('bili_favorite_folder_delete',101,'不再需要这种收藏夹了')['ok'])
        self.folders.folders[-1]['mid']=1234
        self.folders.folders[-1]['attr']=0
        self.assertFalse(self.call('bili_favorite_folder_delete',101,'想删除这个默认收藏夹了')['ok'])
if __name__=='__main__':unittest.main()
