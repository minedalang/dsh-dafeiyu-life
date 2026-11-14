#!/usr/bin/env python3
"""Fixed-path cross-video meme evidence review. No network or AI access."""
import json,sqlite3,sys,re,datetime
from pathlib import Path

# Only literal, bounded title strings from actually selected BVs are evidence.
# These are tentative names, NOT explanations, characters, mood or visual identifications.
STOP={'最新','完整版','合集','原创','搞笑','视频','推荐','剪辑','高能','必看','日常','体验','官方','直播','测试','介绍','挑战','投稿','翻唱','音乐','游戏','更新','教程','番剧'}
BV=re.compile(r'^BV[0-9A-Za-z]{10}$')
GENERIC_MARKER=re.compile(r'^(?:day\s*\d{1,4}|第[0-9零〇一二三四五六七八九十百]+天|第[0-9零〇一二三四五六七八九十百]+期|经验开源|经验分享|教程合集|资源分享|作品展示)$',re.I)
STRONG_BODY_EVIDENCE={'字幕','评论','弹幕','简介','其他文字'}
def generic_marker(name):return bool(GENERIC_MARKER.fullmatch(str(name or '').strip()))


def title_candidates(title):
    if not isinstance(title,str): return []
    if re.search(r'https?://|(?:cookie|token|password|sessdata|secret)',title,re.I):return []
    title=re.sub(r'[\x00-\x1f\x7f-\x9f]',' ',title)[:160]
    parts=re.findall(r'#([^#\n]{2,24})#|[《「“]([^》」”]{2,24})[》」”]|【([^】]{2,24})】',title)
    names=[]
    for choices in parts:
        name=next((x for x in choices if x),'').strip(' #~!！,，.。 ')
        if len(name)<2 or name in STOP or len(name)>24:continue
        if not re.search(r'[\u4e00-\u9fffA-Za-z]',name):continue
        if re.search(r'https?://|(?:cookie|token|password|sessdata|secret)',name,re.I):continue
        if name not in names:names.append(name)
    return names[:3]

def init_db(con):
    with con:
        con.execute('''CREATE TABLE IF NOT EXISTS memes (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '梗',
            meaning TEXT NOT NULL, confidence TEXT NOT NULL DEFAULT '待核实',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'approved')''')
        con.execute('''CREATE TABLE IF NOT EXISTS meme_sources (meme_id INTEGER NOT NULL,bvid TEXT NOT NULL,
            evidence_type TEXT NOT NULL,evidence TEXT NOT NULL,noted_at TEXT NOT NULL, PRIMARY KEY(meme_id,bvid))''')
        con.execute('''CREATE TABLE IF NOT EXISTS meme_observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,bvid TEXT NOT NULL,
            evidence TEXT NOT NULL,evidence_type TEXT NOT NULL,created_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',UNIQUE(name,bvid))''')

def observe(con,payload):
    videos=payload.get('videos') if isinstance(payload,dict) else None
    if not isinstance(videos,list):return {'ok':False,'error':'invalid videos'}
    count=con.execute("SELECT COUNT(*) FROM meme_observations WHERE status='pending'").fetchone()[0]
    added=0
    with con:
        for item in videos[:15]:
            bv=str(item.get('bvid') or '') if isinstance(item,dict) else ''
            title=item.get('title') if isinstance(item,dict) else None
            if not BV.fullmatch(bv) or not isinstance(title,str) or len(title)>250:continue
            evidence=re.sub(r'[\x00-\x1f\x7f-\x9f]',' ',title)[:160]
            for name in title_candidates(title):
                if count+added>=300:break
                now=datetime.datetime.now().astimezone().isoformat(timespec='seconds')
                before=con.total_changes
                con.execute('INSERT OR IGNORE INTO meme_observations(name,bvid,evidence,evidence_type,created_at) VALUES(?,?,?,?,?)',
                    (name,bv,evidence,'标题',now))
                added+=con.total_changes-before
    return {'ok':True,'added':added,'pending':count+added}

