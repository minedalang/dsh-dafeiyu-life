import importlib.util
from pathlib import Path
from unittest.mock import patch
import json

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('vision_dsh_dev3b22',ROOT/'lib'/'vision_dsh.py')
vision=importlib.util.module_from_spec(spec)
spec.loader.exec_module(vision)


def test_mcp_preflight_asset_and_tool_integrity(tmp_path):
    asset=ROOT/'lib'/'assets'/'local-vision-selftest-dafeiyu.png'
    script=(ROOT/'vendor'/'bilibili-mcp'/'mcp_server.py').read_text(encoding='utf8')
    (tmp_path/'mcp_server.py').write_text(script,encoding='utf8')
    overlay="          BILI_VISION_TEST_ASSET: '"+str(asset)+"'\n"
    with patch.object(vision.importlib.util,'find_spec',return_value=object()):
        assert vision._selftest_mcp_preflight(tmp_path,overlay)['status']=='prerequisites_ready'
    (tmp_path/'mcp_server.py').write_text('async def unrelated(): pass',encoding='utf8')
    assert vision._selftest_mcp_preflight(tmp_path,overlay)['reason']=='selftest_tool_missing'
    assert vision._selftest_mcp_preflight(tmp_path,overlay.replace(str(asset),'/invalid/local-vision-selftest-dafeiyu.png'))['reason']=='asset_unavailable'


def test_mcp_receipt_cannot_be_guessed_and_invalid_result_is_not_approval(tmp_path):
    proof=tmp_path/'receipt.json'
    assert vision._read_selftest_image_proof(proof)[0]=='not_received'
    proof.write_text(json.dumps({'kind':'dafeiyu-selftest','sha256':vision._SELFTEST_IMAGE_SHA256,
      'byteLength':vision._SELFTEST_IMAGE_BYTES,'mimeType':'image/png','imageBlocks':2}))
    assert vision._read_selftest_image_proof(proof)[0]=='mismatch'
    diag=vision._vision_selftest_diagnostics(preflight={'status':'ready'},mcp='not_received',provider_api='not_confirmed')
    assert diag['mcpImage']['status']=='not_received'
    assert diag['providerApi']['status']=='not_confirmed'
    assert diag['mcpPreflight']['status']=='ready'


def test_mcp_stdio_preflight_network_and_exception_safe_codes(monkeypatch, tmp_path):
    import asyncio
    async def fail(*args):
        raise RuntimeError('SECRETKEY /home/private/path https://secret.example')
    monkeypatch.setattr(vision,'_probe_mcp_stdio_tool',fail)
    assert vision._run_mcp_stdio_preflight(tmp_path,'',{})=={'status':'failed','reason':'mcp_stdio_start_or_call_failed'}
    async def hang(*args):
        raise asyncio.TimeoutError()
    monkeypatch.setattr(vision,'_probe_mcp_stdio_tool',hang)
    assert vision._run_mcp_stdio_preflight(tmp_path,'',{})=={'status':'failed','reason':'mcp_stdio_timeout'}
