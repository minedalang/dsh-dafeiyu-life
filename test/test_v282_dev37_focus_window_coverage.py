"""Focus sampling: time coverage for variable real-video durations, no invented frames."""
import sys
import unittest
from pathlib import Path
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'lib'))
import adaptive_video as av
import preview_vision as pv

class FocusCoverageTests(unittest.TestCase):
    def sample(self,seconds,limit=24,change=False):
        frames=[]
        for i in range(seconds*2):
            color=(i*11%255,i*23%255,i*33%255) if change else (77,77,77)
            frames.append(Image.new('RGB',(36,20),color))
        return av._scene_candidates([frames],[70.0],limit=limit,focus=True)

    def test_temporal_coverage_for_10_15_20_and_30_second_windows(self):
        for seconds in (10,15,20,30):
            with self.subTest(seconds=seconds):
                rows,info=self.sample(seconds)
                self.assertEqual(len(rows),12)
                self.assertEqual(info['focus_target_frames'],12)
                self.assertEqual(info['focus_frame_shortfall_reason'],'none')
                times=[r['second'] for r in rows]
                self.assertEqual(len(times),len(set(times)))
                self.assertEqual(times,sorted(times))
                # Coverage must include the beginning, middle and end thirds.
                self.assertLess(min(times),70+seconds/3)
                self.assertGreater(max(times),70+seconds*2/3)
                self.assertTrue(all(70<=t<70+seconds for t in times))

    def test_dynamic_frames_still_cover_full_window(self):
        rows,info=self.sample(20,change=True)
        self.assertEqual(len(rows),12)
        self.assertLess(rows[0]['second'],75)
        self.assertGreater(rows[-1]['second'],85)
        self.assertEqual(info['candidates_examined'],40)

    def test_remaining_life_quota_is_a_hard_limit(self):
        rows,info=self.sample(20,limit=5)
        self.assertEqual(len(rows),5)
        self.assertEqual(info['focus_target_frames'],5)

    def test_few_actual_decoded_frames_are_not_fabricated(self):
        images=[Image.new('RGB',(36,20),(10,10,10)) for _ in range(3)]
        rows,info=av._scene_candidates([images],[12.5],limit=24,focus=True)
        self.assertEqual([r['second'] for r in rows],[12.5,13,13.5])
        self.assertEqual(info['focus_frame_shortfall_reason'],'limited-decoded-frames')
        self.assertEqual(len({r['second'] for r in rows}),3)

    def test_overview_static_dedup_policy_is_unchanged(self):
        frames=[Image.new('RGB',(36,20),'gray') for _ in range(40)]
        rows,info=av._scene_candidates([frames],[0.],limit=24,focus=False)
        self.assertLess(len(rows),12)
        self.assertNotIn('focus_selection_policy',info)

    def test_focus_board_metadata_and_prompt_cover_actual_cells(self):
        frames=[{'second':float(i),'image':Image.new('RGB',(16,9),'gray')} for i in range(12)]
        board=av._make_storyboards(frames)[0]
        self.assertEqual(board['grid_cols'],4)
        self.assertEqual(board['grid_rows'],3)
        self.assertEqual(board['tile_count'],12)
        self.assertIn('逐格',pv.ADAPTIVE_BOARD_PROMPT)
        self.assertTrue(pv._local_board_grid_valid('\n'.join(
            f'R{i//4+1}C{i%4+1} [{i//60:02}:{i%60:02}]：真实画面，人物在房间。'
            for i in range(12)),board))

if __name__=='__main__': unittest.main()
