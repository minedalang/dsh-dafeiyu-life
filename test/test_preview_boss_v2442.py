"""Regression: Bilibili boss.hdslb.com player preview sprite and index URLs."""
import importlib.util
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import json
import struct
import unittest
import urllib.request

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('boss_preview', ROOT / 'lib' / 'preview_vision.py')
pv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv)


class BossPreviewTests(unittest.TestCase):
    def test_accept_official_preview_sprite_and_bin_index(self):
        self.assertEqual(
            pv._image_url('//boss.hdslb.com/videoshotpvhdboss/449487050_b9f03b-0001.jpg'),
            'https://boss.hdslb.com/videoshotpvhdboss/449487050_b9f03b-0001.jpg',
        )
        self.assertEqual(
            pv._index_url('http://boss.hdslb.com/videoshotpvhdboss/449487050_b9f03b.bin'),
            'https://boss.hdslb.com/videoshotpvhdboss/449487050_b9f03b.bin',
        )
        # Preserve previous preview hosts.
        self.assertEqual(
            pv._image_url('https://bimp.hdslb.com/videoshotpvhdboss/test.jpg'),
            'https://bimp.hdslb.com/videoshotpvhdboss/test.jpg',
        )

    def test_boss_does_not_open_arbitrary_cdn_paths_or_hosts(self):
        bad = [
            'https://boss.hdslb.com/bfs/videoshot/123.jpg',
            'https://boss.hdslb.com/bfs/archive/secret.jpg',
            'https://boss.hdslb.com/xpeacha-pub/example.jpg',
            'https://boss.hdslb.com/videoshotpvhdboss/../private.jpg',
            'https://boss.hdslb.com/videoshotpvhdboss/%2e%2e/private.jpg',
            'https://boss.hdslb.com/videoshotpvhdboss/sprite.svg',
            'https://boss.hdslb.com/videoshotpvhdboss/sprite.jpg#fragment',
            'https://boss.hdslb.com:8080/videoshotpvhdboss/sprite.jpg',
            'https://boss.hdslb.com.evil.invalid/videoshotpvhdboss/sprite.jpg',
            'https://boss.hdslb.com@evil.invalid/videoshotpvhdboss/sprite.jpg',
            'https://boss.hdslb.com/videoshotpvhdboss/sprite.jpg/other',
        ]
        for url in bad:
            with self.subTest(url=url), self.assertRaises(ValueError):
                pv._image_url(url)
        with self.assertRaises(ValueError):
            pv._index_url('https://boss.hdslb.com/videoshotpvhdboss/123.jpg')
        with self.assertRaises(ValueError):
            pv._image_url('https://boss.hdslb.com/videoshotpvhdboss/123.bin')

    def test_boss_preview_end_to_end_offline(self):
        im = Image.new('RGB', (3*160, 90), 'blue')
        buffer = BytesIO(); im.save(buffer, format='JPEG')
        data = buffer.getvalue()
        def api(url):
            if '/view?' in url: return {'cid': 42}
            if '/videoshot?' in url:
                return {'image': ['//boss.hdslb.com/videoshotpvhdboss/449487050_b9f03b-0001.jpg'],
                        'pvdata': '//boss.hdslb.com/videoshotpvhdboss/449487050_b9f03b.bin',
                        'index': [], 'img_x_len':3, 'img_y_len':1,
                        'img_x_size':160, 'img_y_size':90}
            raise AssertionError(url)
        def download(url, *args, **kwargs):
            if 'pbp/data' in url: return json.dumps({'events': {'default': []}}).encode()
            if kwargs.get('index_file'):
                self.assertEqual(pv._index_url(url), 'https://boss.hdslb.com/videoshotpvhdboss/449487050_b9f03b.bin')
                return struct.pack('>HHHH', 0, 0, 10, 20)
            if kwargs.get('image'):
                self.assertEqual(pv._image_url(url), 'https://boss.hdslb.com/videoshotpvhdboss/449487050_b9f03b-0001.jpg')
                return data
            raise AssertionError((url, args, kwargs))
        with TemporaryDirectory() as tmp, patch.object(pv, '_json_api', side_effect=api), \
             patch.object(pv, '_safe_api_get', side_effect=download):
            result = pv.analyze_preview('BV17gpB68EFU', tmp, enabled=False, debug=True, max_frames=2)
            self.assertTrue(result['ok'], result)
            self.assertEqual(result['status'], 'preview_only')
            self.assertEqual(result['index_source'], 'pvdata_bin')
            # All three supplied thumbnails are identical: v2 adaptive sampler
            # intentionally sends one frame, not two duplicates.
            self.assertEqual(len(result['times']), 1)
            self.assertEqual(len(list(Path(result['debug_dir']).glob('*.jpg'))), 1)

    def test_download_checks_each_redirect(self):
        class GuardOpener:
            def __init__(self, handlers):
                self.handlers = handlers
            def open(self, req, timeout):
                redirect = next(h for h in self.handlers if isinstance(h, urllib.request.HTTPRedirectHandler))
                for url in (
                    'https://evil.invalid/videoshotpvhdboss/123.jpg',
                    'https://boss.hdslb.com/bfs/archive/123.jpg',
                    'http://boss.hdslb.com/videoshotpvhdboss/123.jpg',
                ):
                    with self_outer.assertRaises(ValueError):
                        redirect.redirect_request(req, None, 302, 'found', {}, url)
                # A valid new CDN redirect must be allowed.
                forwarded = redirect.redirect_request(req, None, 302, 'found', {},
                    'https://boss.hdslb.com/videoshotpvhdboss/123.jpg')
                self_outer.assertEqual(forwarded.full_url, 'https://boss.hdslb.com/videoshotpvhdboss/123.jpg')
                class Resp:
                    headers = {'Content-Length': '3'}
                    def __enter__(self): return self
                    def __exit__(self, *args): return False
                    def read(self, n): return b'abc'
                return Resp()
        self_outer = self
        with patch.object(pv.urllib.request, 'build_opener', side_effect=lambda *handlers: GuardOpener(handlers)):
            self.assertEqual(
                pv._safe_api_get('https://boss.hdslb.com/videoshotpvhdboss/123.jpg', image=True), b'abc'
            )

if __name__ == '__main__':
    unittest.main()
