import importlib.util
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('pv',ROOT/'lib'/'preview_vision.py')
pv=importlib.util.module_from_spec(spec);spec.loader.exec_module(pv)

class PreviewTests(unittest.TestCase):
    def test_domain_restrictions(self):
        for url in ['https://evil.invalid/sprite.jpg','http://i0.hdslb.com/x.jpg','https://i0.hdslb.com.evil.invalid/x.jpg']:
            with self.assertRaises(ValueError):pv._image_url(url)
        self.assertEqual(pv._image_url('//i0.hdslb.com/bfs/videoshot/x.jpg'),'https://i0.hdslb.com/bfs/videoshot/x.jpg')
        self.assertEqual(pv._image_url('http://i0.hdslb.com/bfs/videoshot/x.jpg'),'https://i0.hdslb.com/bfs/videoshot/x.jpg')

    def test_uniform_preview_fallback_never_reads_heat_curve(self):
        self.assertEqual(pv._pick_indices([0,10,20,30,40,50,60],2),[1,4])
        self.assertEqual(len(pv._pick_indices([0,10,20,30,40,50,60],3)),3)

    def test_cache_write_uses_unique_stage_and_preserves_legacy_temp(self):
        with TemporaryDirectory() as home:
            cache=Path(home)/'vision-cache'/'BV1234567890-preview-board-v14.json'
            cache.parent.mkdir()
            old=cache.with_suffix('.tmp')
            old.write_text('legacy temp owned by an older run',encoding='utf8')
            self.assertIsNone(pv._save_vision_cache(cache,{'model':'ollama','seq':0}))
            self.assertEqual(old.read_text(encoding='utf8'),'legacy temp owned by an older run')
            with ThreadPoolExecutor(max_workers=8) as pool:
                result=list(pool.map(lambda n:pv._save_vision_cache(cache,{'seq':n}),range(24)))
            self.assertEqual(result,[None]*24)
            self.assertIn(json.loads(cache.read_text(encoding='utf8'))['seq'],range(24))
            self.assertEqual(list(cache.parent.glob('.BV1234567890-preview-board-v14-*.tmp')),[])

    def test_adaptive_cache_permission_does_not_become_ollama_unavailable(self):
        frames=[{'second':12.,'tile_times':[12.],'bytes':b'jpeg-not-read'}]
        decoded={'ok':True,'bvid':'BV1234567890','status':'frames_ready',
                 'image_source':'B站公开视频片段（离线解码）','times':[12.],
                 'sampling':{'frame_plan':12},'frames':frames}
        with TemporaryDirectory() as home, \
             patch('adaptive_video.acquire_adaptive_frames',return_value=decoded), \
             patch.object(pv,'_capture_actual_video_images',return_value=None), \
             patch.object(pv,'_call_local_ollama',return_value='真实的本地模型回执'), \
             patch.object(pv,'_save_vision_cache',return_value='vision_cache_permission_denied'):
            result=pv._analyze_perception_impl('BV1234567890',home,
                perception_source='adaptive',enabled=True,model='qwen3.5:4b')
        self.assertTrue(result['ok'],result)
        self.assertEqual(result['status'],'analyzed')
        self.assertEqual(result['description'],'真实的本地模型回执')
        self.assertFalse(result['cacheSaved'])
        self.assertEqual(result['cacheErrorCode'],'vision_cache_permission_denied')
        self.assertNotIn('error',result)

    def test_cache_disk_full_or_invalid_record_never_leaves_temp(self):
        import errno
        with TemporaryDirectory() as home:
            cache=Path(home)/'vision-cache'/'BV1234567890.json'
            with patch.object(pv.tempfile,'NamedTemporaryFile',side_effect=OSError(errno.ENOSPC,'disk full')):
                self.assertEqual(pv._save_vision_cache(cache,{'x':1}),'vision_cache_disk_full')
            self.assertEqual(pv._save_vision_cache(cache,{'not_json':object()}),
                             'vision_cache_write_failed')
            self.assertFalse(cache.exists())
            self.assertEqual(list(cache.parent.glob('*.tmp')),[])

    def test_cache_permission_error_is_bounded_and_cleans_unique_temp(self):
        with TemporaryDirectory() as home:
            cache=Path(home)/'vision-cache'/'BV1234567890-preview-board-v14.json'
            cache.parent.mkdir()
            cache.write_text('original data',encoding='utf8')
            with patch.object(pv.os,'replace',side_effect=PermissionError(13,'Windows share or ACL denied')):
                code=pv._save_vision_cache(cache,{'description':'not persisted'})
            self.assertEqual(code,'vision_cache_permission_denied')
            self.assertEqual(cache.read_text(encoding='utf8'),'original data')
            self.assertEqual(list(cache.parent.glob('*.tmp')),[])
            answer={'ok':True,'status':'analyzed','description':'genuine visual reply'}
            pv._mark_cache_write_result(answer,code)
            self.assertTrue(answer['ok'])
            self.assertEqual(answer['status'],'analyzed')
            self.assertFalse(answer['cacheSaved'])
            self.assertNotIn(str(cache),answer['cacheWarning'])

    def test_reject_invalid_bv(self):
        self.assertFalse(pv.analyze_preview('../secrets','/tmp',enabled=True,model='foo')['ok'])

    def test_preview_debug_and_vision_and_no_key(self):
        img=Image.new('RGB',(160*4,90),'black')
        for i,col in enumerate(['red','green','blue','yellow']):
            img.paste(col,(i*160,0,(i+1)*160,90))
        buff=BytesIO();img.save(buff,format='JPEG');sheet=buff.getvalue()
        def api(url):
            if '/view?' in url:return {'cid':42}
            if '/videoshot?' in url:return {'image':['//i0.hdslb.com/bfs/videoshot/test.jpg'],'index':[0,0,10,20,30],'img_x_len':4,'img_y_len':1,'img_x_size':160,'img_y_size':90}
            raise AssertionError(url)
        def download(url,*a,**k):
            if 'pbp/data' in url:return json.dumps({'events':{'default':[1,4,8,1]},'step_sec':10}).encode()
            return sheet
        with TemporaryDirectory() as temp,patch.object(pv,'_json_api',side_effect=api),patch.object(pv,'_safe_api_get',side_effect=download):
            d=pv.analyze_preview('BV1234567890',temp,enabled=False,debug=True,max_frames=2)
            self.assertEqual(d['status'],'preview_only');self.assertEqual(len(d['times']),2)
            folder=Path(d['debug_dir']);self.assertEqual(len(list(folder.glob('*.jpg'))),2)
            self.assertNotIn('high_energy',d)
            self.assertIn('不使用旧高能预览选帧',d['sampling']['note'])
            fail=pv.analyze_preview('BV1234567890',temp,enabled=True,debug=True,max_frames=2,provider='anthropic',model='claude-haiku-4-5-20251001')
            self.assertFalse(fail['ok']); self.assertIn('提供方',fail.get('error',''))
            self.assertFalse(fail.get('description'))
            with patch.object(pv,'_call_local_ollama',return_value='画面分别为红、绿色等色块，不能确认完整视频内容') as call:
                ok=pv.analyze_preview('BV1234567890',temp,enabled=True,debug=True,max_frames=2,provider='ollama',model='qwen3.5:4b')
                self.assertEqual(ok['status'],'analyzed')
                self.assertEqual(len(call.call_args[0][0]),2)
            with patch.object(pv,'_json_api',side_effect=AssertionError('cache should be used')):
                cached=pv.analyze_preview('BV1234567890',temp,enabled=True,debug=False,max_frames=2,provider='ollama',model='qwen3.5:4b')
            self.assertEqual(cached['status'],'cached')

if __name__=='__main__':unittest.main()
