#!/usr/bin/env python3
# Local SQLite meme-memory owner moderation. Never loads Bilibili SDK or external URLs.
import json
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

INVALID = re.compile(r'(?i)(?:api[_-]?key|cookie|password|sessdata|https?://|[A-Za-z]:[\\/]|\.dsh[/\\]|-----BEGIN)')
KINDS = ('梗', '角色', '人物', '系列', '其他')
CONFIDENCES = ('待核实', '有文字依据')
STATUSES = ('pending', 'approved', 'rejected')

def result(obj):
    print(json.dumps(obj,ensure_ascii=True))

def clean(v, maxlen, *, required=True):
    if not isinstance(v,str):
        raise ValueError('字段必须是文本')
    value=re.sub(r'[\x00-\x1f\x7f-\x9f]', ' ', v).strip()
    if len(value)>maxlen or INVALID.search(value) or (required and not value):
        raise ValueError('字段过长、为空或包含私密/网址内容')
    return value

def migrate(conn):
    if not conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='memes'").fetchone():return False
    cols={x['name'] for x in conn.execute('PRAGMA table_info(memes)')}
    if 'review_status' not in cols:
        with conn:conn.execute("ALTER TABLE memes ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved'")
    conn.execute("CREATE TABLE IF NOT EXISTS meme_schema_migrations(version TEXT PRIMARY KEY,applied_at TEXT NOT NULL)")
    if not conn.execute("SELECT 1 FROM meme_schema_migrations WHERE version='generic-title-marker-v2'").fetchone():
        if conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='meme_sources'").fetchone():
            conn.execute("CREATE TABLE IF NOT EXISTS meme_observations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,bvid TEXT NOT NULL,evidence TEXT NOT NULL,evidence_type TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',UNIQUE(name,bvid))")
            for row in conn.execute("SELECT id,name,confidence FROM memes WHERE review_status='approved'").fetchall():
                if row['confidence']!='待核实' or not re.fullmatch(r'(?i)(?:day\s*\d{1,4}|经验开源|经验分享|教程合集|资源分享|作品展示)',str(row['name'] or '')):continue
                sources=conn.execute("SELECT bvid,evidence_type,evidence,noted_at FROM meme_sources WHERE meme_id=?",(row['id'],)).fetchall()
                if len({x['bvid'] for x in sources})>=2 and all(x['evidence_type']=='标题' for x in sources):
                    for src in sources:
                        conn.execute("INSERT OR IGNORE INTO meme_observations(name,bvid,evidence,evidence_type,created_at,status) VALUES(?,?,?,?,?,'pending')",(row['name'],src['bvid'],src['evidence'],src['evidence_type'],src['noted_at']))
                    conn.execute("UPDATE memes SET review_status='rejected' WHERE id=?",(row['id'],))
            conn.execute("INSERT INTO meme_schema_migrations(version,applied_at) VALUES('generic-title-marker-v2',?)",(datetime.now().astimezone().isoformat(timespec='seconds'),))
            conn.commit()
    return True

