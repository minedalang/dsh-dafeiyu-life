#!/usr/bin/env python3
"""One-shot host-only writer for a verified public Bilibili dynamic.

This file is launched only after the Life Planner selected a current action.
It exposes no MCP tool to DSH and accepts one exact dynamic target from stdin.
"""
import asyncio
import json
import os
from pathlib import Path
import re
import sys

TOOLS={'like_shared_dynamic':'bili_dynamic_like_life','comment_shared_dynamic':'bili_dynamic_comment_life'}
ID=re.compile(r'[1-9][0-9]{5,19}\Z')
UID=re.compile(r'[1-9][0-9]{0,19}\Z')

def clean_line(value, maximum):
    if not isinstance(value,str) or not 1<=len(value)<=maximum or re.search(r'[\x00-\x1f\x7f]|https?://|www\.|@',value,re.I):
        raise ValueError('不合规文本')
    return value

async def main():
    attempted=False
    try:
        if os.environ.get('BILI_LIFE_SHARED_DYNAMIC_RUNNER')!='1' or os.environ.get('BILI_LIFE_SHARED_DYNAMIC_ACTION_ENABLED')!='1' or os.environ.get('BILI_LIFE_PUBLIC_INTERACTION_ENABLED')!='1':
            raise ValueError('Life 动态互动未授权')
        raw=sys.stdin.buffer.read(4097)
        if len(raw)>4096: raise ValueError('请求过大')
        row=json.loads(raw)
        if not isinstance(row,dict) or set(row)-{'action','dynamicId','expectedAuthorUid','reason','text'}:
            raise ValueError('未知参数')
        action=row.get('action')
        if action not in TOOLS or not ID.fullmatch(str(row.get('dynamicId') or '')) or not UID.fullmatch(str(row.get('expectedAuthorUid') or '')):
            raise ValueError('动作或目标无效')
        if os.environ.get('BILI_MCP_TOOLS')!=TOOLS[action]: raise ValueError('MCP 工具白名单不匹配')
        reason=clean_line(row.get('reason'),100)
        text=clean_line(row.get('text'),180) if action=='comment_shared_dynamic' else ''
        home=Path(os.environ.get('BILI_DUTY_HOME','')).resolve()
        if not home.is_dir() or not (home/'bili_credential.json').is_file(): raise ValueError('凭据缺失')
        sys.path.insert(0,str(home))
        import mcp_server as server
        original=server.get_cred
        def account_bound_cred():
            cred=original()
            if str(getattr(cred,'dedeuserid','') or '')!=os.environ.get('BILI_LIFE_EXPECT_UID'):
                raise ValueError('账号已切换')
            return cred
        server.get_cred=account_bound_cred
        cred=server.get_cred()
        if not UID.fullmatch(str(getattr(cred,'dedeuserid','') or '')): raise ValueError('账号 UID 无效')
        attempted=True
        if action=='like_shared_dynamic':
            result=await server.bili_dynamic_like_life(row['dynamicId'],row['expectedAuthorUid'],reason)
        else:
            result=await server.bili_dynamic_comment_life(row['dynamicId'],row['expectedAuthorUid'],text,reason)
        result=json.loads(result) if isinstance(result,str) else result
        if not isinstance(result,dict): raise ValueError('写入工具回执无效')
        status=str(result.get('status') or '')
        receipt=str(result.get('receiptId') or '')
        print(json.dumps({'ok':result.get('ok') is True,'attempted':result.get('attempted') is True,
            'status':status if status in ('accepted','accepted-unverified','uncertain','not-sent') else 'unconfirmed',
            'receiptId':receipt if re.fullmatch(r'[1-9][0-9]{0,29}',receipt) else ''},ensure_ascii=False))
    except Exception:
        print(json.dumps({'ok':False,'attempted':attempted,'status':'uncertain' if attempted else 'not-sent'},ensure_ascii=False))

if __name__=='__main__': asyncio.run(main())
