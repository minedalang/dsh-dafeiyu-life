"""Safe one-shot MCP progress markers never expose arbitrary Python output."""
import ast
import io
import os
import unittest
from pathlib import Path
from contextlib import redirect_stderr
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'vendor' / 'bilibili-mcp' / 'mcp_server.py'
TREE = ast.parse(SOURCE.read_text(encoding='utf8'))
FUNCTION = next(item for item in TREE.body if isinstance(item, ast.FunctionDef)
                and item.name == '_owner_debug_stage')
ENV = {'os': os}
exec(compile(ast.Module(body=[FUNCTION], type_ignores=[]), str(SOURCE), 'exec'), ENV)


class SafeProgressTests(unittest.TestCase):
    def run_stage(self, enabled, phase):
        output = io.StringIO()
        with patch.dict(os.environ, {'DSH_OWNER_VIDEO_DEBUG_STAGE': enabled}):
            with redirect_stderr(output):
                ENV['_owner_debug_stage'](phase)
        return output.getvalue()

    def test_default_mcp_emits_no_progress(self):
        self.assertEqual(self.run_stage('0', 'model-running'), '')
        self.assertEqual(self.run_stage('', 'frames-reading'), '')

    def test_only_fixed_operational_markers(self):
        self.assertEqual(self.run_stage('1', 'frames-settled'),
                         'DSH_OWNER_DEBUG_STAGE:frames-settled\n')
        self.assertEqual(self.run_stage('1', 'model-running'),
                         'DSH_OWNER_DEBUG_STAGE:model-running\n')
        self.assertEqual(self.run_stage('1', 'BVSECRET_ACCOUNT_PASSWORD'), '')
        self.assertEqual(self.run_stage('1', 'model-running\npassword=secret'), '')


if __name__ == '__main__':
    unittest.main()
