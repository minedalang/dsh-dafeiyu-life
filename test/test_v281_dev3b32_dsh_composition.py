import importlib.util
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('vision32',ROOT/'lib'/'vision_dsh.py')
vision=importlib.util.module_from_spec(spec)
spec.loader.exec_module(vision)

def fake(result):
    def run(argv,**kwargs):
        assert '--dump-config' in argv
        assert kwargs['stdin']==subprocess.DEVNULL
        return result
    return run

def test_dump_config_probe_cannot_be_confused_with_model_vision(tmp_path):
    good=vision._probe_headless_composition(['dsh','--profile','headless','--patch','private.yml'],tmp_path,{},
        fake(subprocess.CompletedProcess([],0,b' - id: mcp-bili-vision-readonly\n serverName: bilivision',b'')))
    assert good=={'status':'ready','reason':'headless_patch_composed'}
    missing=vision._probe_headless_composition(['dsh'],tmp_path,{},
        fake(subprocess.CompletedProcess([],0,b'headless loaded but no vision plugin',b'')))
    assert missing['reason']=='headless_vision_patch_not_composed'

def test_nonzero_dump_config_records_only_safe_metadata(tmp_path):
    failure=vision._probe_headless_composition(['dsh'],tmp_path,{},
        fake(subprocess.CompletedProcess([],1,b'',b'/Users/private-token/path node:internal/modules/cjs/loader Error [ERR_MODULE_NOT_FOUND]')))
    assert failure['status']=='failed'
    assert failure['reason']=='headless_config_dump_exit'
    assert failure['cli']['nodeErrorCode']=='err_module_not_found'
    assert '/Users/' not in str(failure)

def test_node_exception_without_known_code_is_not_mislabeled_as_image_unsupported():
    result=vision._safe_dsh_headless_diagnostic(b'TypeError: bad input\n at node:internal/process/foo',b'',1)
    assert result['diagnosticCode']=='headless_node_runtime_exception'
    cli=vision._safe_cli_process_receipt(subprocess.CompletedProcess([],1,b'',b'TypeError: /private/path at node:internal/modules/failure'))
    assert cli['stderrKind']=='node_exception'
    assert cli['nodeExceptionType']=='TypeError'
    assert '/private' not in str(cli)
