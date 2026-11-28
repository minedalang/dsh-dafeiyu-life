"""不联网验证 @ 诊断持久化、日志隐私、发送结果/计数语义。"""
import ast
import json
import re
import sys
import stat
import uuid
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / 'vendor/bilibili-mcp/mcp_server.py').read_text(encoding='utf8')
parsed = ast.parse(source)
names = {'_record_mention_event', '_record_comment_in_ledger', '_comment_result', '_append_home', '_read_home', '_valid_bv', '_safe_line', '_public_no_mention_reason', '_append_runtime_duty_log'}
code = compile(ast.Module(body=[node for node in parsed.body if isinstance(node, ast.FunctionDef) and node.name in names],type_ignores=[]), '<mention_history>', 'exec')

class MentionHistoryTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.home = Path(self.dir.name)
        self.scope = {'datetime':datetime,'json':json,'os':__import__('os'),'sys':sys, 'Path':Path,'re':re,
                      'stat':stat,'uuid':uuid,'_DUTY_HOME':self.home,'_BV_PATTERN':re.compile(r'^BV[0-9A-Za-z]{10}$')}
        exec(code, self.scope)
        self.diag = {'reason':'ai_declined','mode':'ai_select','selected_count':0,'configured_count':2}
        self.bvid = 'BV1pXHK6mE6z'

    def tearDown(self):
        self.dir.cleanup()

    def lines(self):
        files=list((self.home/'mention-diagnostics').glob('*.jsonl'))
        self.assertEqual(len(files),1)
        return [json.loads(s) for s in files[0].read_text(encoding='utf8').splitlines()]

    def test_success_without_mentions_saves_to_disk_and_duty_log(self):
        payload={'success':True,'rpid':123,'mention_delivery':'none','dynamic_sync':{'status':'disabled'}}
        returned=self.scope['_comment_result'](payload,self.bvid,0,self.diag)
        self.assertEqual(json.loads(returned),payload)
        self.assertNotIn('mention_diagnostic',returned)
        rec=self.lines()[0]
        self.assertTrue(rec['success'])
        self.assertFalse(rec['mention_attempted'])
        self.assertEqual(rec['rpid'],'123')
        self.assertEqual(rec['reason'],'ai_declined')
        self.assertEqual(rec['kind'],'top')
        self.assertIn('原因=ai_declined',(self.home/'duty.log').read_text(encoding='utf8'))

    def test_ai_explanation_is_recorded_once_without_returning_to_agent(self):
        self.diag['ai_reason'] = '这条只是吐槽一个小音效，不太像需要叫朋友来看'
        payload = {'success': True, 'rpid': 123, 'mention_delivery': 'none'}
        returned = self.scope['_comment_result'](payload, self.bvid, 0, self.diag)
        self.assertNotIn('ai_reason', returned)
        self.assertEqual(self.lines()[0]['ai_reason'], self.diag['ai_reason'])
        self.assertIn('AI说明=这条只是吐槽一个小音效', (self.home/'duty.log').read_text('utf8'))

    def test_missing_explanation_not_fabricated(self):
        self.scope['_comment_result']({'success': True, 'rpid': 123, 'mention_delivery': 'none'}, self.bvid, 0, self.diag)
        self.assertEqual(self.lines()[0]['ai_reason'], '')
        self.assertIn('AI说明=未填写', (self.home/'duty.log').read_text('utf8'))

    def test_model_explanation_ignored_for_technical_or_successful_mentions(self):
        for diag, delivery in [
            ({**self.diag, 'reason': 'mention_disabled', 'ai_reason': '我不想通知'}, 'none'),
            ({**self.diag, 'reason': 'no_mention_targets', 'ai_reason': '我不想通知'}, 'none'),
            ({**self.diag, 'reason': 'mention_requested', 'ai_reason': '我不想通知'}, 'uid_mapping_submitted_unverified'),
            ({**self.diag, 'reason': 'ai_declined', 'ai_reason': '未发送无需解释'}, 'not_sent'),
        ]:
            self.scope['_comment_result']({'success': delivery != 'not_sent', 'rpid':123, 'mention_delivery': delivery}, self.bvid, 0, diag)
        self.assertTrue(all(x['ai_reason'] == '' for x in self.lines()))

    def test_explanation_is_sanitized_capped_and_no_log_injection(self):
        explain = '和朋友关系不大\n2026 fake log: 评论成功 '
        self.diag['ai_reason'] = explain
        self.scope['_comment_result']({'success': True, 'rpid': 123, 'mention_delivery': 'none'}, self.bvid, 0, self.diag)
        got = self.lines()[0]['ai_reason']
        self.assertNotIn('\n', got)
        self.assertEqual(len((self.home/'duty.log').read_text('utf8').splitlines()), 1)
        self.assertLessEqual(len(got), 48)
        self.assertEqual(self.scope['_public_no_mention_reason']('a' * 200), 'a' * 48)
        for sensitive in ('https://x.example/private', 'friend UID 210228238', 'C:\\Users\\test', 'cookie=secret', '@友人'):
            self.assertEqual(self.scope['_public_no_mention_reason'](sensitive), '')

    def test_success_with_uid_mapping_is_attempt_not_verified(self):
        diag={**self.diag,'reason':'mention_requested','selected_count':1}
        self.scope['_comment_result']({'success':True,'rpid_str':'888','mention_delivery':'uid_mapping_submitted_unverified'},self.bvid,0,diag)
        rec=self.lines()[0]
        self.assertTrue(rec['mention_attempted'])
        self.assertFalse(rec['notice_confirmed'])
        self.assertEqual(rec['selected_count'],1)
        self.assertEqual(rec['rpid'],'888')

    def test_text_only_without_uid_is_not_delivery_confirmation(self):
        diag={**self.diag,'reason':'mentioned_text_only_missing_uid','selected_count':1}
        self.scope['_comment_result']({'success':True,'rpid':777,'mention_delivery':'text_only_unverified'},self.bvid,0,diag)
        rec=self.lines()[0]
        self.assertTrue(rec['mention_attempted'])
        self.assertFalse(rec['notice_confirmed'])
        self.assertEqual(rec['reason'],'mentioned_text_only_missing_uid')

    def test_failed_send_separate_from_success(self):
        self.scope['_comment_result']({'success':False,'error':'风控拒绝\nCookie私密信息', 'mention_delivery':'not_sent'},self.bvid,0,self.diag)
        rec=self.lines()[0]
        self.assertFalse(rec['success'])
        self.assertFalse(rec['mention_attempted'])
        self.assertEqual(rec['error'],'评论未成功（详细原因见工具回执）')
        self.assertNotIn('Cookie私密信息', json.dumps(rec,ensure_ascii=False))

    def test_replies_not_group_mentioned(self):
        diag={**self.diag,'reason':'reply_no_group_mentions'}
        self.scope['_comment_result']({'success':True,'rpid':456,'mention_delivery':'none'},self.bvid,3344,diag)
        self.assertEqual(self.lines()[0]['kind'],'reply')

    def test_reply_diagnostic_keeps_bounded_public_text_and_root(self):
        self.scope['_comment_result']({'success':True,'rpid':456,'mention_delivery':'none'},
                                       self.bvid,3344,self.diag,'公开回复内容[doge]',2233)
        rec=self.lines()[0]
        self.assertEqual(rec['content'],'公开回复内容[doge]')
        self.assertEqual(rec['root'],'2233')
        self.assertEqual(rec['kind'],'reply')

    def test_comment_text_and_uid_not_persisted(self):
        p={'success':True,'rpid':456,'mention_delivery':'none','private_note':'private content'}
        self.scope['_comment_result'](p,self.bvid,0,self.diag)
        txt=(self.home/'duty.log').read_text('utf8')+self.lines()[0].__str__()
        self.assertNotIn('private content',txt)

if __name__=='__main__':
    unittest.main()
