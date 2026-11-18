"""Offline regression; no Windows/DSH/Bilibili processes are started."""
import ast
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]


def _load(name, path):
    spec=importlib.util.spec_from_file_location(name, ROOT/path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ffmpeg_offline_decoder_requests_detached_windows_console():
    module=_load('adaptive_video_dev3b27', 'lib/adaptive_video.py')
    class Startup:
        dwFlags=0
        wShowWindow=1
    with patch.object(module.os,'name','nt'), patch.object(module.subprocess,'DETACHED_PROCESS',8,create=True), patch.object(module.subprocess,'STARTUPINFO',Startup,create=True), patch.object(module.subprocess,'STARTF_USESHOWWINDOW',1,create=True):
        flags=module._hidden_windows_child()
    assert flags['creationflags']==8
    assert flags['startupinfo'].dwFlags & 1
    assert flags['startupinfo'].wShowWindow==0
    assert module._hidden_windows_child()['creationflags']==0 if os.name!='nt' else True


def test_vendor_ffmpeg_launcher_requests_detached_but_mcp_stdio_is_not_detached():
    text=(ROOT/'vendor'/'bilibili-mcp'/'mcp_server.py').read_text(encoding='utf8')
    tree=ast.parse(text)
    safe=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_hidden_windows_child')
    ffmpeg=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_detached_windows_ffmpeg_child')
    assert 'DETACHED_PROCESS' not in ast.unparse(safe)
    assert 'DETACHED_PROCESS' in ast.unparse(ffmpeg)
    assert text.count('**_detached_windows_ffmpeg_child()')==2
    adaptive=(ROOT/'lib'/'adaptive_video.py').read_text(encoding='utf8')
    assert adaptive.count('**_hidden_windows_child()')>=2
    vision=(ROOT/'lib'/'vision_dsh.py').read_text(encoding='utf8')
    assert 'DETACHED_PROCESS' not in vision, 'DSH stdout/stdio parent must keep its own existing policy'


def test_dsh_exit_receipt_contains_no_output_or_private_values():
    vision=_load('vision_dsh_dev3b27','lib/vision_dsh.py')
    child=subprocess.CompletedProcess(['DSH'],1,b'private request secret',b'api_key=secret')
    receipt=vision._safe_cli_process_receipt(child)
    assert receipt == {'status':'exited','exitCode':1,'stdout':'present','stderr':'present','stderrKind':'unclassified_output'}
    assert 'secret' not in json.dumps(receipt)
    assert vision._safe_cli_process_receipt(subprocess.CompletedProcess(['DSH'],0,b'',b''))['stderr']=='empty'


def test_headless_overlay_requires_mcp_startup_failure_to_be_visible():
    source=(ROOT/'index.js').read_text(encoding='utf8')
    assert "'        failOnStartupError: true'" in source
    assert source.count("'        failOnStartupError: true'")==1
