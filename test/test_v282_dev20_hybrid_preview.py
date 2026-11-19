"""Whole videoshot thumbnail scan, not a whole-video visual-model call."""
import sys
from pathlib import Path
from io import BytesIO
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'lib'))
import preview_vision as pv
import video_heat_signal as heat
BV='BV1234567890'

def image_bytes(n):
    img=Image.new('RGB',(3*96,3*54))
    d=ImageDraw.Draw(img)
    for j in range(9):
        color=((n*43+j*12)%255,(n*13+j*71)%255,(n*31+j*22)%255)
        d.rectangle(((j%3)*96,(j//3)*54,(j%3+1)*96-1,(j//3+1)*54-1),fill=color)
    out=BytesIO();img.save(out,format='JPEG',quality=85)
    return out.getvalue()

def fake_api(url):
    if '/view?' in url:return {'cid':123}
    if '/videoshot?' in url:return {'image':[f'//i0.hdslb.com/bfs/videoshot/{j}.jpg' for j in range(11)],
        'index':[0]+[j*5 for j in range(91)],'img_x_len':3,'img_y_len':3,
        'img_x_size':96,'img_y_size':54}
    raise AssertionError(url)

class HybridPreview(unittest.TestCase):
    def test_all_91_candidates_across_11_sheets_but_only_two_model_boards(self):
        calls=[]
        def fetch(url,*args,**kw):
            calls.append(url)
            return image_bytes(int(url.rsplit('/',1)[1].split('.')[0]))
        with TemporaryDirectory() as home,patch.object(pv,'_json_api',side_effect=fake_api),\
             patch.object(pv,'_safe_api_get',side_effect=fetch),\
             patch.object(heat,'obtain_preview_heat_signal',return_value=None):
            result=pv.analyze_preview(BV,home,storyboard=True,max_frames=24,
                enabled=False,return_frames=True)
        self.assertTrue(result['ok'],result)
        sampler=result['sampling']
        self.assertEqual(sampler['sampler_version'],7)
        self.assertTrue(sampler['timeline_scan_complete'])
        self.assertEqual(sampler['index_frames_available'],91)
        self.assertEqual(sampler['candidates_examined'],91)
        self.assertEqual(sampler['source_sheets_scanned'],11)
        self.assertEqual(len(calls),11)
        self.assertLessEqual(len(result['times']),24)
        self.assertLessEqual(len(result['frames']),2)
        self.assertGreater(result['times'][-1]-result['times'][0],350)
        for t in sampler['review_candidates_seconds']:
            self.assertIn(t,result['times'])
        self.assertEqual(len(sampler['review_candidate_hints']),4)
        self.assertEqual(sampler['review_candidates_seconds'],
                         [h['second'] for h in sampler['review_candidate_hints']])
        for h in sampler['review_candidate_hints']:
            self.assertEqual(h['source'],'python-videoshot-neighbor-diff')
            self.assertGreaterEqual(h['pixel_change'],0)
            self.assertLessEqual(h['pixel_change'],1)
            self.assertIn(h['second'],result['times'])
        for board in result['frames']:
            self.assertLessEqual(board['tile_count'],12)
            with Image.open(BytesIO(board['bytes'])) as image:self.assertEqual(image.width,384)

    def test_48_global_preview_frames_make_four_boards_and_scoped_heat_hints(self):
        with TemporaryDirectory() as home,patch.object(pv,'_json_api',side_effect=fake_api),\
             patch.object(pv,'_safe_api_get',side_effect=lambda url,**kw:image_bytes(int(url.rsplit('/',1)[1].split('.')[0]))),\
             patch.object(heat,'obtain_preview_heat_signal',return_value={
                 'source':'bili-pbp-heat-curve','step':5,'points':[0]*60+[20]*30,
                 'items':90}):
            result=pv.analyze_preview(BV,home,storyboard=True,max_frames=48,
                                      enabled=False,return_frames=True)
        self.assertTrue(result['ok'],result)
        sampling=result['sampling']
        self.assertEqual(sampling['frame_budget'],48)
        self.assertEqual(len(result['times']),48)
        self.assertEqual(len(result['frames']),4)
        self.assertEqual(len(sampling['frame_change_hints']),48)
        self.assertEqual(len(sampling['heat_hints']),48)
        self.assertEqual(sampling['heat_source'],'bili-pbp-heat-curve')
        self.assertEqual({h['second'] for h in sampling['heat_hints']},set(result['times']))

    def test_explicit_small_budget_cannot_hide_overflow_or_claim_full_scan(self):
        with TemporaryDirectory() as home,patch.object(pv,'_json_api',side_effect=fake_api),\
             patch.object(pv,'_safe_api_get',side_effect=lambda url,**kw:image_bytes(0)),\
             patch.object(heat,'obtain_preview_heat_signal',return_value=None):
            result=pv.analyze_preview(BV,home,storyboard=True,max_frames=24,
                enabled=False,return_frames=True,network_budget_bytes=100)
        self.assertFalse(result['ok'])
        self.assertNotIn('frames',result)

if __name__=='__main__':unittest.main()
