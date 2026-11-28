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

    def test_incomplete_production_attempt_overwrites_old_success_but_debug_and_cache_do_not(self):
        import ast, json, os, tempfile
        tree=ast.parse((ROOT/'vendor'/'bilibili-mcp'/'mcp_server.py').read_text(encoding='utf8'))
        fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_record_production_vision_attempt')
        with tempfile.TemporaryDirectory() as d:
            home=Path(d); scope={'_DUTY_HOME':home,'os':os,'json':json}
            exec(compile(ast.Module(body=[fn],type_ignores=[]),'production-writer','exec'),scope)
            write=scope[fn.name]; target=home/'vision-production-last.json'
            write({'status':'analyzed','description':'old secret'},'independent_local','qwen3.5:4b')
            self.assertTrue(json.loads(target.read_text())['ok'])
            result={'status':'vision_incomplete','description':'private frame','visionBoardReceipts':[{'status':'incomplete','errorCode':'ollama_service_offline'}]}
            write(result,'independent_local','qwen3.5:4b'); raw=target.read_text(); row=json.loads(raw)
            self.assertFalse(row['ok']); self.assertEqual(row['errorCode'],'ollama_service_offline'); self.assertNotIn('private frame',raw)
            write({'status':'analyzed','description':'debug'},'independent_local','other',debug=True)
            write({'status':'cached','description':'cache'},'independent_local','other')
            self.assertEqual(target.read_text(),raw)

if __name__=='__main__':unittest.main()
