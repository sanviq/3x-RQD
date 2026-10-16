"""Bounded approved improvement run: collect, protect holdouts, train, compare, integrate, publish."""
import argparse
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import zipfile
from tools.prepare_rdd2022 import file_sha256
from tools.analyze_detector_errors import analyze
from tools.summarize_countries import summarize
from tools.package_compact_dataset import package
from tools.github_assets import upload_assets

GATES={'precision':.5,'recall':.3,'map50':.3,'class_ap50':.1}


def passes(report):
    d=report['diagnostic'];m=report['ultralytics_metrics'];classes=report['per_class_metrics']
    return (d['precision']>=GATES['precision'] and d['recall']>=GATES['recall']
            and m['metrics/mAP50(B)']>=GATES['map50'] and len(classes)==4
            and all(c['map50']>=GATES['class_ap50'] for c in classes.values()))


def improved(candidate, baseline):
    # Same fresh test images, both frozen before seeing final test. This compares
    # complete pipelines (old 640/.35 versus selected new 768/validation threshold).
    return (candidate['dataset_manifest_sha256']==baseline['dataset_manifest_sha256']
            and candidate['split']==baseline['split']=='test'
            and candidate['diagnostic']['precision']>=baseline['diagnostic']['precision']
            and candidate['diagnostic']['recall']>baseline['diagnostic']['recall']
            and candidate['diagnostic']['f1']>baseline['diagnostic']['f1']
            and candidate['ultralytics_metrics']['metrics/mAP50(B)']>baseline['ultralytics_metrics']['metrics/mAP50(B)']
            and candidate['ultralytics_metrics']['metrics/mAP50-95(B)']>=baseline['ultralytics_metrics']['metrics/mAP50-95(B)'])


def atomic_json(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(value,indent=2)+'\n');temporary.replace(path)


