"""Regression: two observed JPEG boards cannot collapse into one incomplete local model receipt."""
import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lib'))
import preview_vision as pv
from test_v281_dev3b16_preview_storyboard import fake_api, image_fetch, BV

class PerBoardVision(unittest.TestCase):
    def run_preview(self, infer):
        with TemporaryDirectory() as home, \
             patch.object(pv, '_json_api', side_effect=fake_api), \
             patch.object(pv, '_safe_api_get', side_effect=image_fetch), \
             patch.object(pv, '_call_local_ollama', side_effect=infer) as worker:
            output = pv.analyze_preview(BV, home, storyboard=True, max_frames=24,
                                        enabled=True, model='openbmb/minicpm-v4.7:1b',debug=True)
            return output, worker.call_args_list

    def test_both_boards_get_independent_images_and_provenance(self):
        def infer(boards, model):
            self.assertEqual(len(boards), 1)
            b = boards[0]
            return 'R1C1 [' + pv._board_clock(b['tile_times'][0]) + '] 只能看到人物与大厅，局部细节不确定。'
        out, calls = self.run_preview(infer)
        self.assertEqual(out['status'],'analyzed',out)
        self.assertEqual(len(calls),2)
        self.assertEqual(len(out['visionBoardReceipts']),2)
        self.assertEqual([r['index'] for r in out['visionBoardReceipts']],[1,2])
        self.assertEqual([r['status'] for r in out['visionBoardReceipts']],['analyzed','analyzed'])
        self.assertIn('分镜图1',out['description'])
        self.assertIn('分镜图2',out['description'])
        self.assertNotEqual(calls[0].args[0][0]['bytes'],calls[1].args[0][0]['bytes'])
        self.assertEqual(out['visionBoardReceipts'][0]['times'],out['times'][:12])
        self.assertEqual(out['visionBoardReceipts'][1]['times'],out['times'][12:24])

    def test_truncated_second_board_must_not_claim_complete_visual(self):
        times=[]
        def infer(boards,model):
            times.append(boards[0]['tile_times'])
            if len(times)==2:return '9. 90.0秒：'
            return 'R1C1 ['+pv._board_clock(boards[0]['tile_times'][0])+'] 大厅中的人物。'
        out, calls=self.run_preview(infer)
        self.assertEqual(len(calls),2)
        self.assertEqual(out['status'],'vision_incomplete',out)
        self.assertNotIn('description',out)
        self.assertEqual([r['status'] for r in out['visionBoardReceipts']],['analyzed','incomplete'])
        self.assertIn('分镜图1',out['visionPartialDescription'])
        self.assertNotIn('分镜图2',out['visionPartialDescription'])

    def test_second_board_cannot_cite_first_board_time(self):
        count=0
        def infer(boards,model):
            nonlocal count
            count+=1
            return 'R1C1 [00:10] 一位游戏角色走动。' if count==2 else '只看到大厅区域，不确定确切动作。'
        out,_=self.run_preview(infer)
        self.assertEqual(out['status'],'vision_incomplete')
        self.assertIn('未采样时间点',out['visionBoardReceipts'][1]['error'])

    def test_ollama_length_finish_is_rejected(self):
        class Response:
            def __enter__(self):return self
            def __exit__(self,*_):pass
            def read(self,n):return json.dumps({'message':{'content':'1. 00:10：画面'},'done_reason':'length','done':True}).encode()
        class Opener:
            def open(self,req,timeout=None):
                self.assertTrue(False)
        class FakeOpener:
            def open(self,req,timeout=None):return Response()
        board={'second':10,'bytes':b'fakeimage','tile_count':12,'tile_times':list(range(10,22)),'rank':0}
        with patch('urllib.request.build_opener',return_value=FakeOpener()):
            with self.assertRaisesRegex(ValueError,'长度限制'):
                pv._call_local_ollama([board],'qwen3.5:4b')

    def test_grid_metadata_has_exact_row_col_mapping(self):
        class Reply:
            def __enter__(self):return self
            def __exit__(self,*_):pass
            def read(self,n):return json.dumps({'message':{'content':'R2C2 [01:05] 看到了楼梯附近的人物，方向不能确定。'},'done_reason':'stop'}).encode()
        class Opener:
            def open(self,req,timeout=None):
                reqdata=json.loads(req.data)
                message=reqdata['messages'][0]
                selfOuter.assertEqual(len(message['images']),1)
                selfOuter.assertIn('R1C4=[00:40]',message['content'])
                selfOuter.assertIn('R2C2=[01:05]',message['content'])
                selfOuter.assertGreaterEqual(reqdata['options']['num_predict'],1200)
                return Reply()
        selfOuter=self
        board={'second':10,'bytes':b'fakeimage','tile_count':12,'tile_times':[10,25,35,40,55,65,70,80,90,115,120,131],'rank':0}
        with patch('urllib.request.build_opener',return_value=Opener()):
            answer=pv._call_local_ollama([board],'qwen3.5:4b')
        self.assertIn('01:05',answer)

    def test_floored_grid_timestamp_matches_fractional_source_index(self):
        self.assertTrue(pv._local_board_time_valid('R2C2 [01:05] 在楼梯附近。',[65.4]))
        self.assertTrue(pv._local_board_time_valid('65秒：人物移动。',[65.4]))
        self.assertFalse(pv._local_board_time_valid('R2C2 [01:06] 在楼梯附近。',[65.4]))

if __name__=='__main__':unittest.main()
