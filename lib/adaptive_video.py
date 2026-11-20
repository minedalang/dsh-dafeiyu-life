"""Bounded, opt-in sampling of a *public* Bilibili video stream.

This is not playback or audio perception. Signed playback URLs are only accepted
from Bilibili's official playurl API. No arbitrary URL, Cookie, ffmpeg network
access, persistent video files, or unrestricted download is supported.
"""
from collections import deque
from io import BytesIO
import json
import bisect
import math
import http.client
import ipaddress
import socket
import os
from pathlib import Path
import re
import shutil
import statistics
import subprocess


def _hidden_windows_child():
    # FFmpeg/FFprobe do not require a console: their stdin/stdout/stderr are
    # redirected by our callers. Windows' CREATE_NO_WINDOW may still create a
    # short-lived visible pseudo-console host on some FFmpeg builds. Use the
    # DETACHED_PROCESS creation mode for these offline decoders ONLY; never use
    # it for MCP stdio or the parent DSH/Python process.
    options = {'creationflags': (getattr(subprocess, 'DETACHED_PROCESS', 0)
                                 if os.name == 'nt' else 0)}
    if os.name == 'nt' and not options['creationflags']:
        options['creationflags'] = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    if os.name == 'nt' and hasattr(subprocess, 'STARTUPINFO'):
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0  # SW_HIDE (no console/GUI window request)
        options['startupinfo'] = startup
    return options
import tempfile
import time
from urllib import parse, request
from urllib.error import HTTPError, URLError

from PIL import Image, ImageChops, ImageStat, ImageDraw
from video_traffic import count_bytes, original_bytes, traffic_scope

BV_RE = re.compile(r'BV[0-9A-Za-z]{10}\Z')
VIDEO_FILE_MAX = 24 * 1024 * 1024  # Legacy small-file threshold, not a video-size gate.
NETWORK_BUDGETS = {12: 24 * 1024 * 1024, 24: 50 * 1024 * 1024,
                   48: 100 * 1024 * 1024}
MAX_REMOTE_SIZE = 1024 * 1024 * 1024  # Limit sparse local media virtual length.
MAX_INDEX_BYTES = 8 * 1024 * 1024
FRAME_W, FRAME_H, FRAME_RATE = 192, 108, 2
FOCUS_W, FOCUS_H = 640, 360  # Up to 360p; preserve aspect, never enlarge low-res source.
MAX_WINDOW = 120
MAX_FRAMES = MAX_WINDOW * FRAME_RATE
SAMPLER_VERSION = 8
MAX_SUPPORTED_DURATION = 4 * 3600  # 4-hour bounded index; network/frame budgets unchanged
FRAME_PLANS = (12, 24, 48)


class AdaptiveUnavailable(ValueError):
    def __init__(self, code, *, fallback=True, authority_detail=None, track=None):
        super().__init__(code)
        self.code = code
        self.fallback = fallback
        # Static enumerations only: no signed URL, hostname or raw parser error.
        allowed = {'userinfo', 'reserved-port', 'url-fragment', 'malformed-authority'}
        self.authority_detail = authority_detail if authority_detail in allowed else None
        self.track = track if track in ('durl', 'dash') else None


def _cdn_url(url):
    """Validate one HTTPS media-shaped URL from the current official PlayURL.

    This is deliberately NOT a global CDN-domain whitelist. Authorization is
    contextual: callers only obtain candidates from the official authenticated
    HTTPS playurl lookup, never from users, Life text or a persisted URL. Every
    actual request also pins a public DNS address and verifies TLS/redirects.
    """
    if not isinstance(url, str) or not 12 <= len(url) <= 4096 or url != url.strip():
        raise AdaptiveUnavailable('unsafe_video_source')
    if any(ord(ch) < 33 or ord(ch) > 126 for ch in url) or "\\" in url:
        raise AdaptiveUnavailable('unsafe_video_source')
    if url.startswith('//'):
        url = 'https:' + url
    try:
        parsed = parse.urlsplit(url)
        host = (parsed.hostname or '').lower()
        port = parsed.port
        userinfo = parsed.username is not None or parsed.password is not None
    except ValueError:
        raise AdaptiveUnavailable('video_source_authority_rejected',
                                  authority_detail='malformed-authority') from None
    if parsed.scheme != 'https':
        raise AdaptiveUnavailable('video_source_scheme_rejected')
    if userinfo:
        raise AdaptiveUnavailable('video_source_authority_rejected', authority_detail='userinfo')
    if parsed.fragment:
        raise AdaptiveUnavailable('video_source_authority_rejected', authority_detail='url-fragment')
    # Any valid HTTPS port can be used by the official CDN. There is no user-
    # supplied URL path into this transport. IP literals are not accepted:
    # original DNS name is required for verified TLS and pinned global IP.
    if not host or len(host) > 253 or not re.fullmatch(
        r'[a-z0-9-]+(?:\.[a-z0-9-]+)+', host) or any(
        len(label) > 63 or label.startswith('-') or label.endswith('-')
        for label in host.split('.')):
        raise AdaptiveUnavailable('video_source_domain_rejected')
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise AdaptiveUnavailable('video_source_domain_rejected')
    if port is not None and not 1 <= port <= 65535:
        raise AdaptiveUnavailable('video_source_authority_rejected', authority_detail='malformed-authority')
    # Keep an unambiguous path and familiar media file signature. This is a
    # shape check, not an ossified CDN path-prefix allowlist.
    path = parsed.path
    if (not 1 <= len(path) <= 1024 or not path.startswith('/') or
        '%' in path or '//' in path or any(part in ('.','..') for part in path.split('/'))):
        raise AdaptiveUnavailable('video_source_path_rejected')
    if not re.fullmatch(r'/[A-Za-z0-9_./-]{1,1023}\.(?:mp4|m4v|flv|m4s)', path, re.I):
        raise AdaptiveUnavailable('video_source_format_rejected')
    return url


