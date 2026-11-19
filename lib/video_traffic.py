"""Best-effort, privacy-preserving video-vision network receive-byte ledger.

Only measures response body bytes read by our Python video vision transport;
this is NOT system-wide bandwidth, and earlier versions cannot be backfilled.
No URLs, BV numbers, account IDs or response bodies enter the ledger.
"""
from contextlib import contextmanager, closing
from contextvars import ContextVar
from datetime import datetime
from pathlib import Path
import argparse
import json
import sqlite3

_CURRENT = ContextVar('video_traffic_scope', default=None)
_CATEGORIES = ('original', 'preview', 'metadata')


def _db(home):
    if Path(home).is_symlink():
        raise ValueError('unsafe_video_traffic_home')
    root = Path(home).resolve()
    if root.is_symlink():
        raise ValueError('unsafe_video_traffic_home')
    path = root / 'video-vision-traffic.sqlite3'
    if path.is_symlink():
        raise ValueError('unsafe_video_traffic_ledger')
    db = sqlite3.connect(str(path), timeout=3)
    db.execute('PRAGMA busy_timeout=3000')
    db.execute('CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, kind TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,kind))')
    return db


def _flush(counter):
    pending = counter['_pending']
    if not any(pending.values()) or counter['_home'] is None:
        return
    try:
        with closing(_db(counter['_home'])) as db:
            with db:
                today = datetime.now().astimezone().strftime('%Y-%m-%d')
                for category, count in pending.items():
                    if count:
                        db.execute('INSERT INTO usage(day,kind,bytes,requests) VALUES(?,?,?,1) ON CONFLICT(day,kind) DO UPDATE SET bytes=bytes+excluded.bytes,requests=requests+1',
                                   (today, category, count))
        for category in _CATEGORIES: pending[category] = 0
    except (OSError, sqlite3.Error, ValueError):
        # Keep pending counters: a future flush in the same task can recover.
        pass


@contextmanager
def traffic_scope(home):
    previous = _CURRENT.get()
    if previous is not None:
        yield previous
        return
    counter = {key: 0 for key in _CATEGORIES}
    counter['_pending'] = {key: 0 for key in _CATEGORIES}
    counter['_home'] = home
    token = _CURRENT.set(counter)
    try:
        yield counter
    finally:
        _CURRENT.reset(token)
        _flush(counter)


def count_bytes(category, count):
    """Record actual received body bytes, including failed/aborted requests."""
    active = _CURRENT.get()
    if active is not None and category in _CATEGORIES and type(count) is int and count > 0:
        active[category] += count
        active['_pending'][category] += count
        if sum(active['_pending'].values()) >= 1024 * 1024:
            _flush(active)


def original_bytes():
    active = _CURRENT.get()
    return active['original'] if active is not None else 0


def summary(home):
    path = Path(home).resolve() / 'video-vision-traffic.sqlite3'
    if not path.is_file() or path.is_symlink():
        return {'ok': True, 'tracked': False, 'todayBytes': 0, 'totalBytes': 0, 'categories': {}}
    try:
        with closing(_db(home)) as db:
            today = datetime.now().astimezone().strftime('%Y-%m-%d')
            rows = db.execute('SELECT day,kind,bytes FROM usage WHERE kind IN (?,?,?)', _CATEGORIES).fetchall()
        result = {k:{'todayBytes':0,'totalBytes':0} for k in _CATEGORIES}
        days = []
        for day, kind, count in rows:
            if type(count) is not int or not 0 <= count <= 10**15:
                return {'ok':False,'error':'traffic_ledger_invalid'}
            days.append(day)
            result[kind]['totalBytes'] += count
            if day == today: result[kind]['todayBytes'] += count
        return {'ok':True,'tracked':bool(rows),'today':today,'since':min(days) if days else None,
                'todayBytes':sum(v['todayBytes'] for v in result.values()),
                'totalBytes':sum(v['totalBytes'] for v in result.values()),
                'categories':result}
    except (sqlite3.Error, OSError, ValueError):
        return {'ok':False,'error':'traffic_ledger_unavailable'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--home', required=True)
    parser.add_argument('--summary', action='store_true', required=True)
    args = parser.parse_args()
    print(json.dumps(summary(args.home), ensure_ascii=False))
