"""Isolated, offline account ledger migration and true local recording timestamp."""
import ast
import os
import sqlite3
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

SRC = Path(__file__).resolve().parents[1] / 'vendor' / 'bilibili-mcp' / 'mcp_server.py'

def load_functions(home):
    tree = ast.parse(SRC.read_text(encoding='utf-8'))
    functions = {'_action_conn', '_record_owned_selection', '_record_owned_observation'}
    selected = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in functions]
    namespace = dict(sqlite3=sqlite3, datetime=datetime, _DUTY_HOME=Path(home),
                     _ACTION_DB_NAME='video-actions.sqlite3', os=os,
                     get_cred=lambda: SimpleNamespace(dedeuserid='1234567'),
                     _current_account_uid=lambda: '1234567',
                     _safe_line=lambda text,limit: str(text)[:limit])
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(SRC), 'exec'), namespace)
    return namespace

class TimelinePrecisionTest(unittest.TestCase):
    def test_new_records_store_a_real_millisecond_time(self):
        with tempfile.TemporaryDirectory() as home:
            ns = load_functions(home)
            old = os.environ.get('BILI_DUTY_LIFE_ROUND_ID')
            try:
                os.environ['BILI_DUTY_LIFE_ROUND_ID'] = 'a' * 24
                self.assertTrue(ns['_record_owned_selection']('BV1abcde1234'))
                ns['_record_owned_observation']('BV1abcde1234', '测试视频', '作者', '挑中')
            finally:
                if old is None: os.environ.pop('BILI_DUTY_LIFE_ROUND_ID', None)
                else: os.environ['BILI_DUTY_LIFE_ROUND_ID'] = old
            con=sqlite3.connect(str(Path(home) / 'video-actions.sqlite3'))
            try:
                at=con.execute('SELECT recorded_at_ms FROM selected_videos').fetchone()[0]
                seen=con.execute('SELECT recorded_at_ms FROM seen_observations').fetchone()[0]
                self.assertGreater(at, 1700000000000)
                self.assertGreater(seen, 1700000000000)
            finally: con.close()

    def test_old_rows_stay_unknown_after_schema_upgrade(self):
        with tempfile.TemporaryDirectory() as home:
            db=Path(home) / 'video-actions.sqlite3'
            con=sqlite3.connect(db)
            con.execute('CREATE TABLE selected_videos(account TEXT,bvid TEXT,day TEXT,round_id TEXT,status TEXT)')
            con.execute('CREATE TABLE seen_observations(account TEXT,bvid TEXT,day TEXT,title TEXT,up TEXT,status TEXT)')
            con.execute("INSERT INTO selected_videos VALUES('1234567','BV1abcde1234','2026-11-11','','挑中')")
            con.commit();con.close()
            ns=load_functions(home)
            con=ns['_action_conn']()
            try:
                self.assertEqual(con.execute('SELECT recorded_at_ms FROM selected_videos').fetchone()[0],0)
                cols={r[1] for r in con.execute('PRAGMA table_info(seen_observations)')}
                self.assertIn('recorded_at_ms',cols)
            finally: con.close()

if __name__ == '__main__': unittest.main()