def operate(home,mode,payload=None):
    home=Path(home).resolve();file=home/'meme-memory.sqlite3'
    if file.is_symlink():return {'ok':False,'error':'unsafe database path'}
    if not file.exists() and mode!='observe':return {'ok':True,'rows':[],'pending':0}
    if mode=='observe' and not file.exists():home.mkdir(parents=True,exist_ok=True)
    con=sqlite3.connect(file,timeout=8);con.row_factory=sqlite3.Row
    try:
        init_db(con)
        if mode=='observe':return observe(con,payload)
        rows=[dict(r) for r in con.execute("SELECT * FROM meme_observations WHERE status='pending' ORDER BY id LIMIT 80")]
        if mode=='list':return {'ok':True,'rows':rows,'pending':len(rows)}
        if mode!='commit':return {'ok':False,'error':'unsupported'}
        if not isinstance(payload,dict):return {'ok':False,'error':'invalid payload'}
        entries=payload.get('entries') or []
        if not isinstance(entries,list) or len(entries)>3:return {'ok':False,'error':'too many entries'}
        byid={r['id']:r for r in rows};created=0
        with con:
            con.execute('BEGIN IMMEDIATE')
            for entry in entries:
                ids=entry.get('observation_ids') or []
                if not isinstance(ids,list) or len(ids)>12 or len(set(ids))!=len(ids) or any(type(i)!=int or i not in byid for i in ids):continue
                src=[byid[i] for i in ids]
                if len({r['bvid'] for r in src})<2:continue
                name=str(entry.get('name') or '').strip()[:48]
                sources=len({r['bvid'] for r in src})
                title_only=all(str(r['evidence_type'] or '') not in STRONG_BODY_EVIDENCE for r in src)
                if not name or generic_marker(name) or (title_only and sources<3) or any(r['name'].casefold()!=name.casefold() for r in src):continue
                meaning=str(entry.get('meaning') or '').strip()[:220]
                if len(meaning)<10 or re.search(r'https?://|(?:cookie|token|password|sessdata|secret)',meaning,re.I):continue
                kind=entry.get('kind') if entry.get('kind') in ('梗','角色','人物','系列','其他') else '其他'
                now=datetime.datetime.now().astimezone().isoformat(timespec='seconds')
                old=con.execute('SELECT id FROM memes WHERE key=?',(name.casefold(),)).fetchone()
                if old:mid=old['id']
                else:
                    cap=300
                    if con.execute('SELECT COUNT(*) FROM memes').fetchone()[0]>=cap:continue
                    cur=con.execute('''INSERT INTO memes(key,name,aliases,kind,meaning,confidence,created_at,updated_at,review_status)
                        VALUES(?,?,?,?,?,?,?,?,?)''',(name.casefold(),name,'',kind,meaning,'待核实',now,now,'approved'))
                    mid=cur.lastrowid;created+=1
                for r in src:
                    con.execute('''INSERT OR IGNORE INTO meme_sources(meme_id,bvid,evidence_type,evidence,noted_at)
                        VALUES(?,?,?,?,?)''',(mid,r['bvid'],r['evidence_type'],r['evidence'],r['created_at']))
                    con.execute("UPDATE meme_observations SET status='reflected' WHERE id=?",(r['id'],))
        return {'ok':True,'created':created,'reviewed':sum(len(e.get('observation_ids') or []) for e in entries)}
    finally:con.close()

if __name__=='__main__':
    try:
        home,mode=sys.argv[1:3]
        payload=json.loads(sys.stdin.read(16000)) if mode in ('commit','observe') else None
        print(json.dumps(operate(home,mode,payload),ensure_ascii=True))
    except Exception as exc:print(json.dumps({'ok':False,'error':str(exc)[:180]},ensure_ascii=True))
