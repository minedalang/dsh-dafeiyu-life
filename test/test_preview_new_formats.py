"""Regression coverage: modern bimp sprites and pvdata BIN index."""
import importlib.util
import json
import struct
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pv_formats', ROOT / 'lib' / 'preview_vision.py')
pv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv)


class ModernPreviewTests(unittest.TestCase):
    def test_allow_modern_known_hosts_formats_only(self):
        self.assertEqual(
            pv._image_url('http://bimp.hdslb.com/videoshotpvhdboss/abc/123-0001.jpg'),
            'https://bimp.hdslb.com/videoshotpvhdboss/abc/123-0001.jpg',
        )
        self.assertEqual(pv._index_url('//bimp.hdslb.com/videoshotpvhdboss/abc/123.bin'),
                         'https://bimp.hdslb.com/videoshotpvhdboss/abc/123.bin')
        self.assertEqual(pv._index_url('http://i0.hdslb.com/bfs/videoshot/123.bin'),
                         'https://i0.hdslb.com/bfs/videoshot/123.bin')
        for bad in [
            'https://bimp.hdslb.com/bfs/archive/secret.jpg',
            'https://bimp.hdslb.com/videoshotpvhdboss/../secret.jpg',
            'https://bimp.hdslb.com/videoshotpvhdboss/%2e%2e/secret.jpg',
            'https://evil.invalid/videoshotpvhdboss/valid.jpg',
            'https://bimp.hdslb.com/videoshotpvhdboss/sheet.svg',
            'https://bimp.hdslb.com/videoshotpvhdboss/sheet.jpg#fragment',
            'https://bimp.hdslb.com:8080/videoshotpvhdboss/sheet.jpg',
        ]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                pv._image_url(bad)
        with self.assertRaises(ValueError):
            pv._index_url('https://bimp.hdslb.com/videoshotpvhdboss/sheet.jpg')

    def test_bin_index_strict(self):
        self.assertEqual(pv._decode_bin_index(struct.pack('>HHHH', 0, 0, 12, 25), 3), [0, 12, 25])
        with self.assertRaisesRegex(ValueError, '长度'):
            pv._decode_bin_index(b'\x00', 3)
        with self.assertRaisesRegex(ValueError, '长度'):
            pv._decode_bin_index(b'', 3)

    def test_bin_index_end_to_end_with_preview_only_and_debug(self):
        img = Image.new('RGB', (160 * 3, 90), 'purple')
        buffer = BytesIO(); img.save(buffer, format='JPEG')
        sprite = buffer.getvalue()
        def api(url):
            if '/view?' in url: return {'cid': 42}
            if '/videoshot?' in url: return {
                'image': ['//bimp.hdslb.com/videoshotpvhdboss/test/sheet-0001.jpg'],
                'pvdata': '//bimp.hdslb.com/videoshotpvhdboss/test/index.bin',
                'index': [], 'img_x_len': 3, 'img_y_len': 1,
                'img_x_size': 160, 'img_y_size': 90,
            }
            raise AssertionError(url)
        def download(url, *args, **kwargs):
            if 'pbp/data' in url: return json.dumps({'events':{'default':[]}}).encode()
            if kwargs.get('index_file'):
                self.assertIn('index.bin', url)
                return struct.pack('>HHHH', 0, 0, 10, 20)
            if kwargs.get('image'):
                self.assertIn('sheet-0001.jpg', url)
                return sprite
            raise AssertionError((url,args,kwargs))
        with TemporaryDirectory() as tmp, patch.object(pv, '_json_api', side_effect=api), \
             patch.object(pv, '_safe_api_get', side_effect=download):
            result = pv.analyze_preview('BV1234567890', tmp, enabled=False, debug=True, max_frames=2)
            self.assertTrue(result['ok'], result)
            self.assertEqual(result['status'], 'preview_only')
            self.assertEqual(result['index_source'], 'pvdata_bin')
            # Solid-purple thumbnails have no visual diversity; avoid duplicate input.
            self.assertEqual(len(result['times']), 1)
            debugdir = Path(result['debug_dir'])
            self.assertEqual(len(list(debugdir.glob('*.jpg'))), 1)
            self.assertEqual(result['sampling']['frames_selected'],1)
            self.assertEqual(json.loads((debugdir / 'metadata.json').read_text())['index_source'], 'pvdata_bin')

    def test_old_json_format_still_supported(self):
        img = Image.new('RGB', (160 * 2, 90), 'blue')
        buffer = BytesIO(); img.save(buffer, format='JPEG')
        def api(url):
            if '/view?' in url: return {'cid':42}
            return {'image':['//i0.hdslb.com/bfs/videoshot/123.jpg'], 'index':[0, 0, 6],
                    'img_x_len':2,'img_y_len':1,'img_x_size':160,'img_y_size':90}
        def download(url, *args, **kwargs):
            if 'pbp/data' in url: return b'{}'
            if kwargs.get('index_file'): raise AssertionError('should not need bin')
            return buffer.getvalue()
        with TemporaryDirectory() as tmp, patch.object(pv,'_json_api',side_effect=api), \
             patch.object(pv,'_safe_api_get',side_effect=download):
            result=pv.analyze_preview('BV1234567890',tmp,enabled=False,debug=True,max_frames=2)
            self.assertTrue(result['ok'],result)
            self.assertEqual(result['index_source'],'json')


if __name__=='__main__': unittest.main()
