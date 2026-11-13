"""Offline tests of the actual MCP shared quota functions; no Bilibili access."""
import ast
import os
import sqlite3
from contextlib import closing
import tempfile
import unittest
import uuid
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'vendor' / 'bilibili-mcp' / 'mcp_server.py'
TEXT = SOURCE.read_text(encoding='utf-8')
MODULE = ast.parse(TEXT)


class SharedCommentQuotaTests(unittest.TestCase):
    def quota(self, directory):
        selected = [node for node in MODULE.body if isinstance(node, ast.FunctionDef)
                    and node.name in ('_reserve_comment_quota', '_comment_quota_preflight')]
        self.assertEqual(len(selected), 2)
        env = {'os': os, 'sqlite3': sqlite3, 'datetime': datetime, 'uuid': uuid, 'closing': closing,
               '_DUTY_HOME': Path(directory)}
        exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE), 'exec'), env)
        return env['_reserve_comment_quota'], env['_comment_quota_preflight']

    def test_atomic_global_attempt_limit(self):
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'BILI_COMMENT_DAILY_LIMIT': '3'}):
            reserve, preflight = self.quota(home)
            self.assertTrue(preflight()[0])
            for _ in range(3):
                self.assertTrue(reserve()[0])
            self.assertFalse(reserve()[0])
            self.assertFalse(preflight()[0])
            with closing(sqlite3.connect(str(Path(home) / 'public-comment-quota.sqlite3'))) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM public_comment_attempt').fetchone()[0], 3)

    def test_all_comment_api_branches_reserve_from_same_ledger(self):
        names = ('bili_dynamic_comment_manual', 'bili_dynamic_reply_inbox', 'bili_reply')
        for name in names:
            nodes = [n for n in MODULE.body if isinstance(n, ast.AsyncFunctionDef) and n.name == name]
            self.assertEqual(len(nodes), 1, name)
            calls = [n for n in ast.walk(nodes[0]) if isinstance(n, ast.Call) and
                     isinstance(n.func, ast.Name) and n.func.id == '_reserve_comment_quota']
            self.assertTrue(calls, name)
        self.assertIn('"1000"', TEXT)


if __name__ == '__main__':
    unittest.main()
