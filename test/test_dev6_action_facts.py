"""Offline dev.6 test: selected video provenance, account separation, live state vs historical receipts."""
import ast
import asyncio
import json
import os
import re
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'vendor/bilibili-mcp/mcp_server.py').read_text('utf8')
NAMES={'_current_account_uid','_owned_seen','_record_owned_observation','_owned_ledger_text','_owned_comment_exists','_selected_owned','_record_owned_selection','_selected_for_reaction','_selected_for_creator_encounter','_action_conn','_creator_encounter_snapshot','_creator_relation_table_exists',
       'bili_creator_encounter','bili_creator_relation_status','bili_ledger_mark','bili_ledger_read'}
rows=[]
for item in ast.parse(SOURCE).body:
    if isinstance(item,(ast.FunctionDef,ast.AsyncFunctionDef)) and item.name in NAMES:
        item.decorator_list=[];rows.append(item)
BYTECODE=compile(ast.fix_missing_locations(ast.Module(body=rows,type_ignores=[])),'<dev6-facts>','exec')
BV1='BV1pXHK6mE6z';BV2='BV1sTHP66E5j'

class Video:
    owner=777
    def __init__(self,bvid,credential):self.bvid=bvid
    async def get_info(self):return {'owner':{'mid':self.owner}}

class ActionFacts(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.home=Path(self.temp.name)
        self.account='111'
        self.relation=0
        self.env=patch.dict(os.environ,{'BILI_AGENT_FOLLOW_ENABLED':'1'});self.env.start();self.addCleanup(self.env.stop)
        def read_home(name,cap=2000000):
            p=self.home/name
            return p.read_text('utf8')[-cap:] if p.exists() else ''
        def append_home(name,data):
            with (self.home/name).open('a',encoding='utf8') as f:f.write(data)
        self.locals={'_DUTY_HOME':self.home,'_ACTION_DB_NAME':'video-actions.sqlite3',
            'os':os,'json':json,'re':re,'sqlite3':sqlite3,'tempfile':tempfile,'Path':Path,
            'datetime':datetime,'timedelta':timedelta,'get_cred':lambda:SimpleNamespace(dedeuserid=self.account),
            'video':SimpleNamespace(Video=Video),'_single_creator_relation':lambda cred,uid:self.relation,
            '_guard':lambda name:'','_valid_bv':lambda b:b if re.fullmatch(r'BV[0-9A-Za-z]{10}',b) else (_ for _ in ()).throw(ValueError('无效BV')),
            '_safe_line':lambda data,n=80:str(data).strip()[:n], '_read_home':read_home,'_append_home':append_home}
        exec(BYTECODE,self.locals)
    def call(self,name,*args):return json.loads(asyncio.run(self.locals[name](*args)))
    def mark(self,bv,status):return self.call('bili_ledger_mark',bv,'有来源的标题','UP',status)
    def test_negative_status_never_authorizes_a_follow(self):
        for status in ['不值得看','未挑中','不入选','跳过','未选中']:
            with self.subTest(status=status):
                (self.home/'seen.md').write_text('',encoding='utf8')
                self.mark(BV1,status)
                self.assertFalse(self.locals['_selected_for_reaction'](BV1))
                self.assertFalse(self.call('bili_creator_encounter',BV1)['ok'])
                self.assertFalse(self.locals['_selected_for_reaction'](BV1))  # negative observations are scoped but never grant writes
        (self.home/'seen.md').write_text('',encoding='utf8')
        self.mark(BV1,'挑中');self.assertTrue(self.locals['_selected_for_reaction'](BV1))
    def test_legacy_recommendation_ledger_not_rewritten_or_used_as_fish_encounter(self):
        # No migration/rewrite of old recommendation/seen data in this release.
        self.mark(BV1,'看过')
        self.assertFalse(self.locals['_selected_for_creator_encounter'](BV1))
        self.assertTrue(self.mark(BV1,'挑中')['already_seen'])
        self.assertTrue(self.locals['_selected_for_creator_encounter'](BV1))
        self.mark(BV2,'值得看')
        self.assertFalse(self.locals['_selected_for_reaction'](BV2)) # old aliases never authorize
        self.assertFalse(self.locals['_selected_for_creator_encounter'](BV2))
        self.assertFalse(self.call('bili_creator_encounter',BV2)['ok'])

    def test_active_ledger_read_excludes_other_accounts_and_unscoped_markdown(self):
        self.mark(BV1,'挑中')
        self.mark(BV2,'跳过')
        current=asyncio.run(self.locals['bili_ledger_read']())
        self.assertIn(BV1,current)
        self.assertIn(BV2,current)
        self.account='222'
        other=asyncio.run(self.locals['bili_ledger_read']())
        self.assertNotIn(BV1,other)
        self.assertNotIn(BV2,other)
        self.assertFalse(self.locals['_owned_seen'](BV1))
        self.mark(BV1,'挑中')
        self.assertTrue(self.locals['_owned_seen'](BV1))
        self.account='111'
        self.assertTrue(self.locals['_owned_seen'](BV1))
        self.assertTrue((self.home/'seen.md').exists())  # legacy projection retained

    def test_shared_markdown_never_cross_authorizes_account(self):
        self.mark(BV1,'挑中')
        self.assertTrue(self.locals['_selected_for_creator_encounter'](BV1))
        self.account='222'
        self.assertFalse(self.locals['_selected_for_creator_encounter'](BV1))
        self.assertFalse(self.locals['_selected_for_reaction'](BV1))
        self.assertFalse(self.call('bili_creator_encounter',BV1)['ok'])
        self.assertTrue(self.mark(BV1,'挑中')['recorded_selection'])
        self.assertTrue(self.locals['_selected_for_creator_encounter'](BV1))

    def test_legacy_report_and_noncanonical_marker_never_authorize(self):
        folder=self.home/'out';folder.mkdir(exist_ok=True)
        (folder/(datetime.now().strftime('%Y-%m-%d')+'.md')).write_text('### '+BV1+'\n','utf8')
        (self.home/'seen.md').write_text('| '+datetime.now().strftime('%Y-%m-%d')+' | '+BV1+' | old | up | 挑中 |\n','utf8')
        self.assertFalse(self.locals['_selected_for_reaction'](BV1))
        for status in ('值得看','挑中·值得看','已挑中','入选','可以看'):
            self.assertFalse(self.mark(BV2,status)['ok'])
            self.assertFalse(self.locals['_selected_for_reaction'](BV2))

    def test_live_follow_status_is_not_immutable_local_fact(self):
        self.mark(BV1,'挑中')
        # Even though this is selected, the status lookup is read-only.
        first=self.call('bili_creator_relation_status',BV1)
        self.assertTrue(first['ok']);self.assertEqual(first['followCurrent'],'not-following')
        self.assertTrue((self.home/'video-actions.sqlite3').exists())  # selected proof now durable
        # An actual verified encounter is recorded, not an outward follow.
        record=self.call('bili_creator_encounter',BV1)
        self.assertTrue(record['ok']);self.assertEqual(record['verifiedEncounters']['videos'],1)
        self.assertFalse(record['followOpportunity'])
        self.relation=2
        after=self.call('bili_creator_relation_status',BV1)
        self.assertEqual(after['followCurrent'],'following')
        self.relation=0
        self.assertEqual(self.call('bili_creator_relation_status',BV1)['followCurrent'],'not-following')
        self.relation=-1
        self.assertEqual(self.call('bili_creator_relation_status',BV1)['followCurrent'],'restricted-or-unknown')
    def test_encounter_needs_distinct_days_and_account_isolation(self):
        self.mark(BV1,'挑中');first=self.call('bili_creator_encounter',BV1)
        self.assertTrue(first['ok'])
        con=sqlite3.connect(self.home/'video-actions.sqlite3')
        con.execute('UPDATE creator_encounters SET day=?',((datetime.now()-timedelta(days=2)).strftime('%Y-%m-%d'),));con.commit();con.close()
        self.mark(BV2,'挑中');second=self.call('bili_creator_encounter',BV2)
        self.assertTrue(second['followOpportunity'])
        self.assertEqual(second['verifiedEncounters'],{'videos':2,'days':2,'meaning':'核验过的入选经历，不等于看完、喜欢或需要关注'})
        self.account='222'
        other=self.call('bili_creator_relation_status',BV1)
        self.assertEqual(other['verifiedEncounters']['videos'],0)
        self.assertEqual(other['followHistory']['recordedByPlugin'],False)
        with patch.dict(os.environ,{'BILI_AGENT_FOLLOW_ENABLED':'0'}):
            self.assertFalse(self.call('bili_creator_encounter',BV1)['ok'])
            self.assertTrue(self.call('bili_creator_relation_status',BV1)['ok'])
    def test_local_history_stays_history_when_platform_status_changes(self):
        self.mark(BV1,'挑中');self.call('bili_creator_encounter',BV1)
        con=sqlite3.connect(self.home/'video-actions.sqlite3')
        con.execute('CREATE TABLE creator_relations(account TEXT,target INTEGER,bvid TEXT,followed_at TEXT,unfollowed_at TEXT,status TEXT)')
        con.execute('INSERT INTO creator_relations VALUES(?,?,?,?,?,?)',('111',777,BV1,'2026-10-01T12:00:00','', 'following'))
        con.execute('INSERT INTO actions(uid,bvid,kind,day,status) VALUES(?,?,?,?,?)',('111',BV1,'collect','2026-10-01','ok'))
        con.commit();con.close()
        self.relation=0
        r=self.call('bili_creator_relation_status',BV1)
        self.assertEqual(r['followHistory']['lastConfirmedAction'],'follow')
        self.assertEqual(r['followCurrent'],'not-following')
        self.assertEqual(r['videoActionHistory']['collect'],'confirmed-once')
        self.assertEqual(r['collectCurrent'],'not-verified')

if __name__=='__main__':unittest.main()
