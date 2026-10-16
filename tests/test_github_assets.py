import json
from types import SimpleNamespace

import pytest
from tools import github_assets
from tools.prepare_rdd2022 import file_sha256


def test_release_visibility_delay_is_retried_without_clobber(tmp_path,monkeypatch):
    asset=tmp_path/'results.json';asset.write_text('{}')
    replies=iter([[],[{'tag_name':'v2','assets':[]}]])
    lookups=[];uploads=[];waits=[]
    def lookup(args,**kwargs):
        lookups.append(args);return json.dumps(next(replies))
    monkeypatch.setattr(github_assets.subprocess,'check_output',lookup)
    monkeypatch.setattr(github_assets.subprocess,'run',lambda args:uploads.append(args) or SimpleNamespace(returncode=0))
    monkeypatch.setattr(github_assets.time,'sleep',waits.append)
    github_assets.upload_assets('v2',[asset])
    assert len(lookups)==2 and waits==[5]
    assert len(uploads)==1 and '--clobber' not in uploads[0]
    assert 'Cache-Control: no-cache' in lookups[0]


def test_matching_upload_is_skipped_and_different_asset_preserved(tmp_path,monkeypatch):
    asset=tmp_path/'weights.pt';asset.write_bytes(b'preserve')
    entry={'name':asset.name,'size':asset.stat().st_size,'digest':'sha256:'+file_sha256(asset)}
    monkeypatch.setattr(github_assets.subprocess,'check_output',lambda *a,**k:json.dumps([{'tag_name':'v2','assets':[entry]}]))
    monkeypatch.setattr(github_assets.subprocess,'run',lambda *a,**k:pytest.fail('Existing assets must not be replaced'))
    github_assets.upload_assets('v2',[asset])
    entry['digest']='different'
    with pytest.raises(ValueError,match='preserving it'):github_assets.upload_assets('v2',[asset])


def test_missing_release_fails_after_bounded_retries(tmp_path,monkeypatch):
    asset=tmp_path/'results.json';asset.write_text('{}')
    attempts=[]
    monkeypatch.setattr(github_assets.subprocess,'check_output',lambda *a,**k:attempts.append(1) or '[]')
    monkeypatch.setattr(github_assets.time,'sleep',lambda *a:None)
    with pytest.raises(ValueError,match='Release not found'):github_assets.upload_assets('missing',[asset])
    assert len(attempts)==3
