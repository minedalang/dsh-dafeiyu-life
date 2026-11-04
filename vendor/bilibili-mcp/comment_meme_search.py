"""Bounded, deterministic comment-sticker name search. Never reads image pixels or calls AI.

Search is deliberately a recommendation, not authorization to upload an image.
The agent must select the exact verified name and decide whether the tone fits.
"""
import re
import json
from datetime import datetime, timezone
from pathlib import Path
from comment_memes import _list

# v2.4.71: rules are a local, owner-editable JSON dataset, not hard-coded synonyms.
# `comment-meme-rules.json` is stored in BILI_DUTY_HOME and included in business backup.


# Only learned, cross-day interests affect ranking. Owner-curated search keywords and
# friend profiles are intentionally not read here. Interest boosts never create a
# candidate by themselves: a sticker must first match the current query/rules.
_INTEREST_TERMS = {
    'DeepSeek／DSH': ('deepseek', 'dsh', '大肥鱼', '鲸鱼娘', '鲸鱼'),
    'AI模型拟人': ('模型娘', 'claude', 'gpt', 'gemini', 'kimi', '豆包', '通义', '智谱'),
    'AI陪伴与情感': ('陪伴', '告别', '记忆', '离别', '治愈', '思念', '小金鱼'),
    '白饭与美食': ('白饭', '白米饭', '米饭', '吃饭', '做饭', '美食', '料理', '下厨'),
    'Token与模型技术': ('token', '推理', '开源', '模型', '插件', '编程', '工具调用', 'api', 'agent'),
    '游戏': ('游戏', '攻略', '闯关', '通关', '电竞'),
    '鬼畜与抽象': ('鬼畜', '整活', '抽象', '搞笑', '魔性', '吐槽', '玩梗', '表情包'),
    '二次元与音乐': ('动画', '动漫', '二次元', '声优', '唱歌', '音乐', 'pv', 'mad', '番剧'),
    '奶娃': ('奶娃',),
    '奶蛙': ('奶蛙',),
}
_INTEREST_STAGE = {'stable': ('较稳定兴趣', 8), 'growing': ('成长兴趣', 6), 'emerging': ('短期兴趣', 4)}

def _read_learned_interests(home):
    """Read the bounded local life-interest file; invalid/missing data means no boost."""
    base = Path(home).resolve()
    folder = base / 'life-memory'
    path = folder / 'interests.json'
    try:
        if folder.is_symlink() or path.is_symlink() or not path.exists() or not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
            return []
        data = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(data, dict) or data.get('schema') != 1 or not isinstance(data.get('entries'), list):
            return []
        now = datetime.now(timezone.utc).timestamp()
        rows = []
        for entry in data['entries'][:30]:
            if not isinstance(entry, dict):
                continue
            topic = entry.get('topic')
            if topic not in _INTEREST_TERMS:
                continue
            evidence = entry.get('evidence')
            if not isinstance(evidence, list):
                continue
            seen_bv, dates = set(), set()
            for ev in evidence[-90:]:
                if not isinstance(ev, dict) or ev.get('source') != 'autonomous-selection':
                    continue
                raw = str(ev.get('at') or ev.get('day') or '')[:40]
                try:
                    at = datetime.fromisoformat(raw.replace('Z', '+00:00'))
                    if at.tzinfo is None:
                        at = at.replace(tzinfo=timezone.utc)
                    stamp = at.timestamp()
                except (ValueError, OverflowError):
                    continue
                if stamp > now + 86400 or now - stamp > 90 * 86400:
                    continue
                bvid = str(ev.get('bvid') or '')
                if not re.fullmatch(r'BV[0-9A-Za-z]{10}', bvid) or bvid in seen_bv:
                    continue
                seen_bv.add(bvid)
                dates.add(at.date().isoformat())
            count, day_count = len(seen_bv), len(dates)
            stage = 'stable' if count >= 12 and day_count >= 5 else 'growing' if count >= 6 and day_count >= 3 else 'emerging' if count >= 3 and day_count >= 2 else ''
            if stage:
                rows.append({'topic': topic, 'stage': stage, 'count': count, 'days': day_count, 'terms': _INTEREST_TERMS[topic]})
        weights = {'stable': 3, 'growing': 2, 'emerging': 1}
        rows.sort(key=lambda x: (-weights[x['stage']], -x['count'], x['topic']))
        return rows[:12]
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return []

def _interest_bonus(name, interests):
    folded = name.casefold()
    stem = folded.rsplit('/', 1)[-1]
    folder = folded.rsplit('/', 1)[0] if '/' in folded else ''
    bonus, signals = 0, []
    for row in interests:
        terms = row['terms']
        matched = next((term for term in terms if term.casefold() in stem), None)
        factor = 1.0
        if matched is None:
            matched = next((term for term in terms if term.casefold() in folder), None)
            factor = 0.5
        if matched is None:
            continue
        stage_label, base = _INTEREST_STAGE[row['stage']]
        value = max(1, int(base * factor))
        bonus += value
        signals.append(f"兴趣优先:{row['topic']}（{stage_label}）")
        if len(signals) >= 2 or bonus >= 12:
            break
    return min(12, bonus), signals[:2]


_RULES_DEFAULT = 'comment_meme_rules_default.json'
_RULES_CUSTOM = 'comment-meme-rules.json'


def _valid_phrases(value):
    return (isinstance(value, list) and len(value) <= 36 and
            all(isinstance(x, str) and 1 <= len(x) <= 38 and
                not any(ord(c) < 32 for c in x) for x in value))


