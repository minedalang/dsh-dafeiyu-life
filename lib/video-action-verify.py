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
KINDS = {'video_like', 'video_collect', 'video_follow', 'video_unfollow', 'video_comment'}
RECEIPT = re.compile(r'^[1-9][0-9]{0,29}$')


def verify(credential_path, kind, target, account_uid, *, receipt_id="", expected_text="", opener=None):
    if kind not in KINDS or not UID.fullmatch(str(account_uid or '')):
        return {'verified': False, 'reason': 'invalid-source'}
    if not (UID if kind == 'video_unfollow' else BV).fullmatch(str(target or '')):
        return {'verified': False, 'reason': 'invalid-target'}
    if kind == 'video_comment' and (not RECEIPT.fullmatch(str(receipt_id or '')) or
                                    not isinstance(expected_text, str) or
                                    not 1 <= len(expected_text) <= 2000):
        return {'verified': False, 'reason': 'invalid-comment-proof'}
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
        if kind == 'video_comment':
            # The existing project verifier uses the recent first page, not
            # x/v2/reply/detail (which returns -400 for this scenario).
            # Not found means UNKNOWN, never evidence that no post occurred.
            video = read('x/web-interface/view?bvid=' + urllib.parse.quote(target))
            aid = str(video.get('aid') or '') if isinstance(video, dict) else ''
            if not UID.fullmatch(aid):raise ValueError('aid-missing')
            page = read('x/v2/reply/main?type=1&oid=' + aid + '&mode=2&next=0&ps=20')
            replies = page.get('replies') if isinstance(page, dict) else None
            if not isinstance(replies, list):raise ValueError('replies-unavailable')
            matched = False
            for row in replies:
                if not isinstance(row, dict) or str(row.get('rpid_str') or row.get('rpid') or '') != str(receipt_id):
                    continue
                member = row.get('member') or {}
                content = row.get('content') or {}
                matched = (str(member.get('mid') or '') == str(account_uid) and
                           isinstance(content, dict) and
                           content.get('message') == expected_text and
                           row.get('invisible') in (None, False, 0))
                break
        elif kind == 'video_like':
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
        receipt_id = sys.argv[5] if kind == 'video_comment' else ''
        expected_text = sys.stdin.read(8192) if kind == 'video_comment' else ''
        print(json.dumps(verify(cred, kind, target, uid,
             receipt_id=receipt_id, expected_text=expected_text)))
    except Exception:
        print(json.dumps({'verified': False, 'reason': 'read-unavailable'}))
