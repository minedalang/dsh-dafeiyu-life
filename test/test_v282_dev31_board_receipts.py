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
    @staticmethod
    def render_board(board):
        cols=board.get('grid_cols',4)
        return '\n'.join(f'R{i//cols+1}C{i%cols+1} [{pv._board_clock(t)}]：通道；动作不确定；文字看不清。'
                         for i,t in enumerate(board['tile_times']))

    def run_preview(self, infer):
        with TemporaryDirectory() as home, \
             patch.object(pv, '_json_api', side_effect=fake_api), \
             patch.object(pv, '_safe_api_get', side_effect=image_fetch), \
             patch.object(pv, '_call_local_ollama', side_effect=infer) as worker:
            output = pv.analyze_preview(BV, home, storyboard=True, max_frames=24,
                                        enabled=True, model='openbmb/minicpm-v4.7:1b',debug=True)
            return output, worker.call_args_list

    def test_both_boards_get_one_bounded_request_and_independent_receipts(self):
        def infer(boards, model):
            self.assertEqual(len(boards), 2)
            return '\n'.join(f'分镜图{i+1}：\n{self.render_board(b)}'
                             for i,b in enumerate(boards))
        out, calls = self.run_preview(infer)
        self.assertEqual(out['status'],'analyzed',out)
        self.assertEqual(len(calls),1)
        self.assertEqual(len(calls[0].args[0]),2)
        self.assertNotEqual(calls[0].args[0][0]['bytes'],calls[0].args[0][1]['bytes'])
        self.assertEqual([r['status'] for r in out['visionBoardReceipts']],['analyzed','analyzed'])
        self.assertEqual([r['inferencePath'] for r in out['visionBoardReceipts']],['paired','paired'])
        self.assertEqual([r['modelAttempts'] for r in out['visionBoardReceipts']],[1,1])
        self.assertEqual(out['visionBoardReceipts'][0]['times'],out['times'][:12])
        self.assertEqual(out['visionBoardReceipts'][1]['times'],out['times'][12:24])
        self.assertIn('分镜图1',out['description'])
        self.assertIn('分镜图2',out['description'])

    def test_truncated_second_board_recovers_only_second_and_never_uses_partial(self):
        def infer(boards,model):
            if len(boards)==2:
                return ('分镜图1：\n'+self.render_board(boards[0])+\
                    '\n分镜图2：\nR1C1 ['+pv._board_clock(boards[1]['tile_times'][0])+']：未完成')
            self.assertEqual(boards[0].get('rank'),1)
            return self.render_board(boards[0])
        out, calls=self.run_preview(infer)
        self.assertEqual(out['status'],'analyzed',out)
        self.assertEqual([len(c.args[0]) for c in calls],[2,1])
        self.assertEqual([r['modelAttempts'] for r in out['visionBoardReceipts']],[1,2])
        self.assertEqual(out['visionBoardReceipts'][1]['inferencePath'],'single-recovery')

    def test_second_board_failure_does_not_claim_complete_visual(self):
        def infer(boards,model):
            if len(boards)==2:
                return ('分镜图1：\n'+self.render_board(boards[0])+\
                    '\n分镜图2：\nR1C1 ['+pv._board_clock(boards[1]['tile_times'][0])+']：未完成')
            return '9. 90.0秒：'
        out,calls=self.run_preview(infer)
        self.assertEqual([len(c.args[0]) for c in calls],[2,1])
        self.assertEqual(out['status'],'vision_incomplete')
        self.assertNotIn('description',out)
        self.assertEqual([r['status'] for r in out['visionBoardReceipts']],['analyzed','incomplete'])
        self.assertIn('分镜图1',out['visionPartialDescription'])
        self.assertNotIn('分镜图2',out['visionPartialDescription'])
        self.assertEqual(out['visionBoardReceipts'][1]['errorCode'],'vision_board_truncated')
        self.assertNotIn('9. 90.0',str(out['visionBoardReceipts'][1]))

    def test_second_board_cannot_cite_first_board_time(self):
        def infer(boards,model):
            if len(boards)==2:
                return ('分镜图1：\n'+self.render_board(boards[0])+\
                    '\n分镜图2：\nR1C1 [00:10]：错误地复用第一张分镜时刻')
            return 'R1C1 [00:10]：错误地复用第一张分镜时刻'
        out,calls=self.run_preview(infer)
        self.assertEqual(out['status'],'vision_incomplete')
        self.assertEqual([len(c.args[0]) for c in calls],[2,1])
        self.assertEqual(out['visionBoardReceipts'][1]['errorCode'],'vision_board_time_mismatch')

    def test_grid_time_swap_is_rejected_even_with_all_cell_ids_present(self):
        board={'second':10,'tile_times':list(range(10,22)),'grid_cols':4,'grid_rows':3}
        rows=self.render_board(board).splitlines()
        rows[0]=rows[0].replace('[00:10]','[00:11]')
        rows[1]=rows[1].replace('[00:11]','[00:10]')
        self.assertTrue(pv._local_board_grid_valid('\n'.join(rows),board))
        self.assertTrue(pv._local_board_time_valid('\n'.join(rows),board['tile_times']))
        self.assertFalse(pv._local_board_cell_times_valid('\n'.join(rows),board))

    def test_batch_needs_distinct_section_headers_before_accepting_either_board(self):
        boards=[{'rank':0},{'rank':1}]
        with self.assertRaisesRegex(ValueError,'分镜标题'):
            pv._split_storyboard_batch('R1C1 [00:10]：模糊\n分镜图2：\n画面',boards)
        with self.assertRaisesRegex(ValueError,'分镜标题'):
            pv._split_storyboard_batch('分镜图1：\n画面\n分镜图1：\n重复',boards)

    def test_local_batch_carries_both_images_and_combined_generation_budget(self):
        import base64
        class Reply:
            def __enter__(self):return self
            def __exit__(self,*_):pass
            def read(self,n):return json.dumps({'message':{'content':'batch test answer'},'done_reason':'stop'}).encode()
        class Opener:
            def open(self,req,timeout=None):
                data=json.loads(req.data)
                self_outer.assertEqual(len(data['messages'][0]['images']),2)
                self_outer.assertEqual(data['messages'][0]['images'],[
                    base64.b64encode(b'A').decode(),base64.b64encode(b'B').decode()])
                self_outer.assertIn('多张独立分镜图',data['messages'][0]['content'])
                self_outer.assertGreaterEqual(data['options']['num_predict'],12288)
                return Reply()
        self_outer=self
        base={'tile_count':12,'tile_times':list(range(12)),'grid_cols':4,'grid_rows':3}
        boards=[dict(base,rank=i,second=i*12,bytes=bytes([65+i])) for i in range(2)]
        with patch('urllib.request.build_opener',return_value=Opener()):
            self.assertEqual(pv._call_local_ollama(boards,'qwen3.5:4b'),'batch test answer')

    def test_full_48_frames_never_exceeds_two_images_per_model_call(self):
        boards=[{'rank':i,'second':i*12,'bytes':bytes([65+i]),
                 'tile_count':12,'tile_times':list(range(i*12,i*12+12)),
                 'grid_cols':4,'grid_rows':3} for i in range(4)]
        calls=[]
        def infer(group,model):
            calls.append([b['rank'] for b in group])
            return '\n'.join(f'分镜图{b["rank"]+1}：\n{self.render_board(b)}' for b in group)
        with patch.object(pv,'_call_local_ollama',side_effect=infer):
            _,receipts=pv._analyze_local_storyboards(boards,'qwen3.5:4b')
        self.assertEqual(calls,[[0,1],[2,3]])
        self.assertEqual([r['status'] for r in receipts],['analyzed']*4)
        self.assertEqual([r['modelAttempts'] for r in receipts],[1]*4)

    def test_long_video_clock_over_99_minutes_remains_valid(self):
        board={'second':6010,'grid_cols':4,'grid_rows':3,'tile_times':list(range(6010,6022))}
        response=self.render_board(board)
        self.assertTrue(pv._local_board_time_valid(response,board['tile_times']))
        self.assertTrue(pv._local_board_cell_times_valid(response,board))

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
            def read(self,n):return json.dumps({'message':{'content':'\n'.join(f'R{i//4+1}C{i%4+1} [{pv._board_clock(t)}] 看不清。' for i,t in enumerate([10,25,35,40,55,65,70,80,90,115,120,131]))},'done_reason':'stop'}).encode()
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