# Do not trust DNS resolution as authorization: an approved CDN name can still
# resolve to an internal address in a compromised DNS environment. Resolve and
# connect to the SAME public address (no DNS rebinding window), while TLS still
# authenticates the original hostname. No ambient HTTP(S) proxy is inherited.
def _public_cdn_addresses(host, port):
    try:
        rows = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, OSError):
        raise AdaptiveUnavailable('video_source_dns_unavailable') from None
    if not rows or len(rows) > 32:
        raise AdaptiveUnavailable('video_source_dns_unavailable')
    safe = []
    for family, kind, proto, _, sockaddr in rows:
        if family not in (socket.AF_INET, socket.AF_INET6):
            raise AdaptiveUnavailable('video_source_ip_rejected', fallback=False)
        try:
            addr = ipaddress.ip_address(sockaddr[0])
        except ValueError:
            raise AdaptiveUnavailable('video_source_ip_rejected', fallback=False) from None
        if not addr.is_global:
            raise AdaptiveUnavailable('video_source_ip_rejected', fallback=False)
        safe.append((family, kind, proto, sockaddr))
    return safe


class _PinnedCDNHTTPS(http.client.HTTPSConnection):
    def connect(self):
        # The full URL must already have passed _cdn_url(). HTTPS hostname
        # verification and SNI use self.host, never the resolved numeric IP.
        candidates = _public_cdn_addresses(self.host, self.port)
        last_error = None
        for family, kind, proto, sockaddr in candidates[:8]:
            sock = socket.socket(family, kind, proto)
            try:
                sock.settimeout(self.timeout)
                if self.source_address:
                    sock.bind(self.source_address)
                sock.connect(sockaddr)
                self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
                return
            except (OSError, TimeoutError) as exc:
                last_error = exc
                sock.close()
        raise AdaptiveUnavailable('video_cdn_connection_failed') from None


class _PinnedCDNHandler(request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_PinnedCDNHTTPS, req)


def _cdn_opener(redirect_handler):
    # An environment HTTP_PROXY must never substitute an unverified target.
    return request.build_opener(request.ProxyHandler({}), _PinnedCDNHandler(), redirect_handler)

def _dash_ranges(stream):
    """Only literal DASH SegmentBase byte intervals supplied by official playurl."""
    base = stream.get('SegmentBase') or stream.get('segment_base') or {}
    if not isinstance(base, dict):
        raise AdaptiveUnavailable('dash_segmentbase_unavailable')
    def interval(value, limit):
        match = re.fullmatch(r'(\d{1,14})-(\d{1,14})', str(value or ''))
        if not match:
            raise AdaptiveUnavailable('dash_segmentbase_unavailable')
        start, end = map(int, match.groups())
        if not (0 <= start <= end < MAX_REMOTE_SIZE and end-start+1 <= limit):
            raise AdaptiveUnavailable('dash_segmentbase_invalid', fallback=False)
        return start, end
    initial = interval(base.get('Initialization') or base.get('initialization'), MAX_INDEX_BYTES)
    index = interval(base.get('indexRange') or base.get('index_range'), MAX_INDEX_BYTES)
    if initial[0] != 0 or index[0] <= initial[1] or index[1] > MAX_INDEX_BYTES*2:
        raise AdaptiveUnavailable('dash_segmentbase_invalid', fallback=False)
    return initial, index


def _official_track_urls(stream):
    """Finite candidate URLs exclusively from ONE official DASH track."""
    raw = [stream.get('baseUrl') or stream.get('base_url')]
    backups = stream.get('backupUrl') or stream.get('backup_url') or []
    if isinstance(backups, list):
        raw.extend(backups[:4])
    valid, rejections = [], []
    for candidate in raw:
        try:
            checked = _cdn_url(candidate)
            if parse.urlsplit(checked).path.lower().endswith('.m4s') and checked not in valid:
                valid.append(checked)
        except AdaptiveUnavailable as exc:
            rejections.append(exc)
    return valid[:3],rejections


def _choose_dash_video(data):
    dash = data.get('dash') or {}
    if not isinstance(dash, dict) or not isinstance(dash.get('video'), list):
        raise AdaptiveUnavailable('dash_stream_unavailable')
    supported = []
    rejections = []
    for stream in dash['video'][:20]:
        if not isinstance(stream, dict):
            continue
        urls, failures = _official_track_urls(stream)
        rejections.extend(failures)
        if not urls:
            continue
        try:
            initial, index = _dash_ranges(stream)
            bandwidth = int(stream.get('bandwidth') or 0)
            if bandwidth < 0:
                continue
            supported.append((bandwidth, urls, initial, index))
        except AdaptiveUnavailable as exc:
            rejections.append(exc)
        except (ValueError, TypeError):
            continue
    if not supported:
        source_rejections = [r for r in rejections if r.code.startswith('video_source_')]
        if source_rejections and len(source_rejections) == len(rejections):
            first=source_rejections[0]
            raise AdaptiveUnavailable(first.code, authority_detail=first.authority_detail, track='dash')
        raise AdaptiveUnavailable('dash_indexed_video_unavailable')
    # Prefer least bandwidth when visual detail is sufficient. Higher resolution
    # is selected only for an explicit Life focus operation, not automatically.
    supported.sort(key=lambda item: item[0])
    _, urls, initial, index = supported[0]
    return {'kind':'dash','url':urls[0], 'urls':urls, 'initial':initial,'index':index,
            'track_selection':'lowest-bandwidth'}


