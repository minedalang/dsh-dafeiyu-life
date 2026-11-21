import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('pv43',ROOT/'lib'/'preview_vision.py')
pv=importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv)

class BrokenOpener:
    def __init__(self,exception):self.exception=exception
    def open(self,*args,**kwargs):raise self.exception

class OllamaFailureTests(unittest.TestCase):
    FRAME={'second':65,'tile_count':1,'bytes':b'local-image-bytes'}
    def _fail(self,error):
        with patch.object(pv.urllib.request,'build_opener',return_value=BrokenOpener(error)):
            with self.assertRaises(pv.VisionServiceError) as caught:
                pv._call_local_ollama([dict(self.FRAME)],'qwen3.5:2b')
            return caught.exception
    def test_connection_refused_is_offline_not_evidence_verification(self):
        error=self._fail(URLError(ConnectionRefusedError(111,'refused')))
        self.assertEqual(error.code,'ollama_service_offline')
        self.assertIn('未启动',str(error))
    def test_http_404_is_model_missing_not_offline(self):
        error=self._fail(HTTPError('http://127.0.0.1:11434/api/chat',404,'not found',{},None))
        self.assertEqual(error.code,'ollama_model_missing')
    def test_timeout_keeps_distinct_code(self):
        self.assertEqual(self._fail(TimeoutError('timeout')).code,'ollama_request_timeout')
    def test_other_connection_problem_keeps_safe_code(self):
        self.assertEqual(self._fail(URLError(OSError(101,'network unreachable'))).code,'ollama_connection_failed')
    def test_board_receipt_carries_bounded_machine_code(self):
        board={**self.FRAME,'tile_count':12,'tile_times':list(range(12)),
          'grid_cols':4,'grid_rows':3}
        with patch.object(pv,'_call_local_ollama',side_effect=pv.VisionServiceError('ollama_service_offline','服务未启动')):
            description,reports=pv._analyze_local_storyboards([board],'qwen3.5:2b')
        self.assertEqual(description,'')
        self.assertEqual(reports[0]['errorCode'],'ollama_service_offline')
        self.assertEqual(reports[0]['status'],'incomplete')
        self.assertNotIn('description',reports[0])

if __name__=='__main__':unittest.main()