def publish(repo,root,documents,release):
    checkout=root/'publication'
    if checkout.exists():raise ValueError('Publication checkout already exists; preserve and inspect it')
    remote=subprocess.check_output(['git','remote','get-url','origin'],cwd=repo,text=True).strip()
    subprocess.run(['git','clone','--depth','1',remote,str(checkout)],check=True)
    def git(*args):return subprocess.check_output(['git',*args],cwd=checkout,text=True).strip()
    for key in ('name','email'):
        git('config','user.'+key,subprocess.check_output(['git','config','user.'+key],cwd=repo,text=True).strip())
    folder=checkout/'docs/datasets/results/improvement-v2';folder.mkdir(parents=True)
    for name,value in documents.items():atomic_json(folder/(name+'.json'),value)
    comparison=summarize(root/'prepared/manifest.json',root/'candidate-test/report.json')
    atomic_json(checkout/'docs/datasets/country-comparison.json',comparison)
    (folder/'README.md').write_text('# Improvement run — measured results\n\nSee activation.json and comparison.json before choosing the checkpoint. The candidate was selected on validation and frozen before the new held-out test. The previous detector is re-evaluated on exactly the same fresh test. No national road-health or field-validation claim.\n\nArtifacts: https://github.com/sanviq/3x-RQD/releases/tag/'+release+'\n')
    git('add','--','docs/datasets/results/improvement-v2','docs/datasets/country-comparison.json')
    git('commit','-m','Record expanded RDD2022 training and matched fresh-test comparison')
    for attempt in range(3):
        try:git('push','origin','HEAD:main');break
        except subprocess.CalledProcessError:
            if attempt==2:raise
            git('fetch','origin','main');git('rebase','origin/main')
    return git('rev-parse','HEAD')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,required=True);p.add_argument('--prior-manifest',type=Path,required=True)
    p.add_argument('--baseline',type=Path,required=True);p.add_argument('--epochs',type=int,default=50)
    p.add_argument('--imgsz',type=int,default=768);p.add_argument('--release',default='rdd2022-improvement-v2')
    a=p.parse_args();root=a.root.resolve();repo=Path(__file__).resolve().parents[1];run=root/'run'
    protocol={'approval':'User authorized extra data, preprocessing experiments, training, phase 5 integration and publication on 2026-10-16.',
              'target_images':5250,'raw_mib_cap':1800,'epochs':a.epochs,'imgsz':a.imgsz,'batch':2,'lr':.0005,
              'mosaic':.5,'scale':.3,'degrees':2,'seed':42,'device':'mps','base_sha256':file_sha256(a.baseline),
              'prior_manifest_sha256':file_sha256(a.prior_manifest),'gates':GATES,
              'policy':'Keep all old weights/data. Select checkpoint and threshold on validation only. Freeze SHA before final test. Only new groups may enter final test. Baseline versus candidate on the identical new test; require precision, recall, F1 and mAP improvement for automatic activation. No repeated test-based tuning.',
              'preprocessing':'Aspect-preserving letterbox, BGR to RGB, float /255. Higher training/inference resolution. No unvalidated denoising, contrast equalization or deblurring imposed on real images.'}
    atomic_json(root/'protocol.json',protocol)
    def status(phase,**extra):
        atomic_json(root/'status.json',{'phase':phase,'updated_utc':datetime.now(timezone.utc).isoformat(),**extra})
    def execute(phase,args):
        status(phase,log=str(root/'pipeline.log'))
        with (root/'pipeline.log').open('ab',buffering=0) as log:
            child=subprocess.Popen([sys.executable,'-u',*args],cwd=repo,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT)
            while child.poll() is None:
                progress={}
                if phase=='training' and (run/'results.csv').exists():
                    try:
                        with (run/'results.csv').open() as f:rows=list(csv.DictReader(f))
                        if rows:progress={'completed_epochs':int(float(rows[-1]['epoch'])),'target_epochs':a.epochs}
                    except (ValueError,KeyError):pass
                status(phase,child_pid=child.pid,log=str(root/'pipeline.log'),**progress)
                time.sleep(15)
            if child.returncode:raise RuntimeError(f'{phase} failed ({child.returncode}); see pipeline.log')
    try:
        status('waiting_for_collection')
        collection=root/'selected/collection-audit.json'
        collector_pid=int((root/'collection.pid').read_text())
        while not collection.exists():
            try:os.kill(collector_pid,0)
            except ProcessLookupError:raise RuntimeError('Collection stopped without an audit; inspect collection.log')
            collected=sum(1 for _ in (root/'selected/raw').rglob('*.jpg'))
            status('waiting_for_collection',collected_images=collected,target_images=5250)
            time.sleep(15)
        audit=json.loads(collection.read_text())
        if audit['status']!='complete' or audit['selected_images']<5000:raise ValueError('Expanded collection incomplete or too small; inspect audit')
        if shutil.disk_usage(root).free<8*1024**3:raise ValueError('Less than 8 GiB free before preparation')
        execute('preparing',['-m','tools.build_compact_dataset',str(root/'selected'),'--output',str(root/'prepared'),'--prior-manifest',str(a.prior_manifest)])
        data=root/'prepared/data.yaml';prepared_audit=json.loads((root/'prepared/audit.json').read_text())
        if any(prepared_audit['missing_classes_by_split'].values()):raise ValueError('A split lacks a target class')
        test=json.loads((root/'prepared/manifest.json').read_text())
        fresh=[r for r in test if r['split']=='test']
        if len(fresh)<100:raise ValueError('Too few independent fresh test images')
        atomic_json(repo/'docs/datasets/country-comparison.json',summarize(root/'prepared/manifest.json'))
        execute('training',['train_detector.py',str(data),'--base',str(a.baseline),'--output',str(run),
                            '--epochs',str(a.epochs),'--imgsz',str(a.imgsz),'--batch','2','--lr','.0005','--device','mps',
                            '--mosaic','.5','--scale','.3','--degrees','2','--patience','20'])
        checkpoint=run/'weights/best.pt';checksum=file_sha256(checkpoint)
        def evaluate(name,path,split,imgsz,confidence):
            args=['-m','tools.evaluate_detector',str(data),'--checkpoint',str(path),'--output',str(root/name),
                  '--split',split,'--device','mps','--batch','2','--imgsz',str(imgsz),'--confidence',str(confidence)]
            if split=='test':args+=['--frozen-sha256',file_sha256(path)]
            execute(name,args)
            return json.loads((root/name/'report.json').read_text())
        val=evaluate('candidate-validation',checkpoint,'val',a.imgsz,.35)
        sweep=analyze(root/'candidate-validation');atomic_json(root/'validation-thresholds.json',sweep)
        selected=sweep['selected_operating_point']
        confidence=selected['confidence'] if selected else .35
        # Update only threshold-dependent diagnostics from saved validation predictions.
        if selected:
            val['diagnostic']={**val['diagnostic'],**selected}
            # Per-class/country diagnostics remain at .35 in this initial report;
            # recompute them at the chosen threshold with a separate reproducible evaluation.
            val=evaluate('candidate-selected-validation',checkpoint,'val',a.imgsz,confidence)
        atomic_json(root/'frozen-candidate.json',{'checkpoint_sha256':checksum,'confidence':confidence,'imgsz':a.imgsz,'validation_passed':passes(val)})
        baseline=evaluate('baseline-test',a.baseline,'test',640,.35)
        candidate=evaluate('candidate-test',checkpoint,'test',a.imgsz,confidence)
        better=improved(candidate,baseline)
        ready=passes(val) and passes(candidate) and better
        activation={'enabled':ready,'validation_passed':passes(val),'test_passed':passes(candidate),'improved_on_fresh_test':better,
                    'checkpoint':str(checkpoint),'checkpoint_sha256':checksum,'confidence':confidence,'imgsz':a.imgsz,'gates':GATES,
                    'notice':'Internal prototype detection gate, not field validation or validation of road-health severity, scores or simulation.'}
        atomic_json(root/'activation.json',activation)
        if ready:atomic_json(repo/'.local-road-health/detector.json',activation)
        documents={'validation':val,'test':candidate,'baseline-test':baseline,'activation':{k:v for k,v in activation.items() if k!='checkpoint'},
                   'protocol':protocol,'validation-thresholds':sweep,'dataset-audit':prepared_audit,
                   'comparison':{'improvement_supported':better,'baseline_imgsz':640,'candidate_imgsz':a.imgsz,
                                 'same_fresh_test_manifest_sha256':candidate['dataset_manifest_sha256'],
                                 'notice':'Matched fresh test comparison of complete inference pipelines. No previous v1 test metrics are compared across different datasets.'}}
        status('publishing',activation=documents['activation'])
        assets=root/'release-assets';assets.mkdir()
        # Bundle previous manifest with thumbnails so fresh holdout protection is reproducible
        # without downloading prepared images from the prior version.
        prior=json.loads(a.prior_manifest.read_text())
        from PIL import Image
        for r in prior:
            with Image.open(a.prior_manifest.parent/r['prepared_image']) as image:
                r['thumbnail']=image.convert('RGB').resize((16,16),Image.Resampling.BILINEAR).tobytes().hex()
        atomic_json(root/'selected/prior-manifest.json',prior)
        archive=package(root/'selected',assets/'rdd2022-improvement-v2.zip',max_mib=1800)
        model=assets/'road-health-improvement-v2-best.pt';shutil.copyfile(checkpoint,model)
        (assets/(model.name+'.sha256')).write_text(checksum+'  '+model.name+'\n')
        for name,value in documents.items():atomic_json(assets/('improvement-v2-'+name+'.json'),value)
        with zipfile.ZipFile(assets/'evaluation-evidence.zip','w',compression=zipfile.ZIP_DEFLATED) as z:
            for name in ('candidate-validation','candidate-selected-validation','baseline-test','candidate-test'):
                for path in (root/name).rglob('*'):
                    if path.is_file():z.write(path,str(path.relative_to(root)))
            for name in ('reproduction.json','args.yaml','results.csv'):
                z.write(run/name,'training/'+name)
        subprocess.run(['gh','release','create',a.release,'--repo','sanviq/3x-RQD','--target','main','--title','RDD2022 expanded subset and evaluated detector v2','--notes','Real bounded multinational dataset, preserved annotations, experimental checkpoint and matched fresh-test evaluation. Inspect activation report; no national road-quality or production accuracy claim.'],check=True)
        upload_assets(a.release,list(assets.iterdir()))
        commit=publish(repo,root,documents,a.release)
        local_results=repo/'docs/datasets/results/improvement-v2'
        if local_results.exists():raise ValueError('Local results directory already exists; preserving it. Published results remain available in the isolated checkout.')
        shutil.copytree(root/'publication/docs/datasets/results/improvement-v2',local_results)
        # Refresh the local summary but do not pull over user changes.
        atomic_json(repo/'docs/datasets/country-comparison.json',summarize(root/'prepared/manifest.json',root/'candidate-test/report.json'))
        status('complete',activated=ready,improved=better,results_commit=commit,release_url='https://github.com/sanviq/3x-RQD/releases/tag/'+a.release,
               notice='Completed training and honest evaluation. A failed candidate remains experimental; the previous default is preserved.')
    except Exception as exc:
        status('failed',error=type(exc).__name__+': '+str(exc));raise

if __name__=='__main__':main()
