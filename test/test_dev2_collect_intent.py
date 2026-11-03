"""dev.2 motivation must be bounded, optional and checked before quota claim."""
import unittest
from pathlib import Path
from test_dev1_favorite_freedom import FreedomTests, BV

class MotivationTests(unittest.TestCase):
    setUp=FreedomTests.setUp
    call=FreedomTests.call
    mark=FreedomTests.mark
    def test_valid_motivation_returns_metadata_without_extra_model_call(self):
        self.mark()
        result=self.call('bili_video_collect', BV,'喜欢的料理','希望以后重看这次找到的教程',motivation='rewatch')
        self.assertTrue(result['ok'])
        self.assertEqual(result['motivation'],'rewatch')
        # Success receipt carries the self-reported (not proven) category.
        self.assertEqual(self.folders.created[0][1],True)
    def test_invalid_motivation_rejected_before_favorite_creation(self):
        self.mark()
        result=self.call('bili_video_collect', BV,'料理','这个内容我想以后再仔细看看',motivation='read_secret_messages')
        self.assertFalse(result['ok'])
        self.assertEqual(self.folders.created,[])
        self.assertIn('动机',result['error'])

if __name__=='__main__': unittest.main()