def _playurl(bvid, *, force_dash=False, expected_cid=None):
    """Use official public DURL first; if absent/unsupported, request indexed DASH.

    Never derive a CDN URL from the video title, model output or a third-party URL.
    The legacy DURL tuple stays stable for existing callers and tests.
    """
    from preview_vision import _json_api
    try:
        info = _json_api('https://api.bilibili.com/x/web-interface/view?' + parse.urlencode({'bvid': bvid}))
    except ValueError as exc:
        if '-509' in str(exc) or '-412' in str(exc):
            raise AdaptiveUnavailable('platform_rate_limited', fallback=False) from None
        raise AdaptiveUnavailable('public_video_metadata_unavailable') from None
    if info.get('bvid') and info['bvid'] != bvid:
        raise AdaptiveUnavailable('video_identity_mismatch', fallback=False)
    pages = info.get('pages') or []
    page = pages[0] if pages else info
    cid = page.get('cid')
    duration = page.get('duration') or info.get('duration')
    try:
        duration = float(duration)
    except (ValueError, TypeError):
        raise AdaptiveUnavailable('video_duration_unavailable') from None
    if not cid or not math.isfinite(duration) or duration < 3 or duration > MAX_SUPPORTED_DURATION:
        raise AdaptiveUnavailable('video_duration_outside_supported_range')
    if expected_cid is not None and int(cid) != expected_cid:
        raise AdaptiveUnavailable('video_identity_mismatch',fallback=False)
    def playurl(fnval):
        try:
            return _json_api('https://api.bilibili.com/x/player/playurl?' + parse.urlencode({
                'bvid': bvid, 'cid': cid, 'qn': 16, 'fnval': fnval, 'fourk': 0}))
        except ValueError as exc:
            if '-509' in str(exc) or '-412' in str(exc):
                raise AdaptiveUnavailable('platform_rate_limited', fallback=False) from None
            raise AdaptiveUnavailable('public_playurl_unavailable') from None
    progressive_rejection = None
    if not force_dash:
        progressive = playurl(1)
        durls = progressive.get('durl') or []
        if len(durls) == 1 and isinstance(durls[0], dict):
            stream = durls[0]
            try:
                size = int(stream['size'])
            except (ValueError, KeyError, TypeError):
                raise AdaptiveUnavailable('video_size_unavailable') from None
            if size <= 0 or size > MAX_REMOTE_SIZE:
                raise AdaptiveUnavailable('video_size_outside_supported_range', fallback=False)
            try:
                url = _cdn_url(stream.get('url'))
            except AdaptiveUnavailable as exc:
                # A rejected progressive CDN URL must not stop us inspecting the
                # *separate, official* DASH listing. Never fetch the rejected URL.
                exc.track = 'durl'
                progressive_rejection = exc
            else:
                # MP4 is seekable. Large FLV needs an indexed DASH track.
                if not url.lower().split('?',1)[0].endswith('.flv') or size <= NETWORK_BUDGETS[12]:
                    return url, size, duration, int(cid)
    data = playurl(16)
    try:
        dash = _choose_dash_video(data)
    except AdaptiveUnavailable as exc:
        # Preserve the original cause if DASH is absent; no URLs or tokens leak.
        if progressive_rejection and exc.code == 'dash_stream_unavailable':
            raise progressive_rejection from None
        raise
    dash.update(duration=duration, cid=int(cid))
    return dash


def _dash_probe_size(url):
    """Exactly one byte to establish size/identity, never HEAD or a full 200."""
    url = _cdn_url(url)
    class Redirect(request.HTTPRedirectHandler):
        hops = 0
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            self.hops += 1
            if self.hops > 3:
                raise AdaptiveUnavailable('too_many_video_redirects', fallback=False)
            _cdn_url(newurl)
            return super().redirect_request(req, fp, code, msg, headers, newurl)
    req = request.Request(url, headers={
        'User-Agent':'Mozilla/5.0','Referer':'https://www.bilibili.com/',
        'Accept-Encoding':'identity','Range':'bytes=0-0'})
    try:
        with _cdn_opener(Redirect()).open(req, timeout=8) as resp:
            _cdn_url(resp.url)
            if resp.status != 206:
                raise AdaptiveUnavailable('video_range_not_supported', fallback=False)
            match = re.fullmatch(r'bytes\s+0-0/(\d+)',resp.headers.get('Content-Range','').strip(),re.I)
            if not match:
                raise AdaptiveUnavailable('video_range_identity_mismatch', fallback=False)
            size = int(match.group(1))
            if not 1024 <= size <= MAX_REMOTE_SIZE:
                raise AdaptiveUnavailable('video_size_outside_supported_range',fallback=False)
            probe = resp.read(2)
            count_bytes('original', len(probe))
            if len(probe) != 1:
                raise AdaptiveUnavailable('video_range_truncated',fallback=False)
            return size, resp.headers.get('ETag',''), resp.headers.get('Last-Modified','')
    except HTTPError as exc:
        if exc.code in (412,429):
            raise AdaptiveUnavailable('platform_rate_limited',fallback=False) from None
        raise AdaptiveUnavailable('dash_range_probe_http_error') from None
    except (URLError, TimeoutError, OSError):
        raise AdaptiveUnavailable('dash_range_probe_failed') from None


