import datetime
import json
import os
import re
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / 'vendor/bilibili-mcp/mcp_server.py'
TREE = __import__('ast').parse(SOURCE.read_text(encoding='utf8'))
NAMES = {'_record_meme_event', '_public_no_mention_reason'}
MINI = __import__('ast').Module(body=[x for x in TREE.body if isinstance(x, __import__('ast').FunctionDef) and x.name in NAMES], type_ignores=[])

class MemeDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.old_enabled = os.environ.get('BILI_COMMENT_MEMES_ENABLED')
        os.environ['BILI_COMMENT_MEMES_ENABLED'] = '1'
        self.addCleanup(self._restore_enabled)
        self.scope = {'datetime': datetime.datetime, 'json': json, 're': re, 'os': os,
                      'sys': __import__('sys'),
                      '_valid_bv': lambda bv: bv if re.fullmatch(r'BV[0-9A-Za-z]{10}', bv) else (_ for _ in ()).throw(ValueError('bad bv'))}
        def append(rel, text):
            path = self.home / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('a', encoding='utf8') as f:
                f.write(text)
        self.scope['_append_home'] = append
        exec(compile(MINI, 'meme-test', 'exec'), self.scope)
        self.bvid = 'BV1234567890'

    def _restore_enabled(self):
        if self.old_enabled is None:
            os.environ.pop('BILI_COMMENT_MEMES_ENABLED', None)
        else:
            os.environ['BILI_COMMENT_MEMES_ENABLED'] = self.old_enabled

    def events(self):
        files = list((self.home / 'meme-diagnostics').glob('*.jsonl'))
        return [json.loads(line) for f in files for line in f.read_text(encoding='utf8').splitlines()]

    def record(self, payload, bvid=None, target_rpid=0, name='', chosen_reason='', decline_reason=''):
        self.scope['_record_meme_event'](payload, bvid or self.bvid, target_rpid, name, chosen_reason, decline_reason)

    def test_public_comment_excerpt_from_explicit_arg_not_payload_secrets(self):
        self.scope['_record_meme_event']({'success': True, 'rpid': 12345, 'private_note':'SECRET'},
            self.bvid,0,'','','',comment_text='大肥鱼的公开评论')
        [event] = self.events()
        self.assertEqual(event['rpid'],'12345')
        self.assertEqual(event['content'],'大肥鱼的公开评论')
        self.assertNotIn('SECRET',json.dumps(event,ensure_ascii=False))

    def test_no_image_reason_is_persisted_without_comment_body(self):
        self.record({'success': True, 'rpid': 234, 'text': 'private-should-not-save'}, decline_reason='本条只是科普讲解，没有合适梗图')
        [event] = self.events()
        self.assertEqual(event['status'], 'ai_declined')
        self.assertEqual(event['reason'], '本条只是科普讲解，没有合适梗图')
        self.assertFalse(event['selected'])
        self.assertNotIn('private-should-not-save', (self.home / 'duty.log').read_text(encoding='utf8'))

    def test_image_uploaded_is_not_claimed_to_be_visible(self):
        self.record({'success': True, 'rpid': 789, 'meme_image': {'status': 'submitted_unverified'}},
                    name='奶娃/奶龙大笑', chosen_reason='反转很好笑')
        [event] = self.events()
        self.assertEqual(event['status'], 'submitted_unverified')
        self.assertEqual(event['image'], '奶娃/奶龙大笑')
        self.assertFalse(event.get('image_visible_confirmed', False))
        self.assertTrue(event['submitted'])

    def test_failed_attempt_distinguished_from_success(self):
        self.record({'success': False, 'meme_image': {'status': 'uncertain_no_retry'}},
                    name='奶娃/大笑', chosen_reason='很有趣')
        [event] = self.events()
        self.assertFalse(event['success'])
        self.assertTrue(event['selected'])
        self.assertFalse(event['submitted'])
        self.assertEqual(event['status'], 'uncertain_no_retry')

    def test_reply_not_in_top_level_diagnostics(self):
        self.record({'success': True, 'rpid': 987}, target_rpid=234, decline_reason='无需梗图')
        self.assertFalse((self.home / 'meme-diagnostics').exists())

    def test_untrusted_ai_reason_not_inserted_as_log_command(self):
        self.record({'success': True, 'rpid': 444}, decline_reason='test\nCookie=SECRET')
        [event] = self.events()
        self.assertEqual(event['reason'], '')
        self.assertNotIn('SECRET', (self.home / 'duty.log').read_text(encoding='utf8'))


class RuntimeDutyLogTests(unittest.TestCase):
    def test_python_writer_obeys_host_lock_and_size_cap(self):
        import ast, stat, uuid
        with tempfile.TemporaryDirectory() as d:
            home = Path(d)
            scope = {'_DUTY_HOME': home, 'os': os, 'json': json, 'datetime': datetime.datetime, 'stat': stat, 'uuid': uuid}
            module = ast.Module(body=[x for x in TREE.body if isinstance(x, ast.FunctionDef) and x.name == '_append_runtime_duty_log'], type_ignores=[])
            exec(compile(module, 'runtime-duty-log', 'exec'), scope)
            append = scope['_append_runtime_duty_log']
            path = home / 'duty.log'
            lock = home / '.runtime-log-maintenance.lock'
            append('first\n')
            self.assertEqual(path.read_text(), 'first\n')
            self.assertFalse(lock.exists())
            lock.write_text('occupied')
            append('must not append\n')
            self.assertEqual(path.read_text(), 'first\n')
            self.assertEqual(lock.read_text(), 'occupied')
            lock.unlink()
            path.write_bytes(b'x' * (2 * 1024 * 1024))
            append('must not grow\n')
            self.assertEqual(path.stat().st_size, 2 * 1024 * 1024)
            self.assertFalse(lock.exists())
