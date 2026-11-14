import importlib.util
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest
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

    def test_high_energy(self):
        self.assertEqual(pv._pick_indices([0,10,20,30,40,50,60],2,[0,0,0,1,10,0,0],10),[2,4])
        self.assertEqual(len(pv._pick_indices([0,10,20,30,40,50,60],3)),3)

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
            self.assertEqual(d['high_energy'],True)
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