def _dash_sidx(payload, offset, remote_size):
    """Parse a flat ISO BMFF sidx. Reject hierarchical/indeterminate refs."""
    cursor = 0
    while cursor+8 <= len(payload):
        length = int.from_bytes(payload[cursor:cursor+4], 'big')
        kind = payload[cursor+4:cursor+8]
        if length < 8 or cursor+length > len(payload):
            raise AdaptiveUnavailable('dash_sidx_invalid', fallback=False)
        if kind == b'sidx':
            box = payload[cursor:cursor+length]
            version = box[8] if len(box)>8 else -1
            if version not in (0,1):
                raise AdaptiveUnavailable('dash_sidx_invalid', fallback=False)
            pos = 16
            if len(box) < 32:
                raise AdaptiveUnavailable('dash_sidx_invalid',fallback=False)
            timescale = int.from_bytes(box[pos:pos+4],'big');pos+=4
            count_bytes = 8 if version==1 else 4
            if timescale == 0 or timescale > 10**9 or len(box)<pos+2*count_bytes+4:
                raise AdaptiveUnavailable('dash_sidx_invalid',fallback=False)
            earliest = int.from_bytes(box[pos:pos+count_bytes],'big');pos+=count_bytes
            first_offset = int.from_bytes(box[pos:pos+count_bytes],'big');pos+=count_bytes
            pos+=2
            count = int.from_bytes(box[pos:pos+2],'big');pos+=2
            if count < 1 or count > 20000 or pos+count*12 > len(box):
                raise AdaptiveUnavailable('dash_sidx_invalid',fallback=False)
            byte_at = offset+cursor+length+first_offset
            time_at = earliest/timescale
            entries=[]
            for _ in range(count):
                raw_size = int.from_bytes(box[pos:pos+4],'big');pos+=4
                duration = int.from_bytes(box[pos:pos+4],'big');pos+=4
                sap = int.from_bytes(box[pos:pos+4],'big');pos+=4
                size = raw_size & 0x7fffffff
                if (raw_size & 0x80000000 or size<16 or duration<=0
                    or byte_at+size>remote_size or (sap & 0x80000000)==0):
                    raise AdaptiveUnavailable('dash_sidx_unusable', fallback=False)
                entries.append({'start':time_at,'end':time_at+duration/timescale,
                                'a':byte_at,'b':byte_at+size-1})
                time_at+=duration/timescale
                byte_at+=size
            return entries
        cursor+=length
    raise AdaptiveUnavailable('dash_sidx_unavailable')


def _dash_sample_refs(entries, windows, *, focus=None):
    """One independently decodable SAP fragment per timeline stratum."""
    wanted = []
    if focus:
        left,right=float(focus['startSeconds']),float(focus['endSeconds'])
        points=[left+(right-left)*(i+.5)/min(6,max(2,int((right-left)/3)))
                for i in range(min(6,max(2,int((right-left)/3))))]
    else:
        points=[(left+right)/2 for left,right in windows]
    for point in points:
        eligible=[e for e in entries if e['start']<=point<e['end']]
        if not eligible:
            continue
        entry=eligible[0]
        if entry not in wanted:
            wanted.append(entry)
    if not wanted:
        raise AdaptiveUnavailable('dash_timeline_not_indexed')
    return wanted


def _download_dash_samples(source, folder, windows, focus, budget, deadline=None):
    """Download only validated fMP4 fragments, decode from disposable local files.

    SIDX positions and SAP flags are official signed-track metadata, not freeform
    model decisions. FFmpeg never receives a network URL. Budget includes the
    one-byte size probe, initialization and index ranges, and each fragment.
    """
    urls = source.get('urls') or [source['url']]
    if not isinstance(urls, list) or not 1 <= len(urls) <= 3:
        raise AdaptiveUnavailable('dash_stream_unavailable')
    last_probe_error = None
    # Attempt one signed primary and up to two official same-track backups.
    # Only a failed one-byte probe retries; NEVER retry a failed body/range
    # identity or budget check against another host.
    probes = 0
    for url in urls:
        probes += 1
        try:
            size, etag, modified = _dash_probe_size(url)
            break
        except AdaptiveUnavailable as exc:
            if exc.code not in ('video_cdn_connection_failed', 'dash_range_probe_failed',
                                'dash_range_probe_http_error'):
                raise
            last_probe_error = exc
    else:
        raise last_probe_error or AdaptiveUnavailable('dash_range_probe_failed')
    media = _SparseRangeVideo(url,Path(folder)/'dash-remote.sparse',size,budget,**({'deadline':deadline} if deadline is not None else {}))
    media.etag,media.modified=etag,modified
    # Count the range size probe as received network data (re-fetched byte 0
    # stays outside the cached data regions).
    media.downloaded = probes  # Conservatively count all backup probes.
    initial, index = source['initial'],source['index']
    if index[1]>=size:
        raise AdaptiveUnavailable('dash_segmentbase_invalid',fallback=False)
    init_data = media.fetch(*initial)
    if len(init_data)<16 or init_data[4:8] != b'ftyp':
        raise AdaptiveUnavailable('dash_initialization_invalid',fallback=False)
    if b'moov' not in init_data:
        raise AdaptiveUnavailable('dash_initialization_invalid',fallback=False)
    index_data = media.fetch(*index)
    entries = _dash_sidx(index_data,index[0],size)
    selected = _dash_sample_refs(entries,windows,focus=focus)
    required=sum(e['b']-e['a']+1 for e in selected)
    if required>budget-media.downloaded:
        # Preserve time spread by dropping alternating strata, never fetching a
        # partial media fragment or falsely claiming all requested windows.
        while len(selected)>2 and required>budget-media.downloaded:
            selected=selected[::2] if len(selected)%2 else selected[::2]+selected[-1:]
            selected=list({e['a']:e for e in selected}.values())
            required=sum(e['b']-e['a']+1 for e in selected)
    if required>budget-media.downloaded:
        raise AdaptiveUnavailable('dash_segment_budget_insufficient',fallback=False)
    jobs=[]
    for n, e in enumerate(selected):
        if time.monotonic() >= media.deadline:
            raise AdaptiveUnavailable('video_sampling_budget_exhausted', fallback=False)
        fragment=media.fetch(e['a'],e['b'])
        if len(fragment)<16 or fragment[4:8] not in (b'styp',b'moof'):
            raise AdaptiveUnavailable('dash_fragment_invalid',fallback=False)
        if b'moof' not in fragment[:256]:
            raise AdaptiveUnavailable('dash_fragment_invalid',fallback=False)
        path=Path(folder)/f'dash-segment-{n}.mp4'
        with open(path,'xb') as stream:
            stream.write(init_data)
            stream.write(fragment)
        # The timeline is from the signed SIDX, not the decoder's local
        # file-relative time. The decode command will seek the source PTS.
        start=max(e['start'],float(focus['startSeconds']) if focus else e['start'])
        offset=start-e['start']
        length=min(3.,e['end']-start-.05,
                   float(focus['endSeconds'])-start if focus else 3.)
        if length<=0:
            raise AdaptiveUnavailable('dash_fragment_too_short',fallback=False)
        jobs.append((path,start,length,offset))
    return jobs, media.downloaded, len(media.ranges)+1, size


