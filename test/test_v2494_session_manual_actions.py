"""No-network tests for the v2.4.94 main-Session manual-action ledger and guards."""
import ast, hashlib, json, os, re, sqlite3, tempfile, unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'vendor/bilibili-mcp/mcp_server.py').read_text('utf8')
TREE=ast.parse(SOURCE)
NAMES={'_action_conn','_claim_session_manual_action','_finish_session_manual_action','bili_session_watch_mark'}
BODY=[]
for node in TREE.body:
    if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in NAMES:
        node.decorator_list=[]; BODY.append(node)
COMPILED=compile(ast.fix_missing_locations(ast.Module(body=BODY,type_ignores=[])),'<manual-actions>','exec')

class ManualActionLedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.scope={'sqlite3':sqlite3,'datetime':datetime,'Path':Path,'hashlib':hashlib,'json':json,'os':os,
                    '_DUTY_HOME':Path(self.tmp.name).resolve(),'_ACTION_DB_NAME':'video-actions.sqlite3',
                    '_guard':lambda name:'','_valid_bv':lambda value:value if re.fullmatch(r'BV[0-9A-Za-z]{10}',str(value or '')) else (_ for _ in ()).throw(ValueError('BV号格式错误')),
                    '_safe_line':lambda value,limit=150:str(value or '').replace('\n',' ')[:limit],
                    'get_cred':lambda:object()}
        exec(COMPILED,self.scope)
    def claim(self,kind='dm',target='456',body='hello',limit=5):
        return self.scope['_claim_session_manual_action']('123',kind,target,body,limit)
    def test_duplicate_same_day_is_blocked(self):
        first=self.claim();self.assertTrue(first['ok'])
        second=self.claim();self.assertFalse(second['ok']);self.assertTrue(second['already'])
    def test_daily_limit_is_atomic_and_separated_by_action(self):
        self.assertTrue(self.claim(body='one',limit=1)['ok'])
        self.assertTrue(self.claim(kind='comment',target='BV1pXHK6mE6z:0:0',body='one',limit=1)['ok'])
        blocked=self.claim(body='two',limit=1)
        self.assertFalse(blocked['ok']);self.assertTrue(blocked['limit'])
    def test_finish_persists_result_without_storing_message_body(self):
        row=self.claim(body='private text');self.assertTrue(row['ok'])
        self.scope['_finish_session_manual_action']('123','dm','456',row['body_hash'],row['day'],'uncertain','timeout no retry')
        con=sqlite3.connect(str(Path(self.tmp.name)/'video-actions.sqlite3'))
        try:
            record=con.execute('SELECT status,body_hash,detail FROM session_manual_actions').fetchone()
        finally:con.close()
        self.assertEqual(record[0],'uncertain');self.assertEqual(record[1],hashlib.sha256(b'private text').hexdigest())
        self.assertNotIn('private text',str(record))
    def test_manual_watch_record_is_idempotent_and_only_stores_public_metadata(self):
        with patch.dict(os.environ,{'BILI_SESSION_MANUAL_ACTIONS_ENABLED':'1'}):
            fn=self.scope['bili_session_watch_mark']
            first=json.loads(__import__('asyncio').run(fn('BV1pXHK6mE6z','公开视频','UP主甲')))
            second=json.loads(__import__('asyncio').run(fn('BV1pXHK6mE6z','公开视频','UP主甲')))
        self.assertTrue(first['recorded']);self.assertTrue(second['recorded'])
        data=json.loads((Path(self.tmp.name)/'session-watch-history.json').read_text('utf8'))
        self.assertEqual(len(data['entries']),1)
        self.assertEqual(data['entries'][0]['bvid'],'BV1pXHK6mE6z')
        self.assertNotIn('subtitle',str(data));self.assertNotIn('私信',str(data))
    def test_source_guards_manual_tools_and_whitelist(self):
        for name in ['bili_video_collect_manual','bili_follow_creator_manual','bili_unfollow_creator_manual','bili_reply_manual','bili_send_message_manual']:
            match=next((n for n in TREE.body if isinstance(n,ast.AsyncFunctionDef) and n.name==name),None)
            self.assertIsNotNone(match,name)
            source=ast.get_source_segment(SOURCE,match)
            self.assertIn('confirm is not True',source,name)
            self.assertIn('BILI_SESSION_MANUAL_',source,name)
        self.assertIn('BILI_SESSION_DM_ALLOWED_UIDS',SOURCE)
        self.assertIn('只能取关大肥鱼通过本插件关注的 UP 主',SOURCE)
        self.assertIn('自主关注未满 7 天，不允许取关',SOURCE)

if __name__=='__main__': unittest.main()


class ExactManualCommentTests(unittest.IsolatedAsyncioTestCase):
    async def test_manual_sender_context_blocks_body_rewrite_and_resets(self):
        import asyncio
        from contextvars import ContextVar
        from types import SimpleNamespace
        tree=ast.parse(SOURCE)
        nodes=[n for n in tree.body if isinstance(n,ast.AsyncFunctionDef) and n.name in {'bili_reply','bili_reply_manual'}]
        for node in nodes:node.decorator_list=[]
        exact=ContextVar('exact',default=None);effects=[];settled=[]
        class Video:
            def __init__(self,**kwargs):pass
            async def get_info(self):return {'aid':123}
        def quota():effects.append('quota');raise AssertionError('rewritten text must never enter quota/send')
        scope={'os':os,'json':json,'_MANUAL_COMMENT_EXACT':exact,'_guard':lambda _: '',
               '_valid_bv':lambda v:v,'get_cred':lambda:SimpleNamespace(dedeuserid='123'),
               'video':SimpleNamespace(Video=Video),'_mention_settings':lambda *_:('off',[{'name':'朋友','uid':'42'}]),
               '_decorate_comment':lambda text,*_:(text.replace('@朋友','').strip(),False),
               '_comment_quota_preflight':quota,
               '_claim_session_manual_action':lambda *_:{'ok':True,'body_hash':'hash','day':'today'},
               '_finish_session_manual_action':lambda *args:settled.append(args)}
        exec(compile(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])),'<exact-sender>','exec'),scope)
        with patch.dict(os.environ,{'BILI_SESSION_MANUAL_ACTIONS_ENABLED':'1'}):
            result=json.loads(await scope['bili_reply_manual']('BV1abcde1234','原样 @朋友 正文',confirm=True))
        self.assertFalse(result['ok']);self.assertIn('正文',result['error']);self.assertEqual(effects,[]);self.assertIsNone(exact.get());self.assertEqual(len(settled),1)
