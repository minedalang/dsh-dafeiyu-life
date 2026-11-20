#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
asr.py —— 把一条 B站 视频（或本地音视频文件）转成文字。
给"这个视频没有字幕、但又值得判断"的情况用。

用法（在插件的 ASR 环境里跑）：
    .venv-asr/Scripts/python.exe asr.py BV1xxxxxxxxx          # Windows
    .venv-asr/bin/python       asr.py https://www.bilibili.com/video/BV1xx
    .venv-asr/Scripts/python.exe asr.py D:\\some\\clip.mp4 -o out.txt
    …还可以加 --model small / --model medium 换模型（默认 small）

设计上的两个要点：
  ① **模型走国内镜像**（HF_ENDPOINT=hf-mirror.com）—— 否则 HuggingFace 拉不动
  ② **音频不落盘到别处**：yt-dlp 下到临时目录，转写完就随系统清理
"""
import argparse
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import shutil
import subprocess
import secrets
import time
from types import SimpleNamespace

# ⭐ Windows 上 Python 默认按 GBK 编/解码标准输出 —— 中文或 emoji 打进管道会直接炸
#    （有用户反馈装依赖 / 跑转写时报 UnicodeDecodeError 或乱码）⇒ 这里钉死 UTF-8
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

# ⚠️ 临时目录必须待在家目录里：值班那一轮跑在沙箱里（只允许写工作区/cwd），
#    yt-dlp 默认往 %TEMP% 写、会被直接拒掉（2026-10-14 在主人机器上实证：
#    yt_dlp DownloadError: unable to open for writing: [Errno 13] Permission denied）
_HOME = os.path.dirname(os.path.abspath(__file__))
_TMP = os.path.join(_HOME, 'tmp', 'asr')
try:
    os.makedirs(_TMP, exist_ok=True)
    tempfile.tempdir = _TMP
except Exception:
    pass

# ⭐ 必须在 import faster_whisper **之前**设好，否则它已经去连 HuggingFace 了
os.environ.setdefault('HF_ENDPOINT', 'https://hf-mirror.com')
# 模型缓存放本脚本所在目录（= 插件家）：默认的 ~/.cache 在本机拒绝写入
os.environ.setdefault('HF_HOME', os.path.join(os.path.dirname(os.path.abspath(__file__)), '.hf-cache'))
# HuggingFace 新版存储（Xet）国内镜像不代理 ⇒ 关掉它，走老 CDN 通道（否则 401）
os.environ.setdefault('HF_HUB_DISABLE_XET', '1')


def to_url(target: str) -> str:
    t = target.strip()
    if t.upper().startswith('BV') and len(t) <= 20:
        return 'https://www.bilibili.com/video/' + t
    return t


def fetch_audio(url: str, tmp: str, tag: str) -> str:
    """用 yt-dlp 把音频拉下来（B站 是 DASH 音视频分离，取 bestaudio 即可，不需要 ffmpeg 合并）"""
    from yt_dlp import YoutubeDL
    opts = {
        'format': 'bestaudio/best',
        'outtmpl': os.path.join(tmp, tag + '.%(ext)s'),   # ⭐ 用 BV 号当文件名：固定名会和别的轮次撞车（踩过）
        'paths': {'home': tmp, 'temp': tmp},   # 别让 yt-dlp 往 %TEMP% 写（沙箱会拒）
        'cachedir': False,                      # 顺手别去动用户目录里的缓存
        # ⭐ nopart：不写 .part 再改名，直接落最终文件。
        #    沙箱里"新建文件 + 改名"会被拒，而这条能绕开（2026-10-14 值班那一轮自己试出来的）
        'nopart': True,
      # [2026-10-20 · 参考社区 PR #23] 进度条默认打到 stdout ⇒ 调用方"stdout 非空=成功"恒真 ✗
      #   我们是读文件走的，把进度关掉，别污染输出
      'noprogress': True,
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
        'socket_timeout': 20,
        'retries': 2,
        'fragment_retries': 2,
        'http_headers': {
            'Referer': 'https://www.bilibili.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
    }
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return ydl.prepare_filename(info)


# Full-duration ASR is the default, including videos longer than eight minutes.
# An operator-only environment override may opt into representative clips.
# Full-audio-attempt means audio was submitted to ASR; it is NOT a claim
# of understanding every sentence or watching the complete video.
LONG_ASR_THRESHOLD_SECONDS = 8 * 60
LONG_ASR_SAMPLE_WINDOWS = 3
LONG_ASR_WINDOW_SECONDS = 60


def _audio_duration(src):
    """Probe local audio only; never pass a URL or model-supplied command."""
    ffprobe = shutil.which('ffprobe')
    if not ffprobe:
        return None
    try:
        result = subprocess.run([ffprobe, '-v', 'error', '-show_entries',
            'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', src],
            capture_output=True, text=True, timeout=12)
        value = float(result.stdout.strip()) if result.returncode == 0 else 0
        return value if math.isfinite(value) and 3 <= value <= 4 * 3600 else None
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def _clip_windows(duration):
    """Three separated bounded windows, with original video timeline offsets."""
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration < LONG_ASR_THRESHOLD_SECONDS:
        return []
    span = LONG_ASR_WINDOW_SECONDS
    centers = (span / 2, duration / 2, duration - span / 2)
    windows = [(round(max(0., min(duration-span, c-span/2)), 3), span) for c in centers]
    # Do not unintentionally duplicate a clip near the threshold.
    return list(dict.fromkeys(windows))


def _sample_audio_windows(src, tmp, tag):
    """Return safe local WAV excerpts, or None if sampling cannot be used.

    Missing FFmpeg/probe falls back to the existing full transcription rather
    than pretending the model heard an unknown number of seconds.
    """
    # Fail toward full ASR on unknown config: a sample must be explicitly chosen.
    if os.environ.get('BILI_ASR_LONG_VIDEO_MODE', 'full').strip().lower() != 'sample':
        return None
    ffmpeg = shutil.which('ffmpeg')
    duration = _audio_duration(src)
    windows = _clip_windows(duration)
    if not ffmpeg or not windows:
        return None
    samples = []
    try:
        for i, (start, length) in enumerate(windows):
            out = os.path.join(tmp, tag + '.sample%d.wav' % i)
            result = subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error',
                '-nostdin', '-ss', str(start), '-i', src, '-t', str(length),
                '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', out],
                capture_output=True, timeout=35, **_hidden_windows_child())
            if result.returncode != 0 or not os.path.isfile(out) or os.path.getsize(out) < 512:
                return None
            samples.append((out, start, length))
        return {'duration':duration,'samples':samples,'windows':windows}
    except (OSError, subprocess.SubprocessError):
        return None


def _hidden_windows_child():
    if os.name != 'nt':
        return {}
    return {'creationflags': getattr(subprocess, 'CREATE_NO_WINDOW', 0)}


def _offset_segments(segments, offset):
    """Whisper clip-relative seconds become truthful original-audio seconds."""
    for item in segments:
        start, end = getattr(item, 'start', None), getattr(item, 'end', None)
        yield SimpleNamespace(text=getattr(item, 'text', ''),
            start=(start + offset) if isinstance(start, (int,float)) else None,
            end=(end + offset) if isinstance(end, (int,float)) else None)


def _asr_receipt(bvid, pieces, *, sampling=None):
    """Keep only explicitly timed Whisper spans; never infer time from plain text."""
    rows = []
    text_parts = []
    for part in pieces:
        body = ' '.join(str(getattr(part, 'text', '') or '').split())
        if not body:
            continue
        text_parts.append(body)
        a, b = getattr(part, 'start', None), getattr(part, 'end', None)
        if (type(a) in (int, float) and type(b) in (int, float)
            and math.isfinite(a) and math.isfinite(b) and 0 <= a < b <= 43200):
            rows.append({'startSeconds': round(a, 3), 'endSeconds': round(b, 3),
                         'text': body[:180]})
        if len(text_parts) >= 2500:
            break
    if len(rows) > 160:
        rows = [rows[round(i * (len(rows) - 1) / 159)] for i in range(160)]
    result = {'bvid': bvid, 'source': 'local-asr', 'asr_evidence': 'faster-whisper-machine-transcript',
            'text': ' '.join(text_parts)[:12000], 'timed_segments': rows,
            'can_claim_audio_listened': False, 'can_claim_full_video_watched': False,
            'coverage': 'representative-windows' if sampling else 'full-audio-attempt'}
    if sampling:
        result['audioDurationSeconds'] = round(sampling['duration'], 3)
        result['sampleWindows'] = [{'startSeconds':start, 'endSeconds':round(start+length,3)}
                                   for start, length in sampling['windows']]
    return result



# Durable but short-lived local-only cache, for repeated *owner-authorized* BV
# reads. A successful cache hit does not relax the MCP read/permission gate.
_ASR_CACHE_VERSION=1
_ASR_CACHE_TTL=7*24*3600

def _asr_cache_file(bvid, model, lang):
    if not re.fullmatch(r'BV[0-9A-Za-z]{10}', bvid) or not re.fullmatch(r'[A-Za-z0-9-]{1,24}', model) or lang not in ('auto','zh','en'):
        return None
    home_value=os.environ.get('BILI_DUTY_HOME','').strip()
    if not home_value or os.environ.get('BILI_ASR_MODEL_PATH','').strip():return None # do not cache source-tree runs or mutable custom models
    home=Path(home_value)
    folder=home/'asr-transcript-cache'
    if folder.is_symlink() or (folder.exists() and not folder.is_dir()):return None
    return folder/(f'{bvid}-{model}-{lang}-v{_ASR_CACHE_VERSION}.json')

def _read_asr_cache(bvid,model,lang):
    path=_asr_cache_file(bvid,model,lang)
    if path is None or path.is_symlink() or not path.is_file():return None
    try:
        if path.stat().st_size>64000:return None
        item=json.loads(path.read_text(encoding='utf8'))
        if (item.get('version')!=_ASR_CACHE_VERSION or item.get('bvid')!=bvid or
            item.get('model')!=model or item.get('lang')!=lang or
            not isinstance(item.get('createdAt'),(int,float)) or
            not 0<=time.time()-item['createdAt']<=_ASR_CACHE_TTL):return None
        receipt=item.get('receipt')
        if (not isinstance(receipt,dict) or receipt.get('source')!='local-asr' or
            receipt.get('bvid')!=bvid or not isinstance(receipt.get('text'),str) or
            not receipt['text'].strip() or not isinstance(receipt.get('timed_segments'),list) or
            len(receipt['timed_segments'])>160):return None
        receipt=dict(receipt)
        receipt['cacheHit']=True
        receipt['languageMode']=lang
        receipt['timings']={'schema':'life-asr-phase-timings/v1',
            'audioDownloadMs':0,'modelLoadMs':0,'clipExtractionMs':0,
            'inferenceMs':0,'receiptMs':0,'totalMs':0}
        return receipt
    except (OSError,ValueError,TypeError,KeyError):return None

def _write_asr_cache(bvid,model,lang,receipt):
    path=_asr_cache_file(bvid,model,lang)
    if path is None or not isinstance(receipt,dict) or not receipt.get('text'):return
    try:
        path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        if path.parent.is_symlink() or path.is_symlink():return
        safe={k:receipt[k] for k in ('bvid','source','asr_evidence','text','timed_segments','coverage') if k in receipt}
        for key in ('audioDurationSeconds','sampleWindows'):
            if key in receipt:safe[key]=receipt[key]
        if safe.get('source')!='local-asr' or len(safe.get('text',''))>12000:return
        payload=json.dumps({'version':_ASR_CACHE_VERSION,'bvid':bvid,'model':model,
                            'lang':lang,'createdAt':time.time(),'receipt':safe},ensure_ascii=False)
        if len(payload.encode('utf8'))>64000:return
        tmp=path.with_name(path.name+'.'+str(os.getpid())+'.tmp')
        try:
            with open(tmp,'x',encoding='utf8') as stream:stream.write(payload)
            os.chmod(tmp,0o600)
            os.replace(tmp,path)
        finally:
            if tmp.exists():tmp.unlink()
    except (OSError,ValueError,TypeError):pass # cache failure never blocks speech

def main() -> int:
    ap = argparse.ArgumentParser(description='把一条视频转成文字（默认自动检测语种）')
    ap.add_argument('target', help='BV 号 / B站链接 / 本地音视频文件')
    ap.add_argument('-o', '--out', help='写到这个文件（不给就打到标准输出）')
    ap.add_argument('--model', default=os.environ.get('BILI_DUTY_ASR_MODEL', 'small'),
                    help='Whisper 模型大小：tiny / base / small / medium（默认 small）')
    ap.add_argument('--lang', default=os.environ.get('BILI_ASR_LANGUAGE','auto'), choices=('auto','zh','en'), help='语种 auto（默认）/中文/英文')
    ap.add_argument('--json', action='store_true', help='输出带明确时间戳的 JSON 回执（只供受限 MCP 调用）')
    args = ap.parse_args()

    if args.json and not re.fullmatch(r'BV[0-9A-Za-z]{10}', args.target):
        print('[asr] JSON 模式仅允许精确 BV 号', file=sys.stderr)
        return 2
    # Explicit language setting + account-safe gate are enforced by the MCP
    # caller first. Cache only a validated public BV JSON result, never local files.
    if args.json and os.environ.get('BILI_ASR_CACHE','1')!='0':
        cached=_read_asr_cache(args.target,args.model,args.lang)
        if cached is not None:
            print(json.dumps(cached,ensure_ascii=False))
            return 0
    src = args.target
    # ⚠️ 不用 mkdtemp：沙箱只允许写"子进程启动前就存在"的目录，新建的会被拒 ✗
    #    这个目录由宿主（插件）预先建好；文件名固定，跑完自己清掉
    tmp = _TMP
    # ⭐ 每个视频用**自己的**文件名：以前写死 audio.m4a ⇒ 两轮同时跑会互相覆盖，
    #    上一轮转出来的其实是另一个视频的内容（2026-10-14 值班那轮亲踩 ✗）
    tag = os.path.basename(src).rsplit('.', 1)[0] or 'clip'
    tag = (re.sub(r'[^0-9A-Za-z_-]', '_', tag)[:32] or 'clip') + '-' + secrets.token_hex(4)
    clock = time.perf_counter
    started = clock()
    phase_ms = {'audioDownloadMs':0, 'modelLoadMs':0,
                'clipExtractionMs':0, 'inferenceMs':0, 'receiptMs':0}
    try:
        phase_at = clock()
        if src.lower().startswith('http') or src.upper().startswith('BV'):
            print('[asr] 先下音频…', file=sys.stderr)
            src = fetch_audio(to_url(src), tmp, tag)
        phase_ms['audioDownloadMs'] = round((clock()-phase_at)*1000)
        if not os.path.exists(src):
            print('[asr] 找不到文件：' + src, file=sys.stderr)
            return 2

        local_model = os.environ.get('BILI_ASR_MODEL_PATH', '').strip() if args.json else ''
        if local_model:
            model_dir = Path(local_model)
            if (not model_dir.is_absolute() or not model_dir.is_dir()
                or not (model_dir / 'model.bin').is_file()
                or not (model_dir / 'config.json').is_file()):
                print('[asr] 自定义模型目录缺少 model.bin / config.json', file=sys.stderr)
                return 2
            model_source = str(model_dir.resolve())
        else:
            model_source = args.model
        phase_at = clock()
        from faster_whisper import WhisperModel
        print('[asr] 加载模型 %s（第一次会自动下模型，之后就是本地读）…' % args.model, file=sys.stderr)
        model = WhisperModel(model_source, device='cpu', compute_type='int8')
        phase_ms['modelLoadMs'] = round((clock()-phase_at)*1000)
        phase_at = clock()
        sampling = _sample_audio_windows(src, tmp, tag)
        phase_ms['clipExtractionMs'] = round((clock()-phase_at)*1000)
        print('[asr] 开始转写…', file=sys.stderr)
        def transcribe(audio):
            return model.transcribe(audio,
                language=None if args.lang == 'auto' else args.lang,
                vad_filter=True,
                beam_size=1,
                condition_on_previous_text=False)[0]
        inference_at = clock()
        if sampling:
            print('[asr] 按操作者设置：仅转写 3 个代表性窗口（非整段转写）', file=sys.stderr)
            from itertools import chain
            segments = chain.from_iterable(_offset_segments(transcribe(filename), offset)
                for filename, offset, _length in sampling['samples'])
        else:
            segments = transcribe(src)
        # Whisper returns lazy segment iterators; consuming the receipt is
        # when inference actually happens, not when transcribe() is invoked.
        from itertools import islice
        parts = list(islice(segments, 2500))
        phase_ms['inferenceMs'] = round((clock()-inference_at)*1000)
        phase_at = clock()
        receipt = _asr_receipt(args.target, parts, sampling=sampling)
        phase_ms['receiptMs'] = round((clock()-phase_at)*1000)
        receipt['timings'] = {'schema':'life-asr-phase-timings/v1',
                              **phase_ms,'totalMs':round((clock()-started)*1000)}
        receipt['languageMode']=args.lang
        if args.json and receipt.get('text') and os.environ.get('BILI_ASR_CACHE','1')!='0':
            _write_asr_cache(args.target,args.model,args.lang,receipt)
        text = receipt['text']
    finally:
        # 临时音频不留在磁盘上
        try:
            import glob
            for f in glob.glob(os.path.join(tmp, tag + '.*')):
                try:
                    os.remove(f)
                except Exception:
                    pass
        except Exception:
            pass

    if args.json:
        print(json.dumps(receipt, ensure_ascii=False))
        return 0
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(text)
        print('[asr] 已写入：' + args.out, file=sys.stderr)
    else:
        print(text)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
