import pathlib,sys,tempfile,unittest,subprocess,json

SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'lib'/'meme-learning-admin.py'

def call(home,mode,data=None):
    cp=subprocess.run([sys.executable,str(SCRIPT),str(home),mode],input=json.dumps(data,ensure_ascii=False) if data else '',text=True,capture_output=True,timeout=7,check=True)
    return json.loads(cp.stdout)

class V2499MemeEvidence(unittest.TestCase):
    def test_real_selected_title_observations_are_persisted_across_videos(self):
        with tempfile.TemporaryDirectory() as folder:
            home=pathlib.Path(folder)
            data={'videos':[{'bvid':'BV19SJi6VEj1','title':'【奶蛙】二创混剪'},{'bvid':'BV1ab2345678','title':'今天也在看【奶蛙】'}, {'bvid':'BV1cd2345678','title':'【奶蛙】二创混剪'}]}
            result=call(home,'observe',data)
            self.assertEqual(result['added'],3)
            self.assertEqual(call(home,'list')['pending'],3)
            self.assertEqual(call(home,'observe',data)['added'],0)
            ids=[row['id'] for row in call(home,'list')['rows']]
            committed=call(home,'commit',{'entries':[{'name':'奶蛙','kind':'角色','meaning':'两条真实标题都使用了该名称，但具体形象和出处仍待核实。','observation_ids':ids}]})
            self.assertTrue(committed['ok'])
            self.assertEqual(committed['created'],1)
            self.assertEqual(call(home,'list')['pending'],0)
    def test_generic_day_and_column_titles_are_hints_not_knowledge(self):
        with tempfile.TemporaryDirectory() as folder:
            home=pathlib.Path(folder)
            data={'videos':[{'bvid':'BV19SJi6VEj1','title':'【Day 1】主人断我粮'}, {'bvid':'BV1ab2345678','title':'【Day 1】自述'}, {'bvid':'BV1cd2345678','title':'【经验开源】教程'}]}
            result=call(home,'observe',data)
            self.assertEqual(result['added'],3)
            rows=call(home,'list')['rows']
            self.assertEqual(len(rows),3)
            ids=[x['id'] for x in rows if x['name']=='Day 1']
            committed=call(home,'commit',{'entries':[{'name':'Day 1','kind':'系列','meaning':'仅有同样的序号标题，没有证据证明相同系列','observation_ids':ids}]})
            self.assertEqual(committed['created'],0)
            self.assertEqual(call(home,'list')['pending'],3)
    def test_two_title_only_videos_are_insufficient(self):
        with tempfile.TemporaryDirectory() as folder:
            home=pathlib.Path(folder)
            call(home,'observe',{'videos':[{'bvid':'BV19SJi6VEj1','title':'【奶蛙】视频一'}, {'bvid':'BV1ab2345678','title':'【奶蛙】视频二'}]})
            ids=[x['id'] for x in call(home,'list')['rows']]
            committed=call(home,'commit',{'entries':[{'name':'奶蛙','kind':'角色','meaning':'两个视频标题都出现该名称，但未核实细节','observation_ids':ids}]})
            self.assertEqual(committed['created'],0)
    def test_title_is_not_visual_proof_and_invalid_bv_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            result=call(folder,'observe',{'videos':[{'bvid':'BVbad','title':'【奶蛙】'},{'bvid':'BV19SJi6VEj1','title':'【教程】普通教程'},{'bvid':'BV1ab2345678','title':'https://secret.example 【密码】'}]})
            self.assertEqual(result['added'],0)
if __name__=='__main__':unittest.main()
