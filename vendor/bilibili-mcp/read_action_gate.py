"""Shared on-disk read reservation protocol used by Node and the independent video MCP.

Only verified public read actions are coordinated. Existing JS-owned calls may
enter through a *verified parent reservation*, but an independent Python process
must first acquire its own reservation. Stale/unknown actions are never replayed.
This module has no Bilibili/network imports so it is independently testable.
"""
import contextlib
import hashlib
import hmac
import json
import os
import re
import time
import uuid
import unicodedata
from pathlib import Path

_ALLOWED = {'bili_search', 'bili_video_info', 'bili_user_videos', 'bili_creator_relation_status', 'bili_comments', 'bili_comment_thread', 'bili_danmaku', 'bili_subtitle'}
_BV = re.compile(r'^BV[0-9A-Za-z]{10}$')
_UID = re.compile(r'^[1-9][0-9]{0,18}$')
_HEX = re.compile(r'^[a-f0-9]{64}$')

class ReadReservationHeld(Exception):
    pass


def _clean(value):
    return ' '.join(unicodedata.normalize('NFKC', str(value if value is not None else '')).split()).strip()


def _bounded_int(value, default, ceiling):
    try:
        n = int(value)
        if str(value).strip() != str(n) and not isinstance(value, int):
            return default
        return min(n, ceiling) if n > 0 else default
    except (ValueError, TypeError):
        return default


def _exact_int(value, default=None, minimum=0, maximum=9007199254740991):
    if value is None:
        return default
    text = str(value)
    if not re.fullmatch(r'(0|[1-9][0-9]*)', text):
        raise ValueError('只读评论参数必须是有效整数')
    number = int(text)
    if not minimum <= number <= maximum:
        raise ValueError('只读评论参数超出安全范围')
    return number

def read_action(tool, args):
    a = args or {}
    if tool in ('bili_video_info', 'bili_creator_relation_status'):
        bv = str(a.get('bvid', ''))
        if not _BV.fullmatch(bv):
            raise ValueError('只读动作缺少有效 BV')
        return tool, bv
    if tool == 'bili_subtitle':
        bvid = str(a.get('bvid', ''))
        if not _BV.fullmatch(bvid):
            raise ValueError('字幕只读动作缺少有效 BV')
        # Same subtitle resource, regardless of a possible later vision
        # fallback. The reservation never authorizes or counts vision calls.
        fallback = a.get('auto_vision_on_missing', False)
        if type(fallback) is not bool:
            raise ValueError('字幕视觉回退参数必须是布尔值')
        return tool, bvid
    if tool == 'bili_danmaku':
        bvid = str(a.get('bvid', ''))
        if not _BV.fullmatch(bvid):
            raise ValueError('弹幕只读动作缺少有效 BV')
        num = _exact_int(a.get('num', 100), minimum=1, maximum=300)
        return tool, json.dumps([bvid, num], ensure_ascii=False, separators=(',', ':'))
    if tool in ('bili_comments', 'bili_comment_thread'):
        bvid = str(a.get('bvid', ''))
        if not _BV.fullmatch(bvid):
            raise ValueError('评论区只读动作缺少有效 BV')
        if tool == 'bili_comments':
            num = _exact_int(a.get('num', 30), minimum=1, maximum=300)
            return tool, json.dumps([bvid, num], ensure_ascii=False, separators=(',', ':'))
        root = _exact_int(a.get('root'), minimum=1)
        if root is None:
            raise ValueError('楼中楼只读动作缺少根评论 ID')
        num = _exact_int(a.get('num', 20), minimum=1, maximum=300)
        target = _exact_int(a.get('target_rpid', 0))
        return tool, json.dumps([bvid, str(root), num, str(target)], ensure_ascii=False, separators=(',', ':'))
    if tool == 'bili_search':
        kw = _clean(a.get('keyword', ''))
        if not kw or len(kw) > 300:
            raise ValueError('只读搜索缺少有效主题')
        return tool, json.dumps([kw.lower(), _bounded_int(a.get('num', 10), 10, 100), _clean(a.get('order', 'totalrank'))], ensure_ascii=False, separators=(',', ':'))
    if tool == 'bili_user_videos':
        uid = str(a.get('uid', ''))
        if not _UID.fullmatch(uid):
            raise ValueError('只读作者资料缺少有效 UID')
        return tool, json.dumps([uid, _bounded_int(a.get('pn', 1), 1, 10000), _bounded_int(a.get('ps', 30), 30, 100), _clean(a.get('order', 'pubdate')), _clean(a.get('keyword', ''))], ensure_ascii=False, separators=(',', ':'))
    return None


def _safe_dir(path):
    if path.is_symlink() or (path.exists() and not path.is_dir()):
        raise ValueError('只读预约目录不安全')


def _safe_read(path, max_size=16384):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > max_size:
        raise ValueError('只读预约记录不安全')
    return json.loads(path.read_text(encoding='utf8'))


