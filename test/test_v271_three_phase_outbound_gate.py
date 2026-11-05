import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import os
import subprocess

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'vendor'/'bilibili-mcp'))
from outbound_action_gate import outbound_reservation, OutboundHeld, outbound_status


class ThreePhaseOutboundSafety(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='dev3-outbound-')
        self.home=Path(self.temp.name)
        (self.home/'account-binding.json').write_text(json.dumps({'activeUid':'12345','generation':1,'reviewRequired':False,'restartRequired':False}))
        (self.home/'bili_credential.json').write_text(json.dumps({'dedeuserid':'12345','sessdata':'secret-not-for-logs'}))

    def tearDown(self):
        self.temp.cleanup()

    def test_confirmed_delivery_blocks_same_day_duplicate_and_redacts_secrets(self):
        with outbound_reservation('dm','556677','private-body-secret',home=self.home) as action:
            action.confirm('123456789000')
        with self.assertRaises(OutboundHeld):
            with outbound_reservation('dm','556677','private-body-secret',home=self.home):
                pass
        summary=outbound_status(self.home)
        self.assertEqual(summary['unresolved'],0)
        logs=' '.join(x.read_text() for x in (self.home/'outbound-action-executions').rglob('*.json'))
        self.assertNotIn('private-body-secret',logs)
        self.assertNotIn('secret-not-for-logs',logs)
        self.assertNotIn('556677',logs)

    def test_crashed_or_unverified_write_remains_blocked(self):
        with self.assertRaisesRegex(OSError,'network disappeared'):
            with outbound_reservation('comment','BV1abcde1234:0:0','important-comment',home=self.home):
                raise OSError('network disappeared')
        with self.assertRaises(OutboundHeld):
            with outbound_reservation('comment','BV1abcde1234:0:0','important-comment',home=self.home):
                pass
        self.assertEqual(outbound_status(self.home)['unresolved'],1)

    def test_no_receipt_is_not_success_and_blocks_retry(self):
        with outbound_reservation('dynamic-comment','dynamic:666','a-comment',home=self.home):
            pass
        self.assertEqual(outbound_status(self.home)['unresolved'],1)
        with self.assertRaises(OutboundHeld):
            with outbound_reservation('dynamic-comment','dynamic:666','a-comment',home=self.home):pass

    def test_account_switch_never_completes_old_account_claim(self):
        binding=self.home/'account-binding.json'
        with self.assertRaisesRegex(ValueError,'作用域'):
            with outbound_reservation('follow','554433','',home=self.home) as action:
                action.confirm('relation-readback:2')
                binding.write_text(json.dumps({'activeUid':'99999','generation':2}))
        binding.write_text(json.dumps({'activeUid':'12345','generation':1,'reviewRequired':False,'restartRequired':False}))
        self.assertEqual(outbound_status(self.home)['unresolved'],1)

    def test_different_targets_and_outbound_kinds_do_not_conflict(self):
        with outbound_reservation('dm','9988','hi',home=self.home) as a:a.confirm('123')
        with outbound_reservation('dm','9989','hi',home=self.home) as a:a.confirm('124')
        with outbound_reservation('comment','9988','hi',home=self.home) as a:a.confirm('125')
        self.assertEqual(outbound_status(self.home)['unresolved'],0)

    def test_incomplete_write_is_still_blocked_next_day(self):
        with patch('outbound_action_gate.time.strftime',return_value='2026-11-05'):
            with outbound_reservation('dm','4411','repeatable',home=self.home):
                pass  # Timed out, no confirmed receipt.
        with patch('outbound_action_gate.time.strftime',return_value='2026-11-06'):
            with self.assertRaises(OutboundHeld):
                with outbound_reservation('dm','4411','repeatable',home=self.home):pass

    def test_confirmed_message_can_be_intentionally_repeated_next_day(self):
        with patch('outbound_action_gate.time.strftime',return_value='2026-11-05'):
            with outbound_reservation('dm','4411','good morning',home=self.home) as claim:
                claim.confirm('111000111')
        with patch('outbound_action_gate.time.strftime',return_value='2026-11-06'):
            with outbound_reservation('dm','4411','good morning',home=self.home) as claim:
                claim.confirm('222000222')
        self.assertEqual(outbound_status(self.home)['unresolved'],0)

    def test_other_python_process_cannot_send_same_outbound_action_concurrently(self):
        code="""from outbound_action_gate import outbound_reservation,OutboundHeld
try:
 with outbound_reservation('dm','7788','hello',home=__import__('sys').argv[1]):print('SENT')
except OutboundHeld:print('HELD')"""
        env={**os.environ,'PYTHONPATH':str(Path(__file__).resolve().parents[1]/'vendor'/'bilibili-mcp')}
        with outbound_reservation('dm','7788','hello',home=self.home):
            result=subprocess.run([sys.executable,'-c',code,str(self.home)],text=True,capture_output=True,env=env,timeout=6)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertIn('HELD',result.stdout)

    def test_fails_closed_on_missing_account_binding(self):
        (self.home/'account-binding.json').unlink()
        with self.assertRaises((ValueError,OSError)):
            with outbound_reservation('dm','111','text',home=self.home):pass

    def test_invalid_confirmation_cannot_release_unknown(self):
        with self.assertRaises(ValueError):
            with outbound_reservation('dm','7711','hello',home=self.home) as a:
                a.confirm('')
        self.assertEqual(outbound_status(self.home)['unresolved'],1)


if __name__=='__main__': unittest.main()
