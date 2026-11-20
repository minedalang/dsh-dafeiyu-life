"""Official videoshot montage fallback: sampled tiles, actual JPEG boards and budgets."""
import sys
from pathlib import Path
from io import BytesIO
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'lib'))
import preview_vision as pv
from adaptive_video import AdaptiveUnavailable
BV='BV1234567890'


def sprite(number, *, n=20):
    image=Image.new('RGB',(5*96,4*54))
    draw=ImageDraw.Draw(image)
    for i in range(n):
        x=(i%5)*96;y=(i//5)*54
        draw.rectangle((x,y,x+95,y+53),fill=((i*13+number*43)%255,(i*37+number*17)%255,(i*17+number*71)%255))
        draw.text((x+4,y+3),f'{number}-{i}',fill='white')
    b=BytesIO();image.save(b,'JPEG',quality=90)
    return b.getvalue()


def fake_api(url):
    if '/view?' in url:return {'cid':123}
    if '/videoshot?' in url:
        return {'image':[f'//i0.hdslb.com/bfs/videoshot/{i}.jpg' for i in range(9)],
                'index':[0]+list(range(180)), 'img_x_len':5,'img_y_len':4,
                'img_x_size':96,'img_y_size':54}
    raise AssertionError(url)


def image_fetch(url,*args,**kwargs):
    num=int(url.rsplit('/',1)[1].split('.')[0]);return sprite(num)

class StoryboardTests(unittest.TestCase):
    def test_adaptive_fallback_contains_12_lowres_tiles_in_one_board(self):
        with TemporaryDirectory() as folder, patch.object(pv,'_json_api',side_effect=fake_api),patch.object(pv,'_safe_api_get',side_effect=image_fetch),patch('adaptive_video.acquire_adaptive_frames',side_effect=AdaptiveUnavailable('ffmpeg_not_installed',fallback=True)):
            result=pv.analyze_perception(BV,folder,perception_source='adaptive',enabled=False,return_frames=True,max_frames=24,view_depth='standard')
        self.assertTrue(result['ok']);self.assertEqual(result['sampling']['sampler_version'],8)
        self.assertEqual(result['sampling']['strategy'],'videoshot-storyboard-stratified')
        self.assertEqual(len(result['times']),12)
        self.assertEqual(result['sampling']['storyboard_count'],1)
        self.assertEqual(len(result['frames']),1)
        with Image.open(BytesIO(result['frames'][0]['bytes'])) as output:self.assertEqual(output.size,(384,222))
        self.assertEqual(result['frames'][0]['tile_times'],result['times'])
        self.assertEqual(result['image_source'],'B站低清预览')
        self.assertEqual(result['adaptive_fallback']['actual_source'],'videoshot')
        self.assertLessEqual(result['sampling']['sheets_downloaded'],48)
        self.assertEqual(result['sampling']['low_resolution'],True)

    def test_deep_24_tiles_two_boards_scan_more_source_sheets(self):
        calls=[]
        def download(url,*a,**kw):
            calls.append(url)
            return image_fetch(url,*a,**kw)
        with TemporaryDirectory() as folder, patch.object(pv,'_json_api',side_effect=fake_api),patch.object(pv,'_safe_api_get',side_effect=download):
            result=pv.analyze_preview(BV,folder,storyboard=True,max_frames=24,enabled=False,return_frames=True)
        self.assertTrue(result['ok']);self.assertEqual(len(result['frames']),2)
        self.assertEqual(len(result['times']),24)
        self.assertEqual(sum(x['tile_count'] for x in result['frames']),24)
        self.assertGreater(result['times'][-1]-result['times'][0],120)
        image_calls=[url for url in calls if '/videoshot/' in url]
        self.assertEqual(len(image_calls),result['sampling']['sheets_downloaded'])
        self.assertEqual(len(image_calls),9, 'complete scan must examine all nine sheets when in budget')
        self.assertTrue(any('/pbp/data?' in url for url in calls), 'optional PBP read is separate from sprite downloads')
        self.assertLess(result['sampling']['sprite_bytes'],8*1024*1024)

    def test_direct_source_standard_uses_only_twelve_even_if_env_says_twentyfour(self):
        with TemporaryDirectory() as folder, patch.dict('os.environ',{'BILI_VISION_FRAMES':'24'}), \
             patch.object(pv,'_json_api',side_effect=fake_api),patch.object(pv,'_safe_api_get',side_effect=image_fetch):
            result=pv.analyze_perception(BV,folder,perception_source='preview',
                enabled=False,return_frames=True,view_depth='standard')
        self.assertTrue(result['ok'])
        self.assertEqual(result['sampling']['frame_budget'],12)
        self.assertEqual(len(result['times']),12)

    def test_focus_only_looks_inside_focus_and_legacy_stays_three(self):
        with TemporaryDirectory() as folder, patch.object(pv,'_json_api',side_effect=fake_api),patch.object(pv,'_safe_api_get',side_effect=image_fetch):
            result=pv.analyze_preview(BV,folder,storyboard=True,max_frames=12,
                  enabled=False,return_frames=True,focus_start=25,focus_end=55)
            legacy=pv.analyze_preview(BV,folder,enabled=False,return_frames=True,max_frames=3)
        self.assertTrue(result['ok']);self.assertTrue(all(25<=x<=55 for x in result['times']))
        self.assertEqual(result['sampling']['sampler_version'],8)
        self.assertLessEqual(len(legacy['times']),3)
        self.assertEqual(legacy['sampling']['sampler_version'],3)

    def test_byte_budget_rejects_oversized_sprites_and_no_fake_frames(self):
        with TemporaryDirectory() as folder, patch.object(pv,'_json_api',side_effect=fake_api),patch.object(pv,'_safe_api_get',side_effect=image_fetch):
            result=pv.analyze_preview(BV,folder,storyboard=True,max_frames=24,enabled=False,return_frames=True,network_budget_bytes=90)
        self.assertFalse(result['ok']);self.assertNotIn('frames',result)

    def test_debug_capture_is_exact_board_bytes_and_not_in_model_answer(self):
        with TemporaryDirectory() as folder, patch.object(pv,'_json_api',side_effect=fake_api),patch.object(pv,'_safe_api_get',side_effect=image_fetch),patch.object(pv,'_call_local_ollama',return_value='观察到多个低清时刻的画面。') as model:
            result=pv.analyze_preview(BV,folder,storyboard=True,max_frames=24,
                  enabled=True,model='qwen3.5:4b',debug=True)
            self.assertTrue(result['ok']); self.assertEqual(result['status'],'analyzed')
            self.assertEqual(len(model.call_args.args[0]),2)
            manifest=result['debugCapture']
            self.assertEqual(manifest['kind'],'storyboard')
            self.assertEqual(len(manifest['images']),2)
            for idx,piece in enumerate(manifest['images']):
                saved=(Path(folder)/'vision-perception-captures'/manifest['id']/piece['file']).read_bytes()
                self.assertEqual(saved,model.call_args.args[0][idx]['bytes'])
                self.assertIn('低清',piece['resolution'])
            self.assertNotIn('frames',result)

if __name__=='__main__':unittest.main()
