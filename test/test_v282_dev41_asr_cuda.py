"""Deterministic CUDA/CPU fallback tests; no GPU, network or audio required."""
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
spec = importlib.util.spec_from_file_location('asr_dev41', ROOT/'lib'/'asr.py')
asr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asr)
BV = 'BV1234567890'

class TestAutoWhisperDevice(unittest.TestCase):
    def test_cuda_device_loads_float16_if_available(self):
        calls=[]
        def factory(src,**kw):
            calls.append(kw)
            return object()
        with patch.dict(os.environ, {'BILI_ASR_DEVICE':'auto'}):
            model,device,compute=asr._load_whisper_auto('tiny',factory,ctranslate2_module=types.SimpleNamespace(get_cuda_device_count=lambda:1))
        self.assertIsNotNone(model)
        self.assertEqual((device,compute),('cuda','float16'))
        self.assertEqual(calls,[{'device':'cuda','compute_type':'float16'}])

    def test_no_cuda_keeps_cpu_int8(self):
        calls=[]
        def factory(src,**kw): calls.append(kw);return object()
        model,device,compute=asr._load_whisper_auto('tiny',factory,ctranslate2_module=types.SimpleNamespace(get_cuda_device_count=lambda:0))
        self.assertEqual((device,compute),('cpu','int8'))
        self.assertEqual(calls,[{'device':'cpu','compute_type':'int8'}])

    def test_cuda_load_error_retries_cpu_without_network(self):
        calls=[]
        def factory(src,**kw):
            calls.append(kw)
            if kw['device']=='cuda':raise RuntimeError('no cublas runtime available')
            return object()
        model,device,compute=asr._load_whisper_auto('tiny',factory,ctranslate2_module=types.SimpleNamespace(get_cuda_device_count=lambda:1))
        self.assertEqual((device,compute),('cpu','int8'))
        self.assertEqual([x['device'] for x in calls],['cuda','cuda','cpu'])

    def test_low_memory_cuda_int8_fallback_without_cpu(self):
        calls=[]
        def factory(src,**kw):
            calls.append(kw)
            if kw['device']=='cuda' and kw['compute_type']=='float16':
                raise RuntimeError('insufficient GPU memory for float16')
            return object()
        model,device,compute=asr._load_whisper_auto('small',factory,ctranslate2_module=types.SimpleNamespace(get_cuda_device_count=lambda:1))
        self.assertIsNotNone(model)
        self.assertEqual((device,compute),('cuda','int8'))
        self.assertEqual([x['compute_type'] for x in calls],['float16','int8'])

    def test_cpu_operator_override_does_not_probe_gpu(self):
        def no_gpu(): raise AssertionError('do not probe cuda')
        with patch.dict(os.environ, {'BILI_ASR_DEVICE':'cpu'}):
            _,device,compute=asr._load_whisper_auto('tiny',lambda *a,**k: object(),ctranslate2_module=types.SimpleNamespace(get_cuda_device_count=no_gpu))
        self.assertEqual((device,compute),('cpu','int8'))

    def test_cuda_lazy_inference_failure_retries_cpu_and_reports_cpu(self):
        created=[]
        class Model:
            def __init__(self,source,**kwargs):
                self.device=kwargs['device'];created.append(self.device)
            def transcribe(self,src,**kwargs):
                def generator():
                    if self.device=='cuda':
                        yield types.SimpleNamespace(start=.1,end=.8,text='partial untrusted output')
                        raise RuntimeError('CUDA runtime failed during lazy inference')
                    yield types.SimpleNamespace(start=1.,end=2.,text='validated CPU retry')
                return generator(),{}
        with tempfile.TemporaryDirectory() as directory:
            src=Path(directory)/'local.audio';src.write_bytes(b'fixture')
            out=io.StringIO()
            with patch.dict(sys.modules,{'faster_whisper':types.SimpleNamespace(WhisperModel=Model),
                                         'ctranslate2':types.SimpleNamespace(get_cuda_device_count=lambda:1)}),\
                 patch.dict(os.environ,{'BILI_ASR_DEVICE':'auto','BILI_ASR_CACHE':'0'}),\
                 patch.object(asr,'_TMP',directory),\
                 patch.object(sys,'argv',['asr.py',BV,'--json']),\
                 patch.object(asr,'fetch_audio',return_value=str(src)),\
                 patch.object(asr,'_sample_audio_windows',return_value=None),\
                 patch('sys.stdout',out):
                self.assertEqual(asr.main(),0)
            receipt=json.loads(out.getvalue())
            self.assertEqual(created,['cuda','cpu'])
            self.assertEqual(receipt['text'],'validated CPU retry')
            self.assertNotIn('partial untrusted',receipt['text'])
            self.assertEqual(receipt['inferenceDevice'],'cpu')
            self.assertEqual(receipt['computeType'],'int8')

    def test_cache_does_not_claim_current_gpu_inference(self):
        with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{'BILI_DUTY_HOME':d,'BILI_ASR_MODEL_PATH':''}):
            receipt={'bvid':BV,'source':'local-asr','text':'previous recording','timed_segments':[],
                     'coverage':'full-audio-attempt','inferenceDevice':'cuda'}
            asr._write_asr_cache(BV,'tiny','auto',receipt)
            cached=asr._read_asr_cache(BV,'tiny','auto')
            self.assertEqual(cached['inferenceDevice'],'cache')
            self.assertTrue(cached['cacheHit'])

if __name__=='__main__': unittest.main()
