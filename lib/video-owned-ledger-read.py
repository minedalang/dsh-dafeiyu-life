"""Read-only account-scoped video history for DSH host.

Only video-actions.sqlite3 is authoritative; historical shared Markdown is not.
Does not read credentials, invoke a model or make network requests.
"""
import json
import re
import sqlite3
import sys
from pathlib import Path


def load(home: str, account: str):
    if not re.fullmatch(r'[1-9][0-9]{0,18}', account or ''):
        return {'ok': False, 'code': 'account-not-ready', 'rows': []}
    root = Path(home).resolve()
    db = root / 'video-actions.sqlite3'
    if db.is_symlink() or not db.is_file() or db.stat().st_size > 100_000_000:
        return {'ok': False, 'code': 'selection-ledger-missing', 'rows': []}
    try:
        con = sqlite3.connect(db.as_uri() + '?mode=ro', uri=True, timeout=2)
        try:
            selection_time = 'recorded_at_ms' if 'recorded_at_ms' in {
                r[1] for r in con.execute('PRAGMA table_info(selected_videos)')} else '0'
            observation_time = 'recorded_at_ms' if 'recorded_at_ms' in {
                r[1] for r in con.execute('PRAGMA table_info(seen_observations)')} else '0'
            selections = con.execute(f'''SELECT bvid,day,round_id,{selection_time} FROM selected_videos
                WHERE account=? AND status='挑中' ORDER BY day DESC LIMIT 2000''', (account,)).fetchall()
            observations = con.execute(f'''SELECT bvid,day,title,up,status,{observation_time} FROM seen_observations
                WHERE account=? ORDER BY day DESC LIMIT 2000''', (account,)).fetchall()
            sent = {r[0] for r in con.execute('SELECT DISTINCT bvid FROM comment_receipts WHERE account=?', (account,))}
        finally:
            con.close()
    except sqlite3.OperationalError as exc:
        if 'locked' in str(exc).lower() or 'busy' in str(exc).lower():
            return {'ok': False, 'code': 'selection-ledger-busy', 'rows': []}
        return {'ok': False, 'code': 'selection-ledger-unavailable', 'rows': []}
    except (OSError, sqlite3.Error):
        return {'ok': False, 'code': 'selection-ledger-unavailable', 'rows': []}
    selected = {str(bv): (str(day), str(round_id), int(at or 0)) for bv, day, round_id, at in selections}
    observed = {}
    for bv, day, title, up, status, at in observations:
        if re.fullmatch(r'BV[0-9A-Za-z]{10}', str(bv)):
            observed[str(bv)] = {'day': str(day), 'title': str(title)[:160],
                                  'up': str(up)[:90], 'status': str(status)[:90],
                                  'observedAt': int(at or 0)}
    rows = []
    for bv in dict.fromkeys(list(selected) + list(observed)):
        if not re.fullmatch(r'BV[0-9A-Za-z]{10}', bv):
            continue
        picked = bv in selected
        day, round_id, selected_at = selected.get(bv, ('', '', 0))
        obs = observed.get(bv, {})
        rows.append({'bvid': bv, 'day': day if picked else obs.get('day', ''),
                     'roundId': round_id if picked else '', 'picked': picked,
                     'observedAt': selected_at if picked and selected_at else obs.get('observedAt', 0),
                     'autonomousSelected': picked, 'delivered': bv in sent,
                     'commented': bv in sent, 'title': obs.get('title', ''),
                     'up': obs.get('up', ''), 'status': '挑中' if picked else obs.get('status', '看过'),
                     'url': 'https://www.bilibili.com/video/' + bv})
    return {'ok': True, 'rows': rows[:2000]}


if __name__ == '__main__':
    try:
        result = load(sys.argv[1], sys.argv[2]) if len(sys.argv) == 3 else {'ok': False, 'rows': []}
    except Exception:
        result = {'ok': False, 'code': 'selection-ledger-unavailable', 'rows': []}
    # Node reads stdout as UTF-8. On Windows, Python stdout may use cp936/GBK;
    # ASCII-escaped JSON preserves every Unicode title even when the pipe encoding
    # is not UTF-8, and also handles characters outside the console code page.
    print(json.dumps(result, ensure_ascii=True))
