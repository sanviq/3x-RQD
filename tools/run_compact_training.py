"""Approved unattended 50-epoch run, honest evaluation and bounded GitHub publication."""
import argparse
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

from train_detector import validated_dataset
from tools.prepare_rdd2022 import file_sha256
from tools.github_assets import upload_assets

# Declared before the held-out test is evaluated. These are prototype deployment
# checks, not engineering certification or evidence of general road safety.
GATE={'minimum_precision_at_035':.5,'minimum_recall_at_035':.3,'minimum_map50':.3,'minimum_class_ap50':.1}


def passes(report):
    return (report['diagnostic']['precision']>=GATE['minimum_precision_at_035']
            and report['diagnostic']['recall']>=GATE['minimum_recall_at_035']
            and report['ultralytics_metrics']['metrics/mAP50(B)']>=GATE['minimum_map50']
            and len(report['per_class_metrics'])==4
            and all(c['map50']>=GATE['minimum_class_ap50'] for c in report['per_class_metrics'].values()))


def publish(repo,root,run,reports,release,activation):
    remote=subprocess.check_output(['git','remote','get-url','origin'],cwd=repo,text=True).strip()
    identity={key:subprocess.check_output(['git','config',f'user.{key}'],cwd=repo,text=True).strip() for key in ('name','email')}
    checkout=Path(tempfile.mkdtemp(prefix='compact-results-',dir=root))/'checkout'
    env={**os.environ,'GIT_TERMINAL_PROMPT':'0'}
    subprocess.run(['git','clone','--depth','1','--branch','main',remote,str(checkout)],check=True,env=env)
    def git(*args):return subprocess.check_output(['git',*args],cwd=checkout,env=env,text=True).strip()
    for key,value in identity.items():git('config',f'user.{key}',value)
    folder=checkout/'docs/datasets/results/compact-v1';folder.mkdir(parents=True,exist_ok=True)
    for name,report in reports.items():(folder/f'{name}.json').write_text(json.dumps(report,indent=2)+'\n')
    (folder/'activation.json').write_text(json.dumps(activation,indent=2)+'\n')
    config=json.loads((run/'reproduction.json').read_text())
    for key in ('base','resume','output','dataset'):config.pop(key,None)
    (folder/'training-config.json').write_text(json.dumps(config,indent=2)+'\n')
    ready=passes(reports['validation']) and passes(reports['test'])
    lines=['# Compact multinational detector — measured results','',
           f'Trained for 50 epochs. Checkpoint SHA256: `{reports["test"]["checkpoint_sha256"]}`.',
           f'Prototype activation checks passed on validation and held-out test: **{ready}**.',
           'These are internal class-enriched subset metrics, not national prevalence estimates or validated road safety scores.','',
           'The checkpoint was selected using validation only, frozen, then evaluated once on the internal held-out test. The generic COCO checkpoint was used only for pretrained initialization. No matched road-trained baseline is available, so no improvement claim is made.','']
    for split,report in reports.items():
        d=report['diagnostic'];m=report['ultralytics_metrics']
        lines.append(f'- {split}: {report["images"]} images; mAP50 {m["metrics/mAP50(B)"]:.4f}; mAP50:95 {m["metrics/mAP50-95(B)"]:.4f}; diagnostic P {d["precision"]:.4f}, R {d["recall"]:.4f}, F1 {d["f1"]:.4f} at confidence .35/IoU .5.')
    lines+=['','Per-class and country/view results are in the JSON reports. The predeclared activation checks are in `activation.json`. A failed checkpoint remains an experimental download and is not activated in the local app.',
            '',f'[Dataset, model and evaluation artifacts](https://github.com/sanviq/3x-RQD/releases/tag/{release}).']
    (folder/'README.md').write_text('\n'.join(lines)+'\n')
    git('add','--','docs/datasets/results/compact-v1')
    staged=git('diff','--cached','--name-only').splitlines()
    if any(not path.startswith('docs/datasets/results/compact-v1/') for path in staged):raise ValueError('Unexpected staged results file')
    git('commit','-m','Record measured compact RDD2022 training and held-out evaluation')
    for attempt in range(4):
        try:git('push','origin','HEAD:main');break
        except subprocess.CalledProcessError:
            if attempt==3:raise
            git('fetch','origin','main');git('rebase','origin/main')
    return git('rev-parse','HEAD')


