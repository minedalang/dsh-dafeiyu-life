"""No false visual success for real decoded boards and harmless Markdown layouts."""
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'lib'))
import preview_vision as pv
import adaptive_video as av

BV='BV1xx411c7mD'
SOURCE='B站公开视频片段（离线解码）'


def board(rank):
    times=list(range(rank*20+10,rank*20+22))
    return {'second':times[0],'tile_times':times,'tile_count':12,
            'grid_cols':4,'grid_rows':3,'rank':rank,'bytes':b'jpeg-placeholder'}


def observed(b,emphasized=False):
    return '\n'.join(
        (f'{i+1}. **R{i//4+1}C{i%4+1}** [{pv._board_clock(t)}]：'
         if emphasized else f'R{i//4+1}C{i%4+1} [{pv._board_clock(t)}]：')+
        '可见通道和室内墙面；其他细节无法从采样画面辨认。'
        for i,t in enumerate(b['tile_times']))


def fake_frames(boards):
    return {'ok':True,'status':'frames_ready','bvid':BV,'frames':boards,
            'image_source':SOURCE,'times':[t for b in boards for t in b['tile_times']],
            'sampling':{'strategy':'decoded-storyboard-stratified-2fps',
                        'sampler_version':8,'storyboard_count':len(boards)}}


class VisualBoardAlignmentTests(unittest.TestCase):
    def test_markdown_variants_still_require_every_real_tile_and_correct_time(self):
        b=board(0)
        text=observed(b,True)
        self.assertTrue(pv._local_board_grid_valid(text,b))
        self.assertTrue(pv._local_board_cell_times_valid(text,b))
        self.assertFalse(pv._local_board_grid_valid('\n'.join(text.splitlines()[:-1]),b))
        self.assertFalse(pv._local_board_cell_times_valid(text.replace('[00:10]','[00:11]',1),b))
        self.assertFalse(pv._local_board_grid_valid(text.replace('R1C1','R4C1',1),b))

    def test_real_decoded_boards_use_correct_prompt_and_per_board_receipts(self):
        boards=[board(0),board(1)]
        calls=[]
        def inference(group,model,**kw):
            self.assertEqual(model,'qwen3.5:2b')
            self.assertEqual(kw.get('image_source'),SOURCE)
            calls.append([b['rank'] for b in group])
            return '\n'.join(f'分镜图{b["rank"]+1}：\n{observed(b,True)}' for b in group) if len(group)==2 else observed(group[0],True)
        with TemporaryDirectory() as folder, \
             patch.object(av,'acquire_adaptive_frames',return_value=fake_frames(boards)), \
             patch.object(pv,'_call_local_ollama',side_effect=inference), \
             patch.object(pv,'_capture_actual_video_images',return_value=None):
            out=pv.analyze_perception(BV,folder,perception_source='adaptive',
                    enabled=True,provider='ollama',model='qwen3.5:2b',max_frames=24)
            self.assertEqual(out['status'],'analyzed',out)
            self.assertEqual(calls,[[0,1]])
            self.assertEqual([r['status'] for r in out['visionBoardReceipts']],['analyzed']*2)
            self.assertTrue(out.get('cacheSaved'))
            with patch.object(av,'acquire_adaptive_frames',side_effect=AssertionError('should use new verified cache')):
                again=pv.analyze_perception(BV,folder,perception_source='adaptive',
                    enabled=True,provider='ollama',model='qwen3.5:2b',max_frames=24)
            self.assertEqual(again['status'],'cached')
            self.assertEqual(len(again['visionBoardReceipts']),2)

    def test_real_decoded_partial_response_never_cached_or_marked_seen(self):
        boards=[board(0),board(1)]
        def inference(group,model,**_):
            if len(group)==2:return '分镜图1：\n'+observed(group[0])+'\n分镜图2：\nR1C1 [00:30]：只完成一个格子。'
            self.assertEqual(group[0]['rank'],1)
            return 'R1C1 [00:30]：只完成一个格子。'
        with TemporaryDirectory() as folder, \
             patch.object(av,'acquire_adaptive_frames',return_value=fake_frames(boards)), \
             patch.object(pv,'_call_local_ollama',side_effect=inference) as work, \
             patch.object(pv,'_capture_actual_video_images',return_value=None), \
             patch.object(pv,'_save_vision_cache') as save:
            out=pv.analyze_perception(BV,folder,perception_source='adaptive',
                    enabled=True,provider='ollama',model='qwen3.5:2b',max_frames=24)
        self.assertEqual(out['status'],'vision_incomplete')
        self.assertNotIn('description',out)
        self.assertEqual([r['status'] for r in out['visionBoardReceipts']],['analyzed','incomplete'])
        self.assertEqual(out['visionBoardReceipts'][1]['errorCode'],'vision_board_grid_mismatch')
        self.assertEqual(work.call_count,2)
        save.assert_not_called()

    def test_malformed_decoded_board_cannot_escape_into_legacy_path(self):
        bad=board(0)
        bad['tile_count']=11  # board image still contains 12 timestamped tiles
        with TemporaryDirectory() as folder, \
             patch.object(av,'acquire_adaptive_frames',return_value=fake_frames([bad])), \
             patch.object(pv,'_capture_actual_video_images',return_value=None), \
             patch.object(pv,'_call_local_ollama') as worker:
            out=pv.analyze_perception(BV,folder,perception_source='adaptive',
                    enabled=True,provider='ollama',model='qwen3.5:2b',max_frames=24)
        self.assertEqual(out['status'],'vision_incomplete')
        self.assertNotIn('description',out)
        worker.assert_not_called()

    def test_legacy_nongrid_adaptive_failure_retains_bounded_error_code(self):
        frame={'second':10,'bytes':b'jpg'}
        source={'ok':True,'status':'frames_ready','bvid':BV,'frames':[frame],
                'image_source':SOURCE,'times':[10], 'sampling':{'sampler_version':8}}
        with TemporaryDirectory() as folder, \
             patch.object(av,'acquire_adaptive_frames',return_value=source), \
             patch.object(pv,'_capture_actual_video_images',return_value=None), \
             patch.object(pv,'_call_local_ollama',side_effect=pv.VisionServiceError(
               'ollama_request_timeout','sensitive details')):
            out=pv.analyze_perception(BV,folder,perception_source='adaptive',
                    enabled=True,provider='ollama',model='qwen3.5:2b',max_frames=24)
        self.assertEqual(out['status'],'vision_unavailable')
        self.assertEqual(out['errorCode'],'ollama_request_timeout')
        self.assertNotIn('sensitive',repr(out))


if __name__=='__main__':unittest.main()
