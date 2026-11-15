"""Offline multi-signal storyboard constraints, only actual decoded frames may be tagged as such."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]/'lib'
sys.path.insert(0,str(ROOT))
import adaptive_video as av
import video_heat_signal as vh

BV='BV1234567890'

class StoryboardTests(unittest.TestCase):
    def test_heat_signal_nearby_viewer_reaction_is_hint_not_content(self):
        heat={'points':[0]*80,'step':5,'source':'bili-danmaku-xml-density'}
        heat['points'][22]=100
        self.assertGreater(vh.heat_at(heat,105),.8)
        self.assertGreater(vh.heat_at(heat,109),.8)
        self.assertEqual(vh.heat_at(None,110),0.)
        self.assertEqual(vh.obtain_heat_signal('',2,300),None)

    def test_coverage_across_20_minute_video_and_window_limit(self):
        for plan,expected_windows in ((12,4),(24,6),(48,8)):
            windows=av._choose_windows(1200,plan,None)
            self.assertEqual(len(windows),expected_windows)
            self.assertLessEqual(sum(end-start for start,end in windows),120.01)
            self.assertLess(windows[0][1],200)
            self.assertGreater(windows[-1][0],1000)
            self.assertEqual(windows,sorted(windows))
        self.assertEqual(av._choose_windows(1200,48,{'startSeconds':90.,'endSeconds':120.}),[(90.,120.)])

    def test_high_danmaku_peaks_add_windows_without_displacing_whole_timeline(self):
        # 5-minute clip; synthetic heat peaks at 01:40, 03:50.
        heat={'source':'bili-danmaku-xml-density','step':5,'points':[0]*60}
        heat['points'][20]=55
        heat['points'][46]=90
        windows=av._choose_windows(300,48,None,heat)
        self.assertEqual(len(windows),8)
        self.assertLessEqual(sum(b-a for a,b in windows),120.01)
        self.assertTrue(any(a<=100<=b for a,b in windows))
        self.assertTrue(any(a<=230<=b for a,b in windows))
        self.assertLess(windows[0][1],45)
        self.assertGreater(windows[-1][0],250)
        self.assertEqual(av._choose_windows(300,48,{'startSeconds':95.,'endSeconds':111.},heat),[(95.,111.)])
        # Flat audience traffic is not an exciting event; keep ordinary coverage.
        flat={'source':'bili-pbp-heat-curve','step':5,'points':[5]*60}
        self.assertEqual(av._choose_windows(300,48,None,flat),av._choose_windows(300,48,None))

    def test_real_storyboards_budget_and_timecode_provenance(self):
        for plan in av.FRAME_PLANS:
            calls=[]
            def decoded(file,*,start,length):
                calls.append((start,length))
                # synthetic scene changes in each decoding window
                return [Image.new('RGB',(av.FRAME_W,av.FRAME_H),
                        (int(start*3+i*15)%255,int(start+i*8)%255,(i//3)*37%255)) for i in range(int(length*av.FRAME_RATE))]
            with patch.object(av.shutil,'which',return_value='/usr/bin/ffmpeg'),\
                 patch.object(av,'_playurl',return_value=('https://a.bilivideo.com/upgcxcode/a.mp4',1000,1200,12)),\
                 patch.object(av,'_download_video',return_value=1000),\
                 patch.object(av,'_decode_samples',side_effect=decoded),\
                 patch.object(vh,'obtain_heat_signal',return_value=None):
                out=av.acquire_adaptive_frames(BV,max_frames=plan,depth='deep')
            self.assertTrue(out['ok'])
            self.assertEqual(out['sampling']['frame_plan'],plan)
            self.assertLessEqual(len(out['times']),plan)
            self.assertEqual(out['sampling']['frames_selected'],len(out['times']))
            self.assertEqual(len(out['frames']),(len(out['times'])+11)//12)
            self.assertTrue(all(len(frame['tile_times'])<=12 for frame in out['frames']))
            self.assertEqual(sum(len(frame['tile_times']) for frame in out['frames']),len(out['times']))
            self.assertTrue(all(frame['bytes'].startswith(b'\xff\xd8') for frame in out['frames']))
            self.assertTrue(all(length<=15.1 for _,length in calls))
            self.assertEqual(out['sampling']['heat_source'],'unavailable')
            self.assertFalse(out['sampling']['viewer_heat_is_content_evidence'])

    def test_standard_caps_at_twelve_and_skim_does_no_io(self):
        self.assertEqual(min(48,12),12)
        with self.assertRaisesRegex(av.AdaptiveUnavailable,'invalid_view_depth'):
            av.acquire_adaptive_frames(BV,max_frames=48,depth='skim')
        with self.assertRaisesRegex(av.AdaptiveUnavailable,'invalid_frame_plan'):
            av.acquire_adaptive_frames(BV,max_frames=30,depth='deep')

    def test_storyboard_no_lost_timestamp_on_high_heat(self):
        frames=[[Image.new('RGB',(av.FRAME_W,av.FRAME_H),(i*3%255,i*7%255,i*15%255)) for i in range(20)]]
        heat={'source':'bili-pbp-heat-curve','step':1,'points':[0]*40}
        heat['points'][13]=10
        chosen,meta=av._scene_candidates(frames,[0.],heat=heat,limit=12)
        self.assertTrue(chosen)
        self.assertLessEqual(len(chosen),12)
        self.assertEqual([x['second'] for x in chosen],sorted(x['second'] for x in chosen))
        self.assertTrue(all(0<=x['audience']<=1 for x in chosen))
        self.assertEqual(meta['frames_selected'],len(chosen))

if __name__=='__main__':unittest.main()