def _write_once(path, item):
    if path.is_symlink() or path.exists():
        raise ValueError('只读预约记录已存在')
    with path.open('x', encoding='utf8') as output:
        json.dump(item, output, ensure_ascii=False, separators=(',', ':'))
        output.write('\n')


def _account_scope(home):
    ledger = _safe_read(home / 'account-binding.json')
    cred = _safe_read(home / 'bili_credential.json', 4096)
    uid = str(cred.get('dedeuserid', ''))
    secret = str(cred.get('sessdata', ''))
    if not _UID.fullmatch(uid) or not secret or uid != str(ledger.get('activeUid', '')) or ledger.get('reviewRequired') or ledger.get('restartRequired') or (home / 'account-login-pending.json').exists():
        raise ValueError('当前 B站账号或凭据作用域未完成核验')
    generation = ledger.get('generation')
    if not isinstance(generation, int) or generation < 1:
        raise ValueError('账号代次无效')
    tag = hmac.new(secret.encode('utf8'), uid.encode('utf8'), hashlib.sha256).hexdigest()[:16]
    return f'{uid}:{generation}:{tag}'


def _sha(text):
    return hashlib.sha256(text.encode('utf8')).hexdigest()


def _windows_pid_alive(pid, kernel32=None):
    """Query a PID without sending a signal or trusting a stale lock.

    Windows os.kill(pid, 0) is not a portable existence check: it can raise
    WinError 6 even when the actual parent process is running. Fail closed if
    the process cannot be opened or queried. The caller also verifies that
    this PID is the direct parent recorded in the exact reservation.
    """
    import ctypes
    from ctypes import wintypes

    if kernel32 is None:
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    open_process = kernel32.OpenProcess
    open_process.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    open_process.restype = wintypes.HANDLE
    get_exit_code = kernel32.GetExitCodeProcess
    get_exit_code.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
    get_exit_code.restype = wintypes.BOOL
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL

    # PROCESS_QUERY_LIMITED_INFORMATION. No terminate or write rights.
    handle = open_process(0x1000, False, pid)
    if not handle:
        return False
    try:
        exit_code = wintypes.DWORD()
        # 259 = STILL_ACTIVE, per Win32 GetExitCodeProcess.
        return bool(get_exit_code(handle, ctypes.byref(exit_code))) and exit_code.value == 259
    finally:
        close_handle(handle)


def _pid_alive(pid):
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    if os.name == 'nt':
        try:
            return _windows_pid_alive(pid)
        except OSError:
            # Never turn a failed process query into adapter authorization.
            return False
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except ProcessLookupError:
        return False
    except OSError:
        return False


@contextlib.contextmanager
def public_read_reservation(tool, args, *, home=None, adapter=False):
    """Fail closed on blocked reservation. `adapter` is only trusted for
    an actual Node parent process holding this exact action's reservation.
    """
    action = read_action(tool, args)
    if action is None or home is None:
        yield
        return
    home = Path(home).resolve()
    scope = _account_scope(home)
    operation, target = action
    key = _sha(json.dumps([scope, 'public', operation, target], separators=(',', ':'), ensure_ascii=False))
    base = home / 'read-action-executions'
    locks, receipts = base / 'locks', base / 'receipts'
    for directory in (home, base, locks, receipts):
        _safe_dir(directory)
        directory.mkdir(mode=0o700, exist_ok=True)
    folder = locks / key
    acquired = False
    try:
        folder.mkdir(mode=0o700)
        acquired = True
    except FileExistsError:
        entry = None
        try:
            entry = _safe_read(folder / 'entry.json', 4096)
        except (OSError, ValueError, TypeError, KeyError):
            pass
        if not (adapter and entry and entry.get('id') == key and entry.get('operation') == operation and entry.get('scopeHash') == _sha(scope)[:20] and entry.get('state') == 'executing' and entry.get('pid') == os.getppid() and _pid_alive(entry.get('pid'))):
            raise ReadReservationHeld('相同的只读动作正在执行或等待人工核查，未重复访问 B站')
        # Node handles receipt and release after this nested in-process MCP call.
        yield
        return
    at = int(time.time() * 1000)
    record = dict(version=1, id=key, scopeHash=_sha(scope)[:20], operation=operation,
                  source='python-video-agent', sourceHash='', obligationHash='', at=at,
                  pid=os.getpid(), state='executing')
    returned = False
    try:
        _write_once(folder / 'entry.json', record)
        yield
        if _account_scope(home) != scope:
            raise ValueError('读取期间 B站账号作用域变化，拒绝旧账号数据')
        returned = True
    except Exception:
        # Failed/unknown may already have hit the server. Keep the lock for review.
        raise
    finally:
        if acquired and returned:
            receipt = dict(record, state='tool-returned', finishedAt=int(time.time() * 1000))
            path = receipts / (str(receipt['finishedAt']).zfill(15) + '-' + str(uuid.uuid4()) + '.json')
            _write_once(path, receipt)
            (folder / 'entry.json').unlink()
            folder.rmdir()
