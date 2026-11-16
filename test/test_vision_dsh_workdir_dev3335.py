import importlib.util
from pathlib import Path
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('vision_dsh_dev3335',Path(__file__).resolve().parents[1]/'lib'/'vision_dsh.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)

def test_headless_cwd_probe_uses_only_successfully_validated_overlay(tmp_path):
    home=tmp_path/'home';work=tmp_path/'host';home.mkdir();work.mkdir()
    calls=[]
    def fake(args,**kwargs):
        calls.append((str(kwargs['cwd']),tuple(args)))
        ok=str(kwargs['cwd'])==str(work)
        return SimpleNamespace(returncode=0 if ok else 1,stdout=b'plugins: mcp-bili-vision-readonly bilivision' if ok else b'',stderr=b'node:internal failed')
    args=['dsh','--profile','headless','--patch','x.yml']
    result,env,cwd=v._probe_headless_with_workdir(args,home,{'BILI_VISION_DSH_WORKDIR':str(work)},execute=fake)
    assert result['status']=='ready' and result['launchCwd']=='host_workdir'
    assert cwd==str(work)
    assert calls[-1][1][-1]=='--dump-config'
    assert all('--patch' in x for _,x in calls if x[-1]=='--dump-config' and x==tuple(args+['--dump-config']))

def test_headless_cwd_probe_never_bypasses_failure(tmp_path):
    home=tmp_path/'home';work=tmp_path/'host';home.mkdir();work.mkdir()
    def fail(args,**kwargs):return SimpleNamespace(returncode=1,stdout=b'',stderr=b'NODE PRIVATE')
    r,env,cwd=v._probe_headless_with_workdir(['dsh','--profile','headless','--patch','x.yml'],home,{'BILI_VISION_DSH_WORKDIR':str(work)},execute=fail)
    assert r['status']=='failed' and r['workdirRetry']=='failed'
    assert cwd==str(home) and 'NODE PRIVATE' not in str(r)

def test_headless_cwd_requires_directory(tmp_path):
    assert v._vision_dsh_valid_host_workdir(tmp_path,{'BILI_VISION_DSH_WORKDIR':'relative'}) is None
    assert v._vision_dsh_valid_host_workdir(tmp_path,{'BILI_VISION_DSH_WORKDIR':str(tmp_path/'missing')}) is None
