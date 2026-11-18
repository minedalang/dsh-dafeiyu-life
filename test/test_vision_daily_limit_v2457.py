import importlib.util
import json
import sys
import unittest
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'lib'))
spec=importlib.util.spec_from_file_location('preview_v2457', ROOT/'lib'/'preview_vision.py')
pv=importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv)
spec_dsh=importlib.util.spec_from_file_location('vision_dsh_v2457', ROOT/'lib'/'vision_dsh.py')
vision_dsh=importlib.util.module_from_spec(spec_dsh)
spec_dsh.loader.exec_module(vision_dsh)

class VisionDailyLimitV2457(unittest.TestCase):
    def test_legacy_limit_env_zero_does_not_block_or_reset_existing_usage(self):
        with TemporaryDirectory() as temp:
            home=Path(temp)
            with patch.dict('os.environ',{'BILI_VISION_DAILY_LIMIT':'0'}):
                for _ in range(205):
                    pv._record_vision_attempt(home)
            import sqlite3
            from datetime import datetime
            with closing(sqlite3.connect(home/'vision-usage.sqlite3')) as db:
                self.assertEqual(db.execute('SELECT used FROM usage WHERE day=?',
                    (datetime.now().strftime('%Y-%m-%d'),)).fetchone()[0],205)

    def test_dsh_records_attempt_but_ignores_old_env_limit(self):
        with TemporaryDirectory() as temp:
            home=Path(temp)
            rows=[]
            for ident in vision_dsh._HEADLESS_DENY_TOOLS:
                rows.extend([f'- id: {ident}','  disabled: true',''])
            for ident in ('credentials','authorization','deepseek-account'):
                rows.extend([f'- id: {ident}','  disabled: false',''])
            rows.extend(['- insert:','    - id: mcp-bili-vision-readonly',"      name: '@deepseek-ai/dsh-mcp-client'",'      config:',
              '        serverName: bilivision','        transport: stdio','        env:',"          BILI_MCP_TOOLS: 'bili_preview_vision'", "          BILI_VISION_CHILD: '1'",''])
            (home/'headless-vision-overlay.yml').write_text('\n'.join(rows),encoding='utf8')
            env={'BILI_VISION_DSH_ARGV':json.dumps([str(home/'fake-dsh'),'--profile','headless','--patch',str(home/'headless-vision-overlay.yml')]),
                 'BILI_VISION_DSH_PROVIDER':'mock','BILI_VISION_DSH_MODEL':'vision',
                 'BILI_VISION_DAILY_LIMIT':'0'}
            called=[]
            def runner(*args,**kwargs):
                called.append(True)
                from types import SimpleNamespace
                return SimpleNamespace(returncode=2,stdout=b'',stderr=b'')
            with patch('preview_vision._record_vision_attempt') as record:
                result=vision_dsh.describe_with_dsh('BV1234567890',home,env=env,runner=runner)
                self.assertNotEqual(result['status'],'daily_limit')
                self.assertTrue(called)
                record.assert_called_once_with(home)

if __name__=='__main__': unittest.main()
