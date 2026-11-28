"""Offline tests for explicit Whisper timestamps and bounded real-frame OCR."""
import contextlib
import ast
import asyncio
import os
import importlib.util
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image

LIB=Path(__file__).resolve().parents[1]/'lib'
sys.path.insert(0,str(LIB))
import frame_ocr as fo
import adaptive_video as av

spec=importlib.util.spec_from_file_location('asr_dev3b2',LIB/'asr.py')
asr=importlib.util.module_from_spec(spec)
spec.loader.exec_module(asr)
BV='BV1234567890'

class TimedMediaTests(unittest.TestCase):
    def test_asr_keeps_whisper_seconds_not_inferred(self):
        parts=[types.SimpleNamespace(start=1.2,end=2.4,text=' 你好 '),
               types.SimpleNamespace(start=4.4,end=6.8,text='下一句话'),
               types.SimpleNamespace(start=None,end=99,text='无时间但有正文')]
        result=asr._asr_receipt(BV,iter(parts))
        self.assertEqual(result['source'],'local-asr')
        self.assertEqual(result['timed_segments'],[
            {'startSeconds':1.2,'endSeconds':2.4,'text':'你好'},
            {'startSeconds':4.4,'endSeconds':6.8,'text':'下一句话'}])
        self.assertIn('无时间但有正文',result['text'])
        self.assertFalse(result['can_claim_audio_listened'])

    def test_asr_json_entrypoint_with_fake_whisper_never_claims_listening(self):
        class FakeModel:
            def __init__(self,*_args,**_kw):pass
            def transcribe(self,*_args,**_kw):
                return iter([types.SimpleNamespace(start=3.25,end=4.75,text=' 识别到声音 ')]),{}
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'audio.wav';path.write_bytes(b'1234')
            fake=types.SimpleNamespace(WhisperModel=FakeModel)
            stdout=io.StringIO()
            with patch.dict(sys.modules,{'faster_whisper':fake}),\
                 patch.object(asr,'fetch_audio',return_value=str(path)),\
                 patch.object(asr,'_TMP',folder),\
                 patch.object(sys,'argv',['asr.py',BV,'--json']),\
                 contextlib.redirect_stdout(stdout):
                self.assertEqual(asr.main(),0)
            content=json.loads(stdout.getvalue())
            self.assertEqual(content['bvid'],BV)
            self.assertEqual(content['timed_segments'][0]['startSeconds'],3.25)
            self.assertFalse(content['can_claim_audio_listened'])
            with patch.object(sys,'argv',['asr.py','https://example.com/audio','--json']):
                self.assertEqual(asr.main(),2)

    def test_mcp_asr_guard_keeps_only_structured_matching_bv(self):
        source=Path(__file__).resolve().parents[1]/'vendor/bilibili-mcp/mcp_server.py'
        tree=ast.parse(source.read_text(encoding='utf8'))
        fn=next(node for node in tree.body if isinstance(node,ast.AsyncFunctionDef) and node.name=='bili_transcribe_safe')
        fn.decorator_list=[]
        helpers=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in {'_asr_failure_category','_hidden_windows_child'}]
        script=compile(ast.fix_missing_locations(ast.Module(body=[*helpers,fn],type_ignores=[])),str(source),'exec')
        with tempfile.TemporaryDirectory() as folder:
            home=Path(folder);(home/'asr.py').write_text('# fake asr')
            runtime=home/'.venv-asr'/('Scripts' if os.name=='nt' else 'bin')
            runtime.mkdir(parents=True)
            (runtime/('python.exe' if os.name=='nt' else 'python')).write_text('# fake python')
            scope={'_guard':lambda _:None,'_valid_bv':lambda value:value,
                   '_DUTY_HOME':home,'asyncio':asyncio,'subprocess':__import__('subprocess'),
                   'os':os,'json':json,'_record_asr_attempt':lambda *args,**kwargs:None}
            exec(script,scope)
            expected={'bvid':BV,'source':'local-asr','asr_evidence':'faster-whisper-machine-transcript',
                      'text':'这句有起止时间','timed_segments':[{'startSeconds':1,'endSeconds':2,'text':'这句有起止时间'}]}
            class Result:
                returncode=0
                stdout=json.dumps(expected,ensure_ascii=False)
                stderr='private token=do not reveal'
            env={'BILI_ASR_ENABLED':'1'}
            calls=[]
            async def fake_worker(argv,*,cwd,timeout_seconds):
                calls.append(argv)
                return Result(),{'schema':'life-asr-mcp-worker-timings/v1',
                    'spawnMs':1,'childAndPipeMs':2,'totalMs':3}
            scope['_run_bounded_asr_process']=fake_worker
            with patch.dict(os.environ,env):
                result=json.loads(asyncio.run(scope['bili_transcribe_safe'](BV)))
            self.assertEqual(result['timed_segments'][0]['startSeconds'],1)
            self.assertFalse(result['can_claim_audio_listened'])
            self.assertEqual(calls[-1][-3:],['--json','--model','small'])
            expected['bvid']='BV0000000000'
            Result.stdout=json.dumps(expected)
            with patch.dict(os.environ,env):
                denied=json.loads(asyncio.run(scope['bili_transcribe_safe'](BV)))
            self.assertFalse(denied['ok'])
            self.assertNotIn('private token',json.dumps(denied))

    def test_offline_ocr_and_audio_probe_use_detached_hidden_children(self):
        class Startup:
            dwFlags=0
            wShowWindow=1
        import subprocess
        for module in (fo,asr):
            with patch.object(module.os,'name','nt'),patch.object(subprocess,'DETACHED_PROCESS',8,create=True), \
                 patch.object(subprocess,'STARTUPINFO',Startup,create=True),patch.object(subprocess,'STARTF_USESHOWWINDOW',1,create=True):
                flags=module._hidden_windows_child()
            self.assertEqual(flags['creationflags'],8)
            self.assertEqual(flags['startupinfo'].wShowWindow,0)
            self.assertTrue(flags['startupinfo'].dwFlags&1)
        with patch.object(asr.shutil,'which',return_value='ffprobe'),patch.object(asr,'_hidden_windows_child',return_value={'creationflags':0}), \
             patch.object(asr.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout='600')) as run:
            self.assertEqual(asr._audio_duration('local.wav'),600)
            self.assertEqual(run.call_args.kwargs['stdin'],subprocess.DEVNULL)
            self.assertEqual(run.call_args.kwargs['creationflags'],0)
        with tempfile.TemporaryDirectory() as folder:
            exe=Path(folder)/'tesseract.exe';exe.write_bytes(b'x')
            def runner(command,**kwargs):
                self.assertEqual(kwargs['creationflags'],0)
                if '--list-langs' in command:
                    self.assertEqual(kwargs['stdin'],subprocess.DEVNULL)
                    return types.SimpleNamespace(returncode=0,stdout='eng',stderr='')
                self.assertIn('input',kwargs)
                return types.SimpleNamespace(returncode=0,stdout=b'')
            with patch.object(fo,'_hidden_windows_child',return_value={'creationflags':0}) as hide:
                out=fo.extract_frame_ocr([{'second':1.,'image':Image.new('RGB',(16,8))}],executable=str(exe),runner=runner)
            self.assertEqual(out['attempted'],1)
            self.assertEqual(hide.call_count,2)

    def test_ocr_requires_actual_local_executable_and_confident_text(self):
        images=[{'second':float(i),'image':Image.new('RGB',(16,8),'white')} for i in range(48)]
        self.assertEqual(fo.extract_frame_ocr(images,executable='/untrusted/not-here')['segments'],[])
        tsv='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
        tsv+='5\t1\t1\t1\t1\t1\t1\t1\t5\t5\t94.0\t测试\n'
        tsv+='5\t1\t1\t1\t1\t2\t2\t1\t5\t5\t90.0\t画面\n'
        tsv+='5\t1\t1\t1\t2\t1\t2\t1\t5\t5\t12.0\t噪声\n'
        calls=[]
        def runner(command,**kwargs):
            calls.append(command)
            return types.SimpleNamespace(returncode=0,stdout=tsv)
        with tempfile.TemporaryDirectory() as folder:
            exe=Path(folder)/'tesseract.exe';exe.write_bytes(b'placeholder')
            result=fo.extract_frame_ocr(images,executable=str(exe),languages='chi_sim',runner=runner)
        self.assertEqual(result['engine'],'tesseract-cli')
        self.assertEqual(result['attempted'],12)
        self.assertEqual(len(result['segments']),12)
        self.assertEqual(result['segments'][0]['text'],'测试 画面')
        self.assertEqual(result['segments'][-1]['atSeconds'],47.)
        self.assertEqual(len(calls),12)
        self.assertTrue(all('--psm' in cmd and 'tsv' in cmd for cmd in calls))
        self.assertLessEqual(len(result['segments']),fo.MAX_OCR_FRAMES)

    def test_focus_window_validation_uses_focus_values_not_unbound_windows(self):
        with patch.object(av.shutil,'which',return_value='/usr/bin/ffmpeg'),\
             patch.object(av,'_playurl',return_value=('https://a.bilivideo.com/upgcxcode/a.mp4',1024,100,1)),\
             patch.object(av,'_download_video',return_value=1024),\
             patch.object(av,'_decode_samples',return_value=[Image.new('RGB',(192,108),'red')]*12),\
             patch.object(fo,'extract_frame_ocr',return_value={'engine':'unavailable','segments':[],'attempted':0}),\
             patch('video_heat_signal.obtain_heat_signal',return_value=None):
            result=av.acquire_adaptive_frames(BV,max_frames=24,focus={'startSeconds':20.,'endSeconds':26.},depth='deep')
            self.assertEqual(result['sampling']['sampled_windows'],[{'startSeconds':20.,'endSeconds':26.}])
            with self.assertRaisesRegex(av.AdaptiveUnavailable,'window_outside_video'):
                av.acquire_adaptive_frames(BV,max_frames=24,focus={'startSeconds':99.,'endSeconds':110.},depth='deep')

if __name__=='__main__': unittest.main()
