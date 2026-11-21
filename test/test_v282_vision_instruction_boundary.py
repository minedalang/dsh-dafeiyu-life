"""The independent vision session must not run on silently clipped instructions."""
import base64
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'lib'))
from vision_dsh import _decode_visual_instruction


def payload(text):
    return {'BILI_VISION_PROMPT_B64':base64.b64encode(text.encode('utf8')).decode('ascii')}


class VisionPromptBoundary(unittest.TestCase):
    def test_accepts_exact_utf16_boundary(self):
        self.assertEqual(_decode_visual_instruction(payload('A'*4000)),'A'*4000)
        self.assertEqual(_decode_visual_instruction(payload('鱼鱼观察')),'鱼鱼观察')

    def test_rejects_one_extra_utf16_unit_without_truncation(self):
        for text in ['A'*4001,'🙂'*2001]:
            with self.subTest(length=len(text)), self.assertRaisesRegex(ValueError,'vision-instruction-too-long'):
                _decode_visual_instruction(payload(text))

    def test_corrupted_payload_is_not_silently_ignored(self):
        for encoded in ('$$$', base64.b64encode(b'\xff').decode('ascii')):
            with self.subTest(encoded=encoded),self.assertRaisesRegex(ValueError,'vision-instruction-invalid-encoding'):
                _decode_visual_instruction({'BILI_VISION_PROMPT_B64':encoded})

    def test_control_character_rejected(self):
        with self.assertRaisesRegex(ValueError,'vision-instruction-invalid-content'):
            _decode_visual_instruction(payload('hello\x00world'))


if __name__=='__main__': unittest.main()
