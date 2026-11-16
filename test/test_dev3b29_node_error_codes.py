import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'lib'))
import vision_dsh
class Result:
    returncode=1
    stdout=b''
    stderr=b''
class TestSafeNodeError(unittest.TestCase):
    def test_safe_node_code(self):
        a=Result();a.stderr=b'node:internal/modules:500\nError [ERR_MODULE_NOT_FOUND]: /private/secret/file'
        row=vision_dsh._safe_cli_process_receipt(a)
        self.assertEqual(row['stderrKind'],'node_exception')
        self.assertEqual(row['nodeErrorCode'],'err_module_not_found')
        self.assertNotIn('secret',str(row))
    def test_unknown_exceptions_no_paths(self):
        a=Result();a.stderr=b'node:internal/modules:500\nError [ERR_MY_UNSAFE_PRIVATE_PATH]: token=secret'
        row=vision_dsh._safe_cli_process_receipt(a)
        self.assertEqual(row.get('nodeErrorCode','unknown'),'unknown')
        self.assertNotIn('secret',str(row))
if __name__=='__main__':unittest.main()
