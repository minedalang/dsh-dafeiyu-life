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

from PIL import Image, ImageChops, ImageStat, ImageDraw

BV_RE = re.compile(r'BV[0-9A-Za-z]{10}\Z')
VIDEO_FILE_MAX = 24 * 1024 * 1024
FRAME_W, FRAME_H, FRAME_RATE = 192, 108, 2
MAX_WINDOW = 120
MAX_FRAMES = MAX_WINDOW * FRAME_RATE
SAMPLER_VERSION = 5
MAX_SUPPORTED_DURATION = 2700  # non-film content; 45 min hard limit
FRAME_PLANS = (12, 24, 48)


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
    if not cid or not 3 <= duration <= MAX_SUPPORTED_DURATION:
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
    return _cdn_url(stream.get('url')), size, duration, int(cid)


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


def _ffmpeg_binary():
    """Use owner-selected local decoder only after strict executable validation."""
    configured = os.environ.get('BILI_FFMPEG_PATH', '').strip()
    if not configured:
        return shutil.which('ffmpeg')
    candidate = Path(configured)
    if (not candidate.is_absolute() or candidate.name.lower() not in ('ffmpeg', 'ffmpeg.exe')
            or not candidate.is_file()):
        return None
    return str(candidate.resolve())


def _decode_samples(filename, *, start, length):
    exe = _ffmpeg_binary()
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


