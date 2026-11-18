import importlib.util
from pathlib import Path
import subprocess
MOD=Path(__file__).resolve().parents[1]/'lib'/'vision_dsh.py'
spec=importlib.util.spec_from_file_location('vision_dsh_isolated',MOD)
vision=importlib.util.module_from_spec(spec);spec.loader.exec_module(vision)
ARGS=['dsh','--profile','headless','--patch','safe.yml']
GOOD=b'- id: mcp-bili-vision-readonly\n  serverName: bilivision'
def result(exit_code, stdout=b'', stderr=b''):
    return subprocess.CompletedProcess([],exit_code,stdout,stderr)

def test_stale_node_options_can_be_isolated_only_after_same_overlay_passes(tmp_path):
    calls=[]
    def execute(argv,**kw):
        env=kw['env'];calls.append((list(argv),dict(env)))
        if 'NODE_OPTIONS' in env:return result(1,b'',b'node:internal error')
        return result(0,GOOD)
    original={'NODE_OPTIONS':'--some-flag','NODE_PATH':'old','DSH_HOME':'profile','HTTPS_PROXY':'http://127.0.0.1:7890','ELECTRON_RUN_AS_NODE':'1'}
    d,env=vision._probe_headless_with_node_env_isolation(ARGS,tmp_path,original,execute=execute)
    assert d['status']=='ready' and d['nodeEnvRetry']=='ready'
    assert 'NODE_OPTIONS' not in env and 'NODE_PATH' not in env
    assert env['DSH_HOME']=='profile' and env['HTTPS_PROXY']==original['HTTPS_PROXY']
    assert original['NODE_OPTIONS']=='--some-flag'
    assert any('--dump-config' in args for args,kw in calls)

def test_failed_isolation_does_not_bypass_config_gate(tmp_path):
    d,env=vision._probe_headless_with_node_env_isolation(ARGS,tmp_path,{'NODE_OPTIONS':'broken'},execute=lambda *a,**k:result(1,b'',b'node:internal error'))
    assert d['status']=='failed' and d['nodeEnvRetry']=='failed'
    assert env['NODE_OPTIONS']=='broken'

def test_no_node_flags_keeps_existing_fail_closed_diagnostic(tmp_path):
    d,env=vision._probe_headless_with_node_env_isolation(ARGS,tmp_path,{},execute=lambda *a,**k:result(1,b'',b'node:internal error'))
    assert d['status']=='failed' and d['nodeEnvRetry']=='no_flags'
