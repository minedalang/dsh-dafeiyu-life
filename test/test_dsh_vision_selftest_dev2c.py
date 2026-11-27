import importlib.util
import json
import subprocess
import sys
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

    def test_ephemeral_session_services_are_required_for_vision_and_selftest(self):
        expected=('session-persistence-jsonl','session-persistence-sqlite','session-query-sqlite','session-projection-cache')
        self.assertEqual(vision._HEADLESS_EPHEMERAL_SERVICES,expected)
        for selftest in (True,False):
            text=self._overlay() if selftest else self._overlay().replace('bili_vision_selftest','bili_preview_vision').replace("BILI_VISION_SELFTEST_ALLOWED: '1'","BILI_VISION_CHILD: '1'")
            self.assertTrue(vision._validate_vision_overlay_text(text,selftest=selftest))
            for ident in expected:
                row=f'- id: {ident}\n  disabled: true'
                for bad in (text.replace(row,''),text.replace(row,row.replace('true','false')),text+'\n'+row,row.replace('- id: ','- id:  ')+'\n'+text,text.replace(row,row+'\n  disabled: false')):
                    with self.assertRaisesRegex(ValueError,'临时 Session'):
                        vision._validate_vision_overlay_text(bad,selftest=selftest)

    def test_vision_selftest_refuses_to_resume_host_session(self):
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp);patch=home/'headless-vision-selftest-overlay.yml';patch.write_text(self._overlay(),encoding='utf8')
            for flag in ('--session-id=main-session','--resume'):
                env={'BILI_VISION_DSH_ARGV':json.dumps([sys.executable,'/app/dsh','--profile','headless','--patch',str(patch),flag])}
                def unexpected(*args,**kwargs):
                    self.fail('existing host Session must never be launched')
                result=vision.describe_test_image_with_dsh(home,env=env,runner=unexpected)
                self.assertFalse(result['ok'])

    def test_verified_image_receipt_required(self):
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp);patch=home/'headless-vision-selftest-overlay.yml';patch.write_text(self._overlay(),encoding='utf8')
            env={'BILI_VISION_DSH_ARGV':json.dumps([sys.executable,'/app/dsh','--profile','headless','--patch',str(patch)])}
            result=vision.describe_test_image_with_dsh(home,env=env,runner=lambda *a,**kw:subprocess.CompletedProcess(a[0],0,b'VISION_TEST_RESULT: hello',b''))
            self.assertFalse(result['ok'])
            self.assertEqual(result['status'],'no_image_proof')
            def complete(argv,**kw):
                Path(kw['env']['BILI_VISION_PROOF_FILE']).write_text(json.dumps({'kind':'dafeiyu-selftest','sha256':'a041e0a1ffc95fe91c13d9acc6c48b8a37ddae15a8de910d9ee35975d0ff5c3b','byteLength':515908,'mimeType':'image/png','imageBlocks':1}))
                return subprocess.CompletedProcess(argv,0,'VISION_TEST_RESULT: 蓝色头发，深蓝裙子，鱼尾。'.encode('utf8'),b'')
            good=vision.describe_test_image_with_dsh(home,env=env,runner=complete)
            self.assertTrue(good['ok']);self.assertIn('鱼尾',good['answer'])
            self.assertEqual(len(list((home/'vision-proof').glob('*'))),0)

if __name__=='__main__':unittest.main()

class DshFailureDiagnosticTests(unittest.TestCase):
    def test_headless_auth_is_not_wrongly_classified_as_bad_image_model(self):
        d=vision._safe_dsh_headless_diagnostic(b'ERROR: ACCOUNT_SIGN_IN_REQUIRED',b'',1)
        self.assertEqual(d['diagnosticCode'],'headless_auth')
        self.assertIn('Headless',d['error'])
        self.assertNotIn('不支持图片',d['error'])

    def test_subprocess_nonzero_exit_reports_headless_reason_not_bad_image_model(self):
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp)
            # Use the same trusted overlay fixture as the real selftest entry.
            rows=[]
            for item in vision._HEADLESS_DENY_TOOLS:rows.extend([f'- id: {item}','  disabled: true',''])
            for item in ('credentials','authorization','deepseek-account'):rows.extend([f'- id: {item}','  disabled: false',''])
            rows.extend(['- insert:','    - id: mcp-bili-vision-readonly','      config:','        serverName: bilivision','        env:',"          BILI_MCP_TOOLS: 'bili_vision_selftest'","          BILI_VISION_SELFTEST_ALLOWED: '1'","          BILI_VISION_TEST_ASSET: '/app/local-vision-selftest-dafeiyu.png'"])
            overlay=home/'headless-vision-selftest-overlay.yml'
            overlay.write_text('\n'.join(rows)+'\n',encoding='utf8')
            env={'BILI_VISION_DSH_ARGV':json.dumps([sys.executable,'/app/dsh','--profile','headless','--patch',str(overlay)])}
            r=vision.describe_test_image_with_dsh(home,env=env,runner=lambda *a,**kw:subprocess.CompletedProcess(a[0],1,b'',b'ACCOUNT_SIGN_IN_REQUIRED'))
            self.assertFalse(r['ok'])
            self.assertEqual(r['status'],'headless_launch_failed')
            self.assertEqual(r['diagnosticCode'],'headless_auth')
            self.assertIn('独立 Headless',r['error'])

    def test_sensitive_stderr_never_appears_in_failure_ui(self):
        d=vision._safe_dsh_headless_diagnostic(b'Some secret https://example.com/?api_key=top-secret',b'',1)
        self.assertEqual(d['diagnosticCode'],'headless_exit_unknown')
        self.assertNotIn('top-secret',d['error'])

    def test_known_mcp_error_is_reported_as_subsession_issue(self):
        d=vision._safe_dsh_headless_diagnostic(b'Cannot find module @deepseek-ai/dsh-mcp-client',b'',1)
        self.assertEqual(d['diagnosticCode'],'mcp_startup')
