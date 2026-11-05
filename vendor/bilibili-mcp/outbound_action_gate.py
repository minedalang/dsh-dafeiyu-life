"""Account-scoped, crash-durable coordination for Bilibili OUTBOUND writes.

This module does NOT grant consent, decide to send, enforce daily quota, or
retry platform actions. Existing business policies run before this reservation.
A platform call is never repeated simply because it timed out or crashed.
Payloads, tokens and contact identifiers are not written into diagnostics.
"""
import contextlib
import hashlib
import json
import os
import re
import time
import uuid
from pathlib import Path

from read_action_gate import _account_scope, _safe_dir, _safe_read, _write_once

_KINDS = {'dm', 'comment', 'dynamic-comment', 'follow', 'unfollow'}
_KEY = re.compile(r'^[a-f0-9]{64}$')


class OutboundHeld(Exception):
    """A same-account, same-action delivery is executing or already recorded."""


def _sha(s):
    return hashlib.sha256(s.encode('utf8')).hexdigest()


class OutboundReservation:
    def __init__(self, record, folder, receipts):
        self._record = record
        self._folder = folder
        self._receipts = receipts
        self._receipt = None

    def confirm(self, platform_id):
        """Only call after an actual verified platform delivery receipt."""
        proof = str(platform_id or '').strip()
        if not proof or len(proof) > 120 or re.search(r'[\r\n\x00-\x1f]', proof):
            raise ValueError('平台回执缺失或无效，不能声明发出成功')
        self._receipt = _sha(proof)[:20]


@contextlib.contextmanager
def outbound_reservation(kind, target, content='', *, home=None):
    """Atomic claim immediately before real network SEND; never auto-unlock.

    The key includes current date to allow an intentional new-day conversation.
    Incomplete/unknown actions remain frozen across days for their exact key.
    `target` and `content` are ONLY hashed, never persisted in cleartext.
    """
    if kind not in _KINDS or not isinstance(target, str) or not target or len(target) > 300:
        raise ValueError('对外动作类型或目标无效')
    if not isinstance(content, str) or len(content) > 4000:
        raise ValueError('对外动作内容无效')
    if home is None:
        raise ValueError('对外动作缺少账号家目录')
    home = Path(home).resolve()
    scope = _account_scope(home)
    day = time.strftime('%Y-%m-%d', time.localtime())
    stable = _sha(json.dumps([scope, kind, target, _sha(content)], ensure_ascii=False, separators=(',', ':')))
    key = _sha(stable + ':' + day)
    base = home / 'outbound-action-executions'
    locks, receipts, uncertain = base / 'locks', base / 'receipts', base / 'unresolved'
    for folder in (home, base, locks, receipts, uncertain):
        _safe_dir(folder)
        folder.mkdir(mode=0o700, exist_ok=True)
    # Stable unresolved marker spans dates; day-scoped confirmed claim only
    # blocks another send during that same day. Crash at ANY point fails closed.
    marker = uncertain / stable
    try:
        marker.mkdir(mode=0o700)
    except FileExistsError:
        raise OutboundHeld('相同对外动作结果未核实，禁止跨天重试')
    folder = locks / key
    try:
        folder.mkdir(mode=0o700)
    except FileExistsError:
        marker.rmdir()
        raise OutboundHeld('同日相同动作已执行，禁止再次发送')
    except BaseException:
        # Err on side of freezing an uncertain action.
        raise
    record = {'version': 1, 'id': key, 'scopeHash': _sha(scope)[:20],
              'kind': kind, 'targetHash': _sha(target)[:16],
              'contentHash': _sha(content)[:16], 'stableHash': stable, 'day': day,
              'pid': os.getpid(), 'at': int(time.time()*1000), 'state': 'executing'}
    claim = OutboundReservation(record, folder, receipts)
    try:
        _write_once(folder / 'entry.json', record)
        yield claim
        if _account_scope(home) != scope:
            raise ValueError('发送期间账号作用域已改变，结果必须人工核查')
        if claim._receipt is not None:
            result = {**record, 'state': 'platform-confirmed',
                      'receiptHash': claim._receipt, 'finishedAt': int(time.time()*1000)}
            _write_once(receipts / (str(result['finishedAt']).zfill(15)+'-'+str(uuid.uuid4())+'.json'), result)
            # Persist receipt BEFORE removing the unresolved marker. A crash
            # here may leave a stale marker, which is safe and reviewable.
            marker.rmdir()
            # Keep claim directory: same-day replay remains blocked.
    except BaseException:
        # Even on cancellation or crash the directory is never removed.
        raise


def outbound_status(home):
    """Safe local diagnostic: hashed identity and statuses only."""
    home=Path(home).resolve()
    scope=_sha(_account_scope(home))[:20]
    locks=home/'outbound-action-executions'/'locks'
    if not locks.exists():
        return {'ok':True, 'pending':[], 'confirmed':0}
    _safe_dir(locks)
    rows=[]
    for item in sorted(locks.iterdir()):
        if not _KEY.fullmatch(item.name):
            continue
        _safe_dir(item)
        try:
            row=_safe_read(item/'entry.json',4096)
            if row.get('id')==item.name and row.get('scopeHash')==scope:
                rows.append({'id':item.name,'kind':row.get('kind'), 'at':row.get('at'),
                            'state':'reserved-or-confirmed', 'needsReview':True})
        except (OSError,ValueError,TypeError,KeyError):
            rows.append({'id':item.name,'kind':'unknown','state':'unreadable', 'needsReview':True})
    unresolved=home/'outbound-action-executions'/'unresolved'
    unresolved_count=sum(1 for item in unresolved.iterdir() if _KEY.fullmatch(item.name)) if unresolved.is_dir() and not unresolved.is_symlink() else 0
    return {'ok':True,'pending':rows[-100:],'count':len(rows),'unresolved':unresolved_count,
            'note':'所有写入预约均不可自动重放；需平台核对回执，任何人工解除不得当作发送成功'}
