"""Read-only time-coded danmaku activity for *decoded video* frame ranking.

Never fetches player videoshot sprites. PBP is a community-documented, optional
hint, NOT verified content. A bounded XML time-only fallback never retains text
or user identifiers. Network failures simply remove this ranking signal.
"""
import json
import math
import re
from urllib import parse, request
from urllib.error import HTTPError, URLError
import xml.etree.ElementTree as ET


MAX_HEAT_POINTS = 3600


def _float(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def _pbp_curve(bvid, cid, duration):
    from preview_vision import _safe_api_get
    url = 'https://bvc.bilivideo.com/pbp/data?' + parse.urlencode({'cid': cid, 'bvid': bvid})
    response = json.loads(_safe_api_get(url, max_bytes=250_000))
    if not isinstance(response, dict):
        return None
    step = _float(response.get('step_sec'))
    values = (response.get('events') or {}).get('default')
    if step is None or not 0.5 <= step <= 120 or not isinstance(values, list):
        return None
    if not 2 <= len(values) <= MAX_HEAT_POINTS or len(values) * step > max(duration + step * 2, 43200):
        return None
    cleaned = [_float(v) for v in values]
    if any(v is None or v < 0 for v in cleaned):
        return None
    if max(cleaned) <= 0:
        return None
    return {'source': 'bili-pbp-heat-curve', 'points': cleaned, 'step': step, 'items': len(cleaned)}


def _xml_density(cid, duration):
    """An optional, size-limited *timestamp only* fallback, no identifiers/text."""
    if not isinstance(cid, int) or not 0 < cid < 10**20:
        return None
    url = 'https://comment.bilibili.com/%d.xml' % cid
    class NoRedirect(request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ValueError('弹幕 XML 不允许重定向')
    req = request.Request(url, headers={'User-Agent': 'Mozilla/5.0',
                                       'Referer': 'https://www.bilibili.com/',
                                       'Accept-Encoding': 'identity'})
    with request.build_opener(request.ProxyHandler({}), NoRedirect()).open(req, timeout=6) as response:
        if response.status != 200 or int(response.headers.get('Content-Length', '0')) > 1_000_000:
            return None
        data = response.read(1_000_001)
    if len(data) > 1_000_000 or b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        return None
    root = ET.fromstring(data)
    # 5s buckets, at most 45min and 540 buckets; no text or midHash retained.
    step = 5
    points = [0] * min(540, max(1, math.ceil(duration / step)))
    for node in root.iter('d'):
        value = (node.attrib.get('p', '').split(',', 1) or [''])[0]
        sec = _float(value)
        if sec is not None and 0 <= sec < duration:
            pos = int(sec // step)
            if 0 <= pos < len(points):
                points[pos] += 1
    if max(points) == 0:
        return None
    return {'source': 'bili-danmaku-xml-density', 'points': points,
            'step': step, 'items': sum(points)}


def obtain_heat_signal(bvid, cid, duration):
    if not re.fullmatch(r'BV[0-9A-Za-z]{10}', str(bvid or '')):
        return None
    if not isinstance(cid, int) or not 0 < cid < 10**20:
        return None
    duration = _float(duration)
    if duration is None or not 3 <= duration <= 2700:
        return None
    try:
        signal = _pbp_curve(bvid, cid, duration)
        if signal:
            return signal
    except (ValueError, KeyError, TypeError, HTTPError, URLError, OSError, ET.ParseError):
        pass
    try:
        return _xml_density(cid, duration)
    except (ValueError, TypeError, HTTPError, URLError, OSError, ET.ParseError):
        return None


def obtain_preview_heat_signal(bvid, cid, duration):
    """Optional, official read-only PBP curve for videoshot candidate ranking.

    Unlike decoded-video heat retrieval, this low-cost preview path does not
    attempt XML fallback; absence of PBP is explicitly an unavailable signal.
    """
    if not re.fullmatch(r'BV[0-9A-Za-z]{10}', str(bvid or '')):
        return None
    if not isinstance(cid, int) or not 0 < cid < 10**20:
        return None
    duration = _float(duration)
    if duration is None or not 3 <= duration <= 2700:
        return None
    try:
        return _pbp_curve(bvid, cid, duration)
    except (ValueError, KeyError, TypeError, HTTPError, URLError, OSError):
        return None


def heat_at(signal, second):
    """Bounded lag-aware heat response: a burst can follow the actual moment."""
    if not signal:
        return 0.0
    values, step = signal['points'], signal['step']
    # Include reactions up to 8s after the visual moment; before 3s only.
    nearby = [values[i] for i in range(max(0, int((second-3)/step)),
               min(len(values), int((second+8)/step)+1))]
    if not nearby:
        return 0.0
    baseline = sorted(values)[len(values)//2]
    ceiling = max(values)
    if ceiling <= baseline:
        return 0.0
    return max(0.0, min(1.0, (max(nearby)-baseline)/(ceiling-baseline)))
