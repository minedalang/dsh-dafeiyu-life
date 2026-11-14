"""Read-only, bounded local preview; used by the owner UI, never sends a comment."""
import json
import sys
from pathlib import Path
home=Path(sys.argv[1]).resolve()
sys.path.insert(0,str(home))
sys.path.insert(1,str(Path(__file__).resolve().parent.parent/'vendor'/'bilibili-mcp'))
try:
    from comment_meme_search import search_library
    # Preview receives the current editor contents over stdin; it does NOT save
    # them to disk and does not rely on system TEMP/TMP.
    raw=sys.stdin.buffer.read(101_000)
    if len(raw)>100_000:
        raise ValueError('预览规则超过100 KB限制')
    overrides=json.loads(raw.decode('utf-8')) if raw.strip() else None
    print(json.dumps(search_library(home,sys.argv[2],limit=12,rules_override=overrides),ensure_ascii=True))
except Exception as exc:
    print(json.dumps({'ok':False,'error':str(exc)[:180]},ensure_ascii=True))
