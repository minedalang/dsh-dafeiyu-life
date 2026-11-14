import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'lib'))
spec=importlib.util.spec_from_file_location('vision_dsh_for_tests',ROOT/'lib'/'vision_dsh.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def configured(tmp_path):
    rows=[]
    for ident in module._HEADLESS_DENY_TOOLS:
        rows.extend([f'- id: {ident}','  disabled: true',''])
    for ident in ('credentials','authorization','deepseek-account'):
        rows.extend([f'- id: {ident}','  disabled: false',''])
    rows.extend(['- insert:','    - id: mcp-bili-vision-readonly',"      name: '@deepseek-ai/dsh-mcp-client'",'      config:','        serverName: bilivision','        transport: stdio','        env:',"          BILI_MCP_TOOLS: 'bili_preview_vision'",''])
    (tmp_path/'headless-vision-overlay.yml').write_text('\n'.join(rows),encoding='utf8')
    args=['/some/absolute/dsh','--profile','headless','--patch',str(tmp_path/'headless-vision-overlay.yml')]
    env={'BILI_VISION_DSH_ARGV':json.dumps(args),'BILI_VISION_DSH_MODEL':'claude-haiku-5-5',
         'BILI_VISION_DSH_PROVIDER':'claude','BILI_VISION_FRAMES':'2'}
    return env


def test_invalid_bvid_never_runs(tmp_path):
    assert module.describe_with_dsh('hi; echo secret',tmp_path)['status']=='invalid_bvid'


def test_no_route_fails_closed(tmp_path):
    result=module.describe_with_dsh('BV1234567890',tmp_path,env={})
    assert not result['ok'] and result['status']=='vision_config_error'


def test_dsh_model_analysis_requires_frame_receipt(tmp_path):
    env=configured(tmp_path)
    calls=[]
    def fake_runner(args,**kwargs):
        calls.append((args,kwargs))
        receipt=Path(kwargs['env']['BILI_VISION_PROOF_FILE'])
        receipt.write_text(json.dumps({'bvid':'BV1234567890','times':[3.0,7.0]}),encoding='utf8')
        return SimpleNamespace(returncode=0,stdout='VISION_DESC: 画面中央有一只圆形黄色卡通角色，背景呈蓝色。\n'.encode(),stderr=b'')
    with patch('preview_vision._claim_vision_quota',return_value=True) as quota:
        result=module.describe_with_dsh('BV1234567890',tmp_path,env=env,runner=fake_runner)
        assert result['ok'] and result['status']=='analyzed'
        assert calls[0][0][-1].find('BV1234567890')>=0
        assert '--patch' in calls[0][0]
        assert not Path(calls[0][1]['env']['BILI_VISION_PROOF_FILE']).exists()
        quota.assert_called_once()
    with patch('preview_vision._claim_vision_quota',side_effect=AssertionError('cache should skip quota')):
        result2=module.describe_with_dsh('BV1234567890',tmp_path,env=env,runner=lambda *a,**kw: 1/0)
        assert result2['status']=='cached'


def test_dsh_model_no_frame_receipt_not_success(tmp_path):
    env=configured(tmp_path)
    def fake_runner(*args,**kwargs):
        return SimpleNamespace(returncode=0,stdout=b'VISION_DESC: made-up graphic scene\n',stderr=b'')
    with patch('preview_vision._claim_vision_quota',return_value=True):
        result=module.describe_with_dsh('BV1234567890',tmp_path,env=env,runner=fake_runner)
    assert not result['ok'] and result['status']=='no_images_confirmed'


def test_daily_quota_applies_to_independent_dsh(tmp_path):
    env=configured(tmp_path)
    with patch('preview_vision._claim_vision_quota',return_value=False):
        result=module.describe_with_dsh('BV1234567890',tmp_path,env=env,runner=lambda *a,**kw: 1/0)
    assert result['status']=='daily_limit'


def test_tampered_vision_overlay_fails_closed(tmp_path):
    env=configured(tmp_path)
    overlay=tmp_path/'headless-vision-overlay.yml'
    text=overlay.read_text(encoding='utf8').replace('- id: tool-fs\n  disabled: true','- id: tool-fs\n  disabled: false')
    overlay.write_text(text,encoding='utf8')
    result=module.describe_with_dsh('BV1234567890',tmp_path,env=env,runner=lambda *a,**kw: 1/0)
    assert not result['ok'] and result['status']=='vision_config_error'
    assert 'tool-fs' in result['error']


def test_extra_profile_or_patch_is_rejected(tmp_path):
    env=configured(tmp_path)
    argv=json.loads(env['BILI_VISION_DSH_ARGV'])
    argv.extend(['--patch',str(tmp_path/'headless-vision-overlay.yml')])
    env['BILI_VISION_DSH_ARGV']=json.dumps(argv)
    result=module.describe_with_dsh('BV1234567890',tmp_path,env=env,runner=lambda *a,**kw: 1/0)
    assert not result['ok'] and result['status']=='vision_config_error'


def test_preview_only_does_not_need_key_or_debug(tmp_path):
    import preview_vision
    # Malformed BV should stop before network, even with prefetch-only mode.
    r=preview_vision.analyze_preview('INVALID',tmp_path,prefetch_only=True,enabled=False,debug=False)
    assert not r['ok'] and r['error']=='BV号格式不正确'


def test_custom_prompt_uses_same_independent_model_and_invalidates_cache(tmp_path):
    import base64
    env=configured(tmp_path)
    env['BILI_VISION_PROMPT_B64']=base64.b64encode('优先观察角色动作与表情'.encode('utf8')).decode('ascii')
    calls=[]
    def fake_runner(args,**kwargs):
        calls.append(args[-1])
        Path(kwargs['env']['BILI_VISION_PROOF_FILE']).write_text(json.dumps({'bvid':'BV1234567890','times':[6.0]}),encoding='utf8')
        return SimpleNamespace(returncode=0,stdout='VISION_DESC: 画面里一只绿色卡通角色正挥动手臂。\n'.encode(),stderr=b'')
    with patch('preview_vision._claim_vision_quota',return_value=True):
        assert module.describe_with_dsh('BV1234567890',tmp_path,env=env,runner=fake_runner)['ok']
        assert '优先观察角色动作与表情' in calls[0]
        # Switching the instruction must not reuse a different instruction's observation.
        env['BILI_VISION_PROMPT_B64']=base64.b64encode('只观察画面可读文字'.encode('utf8')).decode('ascii')
        result=module.describe_with_dsh('BV1234567890',tmp_path,env=env,runner=fake_runner)
        assert result['status']=='analyzed' and len(calls)==2


def test_dsh_focused_window_receipt_is_bound_to_requested_window(tmp_path):
    env=configured(tmp_path)
    expected={'startSeconds':21.0,'endSeconds':51.0}
    seen=[]
    def fake_runner(args,**kwargs):
        seen.append(args[-1])
        Path(kwargs['env']['BILI_VISION_PROOF_FILE']).write_text(
            json.dumps({'bvid':'BV1234567890','times':[30.0,40.0],
                        'focus_window':expected}),encoding='utf8')
        return SimpleNamespace(returncode=0,
            stdout='VISION_DESC: 第30秒和第40秒分别显示两幅不同的卡通画面。\n'.encode(),stderr=b'')
    with patch('preview_vision._claim_vision_quota',return_value=True):
        result=module.describe_with_dsh('BV1234567890',tmp_path,env=env,
            runner=fake_runner,focus_start=21,focus_end=51)
        assert result['ok'] is True
        assert result['focus_window']==expected
        assert 'focus_start_seconds=21.0' in seen[0]
        assert 'focus_end_seconds=51.0' in seen[0]
        # Cached focused proof does not authorize an ordinary full-video observation.
        ordinary=module.describe_with_dsh('BV1234567890',tmp_path,env=env,
            runner=lambda *_a,**_kw: SimpleNamespace(returncode=2,stdout=b'',stderr=b''))
        assert ordinary['ok'] is False
    def wrong_focus(args,**kwargs):
        Path(kwargs['env']['BILI_VISION_PROOF_FILE']).write_text(
            json.dumps({'bvid':'BV1234567890','times':[30], 'focus_window':None}),encoding='utf8')
        return SimpleNamespace(returncode=0,stdout='VISION_DESC: 不应接受的结果\n'.encode(),stderr=b'')
    with patch('preview_vision._claim_vision_quota',return_value=True):
        mismatched=module.describe_with_dsh('BV1234567890',tmp_path,env=env,
            runner=wrong_focus,focus_start=30,focus_end=40)
        assert not mismatched['ok'] and mismatched['status']=='no_images_confirmed'
