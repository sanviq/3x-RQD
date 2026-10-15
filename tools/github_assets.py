"""Upload explicitly selected release assets; preserve existing files unless hashes match."""
import json
from pathlib import Path
import subprocess
import time

from tools.prepare_rdd2022 import file_sha256


def upload_assets(tag,files,repo='sanviq/3x-RQD'):
    for file in map(Path,files):
        checksum='sha256:'+file_sha256(file)
        for attempt in range(3):
            # Draft releases have no published tag yet, so the tag lookup can
            # return 404 even for the authenticated owner. Listing includes them.
            releases=json.loads(subprocess.check_output(['gh','api',f'repos/{repo}/releases?per_page=100'],text=True))
            report=next((r for r in releases if r['tag_name']==tag),None)
            if report is None:raise ValueError('Release not found in authenticated release list: '+tag)
            existing=next((a for a in report['assets'] if a['name']==file.name),None)
            if existing:
                if existing.get('digest')!=checksum or existing['size']!=file.stat().st_size:
                    raise ValueError('Existing release asset differs or cannot be verified; preserving it: '+file.name)
                break
            result=subprocess.run(['gh','release','upload',tag,str(file),'--repo',repo])
            if result.returncode==0:break
            if attempt==2:raise RuntimeError('Release asset upload failed: '+file.name)
            time.sleep(5)
