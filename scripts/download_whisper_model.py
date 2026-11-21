"""Explicit model download with real per-file bytes; no fake global percentage.
Executed only in the plugin's ASR venv with a validated model name and HF_HOME.
"""
import json
import os
import sys
import time

MODELS = {'tiny', 'base', 'small', 'medium', 'large-v3'}
PATTERNS = ['config.json', 'preprocessor_config.json', 'model.bin', 'tokenizer.json', 'vocabulary.*']


def event(kind, **kwargs):
    print('ASR_PROGRESS:' + json.dumps({'phase':kind, **kwargs}, ensure_ascii=False), flush=True)


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in MODELS:
        event('failed', reason='invalid-model')
        return 2
    model = sys.argv[1]
    from huggingface_hub import snapshot_download
    from tqdm.auto import tqdm

    class FileProgress(tqdm):
        def __init__(self, *args, **kwargs):
            kwargs['disable'] = False
            super().__init__(*args, **kwargs)
            self._last_emit = 0
            self._last_value = -1

        def update(self, n=1):
            result = super().update(n)
            total = int(self.total or 0)
            current = int(self.n or 0)
            now = time.monotonic()
            # Small bars can be the file-count aggregator. Only display a
            # percentage when it is backed by a real tqdm transfer total.
            if total > 1024 and (now-self._last_emit >= 0.75 or current >= total or self._last_value < 0):
                event('download', currentBytes=current, totalBytes=total,
                      filename=str(self.desc or '')[:100])
                self._last_emit = now
                self._last_value = current
            return result

    event('download-start', model=model, repo=f'Systran/faster-whisper-{model}')
    # Preserve the exact set of files expected by faster-whisper's own loader.
    path = snapshot_download(repo_id=f'Systran/faster-whisper-{model}',
                             allow_patterns=PATTERNS, tqdm_class=FileProgress)
    event('verify', model=model)
    from faster_whisper import WhisperModel
    WhisperModel(path, device='cpu', compute_type='int8')
    event('ready', model=model)
    print('模型就绪', flush=True)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        event('failed', reason=type(exc).__name__)
        raise
