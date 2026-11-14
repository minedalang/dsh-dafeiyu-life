import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('vision_dsh',ROOT/'lib'/'vision_dsh.py')
vision=importlib.util.module_from_spec(spec)
spec.loader.exec_module(vision)

class DshImageProbeTests(unittest.TestCase):
    def _overlay(self):
        lines=[]
        for item in vision._HEADLESS_DENY_TOOLS:lines.extend([f'- id: {item}','  disabled: true',''])
        for item in ('credentials','authorization','deepseek-account'):lines.extend([f'- id: {item}','  disabled: false',''])
        lines.extend(['- insert:','    - id: mcp-bili-vision-readonly',"      name: '@deepseek-ai/dsh-mcp-client'",'      config:','        serverName: bilivision','        transport: stdio','        env:',"          BILI_MCP_TOOLS: 'bili_vision_selftest'","          BILI_VISION_SELFTEST_ALLOWED: '1'","          BILI_VISION_TEST_ASSET: '/app/lib/assets/local-vision-selftest-dafeiyu.png'"])
        return '\n'.join(lines)+'\n'

    def test_only_allowed_tool_and_fixed_image(self):
        text=self._overlay()
        self.assertTrue(vision._validate_vision_overlay_text(text,selftest=True))
        with self.assertRaises(ValueError):vision._validate_vision_overlay_text(text.replace('bili_vision_selftest','bili_reply'),selftest=True)
        with self.assertRaises(ValueError):vision._validate_vision_overlay_text(text.replace('local-vision-selftest-dafeiyu.png','secrets.png'),selftest=True)

    def test_verified_image_receipt_required(self):
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp);patch=home/'headless-vision-selftest-overlay.yml';patch.write_text(self._overlay(),encoding='utf8')
            env={'BILI_VISION_DSH_ARGV':json.dumps(['/usr/bin/node','/app/dsh','--profile','headless','--patch',str(patch)])}
            result=vision.describe_test_image_with_dsh(home,env=env,runner=lambda *a,**kw:subprocess.CompletedProcess(a[0],0,b'VISION_TEST_RESULT: hello',b''))
            self.assertFalse(result['ok'])
            self.assertEqual(result['status'],'no_image_proof')
            def complete(argv,**kw):
                Path(kw['env']['BILI_VISION_PROOF_FILE']).write_text(json.dumps({'kind':'dafeiyu-selftest','sha256':'a041e0a1ffc95fe91c13d9acc6c48b8a37ddae15a8de910d9ee35975d0ff5c3b'}))
                return subprocess.CompletedProcess(argv,0,'VISION_TEST_RESULT: 蓝色头发，深蓝裙子，鱼尾。'.encode('utf8'),b'')
            good=vision.describe_test_image_with_dsh(home,env=env,runner=complete)
            self.assertTrue(good['ok']);self.assertIn('鱼尾',good['answer'])
            self.assertEqual(len(list((home/'vision-proof').glob('*'))),0)

if __name__=='__main__':unittest.main()
