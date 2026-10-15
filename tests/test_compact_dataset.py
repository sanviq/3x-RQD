"""Compact collection uses authentic pairs; fixtures test bounds, grouping and gallery provenance."""
import io
import json
from pathlib import Path
import re
import zipfile

import numpy as np
from PIL import Image
import pytest

from tools import collect_rdd_subset as collector
from tools.build_compact_dataset import build
from train_detector import validated_dataset


def fixture_zip():
    outer=io.BytesIO()
    with zipfile.ZipFile(outer,'w',compression=zipfile.ZIP_STORED) as z:
        for country in ('India','Japan','Czech'):
            child=io.BytesIO()
            with zipfile.ZipFile(child,'w',compression=zipfile.ZIP_DEFLATED) as c:
                for i in range(25):
                    name=f'{country}_{i*100:06d}.jpg'
                    buf=io.BytesIO();Image.fromarray(np.random.default_rng(i+10000*('India','Japan','Czech').index(country)).integers(0,255,(64,64,3),dtype=np.uint8)).save(buf,format='JPEG')
                    obj='' if i%5==4 else f'<object><name>{["D00","D10","D20","D40"][i%5]}</name><bndbox><xmin>1</xmin><ymin>1</ymin><xmax>64</xmax><ymax>64</ymax></bndbox></object>'
                    xml=f'<annotation><filename>{name}</filename><size><width>64</width><height>64</height></size>{obj}</annotation>'
                    c.writestr(f'{country}/train/images/{name}',buf.getvalue());c.writestr(f'{country}/train/annotations/xmls/{Path(name).stem}.xml',xml)
                c.writestr(f'{country}/test/images/never-evaluate.jpg',b'unlabelled')
            z.writestr(f'RDD2022/{country}.zip',child.getvalue())
    return outer.getvalue()


def test_selective_collection_and_build_are_reproducible_and_test_safe(tmp_path,monkeypatch):
    data=fixture_zip();monkeypatch.setattr(collector,'SIZE',len(data))
    calls=[]
    class Response(io.BytesIO):
        status=206
        def __init__(self,start,end):super().__init__(data[start:end+1]);self.headers={'Content-Range':f'bytes {start}-{end}/{len(data)}'}
    def urlopen(request,timeout):
        a,b=map(int,re.fullmatch(r'bytes=(\d+)-(\d+)',request.get_header('Range')).groups());calls.append((a,b));return Response(a,b)
    monkeypatch.setattr(collector.urllib.request,'urlopen',urlopen)
    source=tmp_path/'selected';report=collector.collect(None,source,per_subset=20,max_mib=20)
    assert report['status']=='complete' and report['selected_images']==60
    assert all(s['source_official_test_images']==1 for s in report['subsets'].values())
    assert all(all(n>0 for n in s['boxes'].values()) for s in report['subsets'].values())
    prepared=tmp_path/'prepared';gallery=tmp_path/'gallery';built=build(source,prepared,gallery)
    validated_dataset(prepared/'data.yaml')
    assert built['prepared_images']==60 and all(s['images'] for s in built['splits'].values())
    manifest=json.loads((prepared/'manifest.json').read_text());catalog=json.loads((gallery/'catalog.json').read_text())
    train={r['source_image'] for r in manifest if r['split']=='train'}
    assert catalog and all(r['source_image'] in train for r in catalog)
    assert all(r['license']=='CC BY 4.0' for r in catalog)
    assert all('/test/' not in r['source_image'] for r in manifest)
    again=collector.collect(None,source,per_subset=20,max_mib=20)
    assert again['network_bytes_this_run']==0
    assert all(a>=0 and b<len(data) for a,b in calls)
    with pytest.raises(ValueError,match='New output'):build(source,prepared)
    from tools.package_compact_dataset import package
    archive=package(source,tmp_path/'selected-release.zip')
    with zipfile.ZipFile(archive) as z:
        assert len([n for n in z.namelist() if n.endswith('.jpg')])==60
        assert 'DATASET_LICENSE_AND_SOURCE.txt' in z.namelist()
        assert not any('range-cache' in n or '/test/' in n for n in z.namelist())
    original=source/'raw'/manifest[0]['source_image']
    before=original.read_bytes();(prepared/manifest[0]['prepared_image']).write_bytes(b'edited prepared image')
    assert original.read_bytes()==before


