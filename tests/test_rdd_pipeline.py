"""Small synthetic fixtures exercise conversion/leakage rules, not model accuracy."""
import io
import json
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image
import pytest

from tools.prepare_rdd2022 import parse_annotation, group_records, assign_splits, prepare
from tools.evaluate_detector import diagnostic_matches


def xml(name='image.jpg', label='D00', box=(1,1,64,64), width=64):
    x1,y1,x2,y2=box
    return f'<annotation><filename>{name}</filename><size><width>{width}</width><height>64</height></size><object><name>{label}</name><bndbox><xmin>{x1}</xmin><ymin>{y1}</ymin><xmax>{x2}</xmax><ymax>{y2}</ymax></bndbox></object></annotation>'.encode()


def test_voc_coordinates_classes_and_invalid_annotations():
    assert parse_annotation(xml(),'image.jpg',64,64)[0]==[(0,.5,.5,1.,1.)]
    assert parse_annotation(xml(label='D40',box=(64,64,64,64)),'image.jpg',64,64)[0][0][0]==3
    for data in [xml(label='D99'),xml(box=(0,1,64,64)),xml(box=(1,1,65,64)),xml(width=63),xml(name='other.jpg')]:
        with pytest.raises(ValueError):parse_annotation(data,'image.jpg',64,64)


def test_pixel_near_duplicate_and_frame_groups_do_not_leak():
    records=[]
    for i in range(20):
        records.append({'source_image':f'Country_{i*100:06d}.jpg','country':'India','pixel_sha256':str(i),
                        'dhash':int.from_bytes(__import__('hashlib').sha256(str(i).encode()).digest()[:8],'big'),
                        'labels':[(i%4,.5,.5,.2,.2)]})
    records[1]['pixel_sha256']=records[0]['pixel_sha256']
    records[3]['dhash']=records[2]['dhash']^1
    records[5]['source_image']='Country_000401.jpg'
    groups=group_records(records)
    split=assign_splits(records,groups)
    assert split==assign_splits(records,groups)
    assert len(set(split.values()))==3
    for group in groups:assert len({split[i] for i in group})==1
    for a,b in [(0,1),(2,3),(4,5)]:assert any(a in g and b in g for g in groups)


def test_prepare_excludes_unlabelled_and_bad_pairs(tmp_path):
    source=tmp_path/'original.zip';output=tmp_path/'prepared'
    with zipfile.ZipFile(source,'w') as z:
        for i in range(32):
            name=f'India_{i*100:06d}.jpg';buf=io.BytesIO()
            Image.fromarray(np.random.default_rng(i).integers(0,255,(64,64,3),dtype=np.uint8)).save(buf,format='JPEG')
            z.writestr('RDD2022/India/train/images/'+name,buf.getvalue())
            if i!=31:z.writestr('RDD2022/India/train/annotations/xmls/'+Path(name).with_suffix('.xml').name,xml(name=name,label=list(('D00','D10','D20','D40'))[i%4]))
        z.writestr('RDD2022/India/test/images/unlabelled.jpg',b'not-a-valid-image-but-not-an-evaluation-input')
        z.writestr('RDD2022/India/train/images/broken.jpg',b'bad')
        z.writestr('RDD2022/India/train/annotations/xmls/broken.xml',xml(name='broken.jpg'))
    original=source.read_bytes()
    nested=tmp_path/'official-layout.zip'
    with zipfile.ZipFile(nested,'w',compression=zipfile.ZIP_STORED) as z:z.writestr('RDD2022/India.zip',original)
    report=prepare(nested,output)
    assert source.read_bytes()==original
    assert report['status']=='complete' and report['prepared_images']==31
    assert report['official_unlabelled_test_images']==1
    assert report['countries']['India']['missing_xml']==1
    assert report['countries']['India']['invalid_pairs']==1
    records=json.loads((output/'manifest.json').read_text())
    assert sum(len(r['labels']) for r in records)==31
    assert all('/train/' in r['source_image'] for r in records)
    from train_detector import validated_dataset
    validated_dataset(output/'data.yaml')
    (output/records[0]['prepared_image']).write_bytes(b'tampered')
    with pytest.raises(ValueError,match='changed'):validated_dataset(output/'data.yaml')
    with pytest.raises(ValueError,match='already exists'):prepare(source,output)


def test_diagnostics_count_wrong_class_as_false_positive_and_miss():
    truth=[{'class_id':0,'bbox':[.1,.1,.4,.4]}]
    wrong=[{'class_id':1,'bbox':[.1,.1,.4,.4],'confidence':.9}]
    result=diagnostic_matches(truth,wrong)
    assert len(result['fp'])==len(result['fn'])==1 and not result['tp']
    correct=[{**wrong[0],'class_id':0}]
    assert len(diagnostic_matches(truth,correct)['tp'])==1
    assert len(diagnostic_matches(truth,[{**correct[0],'confidence':.1}])['fn'])==1


