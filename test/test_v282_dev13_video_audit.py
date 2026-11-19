import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
import zipfile

MODULE = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'audit-282-observation.py'
spec = importlib.util.spec_from_file_location('audit_282_observation', MODULE)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class VideoAuditTests(unittest.TestCase):
    def test_only_redacted_counts_are_reported(self):
        with tempfile.TemporaryDirectory() as home:
            p = pathlib.Path(home) / 'logs.zip'
            with zipfile.ZipFile(p, 'w') as z:
                z.writestr('_diagnostics/video-agent-decision-timeline.json', json.dumps({'recent':[
                    {'at':1795065444994,'offeredVideoAgent':True,'choices':[
                        {'action':'observe_video','type':'model-choice','bvid':'BV1234567890'},
                        {'type':'blocked','code':'visual-read-receipt-unavailable', 'text':'private stuff'}]},
                    {'at':1795065444995,'choices':[{'action':'observe_video','type':'action-result','result':'visual-read-verified'}]}
                ]}))
                z.writestr('_diagnostics/video-agent-rounds.json',json.dumps({'recentRounds':[{'state':'completed'}]}))
                z.writestr('vision-events/2026-11-19.jsonl', json.dumps({'status':'frames_ready','ok':True,'time':'2026-11-19T12:00:00','bvid':'BV1234567890'}))
            report=audit.audit(p)
            self.assertEqual(report['life_chose_frames'],1)
            self.assertEqual(report['frames_receipt_verified'],1)
            self.assertEqual(report['visual_block_codes']['visual-read-receipt-unavailable'],1)
            self.assertEqual(report['last_frame_ready_event'],'2026-11-19T12:00:00')
            out=io.StringIO()
            with contextlib.redirect_stdout(out):self.assertEqual(audit.main([str(p)]),0)
            self.assertNotIn('BV1234567890',out.getvalue())
            self.assertNotIn('private stuff',out.getvalue())
    def test_missing_optional_diagnostics_is_safe(self):
        with tempfile.TemporaryDirectory() as home:
            p=pathlib.Path(home)/'logs.zip'
            with zipfile.ZipFile(p,'w'):pass
            self.assertEqual(audit.audit(p)['frames_receipt_verified'],0)
            self.assertEqual(audit.audit(p)['last_frame_ready_event'],'无')

if __name__=='__main__':unittest.main()
