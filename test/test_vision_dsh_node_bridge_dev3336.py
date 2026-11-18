import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
from types import SimpleNamespace

SRC=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('vision_dsh_bridge',SRC/'lib'/'vision_dsh.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)


def test_python_vision_bridge_transport_does_not_put_prompt_in_os_argv(tmp_path,monkeypatch):
    original_node=shutil.which('node')
    if not original_node:return  # Node-specific integration is tested by the Node test too.
    root=tmp_path/'dsh';root.mkdir()
    (root/'resources').mkdir()
    (root/'resources'/'app.asar').write_text('test fake asar')
    exe=root/'DeepSeek Harness.exe'
    exe.write_text('#!/usr/bin/env node\nprocess.stdout.write("SAFE_NODE_BRIDGE_OK")\n')
    exe.chmod(0o755)
    home=tmp_path/'home';home.mkdir()
    bridge=home/'dsh-vision-node-bridge.mjs'
    bridge.write_bytes((SRC/'lib'/'dsh-vision-node-bridge.mjs').read_bytes())
    node_exe=tmp_path/'node.exe';node_exe.symlink_to(Path(original_node))
    env={**__import__('os').environ,'BILI_DUTY_HOME':str(home),'BILI_VISION_DSH_BRIDGE':str(bridge),
         'BILI_VISION_DSH_WORKDIR':str(tmp_path)}
    entry=root/'resources'/'app.asar'/'dsh'/'node_modules'/'@deepseek-ai'/'dsh-desktop-host'/'lib'/'cli.js'
    argv=[str(exe),'--expose-internals',str(entry),'--profile','headless','--dump-default-config']
    monkeypatch.setattr(v,'_vision_bridge_active',lambda *_:True)
    monkeypatch.setattr(v.shutil,'which',lambda name:str(node_exe))
    result=v._run_vision_cli(argv,cwd=home,env=env,timeout=10,stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False)
    assert result.returncode==0 and b'SAFE_NODE_BRIDGE_OK' in result.stdout
    assert result.args==argv


def test_python_bridge_fails_closed_on_untrusted_script(tmp_path,monkeypatch):
    monkeypatch.setattr(v,'_vision_bridge_active',lambda *_:True)
    home=tmp_path/'home';home.mkdir()
    env={'BILI_DUTY_HOME':str(home),'BILI_VISION_DSH_BRIDGE':str(tmp_path/'foreign.mjs')}
    try:
        v._run_vision_cli(['C:/fake/DeepSeek Harness.exe'],cwd=home,env=env,timeout=5)
    except OSError as err: assert 'untrusted_node_bridge' in str(err)
    else: assert False,'should fail closed'
