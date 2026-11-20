"""Regress actual offline FFmpeg focus sampling, not just command mocks.

The filter graph uses literal comma operators inside min(w,iw). FFmpeg
otherwise treats those commas as separators between distinct filters.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
import adaptive_video as av


class LocalFfmpegFocusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ffmpeg = shutil.which('ffmpeg')
        if not cls.ffmpeg:
            raise unittest.SkipTest('real FFmpeg is not available in PATH')

    def test_actual_focus_decode_uses_valid_min_expression_without_upscaling(self):
        with tempfile.TemporaryDirectory(prefix='dev39-local-ffmpeg-') as td:
            video = Path(td) / 'synthetic.mp4'
            generated = subprocess.run([
                self.ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error',
                '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=6:d=3',
                '-an', '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', '-y', str(video)
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
            self.assertEqual(generated.returncode, 0,
                             generated.stderr.decode('utf8', errors='replace')[:500])
            with patch.object(av, '_ffmpeg_binary', return_value=self.ffmpeg):
                frames = av._decode_samples(video, start=0.5, length=2.0, focused=True)
            self.assertGreaterEqual(len(frames), 2)
            self.assertLessEqual(len(frames), 4)
            self.assertTrue(all(frame.size == (640, 360) for frame in frames))
            # The 320x180 real image must be centered, not scaled up to 640x360.
            self.assertEqual(frames[0].getpixel((0, 0)), (0, 0, 0))
            self.assertGreater(frames[0].getpixel((320, 180))[2], 100)

    def test_overview_filter_and_focused_filter_are_both_parseable(self):
        with tempfile.TemporaryDirectory(prefix='dev39-local-ffmpeg-') as td:
            video = Path(td) / 'synthetic.mp4'
            result = subprocess.run([
                self.ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error',
                '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=6:duration=2',
                '-an', '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', '-y', str(video)
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
            self.assertEqual(result.returncode, 0,
                             result.stderr.decode('utf8', errors='replace')[:500])
            with patch.object(av, '_ffmpeg_binary', return_value=self.ffmpeg):
                overview = av._decode_samples(video, start=0, length=1.5, focused=False)
                focused = av._decode_samples(video, start=0, length=1.5, focused=True)
            self.assertGreaterEqual(len(overview), 2)
            self.assertGreaterEqual(len(focused), 2)
            self.assertEqual(overview[0].size, (192, 108))
            self.assertEqual(focused[0].size, (640, 360))


if __name__ == '__main__':
    unittest.main()
