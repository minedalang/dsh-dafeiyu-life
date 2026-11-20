import importlib.util
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
SRC=Path(__file__).resolve().parents[1]/'lib'/'asr.py'
spec=importlib.util.spec_from_file_location('asr33',SRC)
asr=importlib.util.module_from_spec(spec)
spec.loader.exec_module(asr)
BV='BV1234567890'
class ASRCacheTests(unittest.TestCase):
    def test_auto_language_and_safely_reusable_cache(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ,{'BILI_DUTY_HOME':tmp,'BILI_ASR_LANGUAGE':'auto'}):
            receipt={'bvid':BV,'source':'local-asr','asr_evidence':'faster-whisper-machine-transcript',
              'text':'english audio','timed_segments':[{'startSeconds':1,'endSeconds':2,'text':'english audio'}],
              'coverage':'full-audio-attempt'}
            asr._write_asr_cache(BV,'small','auto',receipt)
            hit=asr._read_asr_cache(BV,'small','auto')
            self.assertEqual(hit['text'],'english audio')
            self.assertTrue(hit['cacheHit'])
            self.assertEqual(hit['timings']['inferenceMs'],0)
            self.assertIsNone(asr._read_asr_cache(BV,'base','auto'))
            self.assertIsNone(asr._read_asr_cache(BV,'small','zh'))
            self.assertIsNone(asr._read_asr_cache('../evil','small','auto'))
            cache=asr._asr_cache_file(BV,'small','auto')
            data=json.loads(cache.read_text(encoding='utf8'))
            data['createdAt']=time.time()-8*24*3600
            cache.write_text(json.dumps(data),encoding='utf8')
            self.assertIsNone(asr._read_asr_cache(BV,'small','auto'))
    def test_unknown_home_and_custom_model_cannot_reuse_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(os.environ,{'BILI_DUTY_HOME':tmp},clear=False):
                self.assertIsNotNone(asr._asr_cache_file(BV,'small','auto'))
            with patch.dict(os.environ,{'BILI_DUTY_HOME':'','BILI_ASR_MODEL_PATH':''},clear=False):
                self.assertIsNone(asr._asr_cache_file(BV,'small','auto'))
            with patch.dict(os.environ,{'BILI_DUTY_HOME':tmp,'BILI_ASR_MODEL_PATH':tmp},clear=False):
                self.assertIsNone(asr._asr_cache_file(BV,'small','auto'))
    def test_cache_symlink_and_missing_contents_rejected(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ,{'BILI_DUTY_HOME':tmp}):
            path=asr._asr_cache_file(BV,'small','auto')
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_text('{}',encoding='utf8')
            self.assertIsNone(asr._read_asr_cache(BV,'small','auto'))
            path.unlink()
            try:path.symlink_to(Path(tmp)/'unknown')
            except (OSError,NotImplementedError):return
            self.assertIsNone(asr._read_asr_cache(BV,'small','auto'))
if __name__=='__main__':unittest.main()