def validate_rules_payload(data):
    """Match the owner-editable schema for on-disk rules AND unsaved preview."""
    if (not isinstance(data, dict) or data.get('schema') != 1 or
            not isinstance(data.get('rules'), list) or len(data['rules']) > 100):
        raise ValueError('表情包检索规则格式不兼容')
    ids = set()
    for rule in data['rules']:
        if (not isinstance(rule, dict) or not isinstance(rule.get('id'), str) or
                not re.fullmatch(r'[a-z0-9_-]{1,48}',rule['id']) or rule['id'] in ids or
                not isinstance(rule.get('label'), str) or not rule['label'].strip() or len(rule['label']) > 65 or
                not isinstance(rule.get('enabled'), bool) or
                not _valid_phrases(rule.get('triggers')) or not rule['triggers'] or
                not _valid_phrases(rule.get('targets')) or not rule['targets'] or
                not _valid_phrases(rule.get('requireAny', [])) or
                not _valid_phrases(rule.get('excludeAny', []))):
            raise ValueError('表情包检索规则字段无效')
        ids.add(rule['id'])
    return data['rules']


def load_rules(home):
    path = Path(home).resolve() / _RULES_CUSTOM
    if not path.exists():
        path = Path(__file__).resolve().parent / _RULES_DEFAULT
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 100_000:
        raise ValueError('表情包检索规则文件不安全或过大')
    return validate_rules_payload(json.loads(path.read_text(encoding='utf-8')))


def _hits(query, words):
    return [w for w in words if w.casefold() in query]

# Reasonable literal phrases for name/description alignment, no private text or prompt inference.
_WORDS = ('战斗机','战斗','战力','开火','架枪','对线','白饭','米饭','大米饭','冰箱','吃饭','饭量',
          '大笑','爆笑','哈哈','笑死','吐槽','无语','离谱','白眼','翻白眼','震惊','惊呆',
          '委屈','哭泣','开心','庆祝','生气','吃瓜','围观','摸鱼','睡觉','躺平',
          '打工','老板','中转站','额度','模型','deepseek','奶蛙','奶娃','大肥鱼')


def search_library(home, query, limit=12, rules_override=None):
    """Return up to `limit` names ordered by cheap scene/emotion and lexical matching.

    No claim that any picture's actual pixels have been viewed. The library's
    existing safe enumeration also rejects duplicate or unsafe file names.
    """
    query = re.sub(r'[\x00-\x1f\x7f]', ' ', str(query or ''))[:280].casefold()
    query = re.sub(r'\s+', ' ', query).strip()
    if not query:
        return {'ok': True, 'matches': [], 'searched': 0, 'total': 0}
    limit = max(1, min(20, int(limit or 12)))
    rows = _list(home)
    rules = validate_rules_payload(rules_override) if rules_override is not None else load_rules(home)
    chosen_intents = []
    for rule in rules:
        if not rule['enabled']:
            continue
        matched = _hits(query, rule['triggers'])
        if not matched or (rule.get('requireAny') and not _hits(query, rule['requireAny'])):
            continue
        if rule.get('excludeAny') and _hits(query, rule['excludeAny']):
            continue
        chosen_intents.append((rule, min(4, len(matched))))
    terms = [word for word in _WORDS if word in query]
    interests = _read_learned_interests(home)
    scored = []
    for row in rows:
        name = row['name']
        stem = name.rsplit('/', 1)[-1].casefold()
        folder = name.rsplit('/', 1)[0].casefold() if '/' in name else ''
        score = 0
        signals = []
        for rule, count in chosen_intents:
            label = rule['label']
            if _hits(stem, rule['targets']):
                score += 24 + count * 5
                signals.append(label + '情绪/场景')
            elif _hits(folder, rule['targets']):
                score += 7 + count
                signals.append(label + '分类')
        for word in terms:
            if word in stem:
                score += 7 + min(5, len(word))
                signals.append('名称:' + word)
            elif word in folder:
                score += 3
                signals.append('分类:' + word)
        # For simple titles not covered by the synonym groups, match 2+ char
        # word fragments; ignore common two-char boilerplate that over-matches.
        if not score:
            chunks = re.findall(r'[\u3400-\u9fff]{2,}|[a-z0-9]{3,}', query)
            for chunk in chunks:
                if len(chunk) <= 5 and chunk in stem:
                    score += 5 + len(chunk)
                    signals.append('原词:' + chunk)
        # Interest is only a tie-breaker/priority signal after the query already found
        # this candidate; it must never force an unrelated sticker into the result set.
        if score and interests:
            bonus, interest_signals = _interest_bonus(name, interests)
            if bonus:
                score += bonus
                signals.extend(interest_signals)
        if score:
            scored.append((score, len(signals), name, signals))
    scored.sort(key=lambda x: (-x[0], -x[1], x[2].casefold()))
    return {'ok': True, 'query': query[:120], 'total': len(rows), 'searched': len(rows),
            'matchedRules': [{'id': r['id'], 'label': r['label'], 'targets': r['targets'][:4]} for r,_ in chosen_intents[:12]],
            'matches': [{'name': name, 'score': score, 'signals': signals[:4]}
                        for score, _, name, signals in scored[:limit]],
            'truncated': len(scored) > limit,
            'notice': '只根据真实图片的名称/分类匹配；未识别图片画面，AI仍需判断语气是否合适。'}
