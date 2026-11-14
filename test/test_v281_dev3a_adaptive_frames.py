"""Offline dev.3a: bounded, low-quality official preview thumbnail selection."""
import importlib.util
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import json
import unittest
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('preview',ROOT/'lib'/'preview_vision.py')
pv=importlib.util.module_from_spec(spec);spec.loader.exec_module(pv)

class AdaptivePreviewTests(unittest.TestCase):
    def test_candidates_only_come_from_primary_sprite_sheets(self):
        times=list(range(0,120,5))
        primary=[2,12,21]  # three distinct 8-frame sheets
        result=pv._candidate_indices_from_primary(primary,times,8,limit=12)
        self.assertLessEqual(len(result),12)
        self.assertTrue(set(primary).issubset(result))
        self.assertTrue(all(any(i//8==p//8 for p in primary) for i in result))

    def test_identical_thumbnails_do_not_create_fake_scene_diversity(self):
        candidates=[{'index':i,'second':i*10.,'tile':Image.new('RGB',(160,90),'#153456')} for i in range(8)]
        chosen=pv._select_distinct_previews(candidates,[1,3,5],3)
        self.assertEqual(len(chosen),1)
        self.assertEqual(chosen[0]['index'],1)

    def test_actual_color_differences_are_selected_in_chronological_order(self):
        colors=['red','red','red','green','green','blue','blue','blue']
        candidates=[{'index':i,'second':i*10.,'tile':Image.new('RGB',(160,90),c)} for i,c in enumerate(colors)]
        chosen=pv._select_distinct_previews(candidates,[0,2,5],3)
        self.assertEqual(len(chosen),3)
        self.assertEqual([v['second'] for v in chosen],sorted(v['second'] for v in chosen))
        self.assertEqual({v['tile'].getpixel((0,0)) for v in chosen},
                         {(255,0,0),(0,128,0),(0,0,255)})

    def test_video_preview_uses_only_bilibili_sprites_and_no_extra_network(self):
        def build_sheet(colors):
            im=Image.new('RGB',(160*4,90),'white')
            for i,c in enumerate(colors):im.paste(c,(i*160,0,(i+1)*160,90))
            buf=BytesIO();im.save(buf,format='JPEG');return buf.getvalue()
        sprites={'/a.jpg':build_sheet(['red','red','red','red']),
                 '/b.jpg':build_sheet(['blue','blue','blue','blue'])}
        fetched=[]
        def api(url):
            if '/view?' in url:return {'cid':1234}
            if '/videoshot?' in url:return {'image':['//i0.hdslb.com/bfs/videoshot/a.jpg','//i0.hdslb.com/bfs/videoshot/b.jpg'],
              'index':[0,0,10,20,30,40,50,60,70], 'img_x_len':4,'img_y_len':1,'img_x_size':160,'img_y_size':90}
            raise AssertionError('not a whitelisted API:'+url)
        def download(url,*args,**kwargs):
            fetched.append(url)
            if '/pbp/data?' in url:return b'{}'
            for suffix,data in sprites.items():
                if url.endswith(suffix):return data
            raise AssertionError('Unexpected download:'+url)
        with TemporaryDirectory() as d,patch.object(pv,'_json_api',side_effect=api),patch.object(pv,'_safe_api_get',side_effect=download):
            r=pv.analyze_preview('BV1234567890',d,enabled=False,debug=False,return_frames=True,max_frames=3)
            self.assertTrue(r['ok'])
            self.assertEqual(r['status'],'frames_ready')
            self.assertEqual(r['sampling']['sampler_version'],2)
            self.assertLessEqual(len(r['frames']),3)
            self.assertGreaterEqual(len(r['frames']),2) # two distinct colored scenes
            self.assertEqual(len([x for x in fetched if '/videoshot/' in x]),2)
            self.assertEqual(r['sampling']['sheets_downloaded'],2)
            self.assertTrue(all(f['source_index'] in range(8) for f in r['frames']))
            self.assertEqual([f['second'] for f in r['frames']],sorted(f['second'] for f in r['frames']))
            self.assertIn('不等于原视频镜头分割',r['sampling']['note'])

    def test_cache_invalidated_if_old_sampler_version(self):
        def sheet():
            im=Image.new('RGB',(160*4,90),'blue');buf=BytesIO();im.save(buf,'JPEG');return buf.getvalue()
        def api(url):
            if '/view?' in url:return {'cid':1234}
            if '/videoshot?' in url:return {'image':['//i0.hdslb.com/bfs/videoshot/a.jpg'],
              'index':[0,0,10,20,30], 'img_x_len':4,'img_y_len':1,'img_x_size':160,'img_y_size':90}
            raise AssertionError(url)
        with TemporaryDirectory() as d:
            cache=Path(d)/'vision-cache'/'BV1234567890.json';cache.parent.mkdir()
            cache.write_text(json.dumps({'provider':'ollama','model':'qwen3.5:4b','frames_limit':2,'description':'old cached result'}))
            with patch.object(pv,'_json_api',side_effect=api),patch.object(pv,'_safe_api_get',return_value=sheet()),patch.object(pv,'_call_local_ollama',return_value='仅看到了蓝色静止背景') as model:
                newer=pv.analyze_preview('BV1234567890',d,enabled=True,debug=False,max_frames=2,provider='ollama',model='qwen3.5:4b')
                self.assertEqual(newer['status'],'analyzed')
                self.assertEqual(model.call_count,1)
                self.assertEqual(len(model.call_args[0][0]),1)
            self.assertEqual(json.loads(cache.read_text())['sampler_version'],2)
            self.assertEqual(json.loads(cache.read_text())['sampling']['frames_selected'],1)

if __name__=='__main__':unittest.main()
