"""Regression: nested DSH visual sessions must inherit Electron Node mode."""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lib'))
spec = importlib.util.spec_from_file_location('vision_dsh_nested_cli', ROOT / 'lib' / 'vision_dsh.py')
vision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vision)


def _overlay(home, selftest):
    rows = []
    for item in vision._HEADLESS_DENY_TOOLS:
        rows.extend([f'- id: {item}', '  disabled: true', ''])
    for item in ('credentials', 'authorization', 'deepseek-account'):
        rows.extend([f'- id: {item}', '  disabled: false', ''])
    tool = 'bili_vision_selftest' if selftest else 'bili_preview_vision'
    rows.extend(['- insert:', '    - id: mcp-bili-vision-readonly',
                 '      config:', '        serverName: bilivision', '        env:',
                 f"          BILI_MCP_TOOLS: '{tool}'"])
    if selftest:
        rows.extend(["          BILI_VISION_SELFTEST_ALLOWED: '1'",
                     "          BILI_VISION_TEST_ASSET: '/fake/local-vision-selftest-dafeiyu.png'"])
    else:
        rows.append("          BILI_VISION_CHILD: '1'")
    filename = 'headless-vision-selftest-overlay.yml' if selftest else 'headless-vision-overlay.yml'
    target = home / filename
    target.write_text('\n'.join(rows) + '\n', encoding='utf8')
    return target


def test_dsh_child_node_flag_is_explicit_and_bounded():
    assert vision._vision_dsh_child_env({'BILI_VISION_DSH_RUN_AS_NODE': '1', 'KEY': 'safe'}) == {
        'KEY': 'safe', 'ELECTRON_RUN_AS_NODE': '1'}
    assert vision._vision_dsh_child_env({'BILI_VISION_DSH_RUN_AS_NODE': '0'}) == {}
    assert vision._vision_dsh_child_env({'BILI_VISION_DSH_RUN_AS_NODE': 'surprise'}) == {}


def test_manual_dsh_image_probe_receives_desktop_node_flag(tmp_path):
    overlay = _overlay(tmp_path, True)
    env = {'BILI_VISION_DSH_ARGV': json.dumps(['/fake/DeepSeek Harness.exe', '--profile', 'headless', '--patch', str(overlay)]),
           'BILI_VISION_DSH_RUN_AS_NODE': '1'}
    received = []
    def runner(argv, **opts):
        received.append((argv, opts['env'].copy()))
        return subprocess.CompletedProcess(argv, 1, b'', b'node:internal exception')
    result = vision.describe_test_image_with_dsh(tmp_path, env=env, runner=runner)
    assert not result['ok'] and result['status'] == 'headless_launch_failed'
    assert received[0][1]['ELECTRON_RUN_AS_NODE'] == '1'
    assert 'BILI_VISION_DSH_RUN_AS_NODE' not in received[0][1]
    assert 'BILI_VISION_DSH_ARGV' not in received[0][1]


def test_production_dsh_frame_probe_receives_desktop_node_flag(tmp_path):
    overlay = _overlay(tmp_path, False)
    env = {'BILI_VISION_DSH_ARGV': json.dumps(['/fake/DeepSeek Harness.exe', '--profile', 'headless', '--patch', str(overlay)]),
           'BILI_VISION_DSH_RUN_AS_NODE': '1', 'BILI_VISION_DSH_PROVIDER': 'test',
           'BILI_VISION_DSH_MODEL': 'test'}
    received = []
    def runner(argv, **opts):
        received.append((argv, opts['env'].copy()))
        return subprocess.CompletedProcess(argv, 1, b'', b'')
    with patch('preview_vision._record_vision_attempt', return_value=True):
        result = vision.describe_with_dsh('BV1234567890', tmp_path, env=env, runner=runner)
    assert not result['ok'] and result['status'] == 'subagent_error'
    assert received[0][1]['ELECTRON_RUN_AS_NODE'] == '1'
    assert 'BILI_VISION_DSH_RUN_AS_NODE' not in received[0][1]
