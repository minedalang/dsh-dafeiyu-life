"""Bounded, opt-in sampling of a *public* Bilibili video stream.

This is not playback or audio perception. Signed playback URLs are only accepted
from Bilibili's official playurl API. No arbitrary URL, Cookie, ffmpeg network
access, persistent video files, or unrestricted download is supported.
"""
from collections import deque
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import shutil
import statistics
import subprocess
import tempfile
import time
from urllib import parse, request
from urllib.error import HTTPError, URLError

from PIL import Image, ImageChops, ImageStat

BV_RE = re.compile(r'BV[0-9A-Za-z]{10}\Z')
VIDEO_FILE_MAX = 24 * 1024 * 1024
FRAME_W, FRAME_H, FRAME_RATE = 192, 108, 2
MAX_WINDOW = 120
MAX_FRAMES = MAX_WINDOW * FRAME_RATE
SAMPLER_VERSION = 4


class AdaptiveUnavailable(ValueError):
    def __init__(self, code, *, fallback=True):
        super().__init__(code)
        self.code = code
        self.fallback = fallback


def _cdn_url(url):
    """Refuse third-party URLs, ports, alternate schemes, and non-media paths."""
    if not isinstance(url, str) or len(url) > 4096:
        raise AdaptiveUnavailable('unsafe_video_source')
    if url.startswith('//'):
        url = 'https:' + url
    p = parse.urlsplit(url)
    host = (p.hostname or '').lower()
    if (p.scheme != 'https' or p.username or p.password or p.port is not None
        or p.fragment or not re.fullmatch(r'(?:[a-z0-9-]+\.){1,5}bilivideo\.com', host)
        or not p.path.startswith('/upgcxcode/') or '%' in p.path
        or any(x in ('.', '..') for x in p.path.split('/'))
        or not re.fullmatch(r'/[A-Za-z0-9_./-]{1,512}\.(?:mp4|m4v|flv)', p.path, re.I)):
        raise AdaptiveUnavailable('unsafe_video_source')
    return url


def _playurl(bvid):
    """Only the official public playurl API; never use account Cookies."""
    from preview_vision import _json_api
    try:
        info = _json_api('https://api.bilibili.com/x/web-interface/view?' + parse.urlencode({'bvid': bvid}))
    except ValueError as exc:
        if '-509' in str(exc) or '-412' in str(exc):
            raise AdaptiveUnavailable('platform_rate_limited', fallback=False) from None
        raise AdaptiveUnavailable('public_video_metadata_unavailable') from None
    if info.get('bvid') and info['bvid'] != bvid:
        raise AdaptiveUnavailable('video_identity_mismatch')
    pages = info.get('pages') or []
    page = pages[0] if pages else info
    cid = page.get('cid')
    duration = page.get('duration') or info.get('duration')
    try:
        duration = float(duration)
    except (ValueError, TypeError):
        raise AdaptiveUnavailable('video_duration_unavailable') from None
    if not cid or not 3 <= duration <= 43200:
        raise AdaptiveUnavailable('video_duration_unavailable')
    # fnval=0 requests a single progressive DURL. DASH and protected/paid
    # sessions are deliberately out of scope for this first bounded decoder.
    try:
        data = _json_api('https://api.bilibili.com/x/player/playurl?' + parse.urlencode({
            'bvid': bvid, 'cid': cid, 'qn': 16, 'fnval': 0, 'fourk': 0}))
    except ValueError as exc:
        if '-509' in str(exc) or '-412' in str(exc):
            raise AdaptiveUnavailable('platform_rate_limited', fallback=False) from None
        raise AdaptiveUnavailable('public_playurl_unavailable') from None
    durls = data.get('durl') or []
    if len(durls) != 1 or not isinstance(durls[0], dict):
        raise AdaptiveUnavailable('progressive_stream_unavailable')
    stream = durls[0]
    try:
        size = int(stream['size'])
    except (ValueError, KeyError, TypeError):
        raise AdaptiveUnavailable('video_size_unavailable') from None
    if size <= 0 or size > VIDEO_FILE_MAX:
        raise AdaptiveUnavailable('video_exceeds_24mb_limit')
    return _cdn_url(stream.get('url')), size, duration