def test_gallery_api_is_bounded_and_labels_ground_truth(tmp_path,monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    import app.dataset_examples as examples
    monkeypatch.setattr(examples,'EXAMPLES',tmp_path)
    row={'image':'India_a.jpg','yolo_labels':'India_a.txt','original_xml':'India_a.original.xml'}
    (tmp_path/'catalog.json').write_text(json.dumps([row]));(tmp_path/'India_a.jpg').write_bytes(b'jpeg-fixture')
    with TestClient(app) as c:
        response=c.get('/api/dataset/examples');assert response.status_code==200
        assert 'human' in response.json()['provenance'].lower()
        assert c.get('/api/dataset/examples/India_a.jpg').status_code==200
        assert c.get('/api/dataset/examples/secret.env').status_code==404


def test_activation_requires_all_four_class_results():
    from tools.run_compact_training import passes
    report={'diagnostic':{'precision':.7,'recall':.6},'ultralytics_metrics':{'metrics/mAP50(B)':.5},
            'per_class_metrics':{c:{'map50':.4} for c in ('D00','D10','D20','D40')}}
    assert passes(report)
    report['per_class_metrics']['D10']['map50']=.01
    assert not passes(report)
    report['per_class_metrics']['D10']['map50']=.4
    report['diagnostic']['recall']=.1
    assert not passes(report)


def test_result_publication_uses_isolated_checkout_and_preserves_workspace(tmp_path):
    import subprocess
    from tools.run_compact_training import publish,GATE
    def git(cwd,*args):return subprocess.check_output(['git',*args],cwd=cwd,text=True,stderr=subprocess.DEVNULL).strip()
    remote=tmp_path/'remote.git';remote.mkdir();git(remote,'init','--bare','--initial-branch=main')
    repo=tmp_path/'repo';repo.mkdir();git(repo,'init','--initial-branch=main')
    git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@example.invalid')
    (repo/'README.md').write_text('committed fixture\n');git(repo,'add','README.md');git(repo,'commit','-m','fixture')
    git(repo,'remote','add','origin',str(remote));git(repo,'push','-u','origin','main')
    head=git(repo,'rev-parse','HEAD');(repo/'README.md').write_text('user edit must survive\n')
    run=tmp_path/'run';run.mkdir();(run/'reproduction.json').write_text(json.dumps({'epochs':50,'dataset':'/private/path','base':'/private/weights'}))
    root=tmp_path/'reports';root.mkdir()
    sample={'checkpoint_sha256':'a'*64,'images':10,'diagnostic':{'precision':.6,'recall':.5,'f1':.54},
            'ultralytics_metrics':{'metrics/mAP50(B)':.4,'metrics/mAP50-95(B)':.2},
            'per_class_metrics':{c:{'map50':.3} for c in ('D00','D10','D20','D40')}}
    commit=publish(repo,root,run,{'validation':sample,'test':sample},'fixture-release',{'checks':GATE})
    assert commit!=head and git(repo,'rev-parse','HEAD')==head
    assert (repo/'README.md').read_text()=='user edit must survive\n'
    config=json.loads(git(remote,'show','main:docs/datasets/results/compact-v1/training-config.json'))
    assert 'dataset' not in config and 'base' not in config
    assert git(remote,'show','main:docs/datasets/results/compact-v1/activation.json')


def test_release_upload_preserves_a_different_existing_asset(tmp_path,monkeypatch):
    from tools import github_assets
    from tools.prepare_rdd2022 import file_sha256
    file=tmp_path/'small.json';file.write_text('{"fixture":true}')
    inventory={'assets':[{'name':file.name,'size':file.stat().st_size,'digest':'sha256:'+file_sha256(file)}]}
    monkeypatch.setattr(github_assets.subprocess,'check_output',lambda *a,**kw:json.dumps(inventory))
    calls=[];monkeypatch.setattr(github_assets.subprocess,'run',lambda *a,**kw:calls.append(a))
    github_assets.upload_assets('fixture',[file]);assert not calls
    inventory['assets'][0]['digest']='sha256:'+'0'*64
    with pytest.raises(ValueError,match='preserving'):github_assets.upload_assets('fixture',[file])
    assert not calls


def test_group_allocator_keeps_large_early_country_groups_in_both_holdouts():
    from tools.prepare_rdd2022 import assign_splits
    records=[];groups=[]
    for country in ('A','B','C','D','E','F','G'):
        sizes=[66,43,19,15,14,12,11,11,10,9,9,8,7,6,6,4] if country=='A' else [5]*50
        for size in sizes:
            group=[]
            for _ in range(size):
                i=len(records);group.append(i);records.append({'country':country,'labels':[(i%4,.5,.5,.1,.1)]})
            groups.append(group)
    result=assign_splits(records,groups)
    for group in groups:assert len({result[i] for i in group})==1
    for country in ('A','B','C','D','E','F','G'):
        for split in ('train','val','test'):
            assert sum(r['country']==country and result[i]==split for i,r in enumerate(records))>=10
    assert result==assign_splits(records,groups)
