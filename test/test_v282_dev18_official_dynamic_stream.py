"""Offline PlayURL provenance, dynamic CDN, and same-track backup safety regression."""
import ipaddress
import socket
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'lib'))
import adaptive_video as av
import preview_vision as pv

BV='BV1Nxs26uE46'
INIT={'Initialization':'0-934','indexRange':'935-4250'}
PRIMARY='https://xy223x109x234x75xy.mcdn.bilivideo.cn:8082/v1/resource/upgcxcode/32/56/43697835632/43697835632-1-30112.m4s?deadline=1795083943&upsig=SECRET'
BACKUP='https://noy84w.edge.mountaintoys.cn:4483/upgcxcode/32/56/43697835632/43697835632-1-30112.m4s?upsig=BACKUP'
FALLBACK='https://cn-hbsjz-cm-02-03.bilivideo.com/upgcxcode/32/56/43697835632/43697835632-1-30112.m4s?upsig=FALLBACK'

class OfficialDynamicStreamTests(unittest.TestCase):
    def test_real_public_playurl_shapes_and_media_safety(self):
        for url in (PRIMARY,BACKUP,FALLBACK):
            self.assertEqual(av._cdn_url(url),url)
        for bad in (
            'http://video.example.net/upgcxcode/stream.m4s',
            'https://user:pw@video.example.net:8082/video.m4s',
            'https://127.0.0.1:8082/video.m4s',
            'https://localhost:8082/video.m4s',
            'https://test.local:8082/../../video.m4s',
            'https://video.example.net:8082/%2e%2e/video.m4s',
            'https://video.example.net:8082/video.exe',
            'https://video.example.net:8082/video.m4s#fragment',
            'https://video.example.net:8082/video.m4s\r\nHost: localhost',
        ):
            with self.subTest(bad=bad.split('?')[0]),self.assertRaises(av.AdaptiveUnavailable):
                av._cdn_url(bad)
        with patch.object(av.socket,'getaddrinfo',return_value=[
            (socket.AF_INET,socket.SOCK_STREAM,6,'',('127.0.0.1',8082))]):
            with self.assertRaises(av.AdaptiveUnavailable) as context:
                av._public_cdn_addresses('new-cdn.example.net',8082)
            self.assertEqual(context.exception.code,'video_source_ip_rejected')

    def test_official_response_only_and_low_bandwidth_first(self):
        calls=[]
        def official(url):
            calls.append(url)
            if '/view?' in url:
                return {'bvid':BV,'pages':[{'cid':1234,'duration':1364}]}
            if 'fnval=1&' in url:
                return {'durl':[{'url':'http://invalid.example.net/untrusted.mp4','size':1234567}]}
            if 'fnval=16' in url:
                return {'dash':{'video':[
                    {'baseUrl':PRIMARY,'backupUrl':[BACKUP,FALLBACK],
                     'bandwidth':995523,'SegmentBase':INIT},
                    {'base_url':'https://another-new-cdn.net:8082/routed/low.m4s?sig=opaque',
                     'backup_url':['https://backup-new.net:4483/media/low.m4s'],
                     'bandwidth':10000,'segment_base':{'initialization':'0-900','index_range':'901-1100'}}]}}
            raise AssertionError('unexpected API call')
        with patch.object(pv,'_json_api',side_effect=official):
            source=av._playurl(BV)
        self.assertEqual(len(calls),3)
        self.assertTrue(all(x.startswith('https://api.bilibili.com/') for x in calls))
        self.assertEqual(source['url'],'https://another-new-cdn.net:8082/routed/low.m4s?sig=opaque')
        self.assertEqual(len(source['urls']),2)
        self.assertEqual(source['track_selection'],'lowest-bandwidth')
        self.assertEqual(source['duration'],1364)
        original=av._choose_dash_video({'dash':{'video':[{'baseUrl':PRIMARY,'backupUrl':[BACKUP,FALLBACK],
                      'bandwidth':995523,'SegmentBase':INIT}]}})
        self.assertEqual(original['urls'],[PRIMARY,BACKUP,FALLBACK])
        self.assertNotIn('SECRET',str({k:v for k,v in original.items() if k not in ('url','urls')}))

    def test_primary_probe_failure_tries_same_track_backups_only(self):
        source={'kind':'dash','url':PRIMARY,'urls':[PRIMARY,BACKUP,FALLBACK],
                'initial':(0,934),'index':(935,4250)}
        attempted=[]
        def probe(url):
            attempted.append(url)
            if url==PRIMARY: raise av.AdaptiveUnavailable('dash_range_probe_failed')
            if url==BACKUP: raise av.AdaptiveUnavailable('dash_range_probe_http_error')
            return (98765,'etag','')
        def fake_media(url,*args):
            self.assertEqual(url,FALLBACK)
            raise RuntimeError('reached authorized backup before any media download')
        with patch.object(av,'_dash_probe_size',side_effect=probe),\
             patch.object(av,'_SparseRangeVideo',side_effect=fake_media):
            with self.assertRaisesRegex(RuntimeError,'authorized backup'):
                av._download_dash_samples(source,'/tmp',[],None,24*1048576)
        self.assertEqual(attempted,[PRIMARY,BACKUP,FALLBACK])

    def test_platform_limit_or_identity_mismatch_does_not_retry(self):
        source={'kind':'dash','url':PRIMARY,'urls':[PRIMARY,BACKUP,FALLBACK],
                'initial':(0,934),'index':(935,4250)}
        for code in ('platform_rate_limited','video_range_identity_mismatch','video_source_ip_rejected'):
            called=[]
            def probe(url):
                called.append(url)
                raise av.AdaptiveUnavailable(code,fallback=False)
            with self.subTest(code=code),patch.object(av,'_dash_probe_size',side_effect=probe):
                with self.assertRaises(av.AdaptiveUnavailable) as caught:
                    av._download_dash_samples(source,'/tmp',[],None,24*1048576)
                self.assertEqual(caught.exception.code,code)
                self.assertEqual(called,[PRIMARY])

if __name__=='__main__':unittest.main()
