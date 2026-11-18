"""Cross-process Bilibili read budget shared with lib/bili-read-budget.mjs.

Only the verified Node-adapter child skips a second debit. Standalone MCP calls
are recorded atomically in the same per-account JSON ledger. No credentials or
message content are persisted here. Unknown/corrupt state fails closed.
"""
import contextlib
import json
import os
import re
import time
import uuid
from pathlib import Path

class ReadBudgetDeferred(Exception):
    def __init__(self, reason='ledger-busy'):
        super().__init__('B站共享读取保护中')
        self.reason=reason


def _is_alive(pid):
    if not isinstance(pid,int) or isinstance(pid,bool) or pid<=0:
        return True
    if os.name=='nt':
        try:
            import ctypes
            h=ctypes.windll.kernel32.OpenProcess(0x1000,False,pid)
            if not h:return True # Can't establish death => don't delete.
            try:
                code=ctypes.c_ulong(0)
                if not ctypes.windll.kernel32.GetExitCodeProcess(h,ctypes.byref(code)):
                    return True
                return code.value==259
            finally:ctypes.windll.kernel32.CloseHandle(h)
        except (OSError,AttributeError):return True
    try:os.kill(pid,0);return True
    except ProcessLookupError:return False
    except OSError:return True

@contextlib.contextmanager
def _lock(file):
    lock=Path(str(file)+'.read-lock')
    ident=uuid.uuid4().hex
    data={'pid':os.getpid(),'token':ident,'at':int(time.time()*1000)}
    def claim():
        with lock.open('x',encoding='utf8') as f:json.dump(data,f)
    try:claim()
    except FileExistsError:
        try:
            age=time.time()-lock.stat().st_mtime
            previous=json.loads(lock.read_text(encoding='utf8')) if age>30 else None
            if previous and re.fullmatch(r'[0-9a-f]{32}',str(previous.get('token',''))) and not _is_alive(previous.get('pid')):
                if json.loads(lock.read_text(encoding='utf8')).get('token')==previous['token']:
                    lock.unlink()
        except (OSError,ValueError,TypeError):pass
        try:claim()
        except FileExistsError:raise ReadBudgetDeferred('ledger-busy') from None
    try:yield
    finally:
        try:
            if json.loads(lock.read_text(encoding='utf8')).get('token')==ident:lock.unlink()
        except (OSError,ValueError,TypeError):pass


def _runtime(home):
    root=Path(home).resolve()
    path=root/'account-binding.json'
    if path.is_symlink() or not path.is_file() or path.stat().st_size>20000:
        raise ReadBudgetDeferred('account-unverified')
    try:
        info=json.loads(path.read_text(encoding='utf8'))
        uid=str(info['activeUid'])
        if (not re.fullmatch(r'[1-9][0-9]{0,18}',uid)
            or info.get('reviewRequired') or info.get('restartRequired')):
            raise ValueError('account-review')
        cred=root/'bili_credential.json'
        if cred.is_symlink() or not cred.is_file() or cred.stat().st_size>32000:
            raise ValueError('credential-unavailable')
        current=json.loads(cred.read_text(encoding='utf8'))
        if str(current.get('dedeuserid'))!=uid:raise ValueError('credential-mismatch')
    except (OSError,ValueError,KeyError,TypeError):raise ReadBudgetDeferred('account-unverified') from None
    folder=root/'accounts'/uid/'runtime'
    if folder.is_symlink():raise ReadBudgetDeferred('unsafe-account-runtime')
    folder.mkdir(mode=0o700,parents=True,exist_ok=True)
    return folder