def _download_video(url, path, expected_size):
    """Streaming hard cap, verified redirect chain, no auth headers or cookies."""
    url = _cdn_url(url)
    class SecureRedirect(request.HTTPRedirectHandler):
        hops = 0
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            self.hops += 1
            if self.hops > 3:
                raise AdaptiveUnavailable('too_many_video_redirects')
            _cdn_url(newurl)
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    req = request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.bilibili.com/',
        'Accept-Encoding': 'identity',
    })
    started = time.monotonic()
    total = 0
    try:
        with request.build_opener(SecureRedirect()).open(req, timeout=8) as resp:
            _cdn_url(resp.url)
            length = resp.headers.get('Content-Length')
            if length and int(length) > VIDEO_FILE_MAX:
                raise AdaptiveUnavailable('video_exceeds_24mb_limit')
            if resp.status != 200:
                raise AdaptiveUnavailable('video_http_error')
            with open(path, 'xb') as handle:
                while True:
                    if time.monotonic() - started > 25:
                        raise AdaptiveUnavailable('video_download_timeout')
                    chunk = resp.read(min(65536, VIDEO_FILE_MAX + 1 - total))
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > VIDEO_FILE_MAX:
                        raise AdaptiveUnavailable('video_exceeds_24mb_limit')
                    handle.write(chunk)
    except HTTPError as exc:
        if exc.code in (429, 412):
            raise AdaptiveUnavailable('platform_rate_limited', fallback=False) from None
        raise AdaptiveUnavailable('video_http_error') from None
    except (URLError, TimeoutError, OSError):
        raise AdaptiveUnavailable('video_download_failed') from None
    if total < 1024 or total > VIDEO_FILE_MAX:
        raise AdaptiveUnavailable('video_size_invalid')
    if expected_size and total != expected_size:
        raise AdaptiveUnavailable('video_size_mismatch')
    return total


