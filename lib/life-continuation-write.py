#!/usr/bin/env python3
"""dev.27 one-shot host-bound Life continuation write.

Only the existing autonomous MCP Python tools can send. Their tool wrappers
perform a fresh localhost Life approval, existing account/provenance/quotas,
write reservation, and report for independent platform verification. This
script does not import or invoke any manual/owner-confirmation tools.
"""
import asyncio
import json
import os
from pathlib import Path
import re
import sys

TOOLS = {
    'like_video': 'bili_video_like',
    'collect_video': 'bili_video_collect',
    'follow_creator': 'bili_follow_creator',
    'comment_video': 'bili_reply',
}
BV = re.compile(r'BV[0-9A-Za-z]{10}\Z')

async def main():
    attempted=False
    try:
        if os.environ.get('BILI_LIFE_CONTINUATION_RUNNER') != '1':
            raise ValueError('Life 写入来源未授权')
        if not re.fullmatch(r'http://127\.0\.0\.1:[0-9]{1,5}', os.environ.get('BILI_LIFE_ACTION_URL', '')):
            raise ValueError('Life 审批桥未就绪')
        if not re.fullmatch(r'[a-f0-9]{64}', os.environ.get('BILI_LIFE_ACTION_TOKEN', '')):
            raise ValueError('Life 审批令牌无效')
        raw = sys.stdin.buffer.read(4097)
        if len(raw)>4096: raise ValueError('请求过大')
        row=json.loads(raw)
        if not isinstance(row,dict) or set(row)-{'action','bvid','reason','text','folderTitle'}:
            raise ValueError('未知写入参数')
        action=row.get('action')
        if action not in TOOLS or not BV.fullmatch(str(row.get('bvid') or '')):
            raise ValueError('不在白名单中的动作或 BV')
        reason=row.get('reason')
        if not isinstance(reason,str) or not 8<=len(reason)<=100:
            raise ValueError('必须提供具体意愿理由')
        if os.environ.get('BILI_MCP_TOOLS')!=TOOLS[action]:
            raise ValueError('MCP 写操作白名单不匹配')
        home=Path(os.environ.get('BILI_DUTY_HOME','')).resolve()
        if not home.is_dir() or not (home/'bili_credential.json').is_file():
            raise ValueError('当前账号凭据缺失')
        # The host intentionally launches the already-staged, account-bound
        # MCP source from its stateDir. This is NOT a new platform client.
        sys.path.insert(0,str(home))
        import mcp_server as server
        unbound_cred=server.get_cred
        def account_bound_cred():
            current=unbound_cred()
            if str(getattr(current,'dedeuserid','') or '')!=os.environ.get('BILI_LIFE_EXPECT_UID'):
                raise ValueError('账号已切换，不得继续外发')
            return current
        server.get_cred=account_bound_cred
        creds=server.get_cred()
        if str(getattr(creds,'dedeuserid','') or '')!=os.environ.get('BILI_LIFE_EXPECT_UID'):
            raise ValueError('当前登录账号变化')
        bvid=row['bvid']
        attempted=True  # Any exception from here may follow a platform send.
        if action=='like_video':
            result=await server.bili_video_like(bvid,reason)
        elif action=='follow_creator':
            result=await server.bili_follow_creator(bvid,reason)
        elif action=='collect_video':
            folder=row.get('folderTitle')
            if not isinstance(folder,str) or not re.fullmatch(r'[\w\u4e00-\u9fff _-]{2,14}',folder):
                raise ValueError('收藏夹主题不合法')
            result=await server.bili_video_collect(bvid,folder,reason,visibility='private',motivation='curiosity')
        else:
            content=row.get('text')
            if not isinstance(content,str) or not 1<=len(content)<=180 or '@' in content or '\n' in content:
                raise ValueError('原创评论正文不合规')
            result=await server.bili_reply(bvid,content,rpid=0,root=0,should_mention=False,mention_mode='off',sync_to_dynamic=False)
        result=json.loads(result) if isinstance(result,str) else result
        if not isinstance(result,dict):raise ValueError('原发送工具未提供结构化回执')
        # Never return raw comment text, nickname, UID, API detail or model reason.
        print(json.dumps({'ok':result.get('ok') is True or result.get('success') is True,
            'attempted':True,'status':'verified' if getattr(server,'_LIFE_WRITE_LAST_STATUS','')=='verified' and (result.get('ok') is True or result.get('success') is True) else 'unconfirmed'},ensure_ascii=False))
    except Exception:
        print(json.dumps({'ok':False,'attempted':attempted,'status':'unconfirmed' if attempted else 'unavailable'},ensure_ascii=False))

if __name__ == '__main__':
    asyncio.run(main())