def _ledger(file):
    if not file.exists():
        return {'version':1,'attempts':[],'blockedUntil':0,'backoffCount':0,
                'lastReason':'','lastErrorAt':0,'lastDmListAttemptAt':0,
                'lastDmMessagesAttemptAt':0,'dmListRateLevel':0,'lastDmRateLimitAt':0,
                'lastDmRateDecayAt':0,'socialProtectionUntil':0,'socialSafeUntil':0,'lastReadAtByKind':{}}
    if file.is_symlink() or not file.is_file() or file.stat().st_size>600000:
        raise ReadBudgetDeferred('ledger-invalid')
    try:
        data=json.loads(file.read_text(encoding='utf8'))
        if (data.get('version')!=1 or not isinstance(data.get('attempts'),list)
           or not isinstance(data.get('blockedUntil'),int) or not isinstance(data.get('backoffCount'),int)):
            raise ValueError()
        return data
    except (OSError,ValueError,TypeError):raise ReadBudgetDeferred('ledger-invalid') from None


def _save(file,data):
    tmp=file.with_name(file.name+'.'+str(os.getpid())+'.'+uuid.uuid4().hex+'.tmp')
    with tmp.open('x',encoding='utf8') as f:json.dump(data,f,ensure_ascii=True,separators=(',',':'))
    try:os.replace(tmp,file)
    finally:
        try:tmp.unlink()
        except FileNotFoundError:pass


def _limits():
    def bound(key,fallback,low,high):
        try:return min(high,max(low,int(os.environ.get(key, fallback))))
        except (ValueError,TypeError):return fallback
    minute=bound('BILI_SHARED_READ_MINUTE_LIMIT',30,5,180)
    return minute,bound('BILI_SHARED_READ_HOUR_LIMIT',450,minute,6000)


def _acquire(file,kind):
    at=int(time.time()*1000)
    with _lock(file):
        data=_ledger(file)
        attempts=[a for a in data.get('attempts',[]) if isinstance(a,dict) and
                  isinstance(a.get('at'),int) and at-3600000<a['at']<=at+60000]
        minute,hour=_limits()
        fresh=[a for a in attempts if at-a['at']<60000]
        if data.get('blockedUntil',0)>at:raise ReadBudgetDeferred('platform-cooldown')
        if len(fresh)>=minute or len(attempts)>=hour:raise ReadBudgetDeferred('shared-budget')
        attempts.append({'kind':kind[:35],'at':at})
        data['attempts']=attempts[-6000:]
        data.setdefault('lastReadAtByKind',{})[kind[:35]]=at
        _save(file,data)


def _note_limit(file,kind):
    at=int(time.time()*1000)
    with _lock(file):
        data=_ledger(file)
        count=min(7,int(data.get('backoffCount',0))+1)
        data.update({'backoffCount':count,'blockedUntil':max(data.get('blockedUntil',0),at+min(1800000,300000*2**(count-1))),
                    'lastReason':'B站拒绝请求或要求验证','lastErrorAt':at,'lastRateLimitKind':kind[:35],
                    'socialProtectionUntil':max(data.get('socialProtectionUntil',0),at+900000),
                    'socialSafeUntil':max(data.get('socialSafeUntil',0),at+21600000)})
        _save(file,data)


def _limited(result):
    if isinstance(result,dict):
        return result.get('code') in (-509,-412,-352,429) or result.get('status') in (403,412,429)
    if isinstance(result,str):
        try:return _limited(json.loads(result))
        except (TypeError,ValueError):return bool(re.search(r'code\s*[=:：]\s*-(?:509|412|352)|请求过于频繁|rate.?limit',result[:500],re.I))
    return False

@contextlib.contextmanager
def shared_read_budget(home,tool,*,node_owned=False):
    if node_owned:
        yield lambda result:None
        return
    if not home:raise ReadBudgetDeferred('account-unverified')
    file=_runtime(home)/'bili-read-budget.json'
    kind='mcp:'+tool
    _acquire(file,kind)
    def receipt(result):
        if _limited(result):_note_limit(file,kind)
    try:yield receipt
    except Exception as exc:
        if _limited(str(exc)):
            _note_limit(file,kind)
        raise
