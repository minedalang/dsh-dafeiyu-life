"""Maintainer-only, synthetic storyboard probe. No B站, Life home or production routing."""
import argparse
import functools
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import urllib.request
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
import preview_vision as pv


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # urllib raises HTTPError; no second destination is opened


def local_request(port, key, path, payload=None, timeout=4):
    # The probe owns the destination. No URL or path comes from model output.
    req = urllib.request.Request(f'http://127.0.0.1:{port}{path}',
        data=None if payload is None else json.dumps(payload).encode('utf8'),
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'})
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(req, timeout=timeout) as resp:
            raw = resp.read(300_001)  # same response cap as original local inference
    except HTTPError as exc:
        exc.close()
        raise
    if len(raw) > 300_000:
        raise ValueError('Local probe response exceeds existing limit')
    return json.loads(raw)


def llama_transport(port, key, calls, child=None):
    """Convert the existing local vision payload; never use reasoning as content."""
    def transport(payload, timeout):
        message = payload['messages'][0]
        parts = [{'type': 'text', 'text': message['content']}]
        parts.extend({'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + image}}
                     for image in message['images'])
        body = {'model': payload['model'], 'stream': False,
                'temperature': payload['options']['temperature'],
                'max_tokens': payload['options']['num_predict'],
                'messages': [{'role': 'user', 'content': parts}]}
        if 'think' in payload:
            body['chat_template_kwargs'] = {'enable_thinking': payload['think']}
        start = time.monotonic()
        record = {'images': len(message['images']), 'predictBudget': body['max_tokens']}
        calls.append(record)
        try:
            if child is not None and child.poll() is not None:
                raise pv.VisionServiceError('ollama_service_offline', 'Probe child stopped')
            reply = local_request(port, key, '/v1/chat/completions', body, timeout)
            choices = reply.get('choices')
            if not isinstance(choices, list) or len(choices) != 1:
                raise ValueError('Expected one completion choice')
            choice = choices[0]
            finish = choice.get('finish_reason')
            content = choice.get('message', {}).get('content')
            if not isinstance(content, str):
                raise ValueError('No visible assistant content')
            usage = reply.get('usage') or {}
            record.update(finishReason=finish, promptTokens=usage.get('prompt_tokens'),
                          outputTokens=usage.get('completion_tokens'))
            return json.dumps({'message': {'content': content}, 'done_reason': finish,
                'done': finish == 'stop', 'eval_count': usage.get('completion_tokens') or 0}).encode('utf8')
        finally:
            record['elapsedSeconds'] = round(time.monotonic() - start, 3)
    return transport


def fixture_boards(count):
    from PIL import Image, ImageDraw
    items, truth = [], []
    colors = [('red', (220, 40, 40)), ('green', (35, 180, 60)), ('blue', (35, 80, 220)), ('yellow', (240, 210, 40))]
    shapes = ['circle', 'square', 'triangle']
    for i in range(count):
        # Deliberately vary both attributes between the two boards.
        color, rgb = colors[(i + i // 12) % len(colors)]
        shape = shapes[(i // 4 + i // 12) % len(shapes)]
        im = Image.new('RGB', (96, 54), 'white')
        draw = ImageDraw.Draw(im)
        if shape == 'circle': draw.ellipse((27, 5, 69, 47), fill=rgb)
        elif shape == 'square': draw.rectangle((27, 5, 69, 47), fill=rgb)
        else: draw.polygon([(48, 4), (22, 48), (74, 48)], fill=rgb)
        second = i * 7
        items.append({'tile': im, 'second': second})
        truth.append({'second': second, 'color': color, 'shape': shape})
    return pv._make_preview_boards(items), truth


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def wait_ready(child, port, key, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError(f'llama-server exited: {child.returncode}; inspect local server log')
        try:
            if local_request(port, key, '/health', timeout=2).get('status') == 'ok':
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise TimeoutError('llama-server startup timeout; inspect local server log')


def stop_child(child):
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()


def run_probe(args):
    # New output only; never resolve a production data directory or write its files.
    out = Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=False)
    boards, truth = fixture_boards(args.frames)
    for i, board in enumerate(boards, 1):
        (out / f'board-{i}.jpg').write_bytes(board['bytes'])
    (out / 'ground-truth.json').write_text(json.dumps(truth, ensure_ascii=False, indent=2), encoding='utf8')
    calls = []
    child = None
    startup = None
    files = None
    start = time.monotonic()
    try:
        if args.backend == 'llama.cpp':
            exe, weights, projector = (Path(p).resolve(strict=True) for p in (args.server, args.weights, args.mmproj))
            if not all(p.is_file() for p in (exe, weights, projector)):
                raise ValueError('Specify actual llama-server, GGUF and mmproj files')
            files = {'server': exe.name, 'weights': weights.name, 'weightsBytes': weights.stat().st_size,
                     'mmproj': projector.name, 'mmprojBytes': projector.stat().st_size}
            port, key = free_port(), secrets.token_hex(32)
            cmd = [str(exe), '--model', str(weights), '--mmproj', str(projector),
                   '--alias', args.model, '--host', '127.0.0.1', '--port', str(port),
                   '--api-key', key, '--ctx-size', str(args.context), '--parallel', '1',
                   '--n-gpu-layers', str(args.gpu_layers), '--jinja']
            # Prevent inherited llama.cpp launch settings changing the selected files/host.
            env = {k: v for k, v in os.environ.items() if not k.upper().startswith('LLAMA_ARG_')}
            with (out / 'server.log').open('wb') as log:
                child = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                    cwd=str(exe.parent), env=env, shell=False,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                wait_ready(child, port, key, args.startup_timeout)
                startup = round(time.monotonic() - start, 3)
                infer = functools.partial(pv._call_local_ollama, _lab_transport=llama_transport(port, key, calls, child), _lab_thinking='off')
                _, receipts = pv._analyze_local_storyboards(boards, args.model, _lab_infer=infer)
        else:
            def infer(frames, model, **kwargs):
                record = {'images': len(frames)}
                calls.append(record)
                begin = time.monotonic()
                try:
                    return pv._call_local_ollama(frames, model, _lab_thinking='off', **kwargs)
                finally:
                    record.update(frames[0].get('_model_receipt', {}))
                    record['elapsedSeconds'] = round(time.monotonic() - begin, 3)
            _, receipts = pv._analyze_local_storyboards(boards, args.model, _lab_infer=infer)
        report = {'backend': args.backend, 'model': args.model, 'syntheticOnly': True,
                  'gpuLayersRequested': args.gpu_layers if args.backend == 'llama.cpp' else None,
                  'contextRequested': args.context if args.backend == 'llama.cpp' else None,
                  'files': files, 'startupSeconds': startup, 'elapsedSeconds': round(time.monotonic() - start, 3),
                  'boardCount': len(boards), 'completedBoards': sum(r['status']=='analyzed' for r in receipts),
                  'sampledCells': len(truth), 'structurallyParsedCells': sum(len(r['times']) if r['status']=='analyzed' else len(r.get('partialCells', [])) for r in receipts),
                  'requestCount': len(calls), 'inferenceSeconds': round(sum(c['elapsedSeconds'] for c in calls), 3),
                  'semanticAccuracy': 'manual-review-required', 'calls': calls, 'receipts': receipts}
        (out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
        return report['completedBoards'] == len(boards)
    except (OSError, ValueError, RuntimeError) as exc:
        # No absolute paths, keys, or arbitrary raw backend error in the shareable report.
        (out / 'report.json').write_text(json.dumps({'backend': args.backend, 'model': args.model,
            'syntheticOnly': True, 'status': 'probe-failed', 'errorType': type(exc).__name__,
            'files': files, 'startupSeconds': startup, 'calls': calls}, indent=2), encoding='utf8')
        raise
    finally:
        if child is not None:
            stop_child(child)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', choices=['llama.cpp', 'ollama'], default='llama.cpp')
    parser.add_argument('--model', required=True, choices=['qwen3.5:2b', 'qwen3.5:4b', 'openbmb/minicpm-v4.7:1b'])
    parser.add_argument('--server')
    parser.add_argument('--weights')
    parser.add_argument('--mmproj')
    parser.add_argument('--output', required=True, help='New output directory, outside production data')
    parser.add_argument('--frames', type=int, choices=[12, 24, 48], default=24)
    parser.add_argument('--context', type=int, default=32768)
    parser.add_argument('--gpu-layers', type=int, default=0)
    parser.add_argument('--startup-timeout', type=float, default=180)
    args = parser.parse_args()
    if args.backend == 'llama.cpp' and not all((args.server, args.weights, args.mmproj)):
        parser.error('llama.cpp requires --server, --weights and --mmproj')
    # Inherited owner Debug flags must not alter the synthetic probe lifecycle.
    os.environ.pop('DSH_OWNER_VIDEO_DEBUG_STAGE', None)
    return 0 if run_probe(args) else 2


if __name__ == '__main__':
    sys.exit(main())
