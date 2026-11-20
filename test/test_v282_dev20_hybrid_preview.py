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
        self.assertEqual(sampler['sampler_version'],9)
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

    def test_large_scan_budget_samples_end_of_timeline_and_reports_partial(self):
        # 30 sheets x 100 tiles: the 1400-tile cap must not stop at sheet 14
        # and falsely declare the remaining half of the video unobserved.
        from PIL import Image
        from io import BytesIO
        def large_api(url):
            if '/view?' in url:return {'cid':123,'duration':3000}
            if '/videoshot?' in url:
                return {'image':[f'//i0.hdslb.com/bfs/videoshot/{i}.jpg' for i in range(30)],
                        'index':[0]+list(range(3000)), 'img_x_len':10,'img_y_len':10,
                        'img_x_size':48,'img_y_size':32}
            raise AssertionError(url)
        def download(url,**kw):
            img=Image.new('RGB',(480,320),((int(url.split('/')[-1].split('.')[0])*7)%250,20,90))
            stream=BytesIO();img.save(stream,format='JPEG');return stream.getvalue()
        with TemporaryDirectory() as home,patch.object(pv,'_json_api',side_effect=large_api),             patch.object(pv,'_safe_api_get',side_effect=download),             patch.object(heat,'obtain_preview_heat_signal',return_value=None):
            result=pv.analyze_preview(BV,home,storyboard=True,max_frames=24,
                enabled=False,return_frames=True)
        self.assertTrue(result['ok'],result)
        sampling=result['sampling']
        self.assertEqual(sampling['candidate_frames_scanned'],1400)
        self.assertEqual(sampling['source_sheets_scanned'],30)
        self.assertFalse(sampling['timeline_scan_complete'])
        self.assertEqual(sampling['scan_limited_by'],'tile-cap')
        self.assertGreater(max(result['times']),2400,'should inspect the end of the video')
        self.assertLess(min(result['times']),600,'should inspect the beginning')

    def test_json_index_over_3000_preserves_full_timeline_under_resource_caps(self):
        # 60 sheets / 6000 real timestamps: source-sheet cap selects 48 across
        # the whole video, not the first 30 or the first 3000 timestamps.
        from io import BytesIO
        def api(url):
            if '/view?' in url:return {'cid':123,'duration':6000}
            if '/videoshot?' in url:
                return {'image':[f'//i0.hdslb.com/bfs/videoshot/{i}.jpg' for i in range(60)],
                        'index':[0]+list(range(6000)), 'img_x_len':10,'img_y_len':10,
                        'img_x_size':48,'img_y_size':32}
            raise AssertionError(url)
        fetched=[]
        def download(url,**kw):
            sheet=int(url.split('/')[-1].split('.')[0]);fetched.append(sheet)
            img=Image.new('RGB',(480,320),((sheet*7)%255,20,90))
            buf=BytesIO();img.save(buf,format='JPEG');return buf.getvalue()
        with TemporaryDirectory() as home,patch.object(pv,'_json_api',side_effect=api),\
             patch.object(pv,'_safe_api_get',side_effect=download),\
             patch.object(heat,'obtain_preview_heat_signal',return_value=None):
            result=pv.analyze_preview(BV,home,storyboard=True,max_frames=24,
                                      enabled=False,return_frames=True)
        self.assertTrue(result['ok'],result)
        sampling=result['sampling']
        self.assertEqual(sampling['index_frames_available'],6000)
        self.assertEqual(sampling['source_sheets_available'],60)
        self.assertEqual(sampling['source_sheets_scanned'],48)
        self.assertEqual(sampling['candidate_frames_scanned'],1400)
        self.assertFalse(sampling['timeline_scan_complete'])
        self.assertEqual(sampling['scan_limited_by'],'tile-cap')
        self.assertLess(min(result['times']),900)
        self.assertGreater(max(result['times']),5100)
        self.assertTrue(any(i>=50 for i in fetched))
        self.assertLessEqual(len(result['frames']),2)

    def test_pvdata_binary_index_over_3000_not_truncated_to_early_timestamps(self):
        import struct
        # 40 sheets / 4000 timestamps: binary source is bigger than the old
        # 3000-entry cutoff but still fits in the safe index read bound.
        def api(url):
            if '/view?' in url:return {'cid':123,'duration':4000}
            if '/videoshot?' in url:
                return {'image':[f'//i0.hdslb.com/bfs/videoshot/{i}.jpg' for i in range(40)],
                        'pvdata':'//i0.hdslb.com/bfs/videoshot/times.bin',
                        'img_x_len':10,'img_y_len':10,'img_x_size':48,'img_y_size':32}
            raise AssertionError(url)
        index_payload=struct.pack('>'+('H'*4001),*([0]+list(range(4000))))
        index_reads=[]
        def download(url,**kw):
            if url.endswith('.bin'):
                index_reads.append(kw.get('max_bytes'))
                self.assertGreaterEqual(kw.get('max_bytes'),len(index_payload))
                return index_payload
            sheet=int(url.split('/')[-1].split('.')[0])
            img=Image.new('RGB',(480,320),((sheet*5)%255,25,90))
            buf=BytesIO();img.save(buf,format='JPEG');return buf.getvalue()
        with TemporaryDirectory() as home,patch.object(pv,'_json_api',side_effect=api),\
             patch.object(pv,'_safe_api_get',side_effect=download),\
             patch.object(heat,'obtain_preview_heat_signal',return_value=None):
            result=pv.analyze_preview(BV,home,storyboard=True,max_frames=12,
                                      enabled=False,return_frames=True)
        self.assertTrue(result['ok'],result)
        self.assertTrue(index_reads)
        self.assertEqual(result['sampling']['index_frames_available'],4000)
        self.assertEqual(result['index_source'],'pvdata_bin')
        self.assertGreater(max(result['times']),3300)
        self.assertFalse(result['sampling']['timeline_scan_complete'])


if __name__=='__main__':unittest.main()
