"""Optional offline Tesseract OCR of *locally decoded* Bilibili sample frames.

This never fetches a video, saves raw OCR to durable storage, trusts text as
instructions, or claims a continuous subtitle track. The video sampler owns
both the source and the per-frame timestamp.
"""
import csv
from io import BytesIO, StringIO
import math
from pathlib import Path
import shutil
import subprocess
from PIL import Image, ImageEnhance, ImageOps

MAX_OCR_FRAMES = 12


def _parse_tsv(tsv):
    """Only accept words with a Tesseract confidence >= 60; one short excerpt."""
    groups = {}
    for row in csv.DictReader(StringIO(tsv[:120000]), delimiter='\t'):
        try:
            confidence = float(row.get('conf', '-1'))
            text = ' '.join((row.get('text') or '').split())
            if not math.isfinite(confidence) or confidence < 60 or not text:
                continue
            key = (row.get('block_num'), row.get('par_num'), row.get('line_num'))
            groups.setdefault(key, []).append((text[:36], confidence))
        except (ValueError, TypeError):
            continue
    if not groups:
        return None
    lines = sorted(groups.values(), key=lambda parts: (-sum(x[1] for x in parts) / len(parts), -len(parts)))
    words = lines[0]
    value = ' '.join(x[0] for x in words).strip()[:120]
    if len(value) < 2:
        return None
    return {'text': value, 'confidence': round(sum(x[1] for x in words)/len(words), 1)}


def extract_frame_ocr(moments, *, executable=None, runner=subprocess.run, languages=None):
    """Machine OCR guesses at <=12 decoded timestamps; no attempt if unavailable."""
    executable = executable or shutil.which('tesseract')
    if not executable or not Path(executable).is_file() or not moments:
        return {'engine': 'unavailable', 'segments': [], 'attempted': 0}
    if languages is None:
        try:
            langs = runner([executable, '--list-langs'], capture_output=True, text=True,
                           timeout=3, check=False)
            available = set(langs.stdout.split()) | set(langs.stderr.split())
            languages = 'chi_sim+eng' if 'chi_sim' in available and 'eng' in available else (
                'chi_sim' if 'chi_sim' in available else 'eng' if 'eng' in available else None)
        except (OSError, subprocess.TimeoutExpired):
            languages = None
    if not languages or languages not in ('chi_sim+eng', 'chi_sim', 'eng'):
        return {'engine':'unavailable','segments':[],'attempted':0}
    # Time-stratified: no more than 12 OCR attempts for 12/24/48 visual samples.
    total = len(moments)
    indexes = sorted(set(round(i*(total-1)/max(1, min(total, MAX_OCR_FRAMES)-1))
                         for i in range(min(total, MAX_OCR_FRAMES))))
    extracted = []
    attempted = 0
    for index in indexes:
        moment = moments[index]
        second = moment.get('second')
        picture = moment.get('image')
        if type(second) not in (float,int) or not math.isfinite(second) or second < 0 or not isinstance(picture, Image.Image):
            continue
        try:
            # Use in-memory stdin; no extra image file or sandbox temp path.
            mono = ImageEnhance.Contrast(ImageOps.grayscale(picture.resize(
                (picture.width*3, picture.height*3), Image.Resampling.BICUBIC))).enhance(1.6)
            png = BytesIO()
            mono.save(png, format='PNG')
            attempted += 1
            reply = runner([executable,'stdin','stdout','-l',languages,'--psm','11','tsv'],
                           input=png.getvalue(), stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                           timeout=3,check=False)
            if reply.returncode != 0 or len(reply.stdout) > 120000:
                continue
            data=reply.stdout.decode('utf-8',errors='replace') if isinstance(reply.stdout,bytes) else reply.stdout
            text = _parse_tsv(data)
            if text:
                extracted.append({'atSeconds':round(float(second),3),**text})
        except (OSError, ValueError, TypeError, subprocess.TimeoutExpired):
            continue
    return {'engine':'tesseract-cli','segments':extracted[:MAX_OCR_FRAMES],
            'attempted':attempted,'languages':languages,
            'note':'仅对少量已解码静帧进行机器OCR，可能误识字；不是字幕轨，也不代表完整观看'}
