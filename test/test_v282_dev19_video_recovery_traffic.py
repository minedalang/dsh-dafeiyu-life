"""dev.19: transfer deadline, same-video recovery, shared bytes, privacy ledger."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'lib'))
import adaptive_video as av
import preview_vision as pv
from video_traffic import traffic_scope, count_bytes, original_bytes, summary

BV='BV1Nxs26uE46'
URL='https://video.example.net/test.mp4'
MB=1024*1024

class VideoRecoveryTrafficTests(unittest.TestCase):
    def run_task(self, *, full, sparse, dash=None, size=48*MB):
        from PIL import Image
        calls=[]
        def playurl(bvid, **kwargs):
            calls.append(('playurl',kwargs))
            if kwargs.get('force_dash'):
                self.assertEqual(kwargs['expected_cid'],101)
                return {'kind':'dash','url':'https://video.example.net/test.m4s',
                        'duration':1364,'cid':101,'track_selection':'lowest-bandwidth'}
            return URL,size,1364,101
        def fake_full(url, path, expected_size, **kwargs):
            calls.append(('full', kwargs['budget']))
            return full(url,path,expected_size,**kwargs)
        def fake_sparse(url, filename, expected_size, windows, budget, **kwargs):
            calls.append(('mp4-range',budget))
            return sparse(url, filename, expected_size, windows, budget, **kwargs)
        def fake_dash(source,folder,windows,focus,budget,**kwargs):
            calls.append(('dash',budget))
            if dash: return dash(source,folder,windows,focus,budget,**kwargs)
            raise AssertionError('unexpected DASH')
        with patch.object(av,'_ffmpeg_binary',return_value='ffmpeg'), \
             patch.object(av,'_playurl',side_effect=playurl), \
             patch.object(av,'_download_video',side_effect=fake_full), \
             patch.object(av,'_download_sparse_mp4',side_effect=fake_sparse), \
             patch.object(av,'_download_dash_samples',side_effect=fake_dash), \
             patch.object(av,'_decode_samples',return_value=[Image.new('RGB',(192,108),'gray')]), \
             patch.object(av,'_scene_candidates',return_value=([{'second':3.0,'image':Image.new('RGB',(192,108),'gray')}],{})), \
             patch('video_heat_signal.obtain_heat_signal',return_value=None), \
             patch('frame_ocr.extract_frame_ocr',return_value={'engine':'unavailable','attempted':0,'segments':[]}):
            receipt=av.acquire_adaptive_frames(BV,max_frames=24,depth='deep')
        return receipt, calls

    def test_full_download_timeout_continues_to_mp4_range_without_resetting_budget(self):
        def full(*a,**kw):
            count_bytes('original',20*MB)
            raise av.AdaptiveUnavailable('video_download_timeout')
        def sparse(url,path,size,windows,budget,**kw):
            self.assertEqual(budget,30*MB)
            count_bytes('original',5*MB)
            return 5*MB, windows, 6
        receipt,calls=self.run_task(full=full,sparse=sparse)
        self.assertEqual(receipt['sampling']['download_mode'],'indexed-mp4-byte-ranges')
        self.assertEqual(receipt['sampling']['input_bytes'],25*MB)
        self.assertEqual(receipt['sampling']['source_attempts'],['durl-complete','durl-mp4-indexed'])
        self.assertNotIn('dash', [r[0] for r in calls])

    def test_range_not_supported_can_switch_to_same_video_official_dash(self):
        def full(*a,**kw):
            count_bytes('original',2*MB)
            raise av.AdaptiveUnavailable('video_download_timeout')
        def sparse(*a,**kw):
            count_bytes('original',3*MB)
            raise av.AdaptiveUnavailable('video_range_not_supported',fallback=False)
        def dash(source,folder,windows,focus,budget,**kw):
            self.assertEqual(budget,45*MB)
            count_bytes('original',4*MB)
            return [(Path(folder)/'fragment.mp4',1.,2.,0.)],4*MB,2,120*MB
        receipt,calls=self.run_task(full=full,sparse=sparse,dash=dash)
        self.assertEqual(receipt['sampling']['source_type'],'bili-public-playurl-dash')
        self.assertEqual(receipt['sampling']['input_bytes'],9*MB)
        self.assertEqual(receipt['sampling']['source_attempts'],['durl-complete','durl-mp4-indexed','dash-indexed'])
        self.assertTrue(any(x[0]=='playurl' and x[1].get('force_dash') for x in calls))

    def test_bad_identity_or_platform_block_never_switches_track(self):
        for code in ('platform_rate_limited','video_range_identity_mismatch','video_network_budget_exhausted'):
            with self.subTest(code=code):
                def full(*a,**kw):
                    raise av.AdaptiveUnavailable('video_download_timeout')
                def sparse(*a,**kw):
                    raise av.AdaptiveUnavailable(code,fallback=False)
                with self.assertRaises(av.AdaptiveUnavailable) as caught:
                    self.run_task(full=full,sparse=sparse)
                self.assertEqual(caught.exception.code,code)

    def test_file_timeout_is_size_based_one_mib_per_second(self):
        class Response:
            status=200
            url=URL
            headers={'Content-Length':str(50*MB)}
            def __enter__(self): return self
            def __exit__(self,*x): pass
            def read(self,n):return b'x'*min(4096,n)
        class Opener:
            def open(self,*a,**kw):return Response()
        times=iter([0.0,0.0,0.0,49.99,50.1])
        with tempfile.TemporaryDirectory() as tmp, patch.object(av,'_cdn_opener',return_value=Opener()), \
             patch.object(av.time,'monotonic',side_effect=lambda:next(times)):
            with self.assertRaises(av.AdaptiveUnavailable) as caught:
                av._download_video(URL,Path(tmp)/'part.mp4',50*MB,budget=50*MB)
        self.assertEqual(caught.exception.code,'video_download_timeout')

    def test_independent_dsh_preserves_only_safe_attempt_labels(self):
        import vision_dsh as vd
        receipt=vd._verified_adaptive_fallback({'adaptive_fallback':{
            'reason':'dash_range_probe_failed',
            'attemptedStages':['durl-complete','durl-mp4-indexed','dash-indexed'],
            'previousFailure':'video_download_timeout',
            'measuredOriginalBytes':14*MB,
            'url':'https://untrusted.example.net/secret.m4s?token=never'}})
        self.assertEqual(receipt['attemptedStages'],['durl-complete','durl-mp4-indexed','dash-indexed'])
        self.assertEqual(receipt['measuredOriginalBytes'],14*MB)
        self.assertNotIn('url',receipt)
        malformed=vd._verified_adaptive_fallback({'adaptive_fallback':{
            'reason':'oops::secret','attemptedStages':['https://not.allowed'],
            'previousFailure':'x?private','measuredOriginalBytes':99999999999}})
        self.assertEqual(malformed,{'actual_source':'videoshot','reason':'fallback_reason_not_reported'})

    def test_preview_response_bytes_are_counted_from_real_read_path(self):
        class Response:
            headers={'Content-Length':'5'}
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return b'abcde'
        class Opener:
            def open(self,*args,**kwargs):return Response()
        with tempfile.TemporaryDirectory() as tmp, patch.object(pv.urllib.request,'build_opener',return_value=Opener()):
            with traffic_scope(tmp):
                self.assertEqual(pv._safe_api_get('https://api.bilibili.com/x/web-interface/view'),b'abcde')
            self.assertEqual(summary(tmp)['categories']['metadata']['totalBytes'],5)

    def test_ledger_counts_failed_downloads_and_fallback_separately(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertFalse(summary(tmp)['tracked'])
            with traffic_scope(tmp):
                count_bytes('original',2*MB)
                with traffic_scope(tmp):
                    count_bytes('preview',260000)
                    count_bytes('metadata',1500)
                self.assertEqual(original_bytes(),2*MB)
                # >1MiB flushes before task ends and can be refreshed live.
                self.assertEqual(summary(tmp)['categories']['original']['totalBytes'],2*MB)
            record=summary(tmp)
            self.assertEqual(record['totalBytes'],2*MB+260000+1500)
            self.assertEqual(record['categories']['preview']['totalBytes'],260000)
            with traffic_scope(tmp):
                count_bytes('original',MB)
                raise_marker=False
            self.assertEqual(summary(tmp)['totalBytes'],3*MB+260000+1500)

if __name__=='__main__':unittest.main()
