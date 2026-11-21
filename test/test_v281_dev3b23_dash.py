"""Offline signed DASH SIDX -> 206 -> local segment decoding and failure-reason tests."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'lib'))
import adaptive_video as av
import preview_vision as pv
import vision_dsh as vd

BV='BV1234567890'
URL='https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/mock/video.m4s'

class Response:
    status=206
    url=URL
    def __init__(self,payload,a,b,*,bad='',etag='"same"'):
        self.status=200 if bad=='200' else 206
        self.body=payload[a:b+1] if self.status==206 else payload
        self.offset=0
        total=len(payload)+(2 if bad=='identity' else 0)
        self.headers={'Content-Range':f'bytes {a}-{b}/{total}',
                      'Content-Length':str(len(self.body)), 'ETag':etag}
    def read(self,n):
        result=self.body[self.offset:self.offset+n];self.offset+=len(result);return result
    def __enter__(self):return self
    def __exit__(self,*args):pass
class Opener:
    def __init__(self,payload,*,bad='',etag_change=False):
        self.data=payload;self.calls=[];self.bad=bad;self.etag_change=etag_change
    def open(self,req,timeout):
        assert timeout<=8
        assert req.full_url==URL
        assert 'Cookie' not in req.headers and 'Authorization' not in req.headers
        a,b=map(int,req.headers['Range'].removeprefix('bytes=').split('-'))
        self.calls.append((a,b))
        return Response(self.data,a,b,bad=('identity' if self.bad=='identity' and len(self.calls)>1 else self.bad if self.bad!='identity' else ''),etag='"changed"' if self.etag_change and len(self.calls)>1 else '"same"')

@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'requires local ffmpeg')
class EndToEndDash(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir=tempfile.TemporaryDirectory()
        filename=Path(cls.dir.name)/'fixture.m4s'
        subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','lavfi',
            '-i','testsrc2=size=160x90:rate=12:duration=160','-an','-c:v','mpeg4',
            '-b:v','400k','-g','24','-movflags','+dash+global_sidx+frag_keyframe+empty_moov',
            '-frag_duration','2000000','-f','mp4',str(filename)],check=True,timeout=45)
        cls.data=filename.read_bytes()
        start=cls.data.index(b'sidx')-4
        end=start+int.from_bytes(cls.data[start:start+4],'big')-1
        cls.source={'kind':'dash','url':URL,'initial':(0,start-1),'index':(start,end),'duration':160,'cid':11}
    @classmethod
    def tearDownClass(cls):cls.dir.cleanup()

    def test_four_time_ranges_decode_real_frames_not_full_download(self):
        opener=Opener(self.data)
        with tempfile.TemporaryDirectory() as tmp,patch.object(av.request,'build_opener',return_value=opener):
            jobs,downloaded,_,size=av._download_dash_samples(self.source,tmp,[(3,6),(13,16),(23,26),(33,36)],None,1_048_576)
            self.assertEqual(len(jobs),4)
            self.assertLess(downloaded,len(self.data))
            self.assertEqual(size,len(self.data))
            self.assertFalse(any(a==0 and b==len(self.data)-1 for a,b in opener.calls))
            for filename,start,length,offset in jobs:
                self.assertGreaterEqual(len(av._decode_samples(filename,start=offset,length=length)),2)
                self.assertTrue(0<=start<=160)
    def test_adaptive_video_returns_real_storyboard_and_six_windows(self):
        opener=Opener(self.data)
        with patch.object(av,'_playurl',return_value=self.source),patch('video_heat_signal.obtain_heat_signal',return_value=None),patch.object(av.request,'build_opener',return_value=opener):
            result=av.acquire_adaptive_frames(BV,max_frames=24,depth='deep',network_budget_bytes=1_048_576)
        self.assertTrue(result['ok'])
        sample=result['sampling']
        self.assertEqual(sample['sampler_version'],av.SAMPLER_VERSION)
        self.assertEqual(sample['source_type'],'bili-public-playurl-dash')
        self.assertEqual(sample['download_mode'],'indexed-dash-sidx-byte-ranges')
        self.assertLess(sample['input_bytes'],len(self.data))
        self.assertGreater(len(sample['sampled_windows']),1)
        self.assertTrue(result['times'])
    def test_focus_within_fragment_still_reports_actual_media_time(self):
        opener=Opener(self.data)
        focus={'startSeconds':15.2,'endSeconds':24.4}
        with tempfile.TemporaryDirectory() as tmp,patch.object(av.request,'build_opener',return_value=opener):
            jobs,_,_,_=av._download_dash_samples(self.source,tmp,[(15.2,24.4)],focus,1_048_576)
            self.assertTrue(jobs)
            for filename,start,length,offset in jobs:
                self.assertGreaterEqual(start,focus['startSeconds'])
                self.assertLessEqual(start+length,focus['endSeconds']+.01)
                self.assertTrue(av._decode_samples(filename,start=offset,length=length))
    def test_200_identity_and_etag_change_fail_closed_without_full_download(self):
        for kind in ('200','identity','etag'):
            opener=Opener(self.data,bad=kind if kind!='etag' else '',etag_change=kind=='etag')
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as tmp,patch.object(av.request,'build_opener',return_value=opener):
                with self.assertRaises(av.AdaptiveUnavailable) as caught:
                    av._download_dash_samples(self.source,tmp,[(3,5)],None,1_048_576)
                self.assertFalse(caught.exception.fallback)
                self.assertLess(sum(b-a+1 for a,b in opener.calls),len(self.data))
    def test_budget_cannot_partially_fetch_fragment(self):
        opener=Opener(self.data)
        with tempfile.TemporaryDirectory() as tmp,patch.object(av.request,'build_opener',return_value=opener):
            with self.assertRaisesRegex(av.AdaptiveUnavailable,'dash_segment_budget_insufficient') as caught:
                av._download_dash_samples(self.source,tmp,[(5,8),(15,18)],None,20000)
            self.assertFalse(caught.exception.fallback)
            self.assertLess(sum(b-a+1 for a,b in opener.calls),20000)

class MetadataAndSafety(unittest.TestCase):
    def test_dash_selected_after_durl_absent(self):
        def api(url):
            if '/view?' in url:return {'bvid':BV,'pages':[{'cid':11,'duration':1800}]}
            if 'fnval=1&' in url:return {'durl':[]}
            self.assertIn('fnval=16',url)
            return {'dash':{'video':[{'bandwidth':100000,'baseUrl':URL,
                'SegmentBase':{'Initialization':'0-1000','indexRange':'1001-3000'}}]}}
        with patch.object(pv,'_json_api',side_effect=api):
            source=av._playurl(BV)
        self.assertEqual(source['kind'],'dash')
        self.assertEqual(source['duration'],1800)
    def test_long_4h_duration_is_indexable_but_not_unbounded(self):
        for seconds,valid in [(1800,True),(3600,True),(10000,True),(14401,False)]:
            def api(url):
                if '/view?' in url:return {'bvid':BV,'pages':[{'cid':11,'duration':seconds}]}
                return {'durl':[{'size':20000,'url':URL.replace('.m4s','.mp4')}]}
            with self.subTest(seconds=seconds),patch.object(pv,'_json_api',side_effect=api):
                if valid:self.assertEqual(av._playurl(BV)[2],seconds)
                else:
                    with self.assertRaisesRegex(av.AdaptiveUnavailable,'video_duration_outside_supported_range'):
                        av._playurl(BV)
    def test_allowlist_rejects_external_dash_and_invalid_ranges(self):
        with self.assertRaises(av.AdaptiveUnavailable):av._cdn_url('https://127.0.0.1/upgcxcode/foo.m4s')
        with self.assertRaises(av.AdaptiveUnavailable):av._dash_ranges({'SegmentBase':{'Initialization':'0-1000','indexRange':'1001-999999999'}})
        with self.assertRaises(av.AdaptiveUnavailable):av._dash_sidx(b'evil',0,10000)
    def test_real_failure_code_transmitted_from_proof(self):
        self.assertEqual(vd._verified_adaptive_fallback({'adaptive_fallback':{'reason':'dash_sidx_unavailable'}}),
                        {'actual_source':'videoshot','reason':'dash_sidx_unavailable'})
        self.assertEqual(vd._verified_adaptive_fallback({})['reason'],'fallback_reason_not_reported')
        self.assertEqual(vd._verified_adaptive_fallback({'adaptive_fallback':{'reason':'https://bad.example'}})['reason'],'fallback_reason_not_reported')
    def test_video_gives_precise_fallback_reason(self):
        with tempfile.TemporaryDirectory() as home,patch.object(av,'acquire_adaptive_frames',side_effect=av.AdaptiveUnavailable('dash_sidx_unavailable')):
            with patch.object(pv,'analyze_preview',return_value={'ok':True,'status':'frames_ready','times':[8],'image_source':'B站低清预览'}):
                r=pv.analyze_perception(BV,home,perception_source='adaptive',return_frames=True)
        self.assertEqual(r['adaptive_fallback']['reason'],'dash_sidx_unavailable')

if __name__=='__main__':unittest.main()

def test_dsh_visual_proof_transmits_real_adaptive_failure(tmp_path):
    import importlib.util
    from types import SimpleNamespace
    src=ROOT/'test'/'test_vision_dsh.py'
    spec=importlib.util.spec_from_file_location('vision_fixture_28123',src)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    env=module.configured(tmp_path)
    def runner(argv,**kwargs):
        Path(kwargs['env']['BILI_VISION_PROOF_FILE']).write_text(json.dumps({
            'bvid':BV,'times':[5.0,50.0], 'focus_window':None,
            'perception_source_requested':'adaptive','view_depth':'deep',
            'image_source':'B站低清预览',
            'adaptive_fallback':{'actual_source':'videoshot','reason':'dash_sidx_unavailable'}}),encoding='utf8')
        return SimpleNamespace(returncode=0,stdout='VISION_DESC: 低清官方预览显示一个室内场景，真实视频没有被解码。\n'.encode('utf8'),stderr=b'')
    with patch.object(pv,'_record_vision_attempt',return_value=True):
        result=vd.describe_with_dsh(BV,tmp_path,env=env,runner=runner,
            perception_source='adaptive',view_depth='deep')
    assert result['ok'] and result['image_source']=='B站低清预览'
    assert result['adaptive_fallback']['reason']=='dash_sidx_unavailable'
    assert not list((tmp_path/'vision-cache').glob('*adaptive*'))