def main():
    try:
        if len(sys.argv)!=4:
            raise ValueError('参数数量不正确')
        home=Path(sys.argv[1]).resolve()
        action=sys.argv[2]
        if action not in ('list','delete','edit','review','add','interaction'):
            raise ValueError('不支持的操作')
        db=(home/'meme-memory.sqlite3').resolve()
        if not db.is_relative_to(home) or db.is_symlink():
            raise ValueError('数据文件位置不安全')
        if action=='add' and not db.exists():
            conn=sqlite3.connect(str(db),timeout=8)
            with conn:
                conn.execute('''CREATE TABLE IF NOT EXISTS memes (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '梗',
                    meaning TEXT NOT NULL, confidence TEXT NOT NULL DEFAULT '待核实',
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'approved')''')
                conn.execute('''CREATE TABLE IF NOT EXISTS meme_sources (
                    meme_id INTEGER NOT NULL,bvid TEXT NOT NULL,evidence_type TEXT NOT NULL,
                    evidence TEXT NOT NULL,noted_at TEXT NOT NULL, PRIMARY KEY(meme_id,bvid))''')
            conn.close()
        if not db.exists():
            result({'ok':True,'total':0,'entries':[], 'deleted':False} if action=='list'
                   else {'ok':False,'error':'梗知识库尚未创建，不能修改或审批不存在的条目'})
            return
        conn=sqlite3.connect(str(db),timeout=8)
        conn.row_factory=sqlite3.Row
        conn.execute('PRAGMA busy_timeout=8000')
        try:
            if not migrate(conn):
                result({'ok':True,'total':0,'entries':[]})
                return
            if action=='interaction':
                # Interactive reply engine reads a bounded approved-only snapshot. The host
                # matches exact names/aliases locally; never pass the whole library to AI.
                rows=conn.execute('''SELECT id,name,aliases,meaning,kind,confidence FROM memes
                    WHERE review_status='approved' ORDER BY updated_at DESC LIMIT 2000''').fetchall()
                result({'ok':True,'entries':[dict(row) for row in rows]})
                return
            if action=='list':
                query=clean(sys.argv[3][:40],40,required=False)
                rows=conn.execute('''SELECT id,name,aliases,meaning,kind,confidence,updated_at,review_status FROM memes
                    WHERE instr(name,?)>0 OR instr(aliases,?)>0 OR instr(meaning,?)>0
                    ORDER BY CASE WHEN review_status='pending' THEN 0 ELSE 1 END,updated_at DESC LIMIT 50''',
                    (query,query,query)).fetchall()
                entries=[]
                for row in rows:
                    item=dict(row)
                    item['sources']=[dict(x) for x in conn.execute('''SELECT bvid,evidence_type,evidence,noted_at FROM meme_sources
                        WHERE meme_id=? ORDER BY noted_at DESC LIMIT 3''',(item['id'],)).fetchall()]
                    item['visual_status']='低清预览线索（待核实）' if any(s['evidence_type']=='低清预览' for s in item['sources']) else '外观未知（未识图）'
                    entries.append(item)
                counts={r['review_status']:r['n'] for r in conn.execute('SELECT review_status, COUNT(*) AS n FROM memes GROUP BY review_status')}
                result({'ok':True,'total':sum(counts.values()),'counts':counts,'entries':entries})
                return
            if action=='add':
                payload=json.loads(sys.argv[3])
                name=clean(payload.get('name'),48)
                if len(name)<2:raise ValueError('名称至少2个字')
                aliases=clean(payload.get('aliases',''),140,required=False)
                meaning=clean(payload.get('meaning'),220)
                kind=payload.get('kind')
                confidence=payload.get('confidence')
                if kind not in KINDS or confidence not in CONFIDENCES:raise ValueError('类型或可信度不合法')
                now=datetime.now().astimezone().isoformat(timespec='seconds')
                with conn:
                    cur=conn.execute('''INSERT INTO memes(key,name,aliases,kind,meaning,confidence,created_at,updated_at,review_status)
                        VALUES (?,?,?,?,?,?,?,?,?)''', (name.casefold(),name,aliases,kind,meaning,confidence,now,now,'approved'))
                result({'ok':True,'id':cur.lastrowid,'status':'approved'})
                return
            try:
                payload=json.loads(sys.argv[3]) if action in ('edit','review') else {'id':int(sys.argv[3])}
                ident=int(payload['id'])
            except (TypeError,ValueError,KeyError,OverflowError):
                raise ValueError('无效记录编号')
            if not 0<ident<2147483647:raise ValueError('无效记录编号')
            if action=='delete':
                with conn:
                    old=conn.execute('SELECT id FROM memes WHERE id=?',(ident,)).fetchone()
                    conn.execute('DELETE FROM meme_sources WHERE meme_id=?',(ident,))
                    conn.execute('DELETE FROM memes WHERE id=?',(ident,))
                result({'ok':True,'deleted':bool(old)})
                return
            row=conn.execute('SELECT id FROM memes WHERE id=?',(ident,)).fetchone()
            if not row:raise ValueError('梗条目不存在')
            now=datetime.now().astimezone().isoformat(timespec='seconds')
            if action=='review':
                status=payload.get('status')
                if status not in STATUSES:raise ValueError('审核状态错误')
                with conn:
                    conn.execute('UPDATE memes SET review_status=?,updated_at=? WHERE id=?',(status,now,ident))
                result({'ok':True,'status':status,'id':ident})
            else:
                name=clean(payload.get('name'),48)
                if len(name)<2:raise ValueError('梗名至少2个字')
                aliases=clean(payload.get('aliases',''),140,required=False)
                meaning=clean(payload.get('meaning'),220)
                kind=payload.get('kind')
                confidence=payload.get('confidence')
                if kind not in KINDS or confidence not in CONFIDENCES:raise ValueError('梗类型或可信度不合法')
                with conn:
                    conn.execute('''UPDATE memes SET key=?,name=?,aliases=?,meaning=?,kind=?,confidence=?,updated_at=? WHERE id=?''',
                        (name.casefold(),name,aliases,meaning,kind,confidence,now,ident))
                result({'ok':True,'updated':True,'id':ident})
        finally:
            conn.close()
    except (Exception,) as exc:
        # Avoid echoing untrusted arbitrary values in errors.
        result({'ok':False,'error':type(exc).__name__+': '+ ('梗名与已有记录重复' if isinstance(exc,sqlite3.IntegrityError) else str(exc)[:100])})

if __name__=='__main__': main()
