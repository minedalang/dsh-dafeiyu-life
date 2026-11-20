"""Dev32 local storyboard density, thinking metadata and bounded output regression."""
import json
import sys
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'lib'))
import preview_vision as pv

class OllamaBoardControls(unittest.TestCase):
    @staticmethod
    def board(n=4):
        return {'second':10,'bytes':b'not-real-jpeg','rank':0,'tile_count':n,
                'tile_times':list(range(10,10+n)),
                'grid_cols':{4:2,6:3,12:4}[n],'grid_rows':2 if n in (4,6) else 3}

    def response(self,frame,*,finish='stop',thinking=''):
        board=self.board(frame)
        cols=board['grid_cols']
        lines=[f'R{i//cols+1}C{i%cols+1} [{pv._board_clock(t)}]：通道；人物不清晰；无可辨文字。'
               for i,t in enumerate(board['tile_times'])]
        return {'message':{'content':'\n'.join(lines),'thinking':thinking},
                'done_reason':finish,'done':True,'eval_count':890}

    def call(self,mode='off',tiles=4,reply=None):
        class Response:
            def __init__(self, data):self.data=data
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def read(self,*args):return json.dumps(self.data).encode()
        requests=[]
        caller=self
        class Opener:
            def open(self,request,timeout=None):
                raw=json.loads(request.data)
                requests.append(raw)
                return Response(reply if reply is not None else caller.response(tiles))
        board=self.board(tiles)
        with patch.dict('os.environ',{'BILI_VISION_LOCAL_THINKING':mode}),patch('urllib.request.build_opener',return_value=Opener()):
            answer=pv._call_local_ollama([board],'qwen3.5:4b')
        return answer,board,requests

    def test_independent_density_and_true_grid_size(self):
        items=[{'tile':Image.new('RGB',(80,45)),'second':i*10} for i in range(24)]
        # dev.34 intentionally retired user-configurable 4/6-cell previews.
        # Any legacy grid argument must now resolve to the fixed 12-cell board.
        for amount,cols,rows,boards in [(4,4,3,2),(6,4,3,2),(12,4,3,2)]:
            rendered=pv._make_preview_boards(items,amount)
            self.assertEqual(len(rendered),boards)
            self.assertEqual(sum(x['tile_count'] for x in rendered),24)
            self.assertEqual(rendered[0]['grid_cols'],cols)
            self.assertEqual(rendered[0]['grid_rows'],rows)
            with Image.open(BytesIO(rendered[0]['bytes'])) as jpg:
                self.assertEqual(jpg.size,(80*cols,65*rows))

    def test_debug_capture_retains_all_fixed_twelve_tile_storyboards(self):
        from tempfile import TemporaryDirectory
        items=[{'tile':Image.new('RGB',(80,45)),'second':i*10} for i in range(24)]
        boards=pv._make_preview_boards(items,4)
        with TemporaryDirectory() as temp:
            receipt=pv._capture_actual_video_images(temp,'BV1Smsb6FEb6',boards,[],None,'B站低清预览')
            self.assertIsNotNone(receipt)
            self.assertEqual(len(receipt['images']),2)
            self.assertTrue(all(len(x['times'])==12 for x in receipt['images']))

    def test_budget_scales_by_tiles_and_thinking_not_total_boards(self):
        self.assertEqual(pv._local_board_predict_budget(4,'off'),3072)
        self.assertEqual(pv._local_board_predict_budget(6,'off'),4096)
        self.assertEqual(pv._local_board_predict_budget(12,'off'),6144)
        self.assertEqual(pv._local_board_predict_budget(12,'high'),12288)
        self.assertLessEqual(pv._local_board_predict_budget(12,'high'),12288)

    def test_disabled_thinking_actual_request_and_model_content_only(self):
        text,board,requests=self.call('off',4,reply=self.response(4,thinking='private reasoning not evidence'))
        self.assertEqual(requests[0]['think'],False)
        self.assertEqual(requests[0]['options']['num_predict'],3072)
        self.assertNotIn('private reasoning',text)
        self.assertEqual(board['_model_receipt']['outputTokens'],890)

    def test_model_default_omits_think_boolean(self):
        _text,board,requests=self.call('default',6)
        self.assertNotIn('think',requests[0])
        self.assertEqual(requests[0]['options']['num_predict'],8192)

    def test_enabled_thinking_consumes_larger_but_bounded_budget(self):
        _text,board,requests=self.call('on',12)
        self.assertEqual(requests[0]['think'],True)
        self.assertEqual(requests[0]['options']['num_predict'],12288)

    def test_named_levels_require_verified_model_metadata(self):
        # A stale model config cannot silently downgrade 'high' to model default.
        with patch.object(pv,'_local_check_named_thinking',side_effect=ValueError('不支持')):
            with patch.dict('os.environ',{'BILI_VISION_LOCAL_THINKING':'high'}):
                with self.assertRaisesRegex(ValueError,'不支持'):
                    pv._call_local_ollama([self.board(4)],'qwen3.5:4b')

    def test_reasoning_only_without_answer_is_incomplete(self):
        with self.assertRaisesRegex(ValueError,'没有可用画面描述'):
            self.call('off',4,reply={'message':{'content':'','thinking':'lots of thoughts'},'done':True,'done_reason':'length'})

    def test_hallucinated_extra_row_never_counts_complete(self):
        wrong=self.response(4)
        wrong['message']['content']+='\nR3C1 [00:10]：虚构的第三行'
        with self.assertRaisesRegex(ValueError,'不存在的行列'):
            self.call('off',4,reply=wrong)

    def test_token_length_finish_fails_closed_even_when_text_exists(self):
        incomplete=self.response(4,finish='length')
        with self.assertRaisesRegex(ValueError,'生成长度限制'):
            self.call('off',4,reply=incomplete)

if __name__=='__main__': unittest.main()