def _decode_samples(filename, *, start, length):
    exe = shutil.which('ffmpeg')
    if not exe:
        raise AdaptiveUnavailable('ffmpeg_not_installed')
    # Accept ONLY a known progressive container, not playlists or remote probes.
    container = 'flv' if str(filename).endswith('.flv') else 'mp4'
    # Strictly local input, offline decoder, bounded raw RGB output and runtime.
    cmd = [exe, '-nostdin', '-hide_banner', '-loglevel', 'error',
           '-protocol_whitelist', 'file,pipe', '-threads', '1',
           '-ss', str(start), '-f', container, '-i', str(filename), '-t', str(length),
           '-vf', f'fps={FRAME_RATE},scale={FRAME_W}:{FRAME_H}:force_original_aspect_ratio=decrease,pad={FRAME_W}:{FRAME_H}:(ow-iw)/2:(oh-ih)/2',
           '-an', '-sn', '-dn', '-frames:v', str(min(MAX_FRAMES, math.ceil(length * FRAME_RATE))),
           '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                stdin=subprocess.DEVNULL, timeout=35, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise AdaptiveUnavailable('video_decode_unavailable') from None
    size = FRAME_W * FRAME_H * 3
    if result.returncode != 0 or len(result.stdout) < size or len(result.stdout) % size:
        raise AdaptiveUnavailable('video_decode_failed')
    count = len(result.stdout) // size
    if count > MAX_FRAMES:
        raise AdaptiveUnavailable('decode_frame_limit_exceeded')
    return [Image.frombytes('RGB', (FRAME_W, FRAME_H), result.stdout[i*size:(i+1)*size])
            for i in range(count)]


def _frame_difference(a, b):
    return sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / (3 * 255)


def _detect_scenes(images, *, start, max_selected):
    """0.5-s sampled approximate cuts + motion, not frame-accurate shot edges."""
    n = len(images)
    if not n:
        raise AdaptiveUnavailable('no_decoded_frames')
    differences = [_frame_difference(images[i-1], images[i]) for i in range(1, n)]
    history = deque(maxlen=12)
    cuts = [0]
    moving = 0
    quiet = 0
    for i, diff in enumerate(differences, 1):
        base = statistics.median(history) if history else 0.04
        if (diff >= max(0.19, base * 2.5) and i - cuts[-1] >= 2):
            cuts.append(i)
        if diff >= 0.045:
            moving += 1
        else:
            quiet += 1
        history.append(diff)
    spans = [(a, b) for a, b in zip(cuts, cuts[1:] + [n]) if b > a]
    # Representative frame of each detected scene; prefer long spans, but
    # preserve temporal spread and retain no more than three model images.
    scenes = sorted(spans, key=lambda p: (-(p[1] - p[0]), p[0]))
    chosen = []
    for a, b in scenes:
        midpoint = (a + b - 1) // 2
        if all(abs(midpoint - x) >= 2 for x in chosen):
            chosen.append(midpoint)
        if len(chosen) >= max_selected:
            break
    if not chosen:
        chosen = [n // 2]
    # Add a separated time sample if a continuous moving shot spans the clip.
    if len(chosen) < max_selected and n > 4 and moving > n // 8:
        for i in (n // 4, (3*n) // 4, n // 2):
            if len(chosen) >= max_selected: break
            if all(abs(i-x) >= 2 for x in chosen): chosen.append(i)
    chosen.sort()
    frames = []
    for i, idx in enumerate(chosen):
        buf = BytesIO()
        images[idx].save(buf, format='JPEG', quality=85)
        frames.append({'second': round(start + idx / FRAME_RATE, 2),
                       'bytes': buf.getvalue(), 'rank': i, 'source_index': idx})
    cut_seconds = [round(start + i / FRAME_RATE, 2) for i in cuts[1:13]]
    moving_hotspots = [round(start + i / FRAME_RATE, 2) for i in
        sorted((i for i in range(1, n) if i not in cuts and differences[i-1] >= 0.045),
               key=lambda i: differences[i-1], reverse=True)[:8]]
    moving_hotspots.sort()
    return frames, {'strategy':'decoded-scene-2fps', 'sampler_version':SAMPLER_VERSION,
        'candidates_examined':n, 'frames_selected':len(frames),
        'scene_candidates':min(len(spans),24), 'cut_candidates':min(len(cuts)-1,23),
        'motion_samples':moving, 'static_samples':quiet,
        'scene_change_seconds':cut_seconds,'motion_hotspots_seconds':moving_hotspots,
        'sample_interval_seconds':1/FRAME_RATE,
        'note':'从可访问的视频流离线稀疏采样，切镜点仅为0.5秒粒度候选，非逐帧准确分镜；未读取音轨'}


def acquire_adaptive_frames(bvid, *, max_frames=2, focus=None):
    """Return in-process JPEG frames or a typed reason to use videoshot."""
    if not BV_RE.fullmatch(str(bvid or '')):
        raise AdaptiveUnavailable('invalid_bvid', fallback=False)
    if focus is not None and (not isinstance(focus, dict)
        or type(focus.get('startSeconds')) not in (int, float)
        or type(focus.get('endSeconds')) not in (int, float)):
        raise AdaptiveUnavailable('invalid_focus_window', fallback=False)
    limit = max(1, min(3, int(max_frames)))
    if not shutil.which('ffmpeg'):
        raise AdaptiveUnavailable('ffmpeg_not_installed')
    url, size, duration = _playurl(bvid)
    start = float(focus['startSeconds']) if focus else 0.0
    end = float(focus['endSeconds']) if focus else min(duration, 60.0)
    if (not math.isfinite(start) or not math.isfinite(end) or start < 0
        or end > duration + 0.01 or end - start < 1 or end - start > MAX_WINDOW):
        raise AdaptiveUnavailable('window_outside_video')
    # Uses the OS temporary directory, not Life Memory or video-cache.
    with tempfile.TemporaryDirectory(prefix='dafeiyu-scene-') as folder:
        ext = '.flv' if parse.urlsplit(url).path.lower().endswith('.flv') else '.mp4'
        filename = Path(folder) / ('public-video' + ext)
        count = _download_video(url, filename, size)
        images = _decode_samples(filename, start=start, length=end-start)
        frames, sampling = _detect_scenes(images, start=start, max_selected=limit)
    sampling.update(source_type='bili-public-playurl-durl', input_bytes=count,
                    clip_window={'startSeconds':start, 'endSeconds':end})
    return {'ok':True, 'bvid':bvid, 'status':'frames_ready', 'frames':frames,
            'times':[f['second'] for f in frames], 'sampling':sampling,
            'focus_window':focus, 'image_source':'B站公开视频片段（离线解码）',
            'notice':'仅分析公开媒体文件中稀疏采样的静态帧，不能推断完整剧情或音频内容'}
