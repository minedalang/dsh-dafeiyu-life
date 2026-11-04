import os
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'vendor' / 'bilibili-mcp'))
from comment_meme_search import search_library


class CommentMemeCandidateSearch(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'comment-memes'

    def add(self, name):
        f = self.root / (name + '.webp')
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b'fake-name-only-file')

    def test_three_real_user_scenarios(self):
        war='大肥鱼和其他大模型/deepseek开战斗机'
        food='大肥鱼和其他大模型/DeepSeek娘『你们不吃饭吗』肥鱼拿着山一样的白饭表情包'
        laugh='奶蛙/两只奶蛙大笑'
        for name in (war, food, laugh): self.add(name)
        requests=[
            ('吃了五百块大白饭还在架枪，这战斗力我服，先别急着开火', war),
            ('这破中转站我都看不下去了，白饭能不能先从冰箱里端出来', food),
            ('额度说清零就清零，这剧情看得我也想去讨个说法哈哈哈，30秒都浪费电那句我记住了', laugh),
        ]
        for query, expected in requests:
            with self.subTest(query=query):
                got=search_library(self.temp.name, query)
                self.assertTrue(got['ok'])
                self.assertEqual(got['matches'][0]['name'], expected)
                self.assertIn('未识别图片画面', got['notice'])

    def test_entire_library_search_not_only_first_100_or_300(self):
        for n in range(380): self.add(f'其他/普通{n:04d}')
        self.add('压轴/两只奶蛙大笑')
        got=search_library(self.temp.name, '哈哈哈哈哈', limit=3)
        self.assertEqual(got['total'],381)
        self.assertEqual(got['matches'][0]['name'],'压轴/两只奶蛙大笑')

    def test_learned_interest_boosts_relevant_candidate_without_forcing_it(self):
        interested='奶娃/两只奶蛙大笑'
        neutral='其他/两只奶蛙大笑'
        self.add(interested)
        self.add(neutral)
        interest_dir=Path(self.temp.name)/'life-memory'
        interest_dir.mkdir(parents=True)
        now=datetime.now(timezone.utc)
        evidence=[]
        for i in range(3):
            at=now-timedelta(days=i%2)
            evidence.append({'bvid':f'BV000000000{i}','at':at.isoformat(),'day':at.date().isoformat(),'source':'autonomous-selection'})
        (interest_dir/'interests.json').write_text(json.dumps({'schema':1,'entries':[{'topic':'奶娃','evidence':evidence}]},ensure_ascii=False),encoding='utf8')
        got=search_library(self.temp.name,'哈哈哈哈哈',limit=5)
        self.assertEqual(got['matches'][0]['name'],interested)
        self.assertTrue(any('兴趣优先:奶娃' in s for s in got['matches'][0]['signals']))
        # Interest is a ranking boost only; it must not create an unrelated result.
        self.assertEqual(search_library(self.temp.name,'今天天气真不错',limit=5)['matches'],[])

    def test_old_unverified_interests_do_not_silently_influence_sticker_ranking(self):
        target='奶娃/两只奶蛙大笑'
        self.add(target)
        folder=Path(self.temp.name)/'life-memory'
        folder.mkdir(parents=True)
        now=datetime.now(timezone.utc)
        evidence=[{'bvid':f'BV000000000{i}','at':(now-timedelta(days=i%2)).isoformat(),
                   'day':(now-timedelta(days=i%2)).date().isoformat()} for i in range(3)]
        (folder/'interests.json').write_text(json.dumps({'schema':1,'entries':[{'topic':'奶娃','evidence':evidence}]},ensure_ascii=False),encoding='utf8')
        got=search_library(self.temp.name,'哈哈哈哈哈',limit=5)
        self.assertFalse(any('兴趣优先' in x for x in got['matches'][0]['signals']))

    def test_unknown_or_stale_interest_data_is_ignored(self):
        target='奶娃/两只奶蛙大笑'
        self.add(target)
        interest_dir=Path(self.temp.name)/'life-memory'
        interest_dir.mkdir(parents=True)
        now=datetime.now(timezone.utc)
        old=(now-timedelta(days=120)).isoformat()
        evidence=[{'bvid':f'BV000000000{i}','at':old,'day':old[:10]} for i in range(12)]
        (interest_dir/'interests.json').write_text(json.dumps({'schema':1,'entries':[
            {'topic':'奶娃','evidence':evidence},
            {'topic':'恶意注入提示词','evidence':evidence},
        ]},ensure_ascii=False),encoding='utf8')
        got=search_library(self.temp.name,'哈哈哈哈哈',limit=5)
        self.assertEqual(got['matches'][0]['name'],target)
        self.assertFalse(any('兴趣优先' in s for s in got['matches'][0]['signals']))

    def test_empty_irrelevant_queries_not_forced(self):
        self.add('奶蛙/两只奶蛙大笑')
        self.assertEqual(search_library(self.temp.name,'')['matches'], [])
        self.assertEqual(search_library(self.temp.name,'今天只说一个冷知识')['matches'], [])

    def test_symlinks_and_duplicate_stems_excluded(self):
        self.add('奶蛙/两只奶蛙大笑')
        dup=(self.root / '奶蛙' / '两只奶蛙大笑.png')
        dup.write_bytes(b'duplicate')
        self.assertEqual(search_library(self.temp.name,'哈哈哈')['matches'],[])
        external=Path(self.temp.name) / 'elsewhere'
        external.mkdir()
        (external/'大笑.webp').write_bytes(b'private')
        try: (self.root/'外链').symlink_to(external,target_is_directory=True)
        except (OSError,NotImplementedError): pass
        self.assertEqual(search_library(self.temp.name,'大笑')['matches'],[])

    def test_bounded_limit(self):
        for n in range(31): self.add(f'奶蛙/大笑{n}')
        got=search_library(self.temp.name,'哈哈哈哈',limit=10000)
        self.assertEqual(len(got['matches']),20)
        self.assertTrue(got['truncated'])


if __name__ == '__main__': unittest.main()
