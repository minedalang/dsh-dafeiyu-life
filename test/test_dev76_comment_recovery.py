"""Offline SQLite tests: neither Bilibili nor a model is imported."""
import ast,os,sqlite3,tempfile,unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from subprocess import check_output
SRC=Path(__file__).resolve().parents[1]/'vendor/bilibili-mcp/mcp_server.py'
READER=Path(__file__).resolve().parents[1]/'lib/video-owned-ledger-read.py'
BV='BV1abcde1234'
def load(home):
    names={'_action_conn','_record_owned_selection','_comment_review_state','_set_comment_review_state','_comment_review_recovery_eligible'}
    nodes=[n for n in ast.parse(SRC.read_text(encoding='utf8')).body if isinstance(n,ast.FunctionDef) and n.name in names]
    ns={'sqlite3':sqlite3,'datetime':datetime,'_DUTY_HOME':Path(home),'_ACTION_DB_NAME':'video-actions.sqlite3',
        '_current_account_uid':lambda:'1234567','get_cred':lambda:SimpleNamespace(dedeuserid='1234567'),
        '_owned_comment_exists':lambda bv:False,'os':os}
    exec(compile(ast.Module(body=nodes,type_ignores=[]),str(SRC),'exec'),ns)
    return ns
class RecoveryTest(unittest.TestCase):
    def test_pending_is_account_scoped_and_only_past_24h(self):
        with tempfile.TemporaryDirectory() as home:
            ns=load(home);old=os.environ.get('BILI_DUTY_LIFE_ROUND_ID');os.environ['BILI_DUTY_LIFE_ROUND_ID']='a'*24
            try:
                self.assertTrue(ns['_record_owned_selection'](BV))
            finally:
                if old is None: os.environ.pop('BILI_DUTY_LIFE_ROUND_ID',None)
                else: os.environ['BILI_DUTY_LIFE_ROUND_ID']=old
            self.assertTrue(ns['_set_comment_review_state'](BV,'pending'))
            self.assertTrue(ns['_comment_review_recovery_eligible'](BV))
            import json
            snapshot=json.loads(check_output(['python',str(READER),home,'1234567']))
            self.assertEqual(snapshot['rows'][0]['reviewState'],'pending')
            self.assertEqual(json.loads(check_output(['python',str(READER),home,'987654']))['rows'],[])
            self.assertTrue(ns['_set_comment_review_state'](BV,'passed'))
            self.assertFalse(ns['_set_comment_review_state'](BV,'pending'))
            self.assertFalse(ns['_comment_review_recovery_eligible'](BV))
    def test_unknown_send_never_recovers_and_legacy_missing_state_is_unknown(self):
        with tempfile.TemporaryDirectory() as home:
            ns=load(home);ns['_action_conn']().close()
            self.assertEqual(ns['_comment_review_state'](BV),'')
            ns['_set_comment_review_state'](BV,'uncertain')
            self.assertFalse(ns['_set_comment_review_state'](BV,'pending'))
            self.assertFalse(ns['_comment_review_recovery_eligible'](BV))
if __name__=='__main__':unittest.main()
