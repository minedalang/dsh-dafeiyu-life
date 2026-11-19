"""Dev.16 offline: full ASR by default, independent child lifetime, strict HTTPS :443."""
import ast
import asyncio
import concurrent.futures
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'lib'))
import adaptive_video as av
spec=importlib.util.spec_from_file_location('dev16_asr',ROOT/'lib'/'asr.py')
asr=importlib.util.module_from_spec(spec)
spec.loader.exec_module(asr)
SRC=(ROOT/'vendor/bilibili-mcp/mcp_server.py').read_text(encoding='utf8')
tree=ast.parse(SRC)
worker=next(x for x in tree.body if isinstance(x,ast.AsyncFunctionDef) and x.name=='_run_bounded_asr_process')
ns={'__builtins__':__builtins__,'asyncio':asyncio,'subprocess':subprocess,
    '_hidden_windows_child':lambda:{}}
exec(compile(ast.Module(body=[worker],type_ignores=[]),'<worker>','exec'),ns)
run=ns['_run_bounded_asr_process']

class FullASRDefault(unittest.TestCase):
    def test_long_audio_is_not_sampled_without_opt_in(self):
        env={k:v for k,v in os.environ.items() if k!='BILI_ASR_LONG_VIDEO_MODE'}
        class Model:
            sources=[]
            def __init__(self,*args,**kwargs):pass
            def transcribe(self,src,**kwargs):
                self.sources.append(src)
                return iter([types.SimpleNamespace(start=10.0,end=20.0,text='有语音')]),{}
        with tempfile.TemporaryDirectory() as d:
            audio=Path(d)/'whole.m4a';audio.write_bytes(b'x')
            out=io.StringIO()
            with patch.dict(os.environ,env,clear=True),\
                 patch.dict(sys.modules,{'faster_whisper':types.SimpleNamespace(WhisperModel=Model)}),\
                 patch.object(asr,'fetch_audio',return_value=str(audio)),\
                 patch.object(asr,'_TMP',d),\
                 patch.object(sys,'argv',['asr.py','BV1234567890','--json']),\
                 contextlib.redirect_stdout(out):
                self.assertEqual(asr.main(),0)
            result=json.loads(out.getvalue())
            self.assertEqual(Model.sources,[str(audio)])
            self.assertEqual(result['coverage'],'full-audio-attempt')
            self.assertNotIn('sampleWindows',result)
            self.assertEqual(result['timed_segments'][0]['startSeconds'],10)
            self.assertFalse(result['can_claim_full_video_watched'])

class HTTPSPortSafety(unittest.TestCase):
    def test_explicit_standard_port_only_after_same_cdn_guards(self):
        good='https://a.bilivideo.com:443/upgcxcode/a.m4s?signed=SECRET'
        self.assertEqual(av._cdn_url(good),good)
        for url,code in [
            ('https://a.bilivideo.com:444/upgcxcode/a.m4s?secret=SECRET','video_source_authority_rejected'),
            ('https://a.bilivideo.com:80/upgcxcode/a.m4s','video_source_authority_rejected'),
            ('http://a.bilivideo.com:443/upgcxcode/a.m4s','video_source_scheme_rejected'),
            ('https://127.0.0.1:443/upgcxcode/a.m4s','video_source_domain_rejected'),
            ('https://evil.com:443/upgcxcode/a.m4s','video_source_domain_rejected'),
            ('https://user:secret@a.bilivideo.com:443/upgcxcode/a.m4s','video_source_authority_rejected'),
            ('https://a.bilivideo.com:443/other/a.m4s','video_source_path_rejected'),
            ('https://a.bilivideo.com:443/upgcxcode/a.m4s#frag','video_source_authority_rejected')]:
            with self.subTest(url=url),self.assertRaises(av.AdaptiveUnavailable) as result:
                av._cdn_url(url)
            self.assertEqual(result.exception.code,code)
            self.assertNotIn('SECRET',str(result.exception))

class IndependentWorker(unittest.IsolatedAsyncioTestCase):
    async def test_exec_does_not_queue_in_shared_default_executor(self):
        held=threading.Event()
        started=threading.Event()
        def occupy():
            started.set();held.wait(timeout=3)
        loop=asyncio.get_running_loop()
        executor=concurrent.futures.ThreadPoolExecutor(max_workers=1)
        loop.set_default_executor(executor)
        busy=loop.run_in_executor(None,occupy)
        self.assertTrue(started.wait(timeout=2))
        class Child:
            returncode=0
            async def communicate(self):return b'{"ok":true}',b'private stderr'
        async def spawn(*argv,**kwargs):return Child()
        try:
            with patch.object(asyncio,'create_subprocess_exec',spawn):
                result,timings=await asyncio.wait_for(run(['fake','--json'],cwd='.',timeout_seconds=1),.4)
            self.assertEqual(result.returncode,0)
            self.assertEqual(result.stdout,'{"ok":true}')
            self.assertIn('private',result.stderr)
            self.assertEqual(timings['schema'],'life-asr-mcp-worker-timings/v1')
            self.assertGreaterEqual(timings['totalMs'],0)
        finally:
            held.set();await busy
            executor.shutdown(wait=True)

    async def test_timeout_kills_worker_without_false_success(self):
        stopped=asyncio.Event()
        child=None
        class Child:
            returncode=None
            killed=False
            async def communicate(self):
                await stopped.wait()
                return b'',b'[asr] start\nprivate content'
            def kill(self):
                self.killed=True
                self.returncode=-9
                stopped.set()
            async def wait(self):return -9
        async def spawn(*argv,**kwargs):
            nonlocal child
            child=Child();return child
        with patch.object(asyncio,'create_subprocess_exec',spawn):
            with self.assertRaises(subprocess.TimeoutExpired):
                await run(['fake'],cwd='.',timeout_seconds=.01)
        self.assertTrue(child.killed)

if __name__=='__main__':unittest.main()
