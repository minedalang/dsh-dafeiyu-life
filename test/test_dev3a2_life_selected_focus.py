import importlib.util
import json
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from PIL import Image

import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('pv', ROOT/'lib'/'preview_vision.py')
pv=importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv)
BV='BV1234567890'

class FocusedPreviewTest(unittest.TestCase):
    def test_window_rejects_malformed_values_without_network(self):
        for a,b in [(30,30),(1,3),(-1,5),(0,180),(float('nan'),30),('12',20),(0,None)]:
            with patch.object(pv,'_json_api',side_effect=AssertionError('no network')):
                result=pv.analyze_preview(BV,'/tmp',enabled=False,return_frames=True,focus_start=a,focus_end=b)
            self.assertFalse(result['ok'])
            self.assertEqual(result['status'],'invalid_focus_window')

    def test_only_official_frames_within_window_and_isolated_cache(self):
        colors=['red','green','blue','yellow','orange','purple','cyan','magenta']
        sprite=Image.new('RGB',(160*8,90),'white')
        for i,color in enumerate(colors):sprite.paste(color,(i*160,0,(i+1)*160,90))
        buf=BytesIO();sprite.save(buf,format='JPEG')
        def json_api(url):
            if '/view?' in url:return {'cid':42}
            if '/videoshot?' in url:return {'image':['//i0.hdslb.com/bfs/videoshot/example.jpg'],
                'index':[0,0,10,20,30,40,50,60,70],
                'img_x_len':8,'img_y_len':1,'img_x_size':160,'img_y_size':90}
            raise AssertionError(url)
        def get(url,*a,**k):
            if 'pbp/data' in url:return b'{}'
            return buf.getvalue()
        with TemporaryDirectory() as home,patch.object(pv,'_json_api',side_effect=json_api),patch.object(pv,'_safe_api_get',side_effect=get):
            frame=pv.analyze_preview(BV,home,enabled=False,return_frames=True,max_frames=3,
                focus_start=21,focus_end=51)
            self.assertTrue(frame['ok'])
            self.assertEqual(frame['status'],'frames_ready')
            self.assertEqual(frame['focus_window'],{'startSeconds':21.0,'endSeconds':51.0})
            self.assertTrue(all(21<=t<=51 for t in frame['times']))
            self.assertEqual(frame['sampling']['sampler_version'],3)
            with patch.object(pv,'_call_local_ollama',return_value='官方播放器的局部低清预览画面，仅可确认采样片段') as mdl:
                analysed=pv.analyze_preview(BV,home,enabled=True,provider='ollama',model='qwen3.5:4b',
                    focus_start=21,focus_end=51)
                self.assertEqual(analysed['status'],'analyzed')
                self.assertTrue(all(21<=f['second']<=51 for f in mdl.call_args.args[0]))
                full=pv.analyze_preview(BV,home,enabled=True,provider='ollama',model='qwen3.5:4b')
                self.assertEqual(full['status'],'analyzed')
                self.assertEqual(mdl.call_count,2)
            self.assertEqual(pv.analyze_preview(BV,home,enabled=True,provider='ollama',model='qwen3.5:4b',
                focus_start=21,focus_end=51)['status'],'cached')
            self.assertEqual(len(list((Path(home)/'vision-cache').glob('*.json'))),2)
            self.assertEqual(pv.analyze_preview(BV,home,enabled=False,return_frames=True,
                focus_start=71,focus_end=80)['ok'],False)

if __name__=='__main__':unittest.main()
