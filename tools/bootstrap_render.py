"""Fetch the frozen inference assets and configure preview; never train or qualify a model."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request

RELEASE = 'https://github.com/sanviq/3x-RQD/releases/download/rdd2022-improvement-v2/'
# Frozen published assets. Updating a release alone cannot silently change these bytes.
ASSETS = {
    'road-health-improvement-v2-best.pt': '56b7de26050d65e52d090a6ea914c21c028544474e9125ed33cac45ed03803a3',
    'improvement-v2-activation.json': '902c64141f08ce9c4e216f6cbb6a5c4d5a2fc37e8fe1f6f56df435ada7215701',
    'improvement-v2-validation.json': '304fac4be410ddd910f30a5e206278fa492dfc24f1a930bbc74b4b33571b65f2',
    'improvement-v2-test.json': '9fbd25dae654b9b1e95c26ea164d4e54f78562555d0bef0e3f0dc9713b27bc87',
}


def digest(path):
    result=hashlib.sha256()
    with Path(path).open('rb') as stream:
        while block:=stream.read(1024*1024):result.update(block)
    return result.hexdigest()


def ensure_assets(directory):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    for name,expected in ASSETS.items():
        target=directory/name
        if target.exists():
            if digest(target)!=expected:
                raise ValueError(f'Cached asset checksum mismatch: {target}. File preserved; review it before redeploying.')
            continue
        temporary=None
        try:
            request=urllib.request.Request(RELEASE+name,headers={'User-Agent':'RoadHealth-Render/1.0'})
            limit=12*1024*1024 if name.endswith('.pt') else 512*1024
            with urllib.request.urlopen(request,timeout=60) as response, tempfile.NamedTemporaryFile(
                dir=directory,prefix=name+'.',suffix='.part',delete=False
            ) as stream:
                temporary=Path(stream.name);total=0
                while block:=response.read(1024*1024):
                    total+=len(block)
                    if total>limit:raise ValueError(f'Release asset exceeds expected size: {name}')
                    stream.write(block)
            if digest(temporary)!=expected:
                raise ValueError(f'Download checksum mismatch: {name}. No model was configured.')
            temporary.replace(target)
        finally:
            if temporary is not None:temporary.unlink(missing_ok=True)
    return directory


def prepare(data_dir):
    from tools.configure_detector_preview import configure
    data_dir=Path(data_dir).resolve()
    preview=Path(os.environ.get('ROAD_HEALTH_PREVIEW_REGISTRY',str(data_dir/'experimental-detector.json')))
    accepted=Path(os.environ.get('ROAD_HEALTH_DETECTOR_REGISTRY',str(data_dir/'detector.json')))
    if preview.resolve()==accepted.resolve():
        raise ValueError('Experimental preview must not overwrite the qualification registry.')
    assets=ensure_assets(data_dir/'model-preview')
    return configure(assets,preview)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir',type=Path,default=Path(os.environ.get('ROAD_HEALTH_DATA_DIR','/var/data')))
    args=parser.parse_args()
    record=prepare(args.data_dir)
    print(json.dumps({'status':'experimental_preview_ready','checkpoint_sha256':record['checkpoint_sha256'],
                      'confidence':record['confidence'],'imgsz':record['imgsz'],'usage':record['usage']}),flush=True)
