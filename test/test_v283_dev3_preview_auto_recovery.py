"""Read-only preview lock death proof and the Bilibili/model phase boundary."""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'vendor' / 'bilibili-mcp'))
sys.path.insert(0, str(ROOT / 'lib'))
import read_action_gate as gate
import preview_vision

SCOPE = 'account-scope-A:cred-digest-00001'
BV = 'BV1abcde1234'

class PreviewRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='dsh-preview-recover-')
        self.addCleanup(self.folder.cleanup)
        self.home = Path(self.folder.name)
        self.scope = patch.object(gate, '_account_scope', return_value=SCOPE)
        self.scope.start()
        self.addCleanup(self.scope.stop)

    def stale(self, operation='bili_preview_frames', pid=2147483647, age=31):
        key = gate._sha(json.dumps([SCOPE, 'public', operation, BV], separators=(',', ':'), ensure_ascii=False))
        folder = self.home/'read-action-executions'/'locks'/key
        folder.mkdir(parents=True, exist_ok=True)
        row = dict(version=1, id=key, scopeHash=gate._sha(SCOPE)[:20], operation=operation,
                   source='python-video-agent', state='executing',
                   at=int(time.time()*1000)-age*60_000, pid=pid)
        (folder/'entry.json').write_text(json.dumps(row),encoding='utf8')
        return folder

    def test_verified_dead_preview_recovery_creates_no_success_receipt_or_replay(self):
        folder = self.stale()
        with patch.object(gate, '_owner_definitely_exited', return_value=True):
            with gate.public_read_reservation('bili_preview_frames',{'bvid':BV},home=self.home) as nested:
                self.assertFalse(nested)
                self.assertTrue(folder.exists(),'new explicitly requested read owns this folder')
        self.assertFalse(folder.exists())
        receipts=list((self.home/'read-action-executions'/'receipts').glob('*.json'))
        states={json.loads(f.read_text())['state'] for f in receipts}
        self.assertIn('auto-recovered-unverified',states)
        self.assertIn('tool-returned',states)

    def test_live_or_unknown_owner_and_other_tools_stay_locked(self):
        self.stale(pid=os.getpid())
        with patch.object(gate,'_owner_definitely_exited',return_value=False):
            with self.assertRaises(gate.ReadReservationHeld):
                with gate.public_read_reservation('bili_preview_frames',{'bvid':BV},home=self.home):pass
        self.stale(operation='bili_video_info')
        with patch.object(gate,'_owner_definitely_exited',return_value=True):
            with self.assertRaises(gate.ReadReservationHeld):
                with gate.public_read_reservation('bili_video_info',{'bvid':BV},home=self.home):pass

    def test_not_old_enough_never_recovers_even_if_owner_is_gone(self):
        self.stale(age=1)
        with patch.object(gate,'_owner_definitely_exited',return_value=True):
            with self.assertRaises(gate.ReadReservationHeld):
                with gate.public_read_reservation('bili_preview_frames',{'bvid':BV},home=self.home):pass

    def test_model_phase_hook_is_before_ollama_and_after_network_frames(self):
        # Mock fixed public endpoints; no network or model is ever contacted.
        from io import BytesIO
        from PIL import Image
        pic=Image.new('RGB',(320,180),color='white')
        buffer=BytesIO();pic.save(buffer,format='JPEG');jpg=buffer.getvalue()
        def api(url):
            if 'videoshot' in url:return {'image':['https://i0.hdslb.com/bfs/videoshot/a.jpg'],
                'img_x_len':1,'img_y_len':1,'img_x_size':320,'img_y_size':180,'index':[0,5]}
            return {'pages':[{'cid':5}]}
        order=[]
        def ready(_result):order.append('frames_ready')
        def model(*args,**kwargs):
            self.assertEqual(order,['frames_ready'],'model must not start while frame lock is held')
            order.append('model')
            return '真实视觉描述'
        with (patch.object(preview_vision,'_json_api',side_effect=api),
              patch.object(preview_vision,'_safe_api_get',return_value=jpg),
              patch.object(preview_vision,'_call_local_ollama',side_effect=model)):
            result=preview_vision._analyze_preview_core(BV,self.home,enabled=True,provider='ollama',model='mock',
                max_frames=1,debug=False,before_model=ready)
        self.assertEqual(result['status'],'analyzed')
        self.assertEqual(order,['frames_ready','model'])
        # Cache hits must not refetch B站 or create a new model invocation.
        with patch.object(preview_vision,'_json_api',side_effect=AssertionError('cache must not refetch')):
            cached=preview_vision._analyze_preview_core(BV,self.home,enabled=True,provider='ollama',model='mock',
                max_frames=1,debug=False,before_model=ready)
        self.assertEqual(cached['status'],'cached')
        self.assertEqual(order,['frames_ready','model'])

    def test_production_local_mode_uses_the_same_thread_phase_boundary(self):
        source=(ROOT/'vendor'/'bilibili-mcp'/'mcp_server.py').read_text(encoding='utf8')
        self.assertIn('with ExitStack() as platform_read:',source)
        self.assertIn('before_model=frames_ready',source)
        self.assertIn('platform_read.close()',source)

if __name__=='__main__':unittest.main()
