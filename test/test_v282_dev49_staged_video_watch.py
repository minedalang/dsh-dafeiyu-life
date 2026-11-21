"""Offline behavioral tests for the per-round staged watch tool."""
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

SRC = Path(__file__).resolve().parents[1] / 'vendor/bilibili-mcp/mcp_server.py'
BV = 'BV1234567890'


def extract(*names):
    tree=ast.parse(SRC.read_text(encoding='utf8'))
    nodes=[]
    for node in tree.body:
        if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in names:
            node.decorator_list=[]
            nodes.append(node)
    env={}
    exec(compile(ast.Module(body=nodes,type_ignores=[]),str(SRC),'exec'),env)
    return env


class StagedVideoWatchTest(unittest.TestCase):
    def test_account_round_bv_selection_proof_is_exact(self):
        proof=extract('_selected_in_current_video_round')['_selected_in_current_video_round']
        with tempfile.TemporaryDirectory() as home:
            db=Path(home)/'video-actions.sqlite3'
            conn=sqlite3.connect(db)
            conn.execute('CREATE TABLE selected_videos (account TEXT,bvid TEXT,day TEXT,round_id TEXT,status TEXT)')
            conn.execute('INSERT INTO selected_videos VALUES (?,?,?,?,?)',('123',BV,'2026-11-20','a'*24,'挑中'))
            conn.commit();conn.close()
            g=proof.__globals__
            g.update(sqlite3=sqlite3,os=os,re=re,datetime=datetime,
                     _BV_PATTERN=re.compile(r'^BV[0-9A-Za-z]{10}$'),
                     _DUTY_HOME=Path(home),_ACTION_DB_NAME='video-actions.sqlite3',
                     get_cred=lambda:SimpleNamespace(dedeuserid='123'))
            with patch.dict(os.environ,{'BILI_DUTY_LIFE_ROUND_ID':'a'*24}):
                self.assertTrue(proof(BV), 'same round remains eligible across midnight')
                self.assertFalse(proof('BVaaaaaaaaaa'))
                g['get_cred']=lambda:SimpleNamespace(dedeuserid='999')
                self.assertFalse(proof(BV))
                g['get_cred']=lambda:SimpleNamespace(dedeuserid='123')
            with patch.dict(os.environ,{'BILI_DUTY_LIFE_ROUND_ID':'b'*24}):
                self.assertFalse(proof(BV))

    def make_watch(self,*,picked=True,caption=True,vision=True,asr=False):
        events=[]
        class Text:
            def __init__(self,type,text):self.type=type;self.text=text
        class Image:pass
        class Result:
            def __init__(self,content):self.content=content
        async def subtitle(bvid,auto_vision_on_missing=False):
            events.append('subtitle')
            return json.dumps({'bvid':bvid,'subtitle_evidence':'caption_text' if caption else 'none',
                               'text':'字幕内容' if caption else ''},ensure_ascii=False)
        async def preview(bvid,**kwargs):
            events.append('vision')
            return json.dumps({'bvid':bvid,'ok':vision,'status':'analyzed' if vision else 'vision_failed',
                'image_source':'B站低清预览','times':[0,15],'description':'画面实际包含人物移动的分镜描述' if vision else ''},ensure_ascii=False)
        async def transcribe(bvid):
            events.append('asr')
            return json.dumps({'bvid':bvid,'source':'local-asr','asr_evidence':'faster-whisper-machine-transcript',
                              'text':'真实转写文本内容','timed_segments':[]},ensure_ascii=False)
        watch=extract('bili_watch_video')['bili_watch_video']
        watch.__globals__.update(asyncio=asyncio,json=json,os=os,
              _guard=lambda name:'',_valid_bv=lambda x:x,
              _selected_in_current_video_round=lambda b:picked,
              bili_subtitle=subtitle,bili_preview_vision=preview,bili_transcribe_safe=transcribe,
              CallToolResult=Result,TextContent=Text,ImageContent=Image)
        return watch,events

    def test_bundled_watch_runs_both_and_evidences_remain_independent(self):
        watch,calls=self.make_watch()
        with patch.dict(os.environ,{'BILI_DUTY_VIDEO_PICK_FLOW':'1','BILI_VISION_ENABLED':'1','BILI_ASR_ENABLED':'1'}):
            res=json.loads(asyncio.run(watch(BV)))
        self.assertEqual(set(calls),{'subtitle','vision'})
        self.assertTrue(res['ok'])
        self.assertTrue(res['visual']['ok'])
        self.assertEqual(res['speech']['source'],'official-subtitles')
        self.assertFalse(res['can_claim_full_video_watched'])
        self.assertFalse(res['can_claim_audio_listened'])

    def test_caption_survives_failed_vision(self):
        watch,calls=self.make_watch(vision=False)
        with patch.dict(os.environ,{'BILI_DUTY_VIDEO_PICK_FLOW':'1','BILI_VISION_ENABLED':'1','BILI_ASR_ENABLED':'0'}):
            res=json.loads(asyncio.run(watch(BV)))
        self.assertTrue(res['ok']);self.assertFalse(res['visual']['ok']);self.assertTrue(res['speech']['ok'])

    def test_asr_only_when_caption_missing_and_opted_in(self):
        watch,calls=self.make_watch(caption=False,vision=False)
        with patch.dict(os.environ,{'BILI_DUTY_VIDEO_PICK_FLOW':'1','BILI_VISION_ENABLED':'1','BILI_ASR_ENABLED':'1'}):
            res=json.loads(asyncio.run(watch(BV)))
        self.assertEqual(set(calls),{'subtitle','vision','asr'})
        self.assertEqual(res['speech']['source'],'local-asr');self.assertTrue(res['ok'])

    def test_no_capability_is_not_fabricated_as_watch_success(self):
        watch,calls=self.make_watch(caption=False,vision=False)
        with patch.dict(os.environ,{'BILI_DUTY_VIDEO_PICK_FLOW':'1','BILI_VISION_ENABLED':'0','BILI_ASR_ENABLED':'0'}):
            res=json.loads(asyncio.run(watch(BV)))
        self.assertEqual(calls,['subtitle']);self.assertFalse(res['ok'])
        self.assertFalse(res['visual']['attempted']);self.assertFalse(res['speech']['ok'])

    def test_no_selection_and_no_video_agent_never_launch_reads(self):
        watch,calls=self.make_watch(picked=False)
        with patch.dict(os.environ,{'BILI_DUTY_VIDEO_PICK_FLOW':'1','BILI_VISION_ENABLED':'1'}):
            res=json.loads(asyncio.run(watch(BV)))
        self.assertTrue(res['blocked']);self.assertEqual(calls,[])
        watch2,calls2=self.make_watch(picked=True)
        with patch.dict(os.environ,{'BILI_DUTY_VIDEO_PICK_FLOW':'0','BILI_VISION_ENABLED':'1'}):
            res2=json.loads(asyncio.run(watch2(BV)))
        self.assertTrue(res2['blocked']);self.assertEqual(calls2,[])

if __name__=='__main__':unittest.main()
