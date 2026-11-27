"""暂停文件保护和真实评论配额计数（不碰真实账号）。"""
import ast
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]


def test_python_write_guard_blocks_while_paused():
    src=ast.parse((ROOT/'vendor/bilibili-mcp/mcp_server.py').read_text(encoding='utf-8'))
    fns=[n for n in src.body if isinstance(n,ast.FunctionDef) and n.name in ('_host_session_current','_guard')]
    module=ast.Module(body=fns,type_ignores=[])
    scope={'Path':Path,'os':os,'json':json,'sys':sys,'_ALLOWED':set()}
    exec(compile(ast.fix_missing_locations(module),'<guard>','exec'),scope)
    with tempfile.TemporaryDirectory() as td:
        env=os.environ.get('BILI_DUTY_HOME')
        os.environ['BILI_DUTY_HOME']=td
        try:
            assert scope['_guard']('bili_reply')==''
            Path(td,'.bili-duty-paused').write_text('paused')
            result=json.loads(scope['_guard']('bili_reply'))
            assert result['blocked'] and not result['success']
            assert json.loads(scope['_guard']('bili_send_message'))['blocked']
        finally:
            if env is None:os.environ.pop('BILI_DUTY_HOME',None)
            else:os.environ['BILI_DUTY_HOME']=env


def test_quota_reader_reads_actual_attempts_and_does_not_create_db():
    reader=ROOT/'lib/comment-quota-count.py'
    with tempfile.TemporaryDirectory() as td:
        db=Path(td,'public-comment-quota.sqlite3')
        def read():return json.loads(subprocess.check_output([sys.executable,str(reader),td],text=True))
        assert read()['used']==0
        assert not db.exists()
        from datetime import datetime
        with sqlite3.connect(db) as conn:
            conn.execute('CREATE TABLE public_comment_attempt(day TEXT NOT NULL, nonce TEXT PRIMARY KEY)')
            conn.execute('INSERT INTO public_comment_attempt VALUES(?,?)',(datetime.now().strftime('%Y-%m-%d'),'a'))
            conn.execute('INSERT INTO public_comment_attempt VALUES(?,?)',(datetime.now().strftime('%Y-%m-%d'),'b'))
            conn.execute('INSERT INTO public_comment_attempt VALUES(?,?)',('2000-01-01','c'))
        assert read()['used']==2


def test_host_child_generation_cannot_replay_after_switch(monkeypatch, tmp_path):
    src=ast.parse((ROOT/'vendor/bilibili-mcp/mcp_server.py').read_text(encoding='utf-8'))
    module=ast.Module(body=[n for n in src.body if isinstance(n,ast.FunctionDef) and n.name in ('_host_session_current','_guard')],type_ignores=[])
    scope={'Path':Path,'os':os,'json':json,'sys':sys,'_ALLOWED':set()}
    exec(compile(ast.fix_missing_locations(module),'<guard>','exec'),scope)
    monkeypatch.setenv('BILI_DUTY_HOME',str(tmp_path))
    monkeypatch.setenv('BILI_SESSION_INTEGRATION_REVISION','0')
    monkeypatch.setenv('BILI_SESSION_INTEGRATION_MODE','autonomous-life')
    guard=scope['_guard'];file=tmp_path/'session-integration-v1.json'
    assert guard('bili_reply')==''
    file.write_text(json.dumps({'version':1,'mode':'autonomous-life','revision':0,'pending':{'mode':'memory-foundation','pid':123}}))
    assert json.loads(guard('bili_reply'))['blocked']
    file.write_text(json.dumps({'version':1,'mode':'memory-foundation','revision':1,'pending':None}))
    assert json.loads(guard('bili_reply'))['blocked']
    monkeypatch.setenv('BILI_SESSION_INTEGRATION_REVISION','1');monkeypatch.setenv('BILI_SESSION_INTEGRATION_MODE','memory-foundation')
    assert guard('bili_reply')==''
    file.write_text('broken');assert json.loads(guard('bili_reply'))['blocked']


def test_capability_generation_fails_closed(monkeypatch, tmp_path):
    src=ast.parse((ROOT/'vendor/bilibili-mcp/mcp_server.py').read_text(encoding='utf-8'))
    module=ast.Module(body=[n for n in src.body if isinstance(n,ast.FunctionDef) and n.name=='_host_session_current'],type_ignores=[])
    scope={'Path':Path,'os':os,'json':json}
    exec(compile(ast.fix_missing_locations(module),'<guard>','exec'),scope)
    check=scope['_host_session_current'];file=tmp_path/'session-integration-v1.json'
    caps={'platform':True,'autonomous':False,'persona':False,'automaticMemory':True,'bridge':False}
    row={'version':2,'capabilities':caps,'revision':5,'pending':None}
    def write():file.write_text(json.dumps(row))
    monkeypatch.setenv('BILI_SESSION_INTEGRATION_REVISION','5');monkeypatch.setenv('BILI_SESSION_INTEGRATION_MODE','memory-foundation')
    write();assert check(tmp_path)
    caps['platform']=False;write();assert not check(tmp_path)
    caps['platform']=True;row['pending']={'capabilities':caps,'pid':123};write();assert not check(tmp_path)
    row['pending']=None;row['revision']=6;write();assert not check(tmp_path)
    monkeypatch.delenv('BILI_SESSION_INTEGRATION_REVISION');monkeypatch.delenv('BILI_SESSION_INTEGRATION_MODE');assert not check(tmp_path)


def test_independent_reply_pause_at_final_python_send(tmp_path):
    import asyncio
    from contextlib import contextmanager
    src=ast.parse((ROOT/'vendor/bilibili-mcp/mcp_server.py').read_text(encoding='utf8'))
    module=ast.Module(body=[n for n in src.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='_coordinated_send'],type_ignores=[])
    calls=[]
    class Claim:
        def confirm(self, proof):pass
    @contextmanager
    def reserve(*args,**kwargs):yield Claim()
    scope={'Path':Path,'_DUTY_HOME':tmp_path,'outbound_reservation':reserve}
    exec(compile(ast.fix_missing_locations(module),'<reply-pause>','exec'),scope)
    async def send():calls.append(1);return {'ok':True}
    marker=tmp_path/'.bili-duty-replies-paused';marker.write_text('paused')
    for kind,target in [('dm','123'),('comment','BV1rV1FzYEbP:12:0'),('comment','BV1rV1FzYEbP:0:12'),('dynamic-comment','dynamic-notice:1:2:3'),('dynamic-comment','dynamic:1:2:3')]:
        try:asyncio.run(scope['_coordinated_send'](kind,target,'body',send,lambda _: 'receipt'))
        except RuntimeError as exc:assert str(exc)=='interaction-replies-paused'
        else:assert False,'reply must be blocked'
    assert calls==[]
    asyncio.run(scope['_coordinated_send']('comment','BV1rV1FzYEbP:0:0','body',send,lambda _: 'receipt'));assert len(calls)==1
    marker.unlink();asyncio.run(scope['_coordinated_send']('dm','123','body',send,lambda _: 'receipt'));assert len(calls)==2
