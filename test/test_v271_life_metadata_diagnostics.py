import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'vendor' / 'bilibili-mcp'))
from life_metadata_diagnostics import public_metadata_failure


class FakeBiliError(Exception):
    def __init__(self, code, text):
        super().__init__(text)
        self.code = code


class LifeMetadataDiagnosticsTests(unittest.TestCase):
    def test_platform_rate_limit_only_exposes_safe_numbers(self):
        raw = public_metadata_failure(FakeBiliError(-412, 'https://host/?SESSDATA=PRIVATE'))
        self.assertEqual(raw['failureCode'], 'metadata-rate-limited')
        self.assertEqual(raw['platformCode'], -412)
        self.assertNotIn('PRIVATE', str(raw))
        self.assertFalse(raw['ok'])

    def test_login_and_timeout(self):
        self.assertEqual(public_metadata_failure(FakeBiliError(-101, 'login'))['failureCode'], 'metadata-account-unavailable')
        self.assertEqual(public_metadata_failure(TimeoutError('huge private error'))['failureCode'], 'metadata-timeout')

    def test_supported_legacy_exception_code_str_without_raw_prose(self):
        row = public_metadata_failure(Exception('request refused code=-352 Cookie:TOPSECRET'))
        self.assertEqual(row['failureCode'], 'metadata-rate-limited')
        self.assertEqual(row['platformCode'], -352)
        self.assertNotIn('TOPSECRET', str(row))

    def test_unknown_error_does_not_invent_platform_status(self):
        row = public_metadata_failure(Exception('password=supersecret'))
        self.assertEqual(row['failureCode'], 'metadata-api-error')
        self.assertEqual(row['platformCode'], 0)
        self.assertNotIn('supersecret', str(row))

    def test_oversized_platform_codes_not_propagated(self):
        row = public_metadata_failure(FakeBiliError(123456789, 'opaque'))
        self.assertEqual(row['platformCode'], 0)


if __name__ == '__main__':
    unittest.main()
