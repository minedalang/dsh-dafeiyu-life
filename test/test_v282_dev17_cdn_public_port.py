"""Dev.17: bounded official HTTPS CDN transport on public, pinned DNS addresses."""
import sys
from pathlib import Path
import socket
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'lib'))
import adaptive_video as av

class PublicCDNPortTests(unittest.TestCase):
    def test_high_https_port_with_restricted_cdn_host_and_media_path(self):
        url='https://upos-sz-a.bilivideo.com:8443/upgcxcode/movie.m4s?token=DO-NOT-LOG'
        self.assertEqual(av._cdn_url(url),url)
        for bad,code in [
            ('https://127.0.0.1:80/upgcxcode/movie.m4s','video_source_domain_rejected'),
            ('http://upos-sz-a.bilivideo.com:8443/upgcxcode/movie.m4s','video_source_scheme_rejected'),
            ('https://localhost:8443/upgcxcode/movie.m4s','video_source_domain_rejected'),
            ('https://upos-sz-a.bilivideo.com:8443/../internal/file.m4s','video_source_path_rejected'),
            ('https://user:pass@upos-sz-a.bilivideo.com:8443/upgcxcode/movie.m4s','video_source_authority_rejected'),
        ]:
            with self.subTest(bad=code),self.assertRaises(av.AdaptiveUnavailable) as err:
                av._cdn_url(bad)
            self.assertEqual(err.exception.code,code)
            self.assertNotIn('DO-NOT-LOG',str(err.exception))

    def test_only_global_dns_candidates_accepted(self):
        rows=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('203.0.113.45',8443))]
        # Documentation IP range is not public globally routed: fail closed.
        with patch.object(av.socket,'getaddrinfo',return_value=rows):
            with self.assertRaises(av.AdaptiveUnavailable) as err:
                av._public_cdn_addresses('cdn.bilivideo.com',8443)
        self.assertEqual(err.exception.code,'video_source_ip_rejected')
        good=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('8.8.8.8',8443))]
        with patch.object(av.socket,'getaddrinfo',return_value=good):
            self.assertEqual(av._public_cdn_addresses('cdn.bilivideo.com',8443),[(socket.AF_INET,socket.SOCK_STREAM,6,('8.8.8.8',8443))])
        mixed=good+[(socket.AF_INET,socket.SOCK_STREAM,6,'',('127.0.0.1',8443))]
        with patch.object(av.socket,'getaddrinfo',return_value=mixed):
            with self.assertRaises(av.AdaptiveUnavailable) as err:
                av._public_cdn_addresses('cdn.bilivideo.com',8443)
            self.assertEqual(err.exception.code,'video_source_ip_rejected')

    def test_no_proxy_in_direct_cdn_opener(self):
        from urllib import request
        op=av._cdn_opener(request.HTTPRedirectHandler())
        proxy=[x for x in op.handlers if isinstance(x,request.ProxyHandler)]
        self.assertEqual(proxy,[])  # explicit empty ProxyHandler suppresses ambient proxies
        self.assertTrue(any(isinstance(h,av._PinnedCDNHandler) for h in op.handlers))

    def test_pinned_connection_wraps_with_original_hostname(self):
        class FakeSocket:
            def __init__(self,*args):self.connected=None
            def settimeout(self,x):pass
            def connect(self,address):self.connected=address
            def close(self):pass
        class FakeContext:
            def __init__(self):self.server=None;self.sock=None
            def wrap_socket(self,sock,server_hostname=None):self.server=server_hostname;self.sock=sock;return sock
        sock=FakeSocket();context=FakeContext()
        conn=av._PinnedCDNHTTPS('safe.bilivideo.com',port=8443,context=context)
        rows=[(socket.AF_INET,socket.SOCK_STREAM,6,('8.8.8.8',8443))]
        with patch.object(av,'_public_cdn_addresses',return_value=rows),patch.object(av.socket,'socket',return_value=sock):
            conn.connect()
        self.assertEqual(sock.connected,('8.8.8.8',8443))
        self.assertEqual(context.server,'safe.bilivideo.com')

if __name__=='__main__':unittest.main()