def _download_video(url, path, expected_size, *, budget=VIDEO_FILE_MAX, deadline=None):
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
    total = 0
    try:
        with _cdn_opener(SecureRedirect()).open(req, timeout=8) as resp:
            _cdn_url(resp.url)
            length = resp.headers.get('Content-Length')
            if length and int(length) > budget:
                raise AdaptiveUnavailable('video_network_budget_exhausted', fallback=False)
            if resp.status != 200:
                raise AdaptiveUnavailable('video_http_error')
            # Require no more than ~1 MiB/s of useful transfer; connection
            # setup is separately bounded by the HTTPS 8s timeout.
            transfer_seconds = max(8, math.ceil(expected_size / (1024 * 1024)))
            transfer_end = time.monotonic() + transfer_seconds
            if deadline is not None:
                transfer_end = min(transfer_end, deadline)
            with open(path, 'xb') as handle:
                while True:
                    if time.monotonic() > transfer_end:
                        raise AdaptiveUnavailable('video_download_timeout')
                    if total >= budget:
                        # A verified exact-size download may legitimately use
                        # the entire budget, but never read an extra byte.
                        if expected_size and total == expected_size:
                            break
                        raise AdaptiveUnavailable('video_network_budget_exhausted', fallback=False)
                    chunk = resp.read(min(65536, budget - total))
                    if not chunk:
                        break
                    count_bytes('original', len(chunk))
                    total += len(chunk)
                    handle.write(chunk)
    except HTTPError as exc:
        if exc.code in (429, 412):
            raise AdaptiveUnavailable('platform_rate_limited', fallback=False) from None
        raise AdaptiveUnavailable('video_http_error') from None
    except (URLError, TimeoutError, OSError):
        raise AdaptiveUnavailable('video_download_failed') from None
    if total < 1024 or total > budget:
        raise AdaptiveUnavailable('video_size_invalid')
    if expected_size and total != expected_size:
        raise AdaptiveUnavailable('video_size_mismatch')
    return total


class _SparseRangeVideo:
    """Keep strict HTTPS/CDN validation in Python; FFmpeg only sees a local MP4.

    A sparse, disposable local MP4 carries container metadata plus byte ranges
    covering the selected real time windows. No HTTP URL reaches FFmpeg.
    """
    def __init__(self, url, path, size, budget, deadline=None):
        self.url = _cdn_url(url)
        self.path = Path(path)
        self.size = size
        self.budget = budget
        self.downloaded = 0
        self.ranges = []
        self.etag = ''
        self.modified = ''
        self.deadline = min(time.monotonic() + 85, deadline) if deadline is not None else time.monotonic() + 85
        with open(path, 'xb') as handle:
            # Sparse on normal filesystems: logical media offsets remain correct.
            handle.truncate(size)

    def _missing(self, start, end):
        gaps = [(start, end)]
        for a, b in self.ranges:
            newer = []
            for x, y in gaps:
                if b < x or a > y:
                    newer.append((x, y))
                else:
                    if x < a: newer.append((x, a-1))
                    if b < y: newer.append((b+1, y))
            gaps = newer
        return gaps

    def fetch(self, start, end):
        if not (0 <= start <= end < self.size):
            raise AdaptiveUnavailable('invalid_video_range', fallback=False)
        for a, b in self._missing(start, end):
            count = b - a + 1
            if count > self.budget - self.downloaded:
                raise AdaptiveUnavailable('video_network_budget_exhausted', fallback=False)
            if time.monotonic() >= self.deadline:
                raise AdaptiveUnavailable('video_sampling_budget_exhausted', fallback=False)
            class SecureRedirect(request.HTTPRedirectHandler):
                hops = 0
                def redirect_request(self, req, fp, code, msg, headers, newurl):
                    self.hops += 1
                    if self.hops > 3:
                        raise AdaptiveUnavailable('too_many_video_redirects', fallback=False)
                    _cdn_url(newurl)
                    return super().redirect_request(req, fp, code, msg, headers, newurl)
            headers = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com/',
                       'Accept-Encoding': 'identity', 'Range': f'bytes={a}-{b}'}
            if self.etag: headers['If-Range'] = self.etag
            elif self.modified: headers['If-Range'] = self.modified
            try:
                req = request.Request(self.url, headers=headers)
                with _cdn_opener(SecureRedirect()).open(req, timeout=8) as resp:
                    _cdn_url(resp.url)
                    # An HTTP 200 means Range was ignored. Never accept its body.
                    if resp.status != 206:
                        raise AdaptiveUnavailable('video_range_not_supported', fallback=False)
                    cr = re.fullmatch(r'bytes\s+(\d+)-(\d+)/(\d+)',
                                      resp.headers.get('Content-Range', '').strip(), re.I)
                    if not cr or tuple(map(int, cr.groups())) != (a, b, self.size):
                        raise AdaptiveUnavailable('video_range_identity_mismatch', fallback=False)
                    if 'multipart/' in resp.headers.get('Content-Type', '').lower():
                        raise AdaptiveUnavailable('video_range_multipart_unexpected', fallback=False)
                    length = resp.headers.get('Content-Length')
                    if length and int(length) != count:
                        raise AdaptiveUnavailable('video_range_length_mismatch', fallback=False)
                    etag = resp.headers.get('ETag', '')
                    last_mod = resp.headers.get('Last-Modified', '')
                    if self.etag and etag and etag != self.etag:
                        raise AdaptiveUnavailable('video_range_identity_mismatch', fallback=False)
                    if self.modified and last_mod and last_mod != self.modified:
                        raise AdaptiveUnavailable('video_range_identity_mismatch', fallback=False)
                    body = bytearray()
                    while len(body) < count:
                        if time.monotonic() >= self.deadline:
                            raise AdaptiveUnavailable('video_sampling_budget_exhausted', fallback=False)
                        chunk = resp.read(min(65536, count-len(body)))
                        if not chunk: break
                        count_bytes('original', len(chunk))
                        body.extend(chunk)
                    if len(body) != count:
                        raise AdaptiveUnavailable('video_range_truncated', fallback=False)
                    if not self.etag and etag: self.etag = etag
                    if not self.modified and last_mod: self.modified = last_mod
            except HTTPError as exc:
                if exc.code in (412, 429):
                    raise AdaptiveUnavailable('platform_rate_limited', fallback=False) from None
                raise AdaptiveUnavailable('video_range_http_error', fallback=False) from None
            except (URLError, TimeoutError, OSError):
                raise AdaptiveUnavailable('video_range_download_failed', fallback=False) from None
            with open(self.path, 'r+b') as handle:
                handle.seek(a)
                handle.write(body)
            self.downloaded += count
            self.ranges.append((a, b))
        return self.read(start, end)

    def read(self, start, end):
        with open(self.path, 'rb') as handle:
            handle.seek(start)
            return handle.read(end-start+1)


