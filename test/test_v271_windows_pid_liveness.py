"""Windows parent-process probe for the shared Node/Python read lock.

The fake Win32 tests also run on Linux to check privileges, return values,
and handle cleanup. The real-process test runs only on Windows.
"""
import ctypes
import os
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'vendor' / 'bilibili-mcp'))
import read_action_gate as gate


class NativeCall:
    """Small ctypes-compatible function stub for portable Win32 API tests."""
    def __init__(self, fn):
        self.fn = fn
        self.argtypes = None
        self.restype = None

    def __call__(self, *args):
        return self.fn(*args)


class FakeKernel32:
    def __init__(self, *, handle=1234, query_ok=True, status=259):
        self.handle = handle
        self.query_ok = query_ok
        self.status = status
        self.closed = []
        self.open_args = []
        self.OpenProcess = NativeCall(self._open)
        self.GetExitCodeProcess = NativeCall(self._query)
        self.CloseHandle = NativeCall(self._close)

    def _open(self, rights, inherit, pid):
        self.open_args.append((rights, inherit, pid))
        return self.handle

    def _query(self, handle, out):
        self.query_handle = handle
        ctypes.cast(out, ctypes.POINTER(ctypes.c_ulong)).contents.value = self.status
        return self.query_ok

    def _close(self, handle):
        self.closed.append(handle)
        return True


class ParentPidLivenessTests(unittest.TestCase):
    def test_invalid_pid_never_authorizes_nested_adapter(self):
        for pid in (-1, 0, True, None, '123'):
            self.assertFalse(gate._pid_alive(pid))

    def test_win32_alive_process_uses_query_only_access(self):
        fake = FakeKernel32(status=259)
        self.assertTrue(gate._windows_pid_alive(4242, kernel32=fake))
        self.assertEqual(fake.open_args, [(0x1000, False, 4242)])
        self.assertEqual(fake.closed, [1234])

    def test_win32_missing_or_ended_parent_fails_closed(self):
        for fake in (FakeKernel32(handle=0), FakeKernel32(status=0), FakeKernel32(query_ok=False)):
            self.assertFalse(gate._windows_pid_alive(4242, kernel32=fake))
            self.assertEqual(fake.closed, [1234] if fake.handle else [])

    @unittest.skipUnless(os.name == 'nt', 'Real Win32 process API only runs on Windows')
    def test_real_windows_process_lifecycle(self):
        self.assertTrue(gate._pid_alive(os.getpid()))
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(20)'],
                                 creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            self.assertTrue(gate._pid_alive(child.pid))
        finally:
            child.terminate()
            child.wait(timeout=5)
        self.assertFalse(gate._pid_alive(child.pid))


if __name__ == '__main__':
    unittest.main()
