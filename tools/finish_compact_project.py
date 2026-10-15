"""Finish the approved compact-data workflow unattended, without the full download."""
import argparse
from datetime import datetime,timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from tools.build_compact_dataset import build
from tools.package_compact_dataset import package
from tools.prepare_rdd2022 import file_sha256
from tools.run_compact_training import restart_managed_server
from train_detector import validated_dataset
from tools.github_assets import upload_assets


def publish_dataset(repo,root,gallery,source,prepared):
    remote=subprocess.check_output(['git','remote','get-url','origin'],cwd=repo,text=True).strip()
    env={**os.environ,'GIT_TERMINAL_PROMPT':'0'}
    checkout=Path(tempfile.mkdtemp(prefix='compact-data-publication-',dir=root))/'checkout'
    subprocess.run(['git','clone','--depth','1','--branch','main',remote,str(checkout)],check=True,env=env)
    def git(*args):return subprocess.check_output(['git',*args],cwd=checkout,env=env,text=True).strip()
    for key in ('name','email'):
        identity=subprocess.check_output(['git','config',f'user.{key}'],cwd=repo,text=True).strip()
        git('config',f'user.{key}',identity)
    target=checkout/'data/examples/rdd2022'
    if target.exists():raise ValueError('A gallery already exists remotely; preserving it rather than overwriting')
    shutil.copytree(gallery,target)
    folder=checkout/'docs/datasets/audits/compact-v1';folder.mkdir(parents=True,exist_ok=False)
    for origin,name in [(source/'collection-audit.json','collection.json'),(prepared/'audit.json','prepared.json'),(prepared/'manifest.json','split-manifest.json')]:
        shutil.copyfile(origin,folder/name)
    (folder/'manifest.sha256').write_text(file_sha256(prepared/'manifest.json')+'  split-manifest.json\n')
    git('add','--','data/examples/rdd2022','docs/datasets/audits/compact-v1')
    names=git('diff','--cached','--name-only').splitlines()
    if any(not p.startswith(('data/examples/rdd2022/','docs/datasets/audits/compact-v1/')) for p in names):raise ValueError('Unexpected dataset publication path')
    git('commit','-m','Add bounded real RDD2022 country gallery and audited compact splits')
    for attempt in range(4):
        try:git('push','origin','HEAD:main');break
        except subprocess.CalledProcessError:
            if attempt==3:raise
            git('fetch','origin','main');git('rebase','origin/main')
    commit=git('rev-parse','HEAD')
    # Fast-forward only when tracked local work is clean. Never stash, reset or overwrite.
    clean=all(subprocess.run(['git',*args],cwd=repo).returncode==0 for args in [('diff','--quiet'),('diff','--cached','--quiet')])
    if clean:
        subprocess.run(['git','fetch','origin'],cwd=repo,check=True)
        subprocess.run(['git','merge','--ff-only','origin/main'],cwd=repo,check=True)
    return commit


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,required=True);p.add_argument('--prepared',type=Path,required=True)
    p.add_argument('--root',type=Path,required=True);p.add_argument('--base',type=Path,required=True)
    p.add_argument('--server-pid',type=int,default=0);p.add_argument('--server-started',default='')
    a=p.parse_args();repo=Path(__file__).resolve().parents[1];root=a.root.resolve();root.mkdir(parents=True,exist_ok=True)
    path=root/'project-status.json';release='rdd2022-compact-v1'
    def status(phase,**extra):
        payload={'phase':phase,'updated_utc':datetime.now(timezone.utc).isoformat(),**extra}
        tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(payload,indent=2));tmp.replace(path);print(json.dumps(payload),flush=True)
    try:
        status('waiting_for_selected_country_pairs',full_dataset_download=False,approved_epochs=50)
        while True:
            audit=a.source/'collection-audit.json'
            if audit.exists():
                try:collection=json.loads(audit.read_text())
                except json.JSONDecodeError:collection={}
                if collection.get('status')=='complete':break
                if collection.get('status')=='failed':raise RuntimeError('Compact collection failed: '+collection.get('error','unknown'))
            time.sleep(15)
        status('building_grouped_dataset')
        gallery=root/'github-gallery'
        result=build(a.source,a.prepared,gallery)
        validated_dataset(a.prepared/'data.yaml')
        if any(result['missing_classes_by_split'].values()):raise ValueError('A target class is missing from a split; manual audit review required')
        subsets=set(result['countries'])
        for split,stats in result['splits'].items():
            if set(stats['countries'])!=subsets:raise ValueError(f'{split} lacks a country/view; inspect grouping before training')
        attribution=repo/'docs/datasets/RDD2022.source.json'
        (gallery/'ATTRIBUTION.json').write_bytes(attribution.read_bytes())
        status('publishing_gallery_and_audit',images=result['prepared_images'])
        commit=publish_dataset(repo,root,gallery,a.source,a.prepared)
        status('packaging_compact_release',dataset_commit=commit)
        archive=package(a.source,root/'rdd2022-compact-v1.zip')
        notes=root/'dataset-release-notes.md'
        size=archive.stat().st_size/1024**2
        notes.write_text(f'''Real RDD2022 compact development subset: {result["prepared_images"]} unchanged original image/XML pairs, {size:.1f} MiB zipped, six countries and seven capture subsets.

Dataset: CC BY 4.0, Arya et al.; official source https://figshare.com/articles/dataset/21431547 . Full attribution and changes are included in the archive. No coverage of all Indian states is claimed.

This is a seeded class-enriched subset, not the full release or a representative road survey. It excludes unlabelled official test images. The repository contains a small training-only preview gallery and audited split manifest; it does not load the dataset into the website bundle.

Verify the SHA256, extract the archive, and follow docs/datasets/COMPACT.md to build the same local train/validation/test data. The approved 50-epoch training and final evaluation are pending when this dataset release is first published. Later model assets carry actual measured reports; an unqualified checkpoint is not automatically activated.
''')
        subprocess.run(['gh','release','create',release,
            '--repo','sanviq/3x-RQD','--target',commit,'--title','Compact RDD2022 development dataset','--notes-file',str(notes),'--draft','--prerelease','--latest=false'],cwd=repo,check=True)
        upload_assets(release,[archive,archive.with_suffix('.zip.sha256')])
        subprocess.run(['gh','release','edit',release,'--repo','sanviq/3x-RQD','--draft=false','--prerelease','--latest=false'],cwd=repo,check=True)
        server=restart_managed_server(repo,root,a.server_pid,a.server_started,None)
        server_pid=server.get('pid',0)
        stamp=subprocess.run(['ps','-p',str(server_pid),'-o','lstart='],capture_output=True,text=True).stdout.strip() if server_pid else ''
        status('starting_approved_training',dataset_release='https://github.com/sanviq/3x-RQD/releases/tag/'+release,
               dataset_images=result['prepared_images'],dataset_archive_mib=round(size,1),approved_epochs=50)
        subprocess.run([sys.executable,'-u','-m','tools.run_compact_training','--dataset',str(a.prepared/'data.yaml'),
            '--base',str(a.base.resolve()),'--root',str(root/'training'),'--release',release,
            '--server-pid',str(server_pid),'--server-started',stamp],cwd=repo,check=True)
        status('complete',training_status=str(root/'training/training-status.json'),dataset_release='https://github.com/sanviq/3x-RQD/releases/tag/'+release)
    except Exception as exc:
        status('failed',error=type(exc).__name__+': '+str(exc));raise


if __name__=='__main__':main()