def _mp4_index(media):
    """Prefetch only MP4 top-level headers and moov, including tail-moov files."""
    media.fetch(0, min(media.size-1, 65535))
    pos = 0
    moov = None
    for _ in range(128):
        if pos + 8 > media.size: break
        header = media.fetch(pos, min(media.size-1, pos+15))
        if len(header) < 8: break
        atom_size = int.from_bytes(header[:4], 'big')
        kind = header[4:8]
        header_size = 8
        if atom_size == 1:
            if len(header) < 16: break
            atom_size = int.from_bytes(header[8:16], 'big')
            header_size = 16
        elif atom_size == 0:
            atom_size = media.size-pos
        if atom_size < header_size or pos + atom_size > media.size:
            raise AdaptiveUnavailable('video_mp4_index_invalid', fallback=False)
        if kind == b'moov':
            if atom_size > MAX_INDEX_BYTES:
                raise AdaptiveUnavailable('video_mp4_index_too_large', fallback=False)
            moov = (pos, pos + atom_size - 1)
            break
        pos += atom_size
    if not moov:
        raise AdaptiveUnavailable('video_mp4_index_unavailable', fallback=False)
    media.fetch(*moov)


def _packet_index(filename):
    """Read local MP4 sample-table positions (not frames) using matching ffprobe."""
    ffmpeg = _ffmpeg_binary()
    if not ffmpeg: raise AdaptiveUnavailable('ffmpeg_not_installed')
    probe_path = Path(ffmpeg).with_name('ffprobe.exe' if Path(ffmpeg).name.lower().endswith('.exe') else 'ffprobe')
    probe = str(probe_path) if probe_path.is_file() else shutil.which('ffprobe')
    if not probe:
        raise AdaptiveUnavailable('ffprobe_not_installed', fallback=False)
    args = [probe, '-v', 'error', '-protocol_whitelist', 'file,pipe',
            '-select_streams', 'v:0', '-show_packets',
            '-show_entries', 'packet=pts_time,pos,flags', '-of', 'csv=p=0', str(filename)]
    try:
        result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                **_hidden_windows_child(),
                                stderr=subprocess.PIPE, timeout=22, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise AdaptiveUnavailable('video_mp4_index_probe_failed', fallback=False) from None
    if result.returncode or len(result.stdout) > 12*1024*1024:
        raise AdaptiveUnavailable('video_mp4_index_probe_failed', fallback=False)
    packets = []
    for line in result.stdout.decode('ascii', errors='ignore').splitlines():
        values = line.split(',')
        if len(values) < 3: continue
        try:
            sec, pos = float(values[0]), int(values[1])
        except (TypeError, ValueError): continue
        if math.isfinite(sec) and sec >= 0 and pos >= 0:
            packets.append((sec, pos, 'K' in values[2]))
    packets.sort(key=lambda x: x[0])
    if len(packets) < 2 or not any(x[2] for x in packets):
        raise AdaptiveUnavailable('video_mp4_keyframes_unavailable', fallback=False)
    return packets


def _window_byte_ranges(packets, windows, size):
    keys = [x for x in packets if x[2]]
    times = [x[0] for x in keys]
    ranges = []
    for start, end in windows:
        before = max(0, bisect.bisect_right(times, max(0, start-0.05))-1)
        after = bisect.bisect_right(times, end+0.5)
        # Include the next GOP to cover the end and interleaved audio bytes.
        left = max(0, keys[before][1]-4096)
        right = min(size-1, (keys[after][1] if after < len(keys) else size-1)+65535)
        if left > right:
            raise AdaptiveUnavailable('video_mp4_keyframes_unavailable', fallback=False)
        ranges.append((left, right))
    # Merge overlaps before calculating actual network cost.
    merged = []
    for a, b in sorted(ranges):
        if merged and a <= merged[-1][1]+1:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else: merged.append((a, b))
    return merged


def _download_sparse_mp4(url, filename, size, windows, budget, deadline=None):
    media = _SparseRangeVideo(url, filename, size, budget, **({'deadline':deadline} if deadline is not None else {}))
    _mp4_index(media)
    packets = _packet_index(filename)
    # If the selected windows exceed the budget, preserve the temporal spread
    # and reduce each window's length before refusing to observe real frames.
    chosen = windows
    for _ in range(8):
        ranges = _window_byte_ranges(packets, chosen, size)
        extra = sum(y-x+1 for a,b in ranges for x,y in media._missing(a,b))
        remaining = budget-media.downloaded
        if extra <= remaining: break
        factor = max(.30, min(.85, remaining/max(extra,1)*.85))
        shorter=[]
        for a,b in chosen:
            width = max(3.0, (b-a)*factor)
            center = (a+b)/2
            shorter.append((max(0., center-width/2), center+width/2))
        if all(abs((b-a)-(y-x)) < .1 for (a,b),(x,y) in zip(chosen,shorter)):
            raise AdaptiveUnavailable('video_window_budget_insufficient', fallback=False)
        chosen = shorter
    else:
        raise AdaptiveUnavailable('video_window_budget_insufficient', fallback=False)
    for a,b in ranges: media.fetch(a,b)
    return media.downloaded, chosen, len(ranges)

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


