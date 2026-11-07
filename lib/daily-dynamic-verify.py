#!/usr/bin/env python3
"""Read-only verification of ONE own text dynamic. Never sends or retries a post.

Fail closed unless the authenticated account UID, dynamic ID and complete text
all match a fresh Bilibili detail response. No model/LLM input is trusted.
"""
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ID = re.compile(r'^[1-9][0-9]{5,29}$')
UID = re.compile(r'^[1-9][0-9]{0,18}$')

def verify(credential_path, dynamic_id, owner_uid, expected_text, *, opener=None):
    if not ID.fullmatch(str(dynamic_id or '')) or not UID.fullmatch(str(owner_uid or '')):
        return {'verified': False, 'reason': 'invalid-identity'}
    if not isinstance(expected_text, str) or not 15 <= len(expected_text) <= 230:
        return {'verified': False, 'reason': 'invalid-text'}
    path = Path(credential_path)
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 8192:
        return {'verified': False, 'reason': 'credentials-unavailable'}
    creds = json.loads(path.read_text('utf-8'))
    if str(creds.get('dedeuserid') or '') != str(owner_uid):
        return {'verified': False, 'reason': 'account-mismatch'}
    session = str(creds.get('sessdata') or '')
    if not session:
        return {'verified': False, 'reason': 'credentials-unavailable'}
    url = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=' + urllib.parse.quote(str(dynamic_id))
    request = urllib.request.Request(url, headers={
        'Cookie': 'SESSDATA=' + session,
        'User-Agent': 'Mozilla/5.0', 'Referer': 'https://t.bilibili.com/'}, method='GET')
    # Explicitly prohibit ambient proxies from receiving account cookies.
    open_url = opener or urllib.request.build_opener(urllib.request.ProxyHandler({})).open
    try:
        with open_url(request, timeout=8) as response:
            body = json.loads(response.read(128_000).decode('utf-8'))
        if body.get('code') != 0:
            return {'verified': False, 'reason': 'platform-not-ready'}
        item = (body.get('data') or {}).get('item') or {}
        modules = item.get('modules') or {}
        author = modules.get('module_author') or {}
        dynamic = modules.get('module_dynamic') or {}
        desc = dynamic.get('desc') or {}
        if str(item.get('id_str') or item.get('id') or '') != str(dynamic_id):
            return {'verified': False, 'reason': 'id-mismatch'}
        if str(author.get('mid') or '') != str(owner_uid):
            return {'verified': False, 'reason': 'author-mismatch'}
        if str(desc.get('text') or '').strip() != expected_text.strip():
            return {'verified': False, 'reason': 'text-mismatch'}
        return {'verified': True, 'source': 'platform-read-after-write'}
    except Exception:
        return {'verified': False, 'reason': 'read-unavailable'}

if __name__ == '__main__':
    try:
        credential_path, dynamic_id, owner_uid = sys.argv[1:4]
        text = sys.stdin.read(1000)
        print(json.dumps(verify(credential_path, dynamic_id, owner_uid, text), ensure_ascii=False))
    except Exception:
        print(json.dumps({'verified': False, 'reason': 'read-unavailable'}))
