"""Privacy-safe, strictly bounded Bilibili video-detail failure evidence.

Do not persist platform exception text: it can contain request URLs or credentials.
The response is a read failure, never a video/watch receipt and never permission
for a second platform request.
"""
import re

_LIMIT = {-352, -412, 429}
_AUTH = {-101, -111, -401, -403}
_NOT_FOUND = {-404, 404}


def _integer(value):
    if isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if -99999 <= number <= 99999 and number != 0 else None


def public_metadata_failure(error):
    """Generate a finite diagnostic envelope; never include raw exception data."""
    code = _integer(getattr(error, 'code', None))
    if code is None:
        code = _integer(getattr(error, 'status_code', None))
    if code is None:
        # Some bilibili-api releases embed the numeric response code only in
        # exception prose. Extract just the integer; discard ALL other content.
        raw = str(error)[:250]
        match = re.search(r'(?:\bcode\b|错误码|响应码|\bHTTP\b)\s*[=:：]?\s*(-?\d{2,5})', raw, re.I)
        if match:
            code = _integer(match.group(1))
    kind = type(error).__name__.lower()
    if code in _LIMIT:
        category = 'metadata-rate-limited'
    elif code in _AUTH:
        category = 'metadata-account-unavailable'
    elif code in _NOT_FOUND:
        category = 'metadata-api-error'
    elif isinstance(error, (TimeoutError,)) or 'timeout' in kind:
        category = 'metadata-timeout'
    elif any(token in kind for token in ('network', 'connection', 'transport', 'clienterror')):
        category = 'metadata-api-error'
    elif 'credential' in kind or 'permission' in kind:
        category = 'metadata-account-unavailable'
    else:
        category = 'metadata-api-error'
    return {'ok': False, 'failureCode': category, 'diagnosticOrigin': 'python-bili-video-info',
            'platformCode': code if code is not None else 0,
            'failureLayer': 'platform' if code is not None else 'python-adapter'}
