"""Wait for the verified download, prepare the full dataset, then STOP before training."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import time

from tools.download_rdd2022 import digest, MD5, SIZE
from tools.prepare_rdd2022 import prepare, file_sha256


def audit_summary(audit, manifest):
    summary={k:v for k,v in audit.items() if k not in ('issues','orphan_xml')}
    summary['issue_first_failure_counts']=dict(Counter(i['reason'] for i in audit['issues']))
    summary['orphan_xml_count']=len(audit['orphan_xml'])
    summary['prepared_manifest_sha256']=file_sha256(manifest)
    return summary


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archive',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--report-directory',type=Path,required=True)
    a=p.parse_args()
    reports=a.report_directory.resolve();reports.mkdir(parents=True,exist_ok=True)
    status_path=reports/'preparation-status.json'
    def status(phase,**extra):
        payload={'phase':phase,'updated_utc':datetime.now(timezone.utc).isoformat(),**extra}
        temp=status_path.with_suffix('.tmp');temp.write_text(json.dumps(payload,indent=2));temp.replace(status_path)
        print(json.dumps(payload),flush=True)
    status('waiting_for_verified_archive',archive=str(a.archive))
    while not a.archive.is_file():time.sleep(30)
    try:
        status('verifying_full_archive')
        if a.archive.stat().st_size!=SIZE or digest(a.archive)!=MD5:raise ValueError('Official full archive integrity check failed')
        status('auditing_and_preparing',output=str(a.output))
        audit=prepare(a.archive,a.output,seed=42,frame_block=100)
        summary=audit_summary(audit,a.output/'manifest.json')
        summary['scope']='Full official multinational archive, locally verified and audited'
        summary['publisher_md5_verified']=MD5
        (reports/'multinational-audit-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
        status('ready_for_audit_review_and_training_approval',prepared_dataset=str(a.output/'data.yaml'),
               summary=str(reports/'multinational-audit-summary.json'),training_started=False,
               notice='Review exclusions/split balance, report updated compute estimates and obtain approval before long training. No weights were promoted. No automatic GitHub push occurs.')
    except Exception as exc:
        status('failed',error=str(exc),training_started=False)
        raise


if __name__=='__main__':main()
