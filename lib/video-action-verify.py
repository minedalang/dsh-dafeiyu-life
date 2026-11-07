#!/usr/bin/env python3
"""Host-initiated, read-only B站 state verification for one video Agent write.

This process cannot send likes/follows/comments. Fail closed on any ambiguity.
The original write claim/limit/anti-duplicate ledger is NOT altered.
"""
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

BV = re.compile(r'^BV[0-9A-Za-z]{10}$')
UID = re.compile(r'^[1-9][0-9]{0,18}$')
KINDS = {'video_like', 'video_collect', 'video_follow', 'video_unfollow'}


def verify(credential_path, kind, target, account_uid, *, opener=None):
    if kind not in KINDS or not UID.fullmatch(str(account_uid or '')):
        return {'verified': False, 'reason': 'invalid-source'}
    if not (UID if kind == 'video_unfollow' else BV).fullmatch(str(target or '')):
        return {'verified': False, 'reason': 'invalid-target'}
    path = Path(credential_path)
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 8192:
        return {'verified': False, 'reason': 'credentials-unavailable'}
    cred = json.loads(path.read_text('utf-8'))
    if str(cred.get('dedeuserid') or '') != str(account_uid):
        return {'verified': False, 'reason': 'account-mismatch'}
    sess = str(cred.get('sessdata') or '')
    if not sess:return {'verified': False, 'reason': 'credentials-unavailable'}
    open_url = opener or urllib.request.build_opener(urllib.request.ProxyHandler({})).open

    def read(path):
        request = urllib.request.Request('https://api.bilibili.com/' + path, headers={
            'Cookie': 'SESSDATA=' + sess, 'User-Agent': 'Mozilla/5.0',
            'Referer': 'https://www.bilibili.com/'}, method='GET')
        with open_url(request, timeout=8) as response:
            value = json.loads(response.read(128_000).decode('utf-8'))
        if not isinstance(value, dict) or value.get('code') != 0:
            raise ValueError('platform-read-not-authoritative')
        return value.get('data')

    try:
        if kind == 'video_like':
            data = read('x/web-interface/archive/has/like?bvid=' + urllib.parse.quote(target))
            # B站 single-video has/like returns data=1 (liked) or data=0.
            matched = type(data) is int and data == 1
        elif kind == 'video_collect':
            item = read('x/web-interface/view?bvid=' + urllib.parse.quote(target))
            aid = str(item.get('aid') or '') if isinstance(item, dict) else ''
            if not UID.fullmatch(aid):raise ValueError('aid-missing')
            data = read('x/v2/fav/video/favoured?aid=' + aid)
            matched = isinstance(data, dict) and data.get('favoured') is True
        else:
            uid = target
            if kind == 'video_follow':
                item = read('x/web-interface/view?bvid=' + urllib.parse.quote(target))
                uid = str((item.get('owner') or {}).get('mid') or '') if isinstance(item, dict) else ''
                if not UID.fullmatch(uid):raise ValueError('creator-unverified')
            data = read('x/relation?fid=' + urllib.parse.quote(uid))
            attr = data.get('attribute') if isinstance(data, dict) else None
            matched = type(attr) is int and (attr in (2, 6) if kind == 'video_follow' else attr == 0)
        return {'verified': True, 'source': 'platform-read-after-write'} if matched else {'verified': False, 'reason': 'state-not-confirmed'}
    except Exception:
        return {'verified': False, 'reason': 'read-unavailable'}

if __name__ == '__main__':
    try:
        cred, kind, target, uid = sys.argv[1:5]
        print(json.dumps(verify(cred, kind, target, uid)))
    except Exception:
        print(json.dumps({'verified': False, 'reason': 'read-unavailable'}))