def test_model_empty_or_low_confidence_detections_withhold_health(monkeypatch):
    import app.detection as d
    monkeypatch.setattr(d,'predict',lambda *a,**kw:[])
    result=d.inspect(d.demo_image(),mode='model')
    assert result['assessment']['score'] is None
    assert result['assessment']['band']=='Unassessable'
    assert result['assessment']['evidence_status']=='insufficient'
    assert result['repeat_capture'] is True
    ds=d.demo_defects()[:1];ds[0].confidence=.4
    monkeypatch.setattr(d,'predict',lambda *a,**kw:ds)
    assert d.inspect(d.demo_image(),mode='model')['assessment']['score'] is None


def test_rdd_metadata_survives_assessment_and_detects_invalid_class():
    from app.assessment import Defect,assess
    defect=Defect(id='a',class_name='crack',detection_code='D10',detection_label='Transverse crack',confidence=.8,bbox=(.1,.2,.3,.4))
    assert assess([defect])['defects'][0]['detection_code']=='D10'
    with pytest.raises(ValueError):Defect(id='b',class_name='pothole',detection_code='D00',confidence=.8,bbox=(.1,.2,.3,.4))


def test_saved_model_uncertainty_and_optimizer_do_not_invent_healthy_roads(tmp_path,monkeypatch):
    from app.storage import SavedSegment,save_segment,list_segments
    from app.assessment import OptimizeRequest,optimize
    monkeypatch.setenv('ROAD_HEALTH_DATA_DIR',str(tmp_path))
    payload={'id':'no-evidence','name':'Capture needs review','latitude':18,'longitude':73,
             'distance_start_m':0,'length_m':100,'assessment':{'defects':[]},'provenance':'model'}
    save_segment(SavedSegment.model_validate(payload))
    survey=list_segments()
    assert survey['summary']['average_quality'] is None
    assert survey['summary']['assessed_distance_m']==0
    assert survey['summary']['unassessable_segments']==1
    assert survey['segments'][0]['result']['score'] is None
    plan=optimize(OptimizeRequest.model_validate({'segments':[payload],'budget':1000000}))
    assert plan['spent']==0 and not plan['recommendations']
    assert plan['excluded_segments'][0]['id']=='no-evidence'


def test_detector_keeps_all_four_rdd_codes_with_compatible_api_classes(tmp_path,monkeypatch):
    from types import SimpleNamespace
    import app.detection as d
    class Tensor:
        def cpu(self):return self
        def numpy(self):return np.array([10,20,30,40])
    boxes=[SimpleNamespace(cls=np.array(i),conf=np.array(.9),xyxy=[Tensor()]) for i in range(4)]
    result=SimpleNamespace(names={i:c for i,c in enumerate(('D00','D10','D20','D40'))},boxes=boxes,masks=None)
    model=SimpleNamespace(predict=lambda *a,**kw:[result])
    file=tmp_path/'fixture.pt';file.write_bytes(b'not-real-weights')
    monkeypatch.setattr(d,'MODEL_PATH',str(file));monkeypatch.setattr(d,'_model',model)
    predictions=d.predict(np.zeros((100,100,3),np.uint8),mode='model')
    assert [p.detection_code for p in predictions]==['D00','D10','D20','D40']
    assert [p.class_name for p in predictions]==['crack','crack','crack','pothole']
    assert all(p.bbox==(.1,.2,.3,.4) and p.confidence==.9 for p in predictions)
    assert predictions[1].detection_label=='Transverse crack'


def test_confidence_is_not_the_quality_score():
    from app.assessment import Defect,assess
    defect=Defect(id='a',class_name='pothole',confidence=.95,bbox=(.1,.1,.4,.4),severity=.8)
    assert assess([defect])['score']==assess([defect.model_copy(update={'confidence':.3})])['score']


def test_download_resumes_existing_prefix_and_verifies_publisher_checksum(tmp_path,monkeypatch):
    import hashlib
    import re
    from tools import download_rdd2022 as downloader
    content=b'official fixture archive bytes, not a real dataset'
    monkeypatch.setattr(downloader,'SIZE',len(content))
    monkeypatch.setattr(downloader,'MD5',hashlib.md5(content).hexdigest())
    monkeypatch.setattr(downloader,'NAME','fixture.zip')
    (tmp_path/'fixture.zip.part').write_bytes(content[:8])
    requested=[]
    class Response(io.BytesIO):
        status=206
        def __init__(self,start,end):
            super().__init__(content[start:end+1]);self.headers={'Content-Range':f'bytes {start}-{end}/{len(content)}'}
    def urlopen(request,timeout):
        start,end=map(int,re.fullmatch(r'bytes=(\d+)-(\d+)',request.get_header('Range')).groups())
        requested.append((start,end));return Response(start,end)
    monkeypatch.setattr(downloader.urllib.request,'urlopen',urlopen)
    target=downloader.download(tmp_path,workers=1)
    assert target.read_bytes()==content and requested==[(8,len(content)-1)]
    downloader.download(tmp_path,workers=1)
    assert len(requested)==1
    target.write_bytes(b'corrupt')
    with pytest.raises(ValueError,match='preserving'):downloader.download(tmp_path,workers=1)
    assert target.read_bytes()==b'corrupt'
