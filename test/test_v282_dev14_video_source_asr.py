"""Dev.14 offline video-source safety and bounded truthful ASR tests."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lib'))
import adaptive_video as av
import preview_vision as pv

spec = importlib.util.spec_from_file_location('dev14_asr', ROOT/'lib'/'asr.py')
asr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asr)
BV = 'BV1234567890'
CDN = 'https://a.bilivideo.com/upgcxcode/a.m4s?token=never-log'


class VideoSourceSafety(unittest.TestCase):
    def test_specific_bounded_rejections_do_not_echo_signed_urls(self):
        cases = [
            ('http://a.bilivideo.com/upgcxcode/a.mp4?secret=1', 'video_source_scheme_rejected'),
            ('https://127.0.0.1/upgcxcode/a.mp4?secret=1', 'video_source_domain_rejected'),
            ('https://a.bilivideo.com:444/upgcxcode/a.mp4?secret=1', 'video_source_authority_rejected'),
            ('https://a.bilivideo.com/other/a.mp4?secret=1', 'video_source_path_rejected'),
            ('https://a.bilivideo.com/upgcxcode/a.exe?secret=1', 'video_source_format_rejected'),
        ]
        for url, reason in cases:
            with self.subTest(reason=reason), self.assertRaises(av.AdaptiveUnavailable) as caught:
                av._cdn_url(url)
            self.assertEqual(caught.exception.code, reason)
            self.assertNotIn('secret', str(caught.exception))
        self.assertEqual(av._cdn_url(CDN), CDN)

    def test_rejected_progressive_source_tries_official_dash_only(self):
        calls = []
        def official(url):
            calls.append(url)
            if '/view?' in url:
                return {'bvid':BV,'pages':[{'cid':22,'duration':1364}]}
            if 'fnval=1&' in url:
                return {'durl':[{'size':12000,'url':'https://bad.example/private.mp4?secret=123'}]}
            if 'fnval=16' in url:
                return {'dash':{'video':[{'bandwidth':10000,'baseUrl':CDN,
                    'SegmentBase':{'Initialization':'0-100','indexRange':'101-501'}}]}}
            raise AssertionError(url)
        with patch.object(pv, '_json_api', side_effect=official), patch.object(av.request,'urlopen', side_effect=AssertionError('no download')):
            result = av._playurl(BV)
        self.assertEqual(result['kind'], 'dash')
        self.assertEqual(result['url'], CDN)
        self.assertEqual(result['duration'], 1364)
        self.assertEqual(len(calls), 3)
        self.assertTrue(all('api.bilibili.com' in url for url in calls))

    def test_dash_index_failure_not_hidden_by_previous_rejected_progressive(self):
        def official(url):
            if '/view?' in url:return {'bvid':BV,'pages':[{'cid':22,'duration':600}]}
            if 'fnval=1&' in url:return {'durl':[{'size':12000,'url':'https://evil.example/a.mp4'}]}
            return {'dash':{'video':[{'bandwidth':10000,'baseUrl':CDN,
                'SegmentBase':{}}]}}
        with patch.object(pv,'_json_api',side_effect=official):
            with self.assertRaises(av.AdaptiveUnavailable) as caught:
                av._playurl(BV)
        self.assertEqual(caught.exception.code,'dash_indexed_video_unavailable')

    def test_both_official_tracks_unsafe_stay_fallback_no_fetch(self):
        def official(url):
            if '/view?' in url: return {'bvid':BV,'pages':[{'cid':22,'duration':600}]}
            if 'fnval=1&' in url: return {'durl':[{'size':12000,'url':'https://evil.example/a.mp4'}]}
            return {'dash':{'video':[{'bandwidth':10000,'baseUrl':'https://evil.example/a.m4s',
                'SegmentBase':{'Initialization':'0-100','indexRange':'101-501'}}]}}
        with patch.object(pv,'_json_api',side_effect=official):
            with self.assertRaises(av.AdaptiveUnavailable) as caught:
                av._playurl(BV)
        self.assertEqual(caught.exception.code,'video_source_domain_rejected')
        self.assertTrue(caught.exception.fallback)


class BoundedAsr(unittest.TestCase):
    def test_22_minute_windows_are_three_nonoverlapping_60s_regions(self):
        windows = asr._clip_windows(1364)
        self.assertEqual(windows, [(0.0,60),(652.0,60),(1304.0,60)])
        self.assertEqual(asr._clip_windows(300), [])
        self.assertEqual(asr._clip_windows(900), [(0.0,60),(420.0,60),(840.0,60)])

    def test_sampling_uses_local_ffmpeg_only_and_never_full_transcribes(self):
        with tempfile.TemporaryDirectory() as tmp:
            src=Path(tmp)/'audio.m4a';src.write_bytes(b'fixture')
            commands=[]
            def execute(cmd, **kwargs):
                commands.append(cmd)
                Path(cmd[-1]).write_bytes(b'0'*1024)
                return types.SimpleNamespace(returncode=0)
            with patch.object(asr.shutil,'which',return_value='ffmpeg'),\
                 patch.object(asr,'_audio_duration',return_value=1364),\
                 patch.object(asr.subprocess,'run',side_effect=execute),\
                 patch.dict(os.environ,{'BILI_ASR_LONG_VIDEO_MODE':'sample'}):
                sampling=asr._sample_audio_windows(str(src),tmp,'test-tag')
            self.assertEqual(len(sampling['samples']),3)
            self.assertEqual(sampling['windows'],asr._clip_windows(1364))
            self.assertTrue(all('-nostdin' in cmd and '-vn' in cmd and '-ss' in cmd for cmd in commands))
            self.assertTrue(all(str(src) in cmd for cmd in commands))
            self.assertTrue(all(not any('http' in str(part) for part in cmd) for cmd in commands))

    def test_explicit_full_mode_disables_sampling(self):
        with patch.dict(os.environ,{'BILI_ASR_LONG_VIDEO_MODE':'full'}),\
             patch.object(asr,'_audio_duration',side_effect=AssertionError('not checked')):
            self.assertIsNone(asr._sample_audio_windows('audio.m4a','tmp','tag'))

    def test_sampling_metadata_preserves_absolute_source_times(self):
        parts=[types.SimpleNamespace(text=' 语音片段 ',start=3.25,end=7.5)]
        sample={'duration':1364.,'windows':asr._clip_windows(1364)}
        proof=asr._asr_receipt(BV,asr._offset_segments(parts,652.),sampling=sample)
        self.assertEqual(proof['timed_segments'][0]['startSeconds'],655.25)
        self.assertEqual(proof['coverage'],'representative-windows')
        self.assertEqual(proof['audioDurationSeconds'],1364)
        self.assertEqual(len(proof['sampleWindows']),3)
        self.assertFalse(proof['can_claim_audio_listened'])
        self.assertFalse(proof['can_claim_full_video_watched'])

    def test_main_samples_real_source_only_after_authorized_download(self):
        class FakeModel:
            read=[]
            def __init__(self,*args,**kwargs): pass
            def transcribe(self,src,**kwargs):
                self.read.append(src)
                return iter([types.SimpleNamespace(start=1.,end=2.,text='实际原声')]),{}
        with tempfile.TemporaryDirectory() as tmp:
            audio=Path(tmp)/'whole.audio';audio.write_bytes(b'full')
            clips=[]
            for i in range(3):
                clip=Path(tmp)/f'fake{i}.wav';clip.write_bytes(b'x'*1024);clips.append(str(clip))
            sampled={'duration':1364,'windows':asr._clip_windows(1364),
                     'samples':[(clips[i],asr._clip_windows(1364)[i][0],60) for i in range(3)]}
            out=io.StringIO()
            with patch.dict(sys.modules,{'faster_whisper':types.SimpleNamespace(WhisperModel=FakeModel)}),\
                patch.object(asr,'fetch_audio',return_value=str(audio)),\
                patch.object(asr,'_sample_audio_windows',return_value=sampled),\
                patch.object(asr,'_TMP',tmp),\
                patch.object(sys,'argv',['asr.py',BV,'--json']),\
                contextlib.redirect_stdout(out):
                self.assertEqual(asr.main(),0)
            receipt=json.loads(out.getvalue())
            self.assertEqual(FakeModel.read,clips)
            self.assertEqual([x['startSeconds'] for x in receipt['timed_segments']],[1,653,1305])
            self.assertEqual(receipt['coverage'],'representative-windows')


if __name__ == '__main__':
    unittest.main()
