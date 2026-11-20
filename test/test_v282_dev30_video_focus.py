"""Dev.30 safety acceptance: bounded original-media focus resolution and frame limits."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'lib'))
import adaptive_video as av
BV='BV1ab2345678'

class VideoFocusClosure(unittest.TestCase):
    def test_actual_focus_decode_targets_360p_not_preview_216p(self):
        received=[]
        class Output:
            returncode=0
            stdout=b'\0'*(640*360*3)
            stderr=b''
        def fake_run(cmd,**kwargs):
            received.append(cmd)
            return Output()
        with patch.object(av,'_ffmpeg_binary',return_value='ffmpeg'),\
             patch.object(av.subprocess,'run',side_effect=fake_run):
            imgs=av._decode_samples('local.mp4',start=20,length=1,focused=True)
        self.assertEqual(imgs[0].size,(640,360))
        cmd=received[0]
        filter_cmd=cmd[cmd.index('-vf')+1]
        self.assertIn(r'scale=min(640\,iw):min(360\,ih)',filter_cmd)
        self.assertIn('pad=640:360',filter_cmd)
        self.assertIn('-protocol_whitelist',cmd)
        self.assertIn('file,pipe',cmd)

    def test_reject_invalid_remaining_frames_before_network_or_ffmpeg(self):
        for limit in (0,-1,49,100,True,2.2):
            with self.subTest(limit=limit),patch.object(av,'_ffmpeg_binary',side_effect=AssertionError('should not open ffmpeg')):
                with self.assertRaises(av.AdaptiveUnavailable) as ctx:
                    av._acquire_adaptive_frames_impl(BV,max_frames=24,
                        focus={'startSeconds':20,'endSeconds':30},depth='deep',
                        frame_budget_limit=limit)
                self.assertIn('invalid_frame_budget_limit',str(ctx.exception))

if __name__=='__main__':unittest.main()
