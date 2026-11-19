"""Offline dev.15 tests: fail-closed Bilibili source diagnostics + local ASR clocks."""
import contextlib
import ast
import asyncio
import os
import subprocess
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'lib'))
import adaptive_video as av
import preview_vision as pv
spec = importlib.util.spec_from_file_location('dev15_asr', ROOT/'lib'/'asr.py')
asr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asr)
BV='BV1234567890'

class SafeAuthorityDiagnostics(unittest.TestCase):
    def test_authority_rejection_is_specific_but_never_echoes_signed_url(self):
        cases=[
            ('https://user:pass@a.bilivideo.com/upgcxcode/a.m4s?signature=SECRET','userinfo'),
            ('https://a.bilivideo.com:443/upgcxcode/a.m4s?signature=SECRET','explicit-port'),
            ('https://a.bilivideo.com/upgcxcode/a.m4s?signature=SECRET#part','url-fragment'),
            ('https://a.bilivideo.com:invalid/upgcxcode/a.m4s?signature=SECRET','malformed-authority'),
        ]
        for url,detail in cases:
            with self.subTest(detail=detail),self.assertRaises(av.AdaptiveUnavailable) as found:
                av._cdn_url(url)
            self.assertEqual(found.exception.code,'video_source_authority_rejected')
            self.assertEqual(found.exception.authority_detail,detail)
            self.assertNotIn('SECRET',str(found.exception))
            self.assertNotIn('bilivideo.com',str(found.exception))
        self.assertEqual(av._cdn_url('https://a.bilivideo.com/upgcxcode/a.m4s?signature=SECRET'),
                         'https://a.bilivideo.com/upgcxcode/a.m4s?signature=SECRET')

    def test_rejected_durl_then_rejected_dash_reports_only_safe_dash_detail(self):
        def official(url):
            if '/view?' in url:return {'bvid':BV,'pages':[{'cid':42,'duration':1364}]}
            if 'fnval=1&' in url:return {'durl':[{'size':10000,'url':'https://evil.com/a.mp4?secret=SECRET'}]}
            return {'dash':{'video':[{'bandwidth':10000,
                'baseUrl':'https://a.bilivideo.com:443/upgcxcode/a.m4s?secret=SECRET',
                'SegmentBase':{'Initialization':'0-100','indexRange':'101-200'}}]}}
        with patch.object(pv,'_json_api',side_effect=official),\
             self.assertRaises(av.AdaptiveUnavailable) as found:
            av._playurl(BV)
        err=found.exception
        self.assertEqual(err.code,'video_source_authority_rejected')
        self.assertEqual(err.authority_detail,'explicit-port')
        self.assertEqual(err.track,'dash')
        self.assertNotIn('SECRET',str(err))

class LocalASRTimings(unittest.TestCase):
    def test_local_receipt_includes_bounded_phase_times_and_keeps_partial_coverage(self):
        class Model:
            called=[]
            def __init__(self,*args,**kwargs): pass
            def transcribe(self,src,**kwargs):
                self.called.append(src)
                def lazy():
                    yield types.SimpleNamespace(start=1.0,end=2.0,text='真实语音')
                return lazy(),{}
        with tempfile.TemporaryDirectory() as directory:
            src=Path(directory)/'whole.m4a';src.write_bytes(b'fixture')
            clips=[]
            for i in range(3):
                clip=Path(directory)/f'chunk{i}.wav';clip.write_bytes(b'1234');clips.append(str(clip))
            windows=asr._clip_windows(1364)
            samples={'duration':1364,'windows':windows,
                     'samples':[(clips[i],windows[i][0],60) for i in range(3)]}
            out=io.StringIO()
            with patch.dict(sys.modules,{'faster_whisper':types.SimpleNamespace(WhisperModel=Model)}),\
                 patch.object(asr,'fetch_audio',return_value=str(src)),\
                 patch.object(asr,'_sample_audio_windows',return_value=samples),\
                 patch.object(asr,'_TMP',directory),\
                 patch.object(sys,'argv',['asr.py',BV,'--json']),\
                 contextlib.redirect_stdout(out):
                self.assertEqual(asr.main(),0)
            data=json.loads(out.getvalue())
            self.assertEqual(data['coverage'],'representative-windows')
            self.assertEqual(Model.called,clips)
            self.assertEqual(len(data['sampleWindows']),3)
            times=data['timings']
            self.assertEqual(times['schema'],'life-asr-phase-timings/v1')
            self.assertEqual(set(times),{'schema','audioDownloadMs','modelLoadMs','clipExtractionMs',
                                        'inferenceMs','receiptMs','totalMs'})
            self.assertTrue(all(type(v) is int and v>=0 for k,v in times.items() if k!='schema'))
            self.assertLessEqual(sum(v for k,v in times.items() if k not in ('schema','totalMs')),times['totalMs']+2000)

class WrappedASRTimings(unittest.TestCase):
    def test_mcp_forwards_only_valid_numbers_from_known_schema(self):
        source=(ROOT/'vendor/bilibili-mcp/mcp_server.py').read_text(encoding='utf8')
        tree=ast.parse(source)
        needed={'_record_asr_attempt','_asr_failure_category',
                '_hidden_windows_child','bili_transcribe_safe'}
        functions=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in needed]
        self.assertEqual(len(functions),4)
        for n in functions:n.decorator_list=[]
        compiled=compile(ast.Module(body=functions,type_ignores=[]),'<mcp-dev15>','exec')
        with tempfile.TemporaryDirectory() as d:
            home=Path(d)
            interpreter=home/'.venv-asr'/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
            interpreter.parent.mkdir(parents=True)
            interpreter.write_text('fake')
            (home/'asr.py').write_text('fake')
            ns={'__builtins__':__builtins__,'_DUTY_HOME':home,'os':os,
                'asyncio':asyncio,'subprocess':subprocess,'json':json,
                '_guard':lambda x:None,'_valid_bv':lambda x:x}
            exec(compiled,ns)
            timings={'schema':'life-asr-phase-timings/v1','audioDownloadMs':240000,
                'modelLoadMs':20,'clipExtractionMs':30,'inferenceMs':1000,
                'receiptMs':1,'totalMs':241051}
            receipt={'bvid':BV,'source':'local-asr','asr_evidence':'faster-whisper-machine-transcript',
                     'coverage':'full-audio-attempt','text':'真实语音','timed_segments':[],
                     'timings':timings,'surprise':'SECRET'}
            def answer(*args,**kwargs):return types.SimpleNamespace(returncode=0,stdout=json.dumps(receipt),stderr='')
            with patch.dict(os.environ,{'BILI_ASR_ENABLED':'1'}),patch.object(subprocess,'run',side_effect=answer):
                result=json.loads(asyncio.run(ns['bili_transcribe_safe'](BV)))
                self.assertEqual(result['timings'],timings)
                self.assertNotIn('surprise',result)
                receipt['timings']['audioDownloadMs']='SECRET'
                invalid=json.loads(asyncio.run(ns['bili_transcribe_safe'](BV)))
                self.assertNotIn('timings',invalid)
                self.assertNotIn('SECRET',json.dumps(invalid))

if __name__ == '__main__': unittest.main()
