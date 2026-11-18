"""Host-owned manual image acceptance: in-memory loopback result contract only."""
import base64
import importlib.util
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SOURCE = Path(__file__).parents[1] / 'lib' / 'vision_dsh.py'
spec = importlib.util.spec_from_file_location('vision_host_owned', SOURCE)
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        packet = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if getattr(self.server, 'reject_reason', ''):
            body = json.dumps({'kind': 'rejected', 'reason': self.server.reject_reason}).encode('utf8')
            self.send_response(403)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.headers.get('X-Vision-Token') != 'a' * 64 or self.path != '/vision':
            self.send_response(403)
            self.end_headers()
            return
        self.server.packets.append(packet)
        result = {'kind': 'process_result', 'exitCode': 0,
                  'out': base64.b64encode(b'expected config').decode(), 'err': ''}
        body = json.dumps(result).encode('utf8')
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class TestHostOwnedVision(unittest.TestCase):
    def setUp(self):
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.httpd.packets = []
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)

    def test_host_owned_result_is_same_completedprocess_contract(self):
        args = ['C:/desktop/DeepSeek Harness.exe', '--expose-internals',
                'C:/desktop/cli.js', '--profile', 'headless', '--dump-default-config']
        env = {'BILI_VISION_HOST_TOKEN': 'a' * 64, 'BILI_VISION_HOST_PORT': str(self.httpd.server_port)}
        out = v._run_host_owned_vision_cli(args, cwd='C:/duty', env=env, timeout=5)
        self.assertEqual(out.returncode, 0)
        self.assertEqual(out.stdout, b'expected config')
        self.assertEqual(self.httpd.packets[0]['argv'], args[1:])
        self.assertEqual(self.httpd.packets[0]['cwd'], 'C:/duty')

    def test_missing_bearer_rejected_without_connection(self):
        with self.assertRaisesRegex(OSError, 'vision_host_capability_invalid'):
            v._run_host_owned_vision_cli(['C:/x'], cwd='C:/duty',
                                         env={'BILI_VISION_HOST_PORT': '1'}, timeout=5)
        self.assertEqual(self.httpd.packets, [])

    def test_host_rejection_reports_closed_reason_without_leaking_http_body(self):
        self.httpd.reject_reason = 'not_private_selftest_patch'
        args = ['C:/desktop/DeepSeek Harness.exe', '--expose-internals',
                'C:/desktop/cli.js', '--profile', 'headless', '--dump-config']
        env = {'BILI_VISION_HOST_TOKEN': 'a' * 64, 'BILI_VISION_HOST_PORT': str(self.httpd.server_port)}
        with self.assertRaisesRegex(OSError, 'vision_host_rejected:not_private_selftest_patch'):
            v._run_host_owned_vision_cli(args, cwd='C:/duty', env=env, timeout=5)
        self.assertEqual(self.httpd.packets, [])


if __name__ == '__main__':
    unittest.main()
