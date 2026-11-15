import ast
import json
import unittest
from pathlib import Path
SOURCE=(Path(__file__).resolve().parents[1]/'vendor/bilibili-mcp/mcp_server.py').read_text(encoding='utf8')
TREE=ast.parse(SOURCE)
node=next(x for x in TREE.body if isinstance(x,ast.FunctionDef) and x.name=='_asr_failure_category')
ns={}
exec(compile(ast.Module(body=[node],type_ignores=[]),'<asr-classifier>','exec'),ns)
class TestAsrReasonCodes(unittest.TestCase):
 def test_audio_error_is_not_misrepresented_as_no_speech(self):
  f=ns['_asr_failure_category']
  self.assertEqual(f('[asr] 先下音频…\nERROR: HTTP Error 403: sample file title')[0],'audio-access-denied')
  self.assertEqual(f('[asr] 先下音频…\nDownloadError: timeout')[0],'audio-network-failed')
  self.assertEqual(f('[asr] 加载模型 small\nsecret')[0],'model-load-failed')
  self.assertEqual(f('[asr] 开始转写…\nsensitive audio')[0],'inference-failed')
  for raw in ['[asr] 先下音频…\nprivate data','[asr] 开始转写…\nsecret']:
   code,hint=f(raw)
   self.assertNotIn('private',json.dumps([code,hint]));self.assertNotIn('secret',json.dumps([code,hint]))
