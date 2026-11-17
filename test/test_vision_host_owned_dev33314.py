"""Host-owned manual image acceptance: in-memory loopback result contract only."""
import base64
import importlib.util
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import pytest

SOURCE=Path(__file__).parents[1]/'lib'/'vision_dsh.py'
spec=importlib.util.spec_from_file_location('vision_host_owned',SOURCE)
v=importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*_): pass
    def do_POST(self):
        packet=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.headers.get('X-Vision-Token')!='a'*64 or self.path!='/vision':
            self.send_response(403);self.end_headers();return
        self.server.packets.append(packet)
        result={'kind':'process_result','exitCode':0,
                'out':base64.b64encode(b'expected config').decode(), 'err':''}
        body=json.dumps(result).encode('utf8')
        self.send_response(200);self.send_header('Content-Length',str(len(body)))
        self.end_headers();self.wfile.write(body)

@pytest.fixture
def server():
    httpd=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    httpd.packets=[]
    thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
    try:yield httpd
    finally:httpd.shutdown();httpd.server_close();thread.join(timeout=2)

def test_host_owned_result_is_same_completedprocess_contract(server):
    args=['C:/desktop/DeepSeek Harness.exe','--expose-internals','C:/desktop/cli.js','--profile','headless','--dump-default-config']
    env={'BILI_VISION_HOST_TOKEN':'a'*64,'BILI_VISION_HOST_PORT':str(server.server_port)}
    out=v._run_host_owned_vision_cli(args,cwd='C:/duty',env=env,timeout=5)
    assert out.returncode==0 and out.stdout==b'expected config'
    assert server.packets[0]['argv']==args[1:]
    assert server.packets[0]['cwd']=='C:/duty'

def test_missing_bearer_rejected_without_connection():
    with pytest.raises(OSError,match='vision_host_capability_invalid'):
        v._run_host_owned_vision_cli(['C:/x'],cwd='C:/duty',env={'BILI_VISION_HOST_PORT':'1'},timeout=5)
