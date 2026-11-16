"""Closed-vocabulary CLI process diagnostics: no private stderr or request text."""
import importlib.util
import json
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('vision_dsh_dev3b28',ROOT/'lib'/'vision_dsh.py')
vision=importlib.util.module_from_spec(spec)
spec.loader.exec_module(vision)

def test_safe_cli_metadata_classes():
    checks=[(b'', 'none'),
            (b'Traceback (most recent call last) SECRET=123', 'python_traceback'),
            (b'node:internal stack secret', 'node_exception'),
            (b'MCP transport failed private/path', 'mcp_diagnostic'),
            (b'status code 403 private=abc','http_diagnostic'),
            (b'unknown private=abc','unclassified_output')]
    for error,kind in checks:
        item=vision._safe_cli_process_receipt(subprocess.CompletedProcess(['dsh'],1,b'private=123',error))
        assert item['stderrKind']==kind
        assert item['exitCode']==1
        assert 'private' not in json.dumps(item)
        assert '123' not in json.dumps(item)