def restart_managed_server(repo,root,pid,started,checkpoint):
    if pid:
        stamp=subprocess.run(['ps','-p',str(pid),'-o','lstart='],capture_output=True,text=True).stdout.strip()
        command=subprocess.run(['ps','-p',str(pid),'-o','command='],capture_output=True,text=True).stdout
        if stamp==started and 'uvicorn app.main:app' in command:
            os.kill(pid,signal.SIGTERM)
            for _ in range(20):
                try:os.kill(pid,0);time.sleep(.25)
                except ProcessLookupError:break
        elif stamp:return {'restarted':False,'reason':'Managed server changed; preserving the running process.'}
    env={**os.environ}
    if checkpoint:env['ROAD_HEALTH_MODEL']=str(checkpoint)
    else:env.pop('ROAD_HEALTH_MODEL',None)
    with (root/'app-after-training.log').open('ab',buffering=0) as log:
        child=subprocess.Popen([sys.executable,'-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000'],cwd=repo,env=env,
                               stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    time.sleep(2)
    return {'restarted':child.poll() is None,'pid':child.pid,'model_configured':bool(checkpoint)}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dataset',type=Path,required=True);p.add_argument('--base',type=Path,required=True)
    p.add_argument('--root',type=Path,required=True);p.add_argument('--release',default='rdd2022-compact-v1')
    p.add_argument('--server-pid',type=int,default=0);p.add_argument('--server-started',default='')
    a=p.parse_args();repo=Path(__file__).resolve().parents[1];root=a.root.resolve();root.mkdir(parents=True,exist_ok=True)
    status_path=root/'training-status.json';run=root/'run-50-epochs'
    def status(phase,**extra):
        result={'phase':phase,'updated_utc':datetime.now(timezone.utc).isoformat(),'approved_epochs':50,**extra}
        tmp=status_path.with_suffix('.tmp');tmp.write_text(json.dumps(result,indent=2));tmp.replace(status_path);print(json.dumps(result),flush=True)
    def execute(stage,args):
        status(stage,log=str(root/'pipeline.log'))
        with (root/'pipeline.log').open('ab',buffering=0) as log:
            process=subprocess.Popen([sys.executable,*args],cwd=repo,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT)
            last=0
            while process.poll() is None:
                now=time.monotonic()
                if now-last>30:
                    progress={}
                    csv_path=run/'results.csv'
                    if stage=='training' and csv_path.is_file():
                        try:
                            rows=list(csv.DictReader(csv_path.open()))
                            if rows:progress={'completed_epochs':int(float(rows[-1]['epoch']))}
                        except (KeyError,ValueError):pass
                    status(stage,child_pid=process.pid,log=str(root/'pipeline.log'),**progress);last=now
                time.sleep(2)
            if process.returncode:raise RuntimeError(f'{stage} exited {process.returncode}; see pipeline.log')
    try:
        dataset,fingerprint=validated_dataset(a.dataset)
        audit=json.loads((dataset.parent/'audit.json').read_text())
        if any(audit['missing_classes_by_split'].values()):raise ValueError('A split lacks a target class; inspect the audit before training')
        (root/'approved-protocol.json').write_text(json.dumps({'epochs':50,'imgsz':640,'batch':2,'lr':.001,'seed':42,'device':'mps',
            'dataset_manifest_sha256':fingerprint,'activation_checks':GATE,'test_policy':'Freeze validation-selected best checkpoint before one held-out test evaluation.'},indent=2))
        execute('training',['train_detector.py',str(dataset),'--base',str(a.base.resolve()),'--output',str(run),
                            '--epochs','50','--imgsz','640','--batch','2','--lr','.001','--seed','42','--device','mps'])
        checkpoint=run/'weights/best.pt';checksum=file_sha256(checkpoint)
        reports={}
        for split,name in [('val','validation'),('test','test')]:
            output=root/f'evaluation-{split}'
            args=['-m','tools.evaluate_detector',str(dataset),'--checkpoint',str(checkpoint),'--output',str(output),
                  '--split',split,'--device','mps','--batch','2','--confidence','.35']
            if split=='test':args+=['--frozen-sha256',checksum]
            execute('evaluating_'+name,args);reports[name]=json.loads((output/'report.json').read_text())
        ready=passes(reports['validation']) and passes(reports['test'])
        reports['activation']={'checks':GATE,'validation_passed':passes(reports['validation']),'test_passed':passes(reports['test']),
            'enabled_for_local_model_mode':ready,'checkpoint_sha256':checksum,'notice':'Prototype reliability gate only; road-health scores and severity remain unvalidated.'}
        # publish() expects evaluation reports separately from activation policy.
        activation=reports.pop('activation');(root/'activation.json').write_text(json.dumps(activation,indent=2))
        status('publishing_measured_results',activation=activation)
        # The isolated checkout preserves all user changes in the main workspace.
        commit=publish(repo,root,run,reports,a.release,activation)
        assets=root/'release-assets';assets.mkdir()
        import shutil
        model=assets/'road-health-compact-v1-best.pt';shutil.copyfile(checkpoint,model)
        for name,report in {**reports,'activation':activation}.items():(assets/f'compact-v1-{name}.json').write_text(json.dumps(report,indent=2))
        (assets/'road-health-compact-v1-best.pt.sha256').write_text(f'{checksum}  {model.name}\n')
        import zipfile
        evidence=assets/'compact-v1-evaluation-evidence.zip'
        with zipfile.ZipFile(evidence,'w',compression=zipfile.ZIP_DEFLATED) as z:
            for split in ('val','test'):
                folder=root/f'evaluation-{split}'
                for path in folder.rglob('*'):
                    if path.is_file():z.write(path,f'{split}/{path.relative_to(folder)}')
        upload_assets(a.release,list(assets.iterdir()))
        server=restart_managed_server(repo,root,a.server_pid,a.server_started,checkpoint if ready else None)
        status('complete',results_commit=commit,checkpoint_sha256=checksum,activation=activation,server=server,
               release_url='https://github.com/sanviq/3x-RQD/releases/tag/'+a.release,
               notice='Training and internal held-out evaluation finished. Inspect metrics and examples; passing the prototype gate is not field validation.')
    except Exception as exc:
        status('failed',error=type(exc).__name__+': '+str(exc));raise


if __name__=='__main__':main()
