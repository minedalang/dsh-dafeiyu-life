"""Offline tests of real-public-video adaptive sampling and provenance fences."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from PIL import Image

LIB=Path(__file__).resolve().parents[1]/'lib'
sys.path.insert(0,str(LIB))
import adaptive_video as av
import preview_vision as pv

BV='BV1234567890'


def jpg(color):
    image=Image.new('RGB',(av.FRAME_W,av.FRAME_H),color)
    data=BytesIO();image.save(data,format='JPEG')
    return data.getvalue()


class AdaptiveTests(unittest.TestCase):
    def test_public_cdn_allowlist_rejects_ssrf_and_leaks(self):
        good='https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/12/34/video.mp4?expires=777'
        self.assertEqual(av._cdn_url(good),good)
        for url in ('http://upos-sz-mirrorcos.bilivideo.com/upgcxcode/a.mp4',
            'https://user:pass@upos-sz-mirrorcos.bilivideo.com:444/upgcxcode/a.mp4',
            'https://127.0.0.1:444/upgcxcode/a.mp4',
            'https://127.0.0.1/upgcxcode/a.mp4',
            'https://upos-sz-mirrorcos.bilivideo.com/admin/token',
            'https://user:pass@upos-sz-mirrorcos.bilivideo.com/upgcxcode/a.mp4',
            'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/../private.mp4',
            'file:///etc/passwd',
            'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/%2e%2e/secrets'):
            with self.subTest(url=url),self.assertRaises(av.AdaptiveUnavailable):
                av._cdn_url(url)

    def test_playurl_accepts_large_public_source_but_keeps_maximum_virtual_size_and_bv_match(self):
        def api(url):
            if '/view?' in url:return {'bvid':BV,'pages':[{'cid':12,'duration':60}]}
            return {'durl':[{'size':av.VIDEO_FILE_MAX+1,'url':'https://a.bilivideo.com/upgcxcode/a.mp4'}]}
        with patch.object(pv,'_json_api',side_effect=api):
            self.assertGreater(av._playurl(BV)[1],av.VIDEO_FILE_MAX)
        def too_big(url):
            if '/view?' in url:return {'bvid':BV,'pages':[{'cid':12,'duration':60}]}
            return {'durl':[{'size':av.MAX_REMOTE_SIZE+1,'url':'https://a.bilivideo.com/upgcxcode/a.mp4'}]}
        with patch.object(pv,'_json_api',side_effect=too_big):
            with self.assertRaisesRegex(av.AdaptiveUnavailable,'video_size_outside_supported_range'):
                av._playurl(BV)
        with patch.object(pv,'_json_api',return_value={'bvid':'BV0987654321'}):
            with self.assertRaisesRegex(av.AdaptiveUnavailable,'video_identity_mismatch'):
                av._playurl(BV)

    def test_no_fallback_on_platform_rate_limit(self):
        with tempfile.TemporaryDirectory() as home,patch.object(av,'acquire_adaptive_frames',side_effect=av.AdaptiveUnavailable('platform_rate_limited',fallback=False)):
            with patch.object(pv,'analyze_preview',side_effect=AssertionError('must not retry preview')):
                result=pv.analyze_perception(BV,home,perception_source='adaptive',return_frames=True)
        self.assertFalse(result['ok'])
        self.assertEqual(result['status'],'platform_rate_limited')

    def test_bounded_unavailable_uses_honest_videoshot_provenance(self):
        with tempfile.TemporaryDirectory() as home,patch.object(av,'acquire_adaptive_frames',side_effect=av.AdaptiveUnavailable('video_exceeds_24mb_limit')):
            with patch.object(pv,'analyze_preview',return_value={'ok':True,'status':'frames_ready','times':[6],
                'image_source':'B站低清预览','frames':[{'bytes':jpg('green'),'second':6}]}):
                result=pv.analyze_perception(BV,home,perception_source='adaptive',return_frames=True)
        self.assertEqual(result['image_source'],'B站低清预览')
        self.assertEqual(result['adaptive_fallback']['actual_source'],'videoshot')
        self.assertEqual(result['adaptive_fallback']['reason'],'video_exceeds_24mb_limit')
        self.assertNotIn('description',result)

    def test_adaptive_cache_only_after_real_model_receipt_and_window_isolation(self):
        focus={'startSeconds':2.,'endSeconds':8.}
        def frames(*args,**kwargs):
            return {'ok':True,'status':'frames_ready','bvid':BV,
                'image_source':'B站公开视频片段（离线解码）',
                'times':[3.,6.], 'frames':[{'bytes':jpg('red'),'second':3.},
                    {'bytes':jpg('blue'),'second':6.}],
                'sampling':{'strategy':'decoded-scene-2fps','sampler_version':4,
                    'source_type':'bili-public-playurl-durl','clip_window':focus},
                'focus_window':focus}
        with tempfile.TemporaryDirectory() as home:
            with (patch.object(av,'acquire_adaptive_frames',side_effect=frames) as acq,
                  patch.object(pv,'_call_local_ollama',return_value='画面中可见颜色变化，但不能确认声音') as model,
                  patch.object(pv,'_record_vision_attempt',return_value=True)):
                result=pv.analyze_perception(BV,home,perception_source='adaptive',enabled=True,
                    provider='ollama',model='qwen3.5:4b',focus_start=2,focus_end=8)
                self.assertEqual(result['status'],'analyzed')
                self.assertEqual(result['image_source'],'B站公开视频片段（离线解码）')
                self.assertEqual(model.call_args.kwargs['image_source'],result['image_source'])
            with patch.object(av,'acquire_adaptive_frames',side_effect=AssertionError('cached')):
                cached=pv.analyze_perception(BV,home,perception_source='adaptive',enabled=True,
                    provider='ollama',model='qwen3.5:4b',focus_start=2,focus_end=8)
                self.assertEqual(cached['status'],'cached')
            with (patch.object(av,'acquire_adaptive_frames',side_effect=av.AdaptiveUnavailable('video_size_unavailable')),
                  patch.object(pv,'analyze_preview',return_value={'ok':True,'image_source':'B站低清预览'})):
                other=pv.analyze_perception(BV,home,perception_source='adaptive',enabled=True,
                    provider='ollama',model='qwen3.5:4b',focus_start=4,focus_end=12)
                self.assertEqual(other['image_source'],'B站低清预览')

    def test_video_download_keeps_strict_byte_and_redirect_constraints(self):
        from io import BytesIO
        from urllib import request
        url='https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/a.mp4'
        class Body(BytesIO):
            status=200
            headers={'Content-Length':'2048'}
            @property
            def url(self):return url
        class Opener:
            def open(self, req, timeout):
                self_request=req
                self_timeout=timeout
                self.assert_value = (self_request, self_timeout)
                return Body(b'x'*2048)
        opener=Opener()
        with tempfile.TemporaryDirectory() as tmp,patch.object(av.request,'build_opener',return_value=opener):
            result=av._download_video(url, Path(tmp)/'public.mp4',2048)
            self.assertEqual(result,2048)
            self.assertEqual((Path(tmp)/'public.mp4').stat().st_size,2048)
            self.assertNotIn('Cookie',opener.assert_value[0].headers)
            with self.assertRaisesRegex(av.AdaptiveUnavailable,'video_size_mismatch'):
                av._download_video(url, Path(tmp)/'another.mp4',2000)
            self.assertFalse((Path(tmp)/'stolen.mp4').exists())
        self.assertEqual(request.Request(url).full_url,url)

    @unittest.skipUnless(shutil.which('ffmpeg'), 'requires locally installed ffmpeg')
    def test_real_mp4_decode_detects_scene_changes_without_network_or_audio(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)
            # 3 seconds red, 3 seconds blue, 3 seconds green at 2 fps.
            for i in range(18):
                color='red' if i<6 else ('blue' if i<12 else 'green')
                Image.new('RGB',(160,90),color).save(path/f'{i:03d}.png')
            mp4=path/'synthetic.mp4'
            subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-framerate','2',
                '-i',str(path/'%03d.png'),'-c:v','mpeg4','-qscale:v','4',str(mp4)],
                check=True,timeout=20)
            images=av._decode_samples(mp4,start=0,length=9)
            self.assertGreaterEqual(len(images),16)
            frames,meta=av._detect_scenes(images,start=0,max_selected=3)
            self.assertGreaterEqual(meta['cut_candidates'],2)
            self.assertEqual(len(frames),3)
            self.assertEqual(sorted(f['second'] for f in frames),[f['second'] for f in frames])
            self.assertNotIn('file',json.dumps(meta))

    def test_static_video_returns_one_frame(self):
        pictures=[Image.new('RGB',(192,108),'red') for _ in range(16)]
        frames,meta=av._detect_scenes(pictures,start=10,max_selected=3)
        self.assertEqual(meta['cut_candidates'],0)
        self.assertEqual(len(frames),1)

    def test_invalid_source_never_attempts_io(self):
        with tempfile.TemporaryDirectory() as home:
            r=pv.analyze_perception(BV,home,perception_source='http://private')
        self.assertFalse(r['ok']);self.assertEqual(r['status'],'invalid_source')

if __name__=='__main__':unittest.main()
