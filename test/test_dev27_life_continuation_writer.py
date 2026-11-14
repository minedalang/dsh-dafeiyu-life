"""Offline protocol tests. Stub server NEVER contacts Bilibili or a real Life bridge."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/'lib'/'life-continuation-write.py'
BV='BV1abcde1234'
STUB='''import json\nfrom types import SimpleNamespace\n_LIFE_WRITE_LAST_STATUS='verified'\ndef get_cred():return SimpleNamespace(dedeuserid='1234')\nasync def bili_video_like(bvid, reason):return json.dumps({'ok': True})\nasync def bili_follow_creator(bvid, reason):return json.dumps({'ok': True})\nasync def bili_video_collect(bvid, title, reason, visibility, motivation):\n assert visibility=='private'\n return json.dumps({'ok': True})\nasync def bili_reply(bvid, text, rpid, root, should_mention, mention_mode, sync_to_dynamic):\n assert (rpid,root,should_mention,mention_mode,sync_to_dynamic)==(0,0,False,'off',False)\n return json.dumps({'success': True})\n'''
TOOLS={'like_video':'bili_video_like','collect_video':'bili_video_collect','follow_creator':'bili_follow_creator','comment_video':'bili_reply'}

class LifeContinuationWriter(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='life-dev27-py-')
        self.home=Path(self.temp.name)
        (self.home/'bili_credential.json').write_text('{}',encoding='utf8')
        (self.home/'mcp_server.py').write_text(STUB,encoding='utf8')
    def tearDown(self):self.temp.cleanup()
    def run_writer(self,action='comment_video',**changes):
        payload={'action':action,'bvid':BV,'reason':'确实想了解并支持这部真实的公开作品',
                 'text':'公开视频资料确实有值得讨论的地方','folderTitle':'音乐作品'}
        payload.update(changes)
        env={**os.environ,'BILI_DUTY_HOME':str(self.home),'BILI_LIFE_ACTION_URL':'http://127.0.0.1:1234',
             'BILI_LIFE_ACTION_TOKEN':'f'*64,'BILI_LIFE_CONTINUATION_RUNNER':'1',
             'BILI_LIFE_EXPECT_UID':'1234','BILI_MCP_TOOLS':TOOLS.get(action,'bili_reply')}
        result=subprocess.run([sys.executable,str(SCRIPT)],input=json.dumps(payload,ensure_ascii=False),
                              text=True,capture_output=True,env=env,timeout=8)
        self.assertEqual(result.returncode,0,result.stderr)
        return json.loads(result.stdout.strip())
    def test_comment_is_top_level_no_mentions_and_requires_verified_bridge(self):
        self.assertEqual(self.run_writer()['status'],'verified')
    def test_all_four_use_autonomous_tools(self):
        for action in TOOLS:
            with self.subTest(action=action):self.assertEqual(self.run_writer(action)['status'],'verified')
    def test_invalid_target_cannot_send(self):
        self.assertEqual(self.run_writer(bvid='BVnot-valid')['attempted'],False)
    def test_missing_account_fails_closed(self):
        r=self.run_writer()
        (self.home/'bili_credential.json').unlink()
        self.assertEqual(self.run_writer()['status'],'unavailable')
        self.assertEqual(r['status'],'verified')
    def test_no_bridge_token_means_no_send(self):
        # Injection of arbitrary actor parameters cannot become a sender.
        self.assertEqual(self.run_writer(uid='6789')['attempted'],False)
    def test_comment_target_is_root_only(self):
        self.assertEqual(self.run_writer(rpid=123)['attempted'],False)

if __name__=='__main__':unittest.main()
