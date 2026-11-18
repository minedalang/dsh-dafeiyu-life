"""Only scoped, offline diagnostics for current Windows Headless failures."""
from pathlib import Path
import importlib.util
import subprocess

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('vision331', ROOT/'lib'/'vision_dsh.py')
vision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vision)

ARGS = ['C:/dsh.exe','--profile','headless','--patch','C:/safe-overlay.yml']

def fake_sequence(full, baseline, base):
    seen=[]
    responses = [full,baseline,base]
    def runner(argv,**kwargs):
        seen.append(argv)
        assert kwargs['stdin'] == subprocess.DEVNULL
        assert kwargs['check'] is False
        assert kwargs['timeout']==25
        return responses.pop(0)
    return runner,seen

def resp(exit=0,stdout=b'good',stderr=b''):
    return subprocess.CompletedProcess([],exit,stdout,stderr)

def test_dump_failure_separates_overlay_from_base(tmp_path):
    runner,seen=fake_sequence(resp(1,b'',b'Invalid patch G:/private/key'),resp(),resp())
    result=vision._probe_headless_composition(ARGS,tmp_path,{},execute=runner)
    assert result['failureLayer']=='vision_overlay'
    assert result['failureKind']=='patch_parse_error'
    assert result['defaultDump']=='ready' and result['baseDump']=='ready'
    assert '--patch' in seen[0]
    assert '--patch' not in seen[1] and '--patch' not in seen[2]
    assert '--dump-default-config' in seen[1] and '--dump-config' in seen[2]
    assert 'G:/private' not in str(result)

def test_dump_failure_default_bundle(tmp_path):
    runner,seen=fake_sequence(resp(1,b'',b'node:internal Error [ERR_MODULE_NOT_FOUND] C:/secret'),resp(1,b'',b'failure'),resp())
    result=vision._probe_headless_composition(ARGS,tmp_path,{},execute=runner)
    assert result['failureLayer']=='cli_or_bundle'
    assert result['failureKind']=='module_resolution_error'
    assert result['cli']['nodeErrorCode']=='err_module_not_found'
    assert result['baseDump']=='not_run'
    assert len(seen)==2
    assert 'C:/secret' not in str(result)

def test_dump_failure_profile_home_layer(tmp_path):
    runner,seen=fake_sequence(resp(1,b'',b'error'),resp(),resp(1,b'',b'error'))
    result=vision._probe_headless_composition(ARGS,tmp_path,{},execute=runner)
    assert result['failureLayer']=='profile_or_home'
    assert result['defaultDump']=='ready' and result['baseDump']=='failed'
    assert len(seen)==3

def test_dump_success_still_requires_actual_inserted_mcp(tmp_path):
    ready=vision._probe_headless_composition(ARGS,tmp_path,{},execute=lambda a,**k:resp(0,b'- id: mcp-bili-vision-readonly\n  serverName: bilivision'))
    assert ready['status']=='ready'
    missing=vision._probe_headless_composition(ARGS,tmp_path,{},execute=lambda a,**k:resp(0,b'headless works, not plugin'))
    assert missing['status']=='failed'
    assert missing['reason']=='headless_vision_patch_not_composed'
