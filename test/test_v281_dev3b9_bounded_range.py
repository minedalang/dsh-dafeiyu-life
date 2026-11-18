"""Offline no-Cookie MP4 range sampling and failure-safety regression."""
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

URL='https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/test.mp4'

class Fake206:
    status=206
    url=URL
    def __init__(self,data,a,b,code=206,headers=None):
        self.status=code
        self.payload=data[a:b+1] if code==206 else data[:2048]
        self.cursor=0
        self.headers=headers or {'Content-Range':f'bytes {a}-{b}/{len(data)}',
                                 'Content-Length':str(len(self.payload)), 'ETag':'"same-file"'}
    def read(self,n):
        x=self.payload[self.cursor:self.cursor+n];self.cursor+=len(x);return x
    def __enter__(self):return self
    def __exit__(self,*args):pass

class RangeOpener:
    def __init__(self,data,*,bad=None):self.data=data;self.calls=[];self.bad=bad
    def open(self,req,timeout):
        assert timeout<=8
        assert req.full_url==URL
        assert 'Cookie' not in req.headers
        assert 'Authorization' not in req.headers
        assert 'Range' in req.headers
        a,b=map(int,req.headers['Range'].removeprefix('bytes=').split('-'))
        self.calls.append((a,b))
        if self.bad=='200':return Fake206(self.data,a,b,code=200)
        if self.bad=='identity':
            return Fake206(self.data,a,b,headers={'Content-Range':f'bytes {a}-{b}/{len(self.data)+2}',
                'Content-Length':str(b-a+1)})
        return Fake206(self.data,a,b)

@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'requires real local ffmpeg and ffprobe')
class RealRangeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.movie=Path(cls.tmp.name)/'movie.mp4'
        subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error',
            '-f','lavfi','-i','testsrc2=size=320x180:rate=12:duration=30',
            '-c:v','mpeg4','-b:v','3M','-movflags','+faststart',str(cls.movie)],
            check=True,timeout=45)
        cls.data=cls.movie.read_bytes()
        assert len(cls.data)>2*1024*1024
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()

    def test_sparse_true_windows_without_complete_download(self):
        opener=RangeOpener(self.data)
        with tempfile.TemporaryDirectory() as directory,patch.object(av.request,'build_opener',return_value=opener):
            file=Path(directory)/'sparse.mp4'
            count,windows,range_count=av._download_sparse_mp4(URL,file,len(self.data),[(5,9),(20,24)],2*1024*1024)
            self.assertLess(count,len(self.data))
            self.assertLessEqual(count,2*1024*1024)
            self.assertGreaterEqual(range_count,2)
            self.assertEqual(len(windows),2)
            for a,b in windows:
                frames=av._decode_samples(file,start=a,length=b-a)
                self.assertGreaterEqual(len(frames),3)
            self.assertFalse(any(a==0 and b==len(self.data)-1 for a,b in opener.calls))

    def test_mp4_moov_at_tail_with_sparse_ranges(self):
        tail=Path(self.tmp.name)/'movie-tail.mp4'
        subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(self.movie),
            '-c','copy',str(tail)],check=True,timeout=20)
        payload=tail.read_bytes();opener=RangeOpener(payload)
        with tempfile.TemporaryDirectory() as directory,patch.object(av.request,'build_opener',return_value=opener):
            file=Path(directory)/'sparse.mp4'
            count,windows,_=av._download_sparse_mp4(URL,file,len(payload),[(3,6),(24,27)],2*1024*1024)
            self.assertLess(count,len(payload))
            self.assertGreaterEqual(len(av._decode_samples(file,start=windows[1][0],length=windows[1][1]-windows[1][0])),2)

    def test_range_200_and_incorrect_identity_rejected_no_unsafe_full_download(self):
        for kind,reason in [('200','video_range_not_supported'),('identity','video_range_identity_mismatch')]:
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as directory:
                opener=RangeOpener(self.data,bad=kind)
                with patch.object(av.request,'build_opener',return_value=opener):
                    with self.assertRaisesRegex(av.AdaptiveUnavailable,reason) as caught:
                        av._download_sparse_mp4(URL,Path(directory)/'sparse.mp4',len(self.data),[(5,9)],2*1024*1024)
                self.assertFalse(caught.exception.fallback)
                self.assertEqual(len(opener.calls),1)

    def test_budget_too_small_never_claims_video_playback(self):
        opener=RangeOpener(self.data)
        with tempfile.TemporaryDirectory() as directory,patch.object(av.request,'build_opener',return_value=opener):
            with self.assertRaises(av.AdaptiveUnavailable) as caught:
                av._download_sparse_mp4(URL,Path(directory)/'sparse.mp4',len(self.data),[(5,9),(20,24)],16*1024)
            self.assertFalse(caught.exception.fallback)
            self.assertLessEqual(sum(b-a+1 for a,b in opener.calls),16*1024)

class PlanTests(unittest.TestCase):
    def test_budget_is_per_video_plan_not_daily_calls(self):
        self.assertEqual(av.NETWORK_BUDGETS[12],24*1024*1024)
        self.assertEqual(av.NETWORK_BUDGETS[24],50*1024*1024)
        self.assertEqual(av.NETWORK_BUDGETS[48],100*1024*1024)
        self.assertGreater(av.MAX_REMOTE_SIZE,max(av.NETWORK_BUDGETS.values()))
    def test_playurl_no_longer_rejects_size_over_24m(self):
        from unittest.mock import patch
        import preview_vision
        def api(url):
            if '/view?' in url:return {'bvid':'BV1234567890','pages':[{'cid':123,'duration':400}]}
            self.assertIn('fnval=1',url)  # Prefer a seekable progressive MP4, not old FLV.
            return {'durl':[{'size':200*1024*1024,'url':URL}]}
        with patch.object(preview_vision,'_json_api',side_effect=api):
            result=av._playurl('BV1234567890')
        self.assertEqual(result[1],200*1024*1024)
    def test_non_range_container_reports_truth_not_lowres(self):
        with patch.object(av,'_ffmpeg_binary',return_value='ffmpeg'),patch.object(av,'_playurl',return_value=(URL.replace('.mp4','.flv'),200*1024*1024,500,1)),patch('video_heat_signal.obtain_heat_signal',return_value=None):
            with self.assertRaisesRegex(av.AdaptiveUnavailable,'video_range_container_unsupported') as caught:
                av.acquire_adaptive_frames('BV1234567890',max_frames=24,depth='deep')
            self.assertFalse(caught.exception.fallback)

if __name__=='__main__':unittest.main()