def _choose_windows(duration, budget, focus, heat=None):
    """Use full-timeline strata plus up to two danmaku hints, never just peaks.

    Viewer reactions are delayed and noisy. Reserve >= 3/4 of windows for
    uniform coverage and let peaks augment, rather than replace, that view.
    """
    if focus:
        return [(float(focus['startSeconds']), float(focus['endSeconds']))]
    if duration <= 120:
        return [(0.0, duration)]
    if heat and max(heat['points']) <= max(0., statistics.median(heat['points']) * 1.4):
        heat = None  # No meaningful peak: no slots are reserved for crowd reactions.
    slices = 4 if budget <= 12 else (6 if budget <= 24 else 8)
    width = min(15.0, 120.0 / slices)
    heat_slots = 0 if not heat else min(2, slices // 4)
    uniform_slots = slices - heat_slots
    windows = []
    for i in range(uniform_slots):
        midpoint = duration * (i + 0.5) / uniform_slots
        start = max(0., min(duration - width, midpoint - width / 2))
        windows.append((round(start, 2), round(start + width, 2)))
    if heat_slots:
        # Score a bounded peak list once, not one HTTP request per timestamp.
        step = heat['step']
        values = heat['points']
        baseline = statistics.median(values)
        ranked = sorted(range(len(values)), key=lambda i: (-values[i], i))
        for index in ranked:
            if len(windows) >= slices:
                break
            if values[index] <= max(0, baseline * 1.4):
                break
            # Danmaku can arrive several seconds after the noteworthy action.
            midpoint = max(0., min(duration, (index + .5) * step - 5.))
            start = max(0., min(duration - width, midpoint - width / 2))
            candidate = (round(start, 2), round(start + width, 2))
            if any(max(0., min(b, candidate[1]) - max(a, candidate[0])) > width * .2
                   or abs((a+b)/2 - (candidate[0]+candidate[1])/2) < width
                   for a,b in windows):
                continue
            windows.append(candidate)
        # Sparse/fake peaks may not fill both slots: restore uniform coverage.
        for i in range(slices):
            if len(windows) >= slices:
                break
            midpoint = duration * (i + .5) / slices
            start = max(0., min(duration-width, midpoint-width/2))
            candidate = (round(start,2), round(start+width,2))
            if any(abs((a+b)/2 - midpoint) < width*.6 for a,b in windows):
                continue
            windows.append(candidate)
    return sorted(windows)


def _scene_candidates(images, starts, *, heat=None, limit=24):
    """Coverage first; changes, motion and optional viewer activity rank extras.

    Input is only *locally decoded* frames, grouped by separate decode window.
    No artificial cuts are inferred between different windows.
    """
    buckets=[]
    for start, pictures in zip(starts, images):
        entries=[]
        for i,picture in enumerate(pictures):
            prev=pictures[i-1] if i else picture
            diff=_frame_difference(prev,picture)
            before=pictures[i-2] if i>1 else picture
            jump=diff >= .19 and _frame_difference(before,prev)<.18
            second=round(start+i/FRAME_RATE,2)
            from video_heat_signal import heat_at
            audience=heat_at(heat,second)
            score=(.32 if jump else 0)+min(.22,diff*.8)+.31*audience+.15
            entries.append({'second':second,'image':picture,'thumb':picture.resize((24,14)),'score':score,
                            'jump':jump,'diff':diff,'audience':audience})
        if entries:
            buckets.append(entries)
    if not buckets:
        raise AdaptiveUnavailable('no_decoded_frames')
    # Uniformly cover all sampled windows. A static shot needs one observation.
    chosen=[]
    def add(item):
        if item in chosen:
            return False
        if any(abs(item['second']-prev['second'])<.45 for prev in chosen):
            return False
        # Avoid duplicate static shots even across separate timeline windows.
        if any(_frame_difference(item['thumb'],prev['thumb'])<.013 for prev in chosen):
            return False
        chosen.append(item)
        return True
    for bucket in buckets:
        add(bucket[len(bucket)//2])
    per_window_cap=max(2,math.ceil(limit/len(buckets)*1.75))
    per_window_counts={id(bucket):0 for bucket in buckets}
    for bucket in buckets:
        per_window_counts[id(bucket)]=sum(x in chosen for x in bucket)
    # Candidate weighting retains weak uniform coverage and avoids concentrating on one peak.
    while len(chosen)<limit:
        ranked=[]
        for bucket in buckets:
            if per_window_counts[id(bucket)]>=per_window_cap:
                continue
            for item in bucket:
                if item in chosen or any(abs(item['second']-x['second'])<1.5 for x in chosen):
                    continue
                if chosen and min(_frame_difference(item['thumb'],x['thumb']) for x in chosen) < .025:
                    continue
                score=item['score']+ .18*min(1, min(abs(item['second']-x['second']) for x in chosen)/15)
                score-=.09*per_window_counts[id(bucket)]
                ranked.append((score,-item['second'],bucket,item))
        if not ranked:
            break
        ranked.sort(key=lambda x:(x[0],x[1]),reverse=True)
        _,__,bucket,item=ranked[0]
        if not add(item):break
        per_window_counts[id(bucket)]+=1
    chosen.sort(key=lambda x:x['second'])
    return chosen, {'scene_change_seconds':[x['second'] for bucket in buckets for x in bucket if x['jump']][:24],
                   'motion_hotspots_seconds':[x['second'] for x in sorted(
                       (e for bucket in buckets for e in bucket if e['diff']>.045),
                       key=lambda x:x['diff'],reverse=True)[:12]],
                   'heat_candidates_seconds':[x['second'] for x in chosen if x['audience']>=.7][:12],
                   'candidates_examined':sum(map(len,buckets)),
                   'windows_covered':len(buckets),
                   'frames_selected':len(chosen)}


def _make_storyboards(items):
    """12 individually timestamped decoded moments per bounded image board."""
    from PIL import ImageFont
    output=[]
    for start in range(0,len(items),12):
        chunk=items[start:start+12]
        tile_w,tile_h=FRAME_W,FRAME_H+20
        grid=Image.new('RGB',(4*tile_w,3*tile_h),(19,23,30))
        paint=ImageDraw.Draw(grid)
        for j,item in enumerate(chunk):
            x=(j%4)*tile_w;y=(j//4)*tile_h
            grid.paste(item['image'],(x,y))
            t=item['second']
            paint.text((x+5,y+FRAME_H+2), '%02d:%02d'%(int(t//60),int(t%60)),fill=(247,247,247))
        out=BytesIO();grid.save(out,format='JPEG',quality=86,optimize=True)
        output.append({'second':chunk[0]['second'],'bytes':out.getvalue(),
                       'rank':len(output),'tile_times':[x['second'] for x in chunk],
                       'tile_count':len(chunk)})
    return output


def acquire_adaptive_frames(bvid, *, max_frames=24, focus=None, depth='standard'):
    """Return storyboards *of actual decoded moments* or an explicit fallback reason."""
    if not BV_RE.fullmatch(str(bvid or '')):
        raise AdaptiveUnavailable('invalid_bvid', fallback=False)
    if depth not in ('standard','deep'):
        raise AdaptiveUnavailable('invalid_view_depth',fallback=False)
    if focus is not None and (not isinstance(focus, dict)
        or type(focus.get('startSeconds')) not in (int, float)
        or type(focus.get('endSeconds')) not in (int, float)):
        raise AdaptiveUnavailable('invalid_focus_window', fallback=False)
    configured=int(max_frames)
    if configured not in FRAME_PLANS:
        raise AdaptiveUnavailable('invalid_frame_plan', fallback=False)
    limit = min(configured,12) if depth=='standard' else configured
    if not _ffmpeg_binary():
        raise AdaptiveUnavailable('ffmpeg_not_installed')
    url, size, duration, cid = _playurl(bvid)
    if focus and (not math.isfinite(focus['startSeconds']) or not math.isfinite(focus['endSeconds'])
        or focus['startSeconds'] < 0 or focus['endSeconds'] > duration + .01
        or focus['endSeconds']-focus['startSeconds'] < 3
        or focus['endSeconds']-focus['startSeconds'] > MAX_WINDOW):
        raise AdaptiveUnavailable('window_outside_video')
    # Heat is optional and applies to *decoded video* only; never to videoshot.
    from video_heat_signal import obtain_heat_signal
    heat=obtain_heat_signal(bvid,cid,duration)
    windows = _choose_windows(duration,limit,focus,heat=heat)
    all_images=[]
    started=time.monotonic()
    with tempfile.TemporaryDirectory(prefix='dafeiyu-scene-') as folder:
        ext = '.flv' if parse.urlsplit(url).path.lower().endswith('.flv') else '.mp4'
        filename = Path(folder) / ('public-video' + ext)
        count = _download_video(url, filename, size)
        for start,end in windows:
            if time.monotonic()-started>95:
                raise AdaptiveUnavailable('video_sampling_budget_exhausted')
            all_images.append(_decode_samples(filename,start=start,length=end-start))
    moments,info=_scene_candidates(all_images,[start for start,_ in windows],heat=heat,limit=limit)
    boards=_make_storyboards(moments)
    # Optional, strictly offline OCR of already decoded frames; NEVER of low-res
    # videoshot fallback. It is a machine estimate, not a semantic confirmation.
    try:
        from frame_ocr import extract_frame_ocr
        ocr=extract_frame_ocr(moments)
    except Exception:
        # OCR is optional: its failure must never erase decoded frame proof.
        ocr={'engine':'unavailable','segments':[],'attempted':0}

    coverage=round(sum(end-start for start,end in windows),1)
    sampling={'strategy':'decoded-storyboard-stratified-2fps','sampler_version':SAMPLER_VERSION,
              'source_type':'bili-public-playurl-durl','input_bytes':count,
              'clip_window':focus if focus else {'startSeconds':0.,'endSeconds':duration},
              'sampled_windows':[{'startSeconds':a,'endSeconds':b} for a,b in windows],
              'sampled_duration_seconds':coverage,'video_duration_seconds':duration,
              'heat_source':heat['source'] if heat else 'unavailable',
              'viewer_heat_is_content_evidence':False,'depth':depth,
              'frame_plan':configured,'frame_budget':limit,'storyboard_count':len(boards),
              'sample_interval_seconds':1/FRAME_RATE,
              'note':'全片按时间分区稀疏抽样；OCR 仅在本机可用时分析少量静帧，未理解音轨或完整播放'}
    sampling.update(info)
    sampling['ocr_engine'] = ocr['engine']
    sampling['ocr_attempted'] = ocr['attempted']
    return {'ok':True, 'bvid':bvid, 'status':'frames_ready', 'frames':boards,
            'times':[x['second'] for x in moments], 'sampling':sampling, 'ocr':ocr,
            'focus_window':focus, 'image_source':'B站公开视频片段（离线解码）',
            'notice':'每张分镜拼图包含多个带时间码的公开视频采样时刻；未逐帧观看完整视频或听到音频'}
