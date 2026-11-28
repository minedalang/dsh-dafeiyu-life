"""确保刷视频 MCP 不能用于回复楼中楼；后台调用不受该专属限制。"""
import ast
import asyncio
import json
import os
from pathlib import Path
from unittest.mock import patch

FILE=Path(__file__).resolve().parents[1]/'vendor/bilibili-mcp/mcp_server.py'

def only_function():
    tree=ast.parse(FILE.read_text(encoding='utf-8'))
    node=next(x for x in tree.body if isinstance(x,ast.AsyncFunctionDef) and x.name=='bili_reply')
    node.decorator_list=[]
    code=compile(ast.fix_missing_locations(ast.Module(body=[node],type_ignores=[])),str(FILE),'exec')
    def get_cred(): raise RuntimeError('credential path reached')
    scope={'os':os,'json':json,'_guard':lambda _: '', 'get_cred':get_cred, '_MANUAL_COMMENT_EXACT':__import__('contextvars').ContextVar('manual',default=None)}
    exec(code,scope)
    return scope['bili_reply']

def test_duty_rejects_reply_before_reading_credentials():
    reply=only_function()
    with patch.dict(os.environ, {'BILI_DUTY_TOP_LEVEL_ONLY':'1'}):
        for (rpid,root) in [(123,0),(123,123),(0,123)]:
            out=json.loads(asyncio.run(reply('BV1xx', 'hello',rpid=rpid,root=root)))
            assert out['blocked'] and not out['success']
        try: asyncio.run(reply('BV1xx','hello',rpid=0,root=0))
        except RuntimeError as e: assert 'credential path reached' in str(e)
        else: raise AssertionError('顶层新评论不应被拒绝')

def test_background_reply_not_subject_to_duty_guard():
    reply=only_function()
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop('BILI_DUTY_TOP_LEVEL_ONLY',None)
        try: asyncio.run(reply('BV1xx','hello',rpid=123,root=0))
        except RuntimeError as e: assert 'credential path reached' in str(e)
        else: raise AssertionError('后台路径不应被“跑一轮”专属守卫拒绝')
