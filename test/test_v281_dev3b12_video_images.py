"""Real JPEG debugger receipts are bounded; no image bytes enter Life context."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from io import BytesIO
from PIL import Image
LIB=Path(__file__).resolve().parents[1]/'lib'
sys.path.insert(0,str(LIB))
import preview_vision as pv
import adaptive_video as av
BV='BV1234567890'

def jpeg(color, width=384, height=216):
    buf=BytesIO(); Image.new('RGB',(width,height),color).save(buf,format='JPEG');return buf.getvalue()

class CaptureTests(unittest.TestCase):
    def test_bound_authenticated_image_receipt_and_no_raw_bytes_in_json(self):
        with tempfile.TemporaryDirectory() as home:
            img=jpeg('blue',768,384)
            def source(*args,**kwargs):
                return {'ok':True,'bvid':BV,'status':'frames_ready',
                    'image_source':'B站公开视频片段（离线解码）',
                    'times':[1.,3.],'sampling':{'sampler_version':6},
                    'frames':[{'second':1,'bytes':img,'tile_times':[1.,3.]}],
                    'debug_moments':[], 'focus_window':None}
            with patch.object(av,'acquire_adaptive_frames',side_effect=source), patch.object(pv,'_call_local_ollama',return_value='清晰看到蓝色画面'):
                result=pv.analyze_perception(BV,home,perception_source='adaptive',enabled=True,provider='ollama',model='qwen3.5:4b')
            receipt=result['debugCapture']
            self.assertEqual(len(receipt['images']),1)
            self.assertEqual(receipt['kind'],'storyboard')
            self.assertEqual(receipt['images'][0]['times'],[1.,3.])
            folder=Path(home)/'vision-perception-captures'/receipt['id']
            self.assertEqual((folder/'storyboard-01.jpg').read_bytes(),img)
            self.assertNotIn('bytes',json.dumps(receipt))
            self.assertNotIn('data:image',json.dumps(result))
            with patch.object(av,'acquire_adaptive_frames',side_effect=AssertionError('cached')):
                cached=pv.analyze_perception(BV,home,perception_source='adaptive',enabled=True,provider='ollama',model='qwen3.5:4b')
            self.assertEqual(cached['debugCapture']['id'],receipt['id'])
    def test_focus_capture_records_each_actual_384_pixel_source_jpeg(self):
        with tempfile.TemporaryDirectory() as home:
            pics=[{'second':17.,'bytes':jpeg('red')},{'second':19.,'bytes':jpeg('green')}]
            def source(*args,**kwargs):
                return {'ok':True,'bvid':BV,'status':'frames_ready',
                    'image_source':'B站公开视频片段（离线解码）',
                    'times':[17.,19.],'sampling':{'sampler_version':6},
                    'frames':[{'second':17,'bytes':jpeg('gray',768,384),'tile_times':[17.,19.]}],
                    'debug_moments':pics,'focus_window':{'startSeconds':16.,'endSeconds':20.}}
            with patch.object(av,'acquire_adaptive_frames',side_effect=source), patch.object(pv,'_call_local_ollama',return_value='可见活动画面'):
                r=pv.analyze_perception(BV,home,perception_source='adaptive',enabled=True,provider='ollama',model='qwen3.5:4b',focus_start=16,focus_end=20)
            receipt=r['debugCapture'];folder=Path(home)/'vision-perception-captures'/receipt['id']
            self.assertEqual(receipt['kind'],'focus')
            self.assertEqual(len(receipt['images']),3)
            self.assertEqual(receipt['images'][0]['file'],'focus-00.jpg')
            self.assertEqual(receipt['images'][0]['times'],[17.,19.])
            self.assertEqual((folder/'focus-00.jpg').read_bytes(),jpeg('gray',768,384))
            self.assertEqual((folder/'focus-01.jpg').read_bytes(),pics[0]['bytes'])
            self.assertEqual((folder/'focus-02.jpg').read_bytes(),pics[1]['bytes'])
            self.assertNotIn('debug_moments',r)
    def test_focus_gallery_shows_one_true_storyboard_and_twelve_distinct_real_frames(self):
        with tempfile.TemporaryDirectory() as home:
            seconds=[42.0+i for i in range(12)]
            stitched={'second':42.0,'bytes':jpeg('gray',768,384),'tile_times':seconds}
            originals=[{'second':t,'bytes':jpeg((i*17%256,40,120))} for i,t in enumerate(seconds)]
            receipt=pv._capture_actual_video_images(home,BV,[stitched],originals,
                {'startSeconds':41.5,'endSeconds':56.5},'B站公开视频片段（离线解码）')
            self.assertEqual(len(receipt['images']),13)
            self.assertEqual(receipt['images'][0]['file'],'focus-00.jpg')
            self.assertEqual(receipt['images'][0]['times'],seconds)
            self.assertEqual(receipt['images'][-1]['file'],'focus-12.jpg')
            self.assertEqual(receipt['images'][-1]['times'],[53.0])
            root=Path(home)/'vision-perception-captures'/receipt['id']
            self.assertEqual((root/'focus-00.jpg').read_bytes(),stitched['bytes'])
            self.assertEqual((root/'focus-12.jpg').read_bytes(),originals[-1]['bytes'])
            self.assertNotIn('bytes',json.dumps(receipt))
    def test_invalid_identity_or_source_is_not_persisted(self):
        with tempfile.TemporaryDirectory() as home:
            self.assertIsNone(pv._capture_actual_video_images(home,'/etc/passwd',[],[],None,'B站公开视频片段（离线解码）'))
            self.assertIsNone(pv._capture_actual_video_images(home,BV,[{'bytes':jpeg('red')}],[],None,'B站低清预览'))
            self.assertFalse((Path(home)/'vision-perception-captures').exists())

if __name__=='__main__':unittest.main()
