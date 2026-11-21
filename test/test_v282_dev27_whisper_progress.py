"""Offline test: real per-file bytes arrive from the model installer, not fake time-based percentages."""
import contextlib
import io
import json
import runpy
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'download_whisper_model.py'


class StubTqdm:
    def __init__(self, *args, **kwargs):
        self.total = kwargs.get('total', 0)
        self.desc = kwargs.get('desc', '')
        self.n = 0

    def update(self, n=1):
        self.n += n
        return True


class InstallerProgressTest(unittest.TestCase):
    def run_installer(self, model):
        output = io.StringIO()
        actual = []

        def snapshot_download(*, repo_id, allow_patterns, tqdm_class):
            actual.append((repo_id, allow_patterns))
            bar = tqdm_class(total=2000000, desc='model.bin')
            bar.update(500000)
            bar.update(1500000)
            return '/tmp/fake-whisper-snapshot'

        def mock_model(path, device, compute_type):
            self.assertEqual(path, '/tmp/fake-whisper-snapshot')
            self.assertEqual((device, compute_type), ('cpu', 'int8'))

        hub = types.ModuleType('huggingface_hub')
        hub.snapshot_download = snapshot_download
        tqdm_mod = types.ModuleType('tqdm')
        auto = types.ModuleType('tqdm.auto')
        auto.tqdm = StubTqdm
        whisper_mod = types.ModuleType('faster_whisper')
        whisper_mod.WhisperModel = mock_model
        with patch.dict(sys.modules, {'huggingface_hub': hub, 'tqdm': tqdm_mod,
                                      'tqdm.auto': auto, 'faster_whisper': whisper_mod}), \
             patch.object(sys, 'argv', [str(SCRIPT), model]), contextlib.redirect_stdout(output):
            with self.assertRaises(SystemExit) as ex:
                runpy.run_path(str(SCRIPT), run_name='__main__')
        events = [json.loads(line[len('ASR_PROGRESS:'):]) for line in output.getvalue().splitlines()
                  if line.startswith('ASR_PROGRESS:')]
        return ex.exception.code, actual, events

    def test_real_byte_count_emitted_and_model_loaded(self):
        code, actual, events = self.run_installer('tiny')
        self.assertEqual(code, 0)
        self.assertEqual(actual[0][0], 'Systran/faster-whisper-tiny')
        self.assertIn('model.bin', actual[0][1])
        self.assertTrue(any(e['phase'] == 'download' and e['currentBytes'] == 500000 and
                            e['totalBytes'] == 2000000 for e in events))
        self.assertTrue(any(e['phase'] == 'download' and e['currentBytes'] == 2000000 and
                            e['totalBytes'] == 2000000 for e in events))
        self.assertEqual([e['phase'] for e in events if e['phase'] in ('download-start', 'verify', 'ready')],
                         ['download-start', 'verify', 'ready'])

    def test_unknown_model_never_calls_downloader(self):
        code, actual, events = self.run_installer('../small')
        self.assertEqual(code, 2)
        self.assertEqual(actual, [])
        self.assertEqual(events[0]['reason'], 'invalid-model')


if __name__ == '__main__':
    unittest.main()