def _decode_samples(filename, *, start, length, focused=False):
    exe = _ffmpeg_binary()
    if not exe:
        raise AdaptiveUnavailable('ffmpeg_not_installed')
    # Accept ONLY a known progressive container, not playlists or remote probes.
    container = 'flv' if str(filename).endswith('.flv') else 'mp4'
    # Focus mode decodes the original media stream (never overview tiles).
    # Scale down to at most 640x360 without upscaling a smaller source;
    # output is padded to a fixed frame size for bounded RGB decoding.
    width,height=(FOCUS_W,FOCUS_H) if focused else (FRAME_W,FRAME_H)
    # Strictly local input, offline decoder, bounded raw RGB output and runtime.
    resize=(f'min({width},iw):min({height},ih)' if focused else f'{width}:{height}')
    cmd = [exe, '-nostdin', '-hide_banner', '-loglevel', 'error',
           '-protocol_whitelist', 'file,pipe', '-threads', '1',
           '-ss', str(start), '-f', container, '-i', str(filename), '-t', str(length),
           '-vf', f'fps={FRAME_RATE},scale={resize}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2',
           '-an', '-sn', '-dn', '-frames:v', str(min(MAX_FRAMES, math.ceil(length * FRAME_RATE))),
           '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                **_hidden_windows_child(),
                                stdin=subprocess.DEVNULL, timeout=35, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise AdaptiveUnavailable('video_decode_unavailable') from None
    size = width * height * 3
    if result.returncode != 0 or len(result.stdout) < size or len(result.stdout) % size:
        raise AdaptiveUnavailable('video_decode_failed')
    count = len(result.stdout) // size
    if count > MAX_FRAMES:
        raise AdaptiveUnavailable('decode_frame_limit_exceeded')
    return [Image.frombytes('RGB', (width, height), result.stdout[i*size:(i+1)*size])
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
        tile_w=chunk[0]['image'].width
        tile_height=chunk[0]['image'].height
        tile_h=tile_height+20
        grid=Image.new('RGB',(4*tile_w,3*tile_h),(19,23,30))
        paint=ImageDraw.Draw(grid)
        for j,item in enumerate(chunk):
            x=(j%4)*tile_w;y=(j//4)*tile_h
            grid.paste(item['image'],(x,y))
            t=item['second']
            paint.text((x+5,y+tile_height+2), '%02d:%02d'%(int(t//60),int(t%60)),fill=(247,247,247))
        out=BytesIO();grid.save(out,format='JPEG',quality=86,optimize=True)
        output.append({'second':chunk[0]['second'],'bytes':out.getvalue(),
                       'rank':len(output),'tile_times':[x['second'] for x in chunk],
                       'tile_count':len(chunk)})
    return output


def _acquire_adaptive_frames_impl(bvid, *, max_frames=24, focus=None, depth='standard', network_budget_bytes=None, frame_budget_limit=None):
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
    # A remaining Episode frame allowance is an enforced tool-side ceiling.
    if frame_budget_limit is not None:
        if (focus is None or type(frame_budget_limit) is not int or
                not 1 <= frame_budget_limit <= configured):
            raise AdaptiveUnavailable('invalid_frame_budget_limit',fallback=False)
        limit = min(limit,frame_budget_limit)
    if network_budget_bytes is not None:
        if (type(network_budget_bytes) is not int or not 1_048_576<=network_budget_bytes<=NETWORK_BUDGETS[configured]):
            raise AdaptiveUnavailable('invalid_network_budget', fallback=False)
    if not _ffmpeg_binary():
        raise AdaptiveUnavailable('ffmpeg_not_installed')
    source = _playurl(bvid)
    if isinstance(source, dict):
        duration, cid = source['duration'], source['cid']
    else:
        url, size, duration, cid = source
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
    # One end-to-end budget across complete transfer, recovered MP4 and DASH;
    # preserve time for offline decoding + restricted vision model (220s outer).
    download_deadline = started + 170
    with tempfile.TemporaryDirectory(prefix='dafeiyu-scene-') as folder:
        budget = min(NETWORK_BUDGETS[configured], network_budget_bytes) if network_budget_bytes is not None else NETWORK_BUDGETS[configured]
        observed_start = original_bytes()
        attempted = []
        original_failure = None
        def remaining():
            return max(0, budget - (original_bytes() - observed_start))
        def dash_download():
            nonlocal source, windows
            attempted.append('dash-indexed')
            try:
                if not isinstance(source, dict):
                    source = _playurl(bvid,force_dash=True,expected_cid=cid)
                if not isinstance(source,dict):
                    raise AdaptiveUnavailable('dash_indexed_video_unavailable')
                jobs_, count_, ranges_, size_ = _download_dash_samples(
                    source,folder,windows,focus,remaining(),deadline=download_deadline-20)
            except AdaptiveUnavailable as exc:
                exc.attempted_stages = tuple(attempted)
                exc.previous_failure = original_failure
                exc.measured_original_bytes = original_bytes() - observed_start
                raise
            windows = [(start,start+length) for _,start,length,_ in jobs_]
            return jobs_,count_,ranges_,size_
        if isinstance(source, dict):
            jobs,count,range_count,size = dash_download()
            download_mode = 'indexed-dash-sidx-byte-ranges'
            source_type = 'bili-public-playurl-dash'
        else:
            ext = '.flv' if parse.urlsplit(url).path.lower().endswith('.flv') else '.mp4'
            filename = Path(folder) / ('public-video' + ext)
            original_failure = None
            use_dash = False
            if size <= budget:
                attempted.append('durl-complete')
                try:
                    count = _download_video(url, filename, size, budget=remaining(),
                                            deadline=download_deadline-25)
                    download_mode, range_count = 'complete-bounded',1
                except AdaptiveUnavailable as exc:
                    if exc.code not in ('video_download_timeout','video_download_failed') or not exc.fallback:
                        exc.attempted_stages = tuple(attempted)
                        raise
                    original_failure = exc.code
            if size > budget or original_failure:
                if ext == '.mp4':
                    attempted.append('durl-mp4-indexed')
                    try:
                        if remaining() < 1_048_576:
                            raise AdaptiveUnavailable('video_network_budget_exhausted',fallback=False)
                        # New sparse file: never assume the incomplete whole-file
                        # transfer has a valid index, identity, or byte ranges.
                        sparse = Path(folder) / 'public-sparse.mp4'
                        count,windows,range_count = _download_sparse_mp4(
                            url,sparse,size,windows,remaining(),deadline=download_deadline-20)
                        filename = sparse
                        download_mode = 'indexed-mp4-byte-ranges'
                    except AdaptiveUnavailable as exc:
                        # Unsafe identity, rate-limit, or budget failures do not
                        # authorize switching source. The remaining set is a
                        # *different official track*, freshly bound to same CID.
                        recoverable = {'video_range_not_supported',
                                       'video_range_download_failed',
                                       'video_mp4_index_unavailable','video_mp4_keyframes_unavailable',
                                       'video_window_budget_insufficient',
                                       'ffprobe_not_installed'}
                        if exc.code not in recoverable or remaining() < 1_048_576:
                            exc.attempted_stages = tuple(attempted)
                            exc.previous_failure = original_failure
                            exc.measured_original_bytes = original_bytes() - observed_start
                            raise
                        original_failure = exc.code
                        use_dash = True
                else:
                    # The ordinary PlayURL selector already bypasses oversized
                    # FLV. Preserve the fail-closed contract for injected tracks.
                    if size > budget:
                        raise AdaptiveUnavailable('video_range_container_unsupported',fallback=False)
                    use_dash = True
            if isinstance(source,dict) or use_dash:
                jobs,count,range_count,size = dash_download()
                download_mode = 'indexed-dash-sidx-byte-ranges'
                source_type = 'bili-public-playurl-dash'
            else:
                source_type = 'bili-public-playurl-durl'
                jobs = [(filename,start,end-start,start) for start,end in windows]
        count = original_bytes()-observed_start
        for filename,start,length,decode_start in jobs:
            if time.monotonic()>=download_deadline:
                raise AdaptiveUnavailable('video_sampling_budget_exhausted')
            try:
                all_images.append(_decode_samples(filename,start=decode_start,length=length,focused=True) if focus
                                  else _decode_samples(filename,start=decode_start,length=length))
            except AdaptiveUnavailable as exc:
                if download_mode.startswith('indexed-'):
                    raise AdaptiveUnavailable(exc.code, fallback=False) from None
                raise
    try:
        moments,info=_scene_candidates(all_images,[start for start,_ in windows],heat=heat,limit=limit)
    except AdaptiveUnavailable as exc:
        if download_mode.startswith('indexed-'):
            raise AdaptiveUnavailable(exc.code, fallback=False) from None
        raise
    boards=_make_storyboards(moments)
    # The restricted diagnostics renderer may show the actual higher-resolution
    # focus JPEGs. They never become a model reply or persisted Life memory.
    debug_moments=[]
    if focus:
        for item in moments[:12]:
            raw=BytesIO()
            item['image'].save(raw,format='JPEG',quality=84,optimize=True)
            debug_moments.append({'second':item['second'],'bytes':raw.getvalue()})
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
              'source_type':source_type,'input_bytes':count,
              'source_attempts':attempted,
              'network_budget_bytes':budget,'remote_video_bytes':size,
              'download_mode':download_mode,'download_ranges':range_count,
              'track_selection':source.get('track_selection') if isinstance(source,dict) else 'progressive-low-quality',
              'clip_window':focus if focus else {'startSeconds':0.,'endSeconds':duration},
              'sampled_windows':[{'startSeconds':a,'endSeconds':b} for a,b in windows],
              'sampled_duration_seconds':coverage,'video_duration_seconds':duration,
              'heat_source':heat['source'] if heat else 'unavailable',
              'viewer_heat_is_content_evidence':False,'depth':depth,
              'frame_plan':configured,'frame_budget':limit,'storyboard_count':len(boards),
              'frame_pixel_size':[FOCUS_W,FOCUS_H] if focus else [FRAME_W,FRAME_H],
              'frame_budget_limit':frame_budget_limit,
              'sample_interval_seconds':1/FRAME_RATE,
              'note':'DURL MP4 或 DASH SIDX 仅按可信时间索引和网络预算采样；未完整播放、未读取原声音轨'}
    sampling.update(info)
    sampling['ocr_engine'] = ocr['engine']
    sampling['ocr_attempted'] = ocr['attempted']
    return {'ok':True, 'bvid':bvid, 'status':'frames_ready', 'frames':boards,
            'debug_moments':debug_moments,
            'times':[x['second'] for x in moments], 'sampling':sampling, 'ocr':ocr,
            'focus_window':focus, 'image_source':'B站公开视频片段（离线解码）',
            'notice':'每张分镜拼图包含多个带时间码的公开视频采样时刻；未逐帧观看完整视频或听到音频'}


def acquire_adaptive_frames(bvid, *, max_frames=24, focus=None, depth='standard', network_budget_bytes=None, frame_budget_limit=None):
    # For direct entrypoints, still enforce one shared physical-byte budget;
    # nested inside the public video tool this reuses its persisted scope.
    with traffic_scope(None):
        return _acquire_adaptive_frames_impl(
            bvid,max_frames=max_frames,focus=focus,depth=depth,
            network_budget_bytes=network_budget_bytes,frame_budget_limit=frame_budget_limit)
