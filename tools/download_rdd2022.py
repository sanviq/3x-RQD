"""Download the official immutable archive with resumable ranges and integrity checks."""
import argparse
import fcntl
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import shutil
import threading
import time
import urllib.request

URL = 'https://ndownloader.figshare.com/files/38030910'
SIZE = 13264172619
MD5 = 'b62bd51d2ffcfaa76c60f234f0cc2bb3'
NAME = 'RDD2022_released_through_CRDDC2022.zip'


def download(directory, workers=4):
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / '.rdd2022-download.lock').open('a') as process_lock:
        try:
            fcntl.flock(process_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError('Another downloader is already using this directory.') from exc
        return _download(directory, workers)


def _download(directory, workers):
    target = directory / NAME
    partial = directory / (NAME + '.part')
    state_path = directory / (NAME + '.download.json')
    if target.exists():
        if target.stat().st_size != SIZE or digest(target) != MD5:
            raise ValueError('Existing archive failed integrity checks; preserving it. Choose another directory.')
        print('Existing archive verified; no download needed.', flush=True)
        return target
    if state_path.exists():
        state = json.loads(state_path.read_text())
        if state.get('url') != URL or state.get('size') != SIZE or not partial.exists():
            raise ValueError('Inconsistent resume state; inspect existing files manually.')
    else:
        prefix = partial.stat().st_size if partial.exists() else 0
        if prefix > SIZE:
            raise ValueError('Partial archive is too large; preserving it.')
        step = 64 * 1024 * 1024
        state = {'url': URL, 'size': SIZE, 'md5': MD5, 'prefix': prefix,
                 'chunks': [[a, min(a + step, SIZE)] for a in range(prefix, SIZE, step)], 'done': []}
    completed = set(state['done'])
    remaining = sum(b-a for i,(a,b) in enumerate(state['chunks']) if i not in completed)
    # Sparse resume files may have the full logical size already; count unfinished ranges.
    if shutil.disk_usage(directory).free < remaining + 2 * 1024**3:
        raise ValueError('Not enough free space for remaining bytes plus 2 GiB reserve.')
    lock = threading.Lock()
    fd = os.open(partial, os.O_RDWR | os.O_CREAT, 0o600)
    started = time.monotonic()
    downloaded = 0
    last_report = 0

    def save_state():
        temporary = state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state, indent=2))
        temporary.replace(state_path)

    with lock:
        save_state()

    def fetch(i, a, b):
        nonlocal downloaded, last_report
        for attempt in range(5):
            try:
                # Resolve a new signed URL for each request; validate the exact byte range.
                req = urllib.request.Request(URL, headers={'Range': f'bytes={a}-{b-1}'})
                with urllib.request.urlopen(req, timeout=90) as response:
                    expected = f'bytes {a}-{b-1}/{SIZE}'
                    if response.status != 206 or response.headers.get('Content-Range') != expected:
                        raise ValueError('Server did not honor requested range: ' + str(response.headers.get('Content-Range')))
                    position = a
                    while block := response.read(1024 * 1024):
                        if position + len(block) > b:
                            raise ValueError('Range response exceeds requested length.')
                        written = os.pwrite(fd, block, position)
                        if written != len(block):
                            raise OSError('Short write')
                        position += written
                    if position != b:
                        raise OSError('Incomplete range')
                with lock:
                    os.fsync(fd)
                    state['done'].append(i)
                    save_state()
                    downloaded += b-a
                    now = time.monotonic()
                    if now-last_report > 15:
                        done = state['prefix'] + sum(state['chunks'][j][1]-state['chunks'][j][0] for j in state['done'])
                        print(f'{done/SIZE:.1%} verified ranges; {downloaded/max(now-started,1)/1024**2:.1f} MiB/s this run', flush=True)
                        last_report = now
                return
            except Exception:
                if attempt == 4:
                    raise
                time.sleep(min(2**attempt, 8))
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            jobs = [pool.submit(fetch, i, a, b) for i,(a,b) in enumerate(state['chunks']) if i not in completed]
            for job in as_completed(jobs):
                job.result()
    finally:
        os.close(fd)
    if partial.stat().st_size != SIZE or digest(partial) != MD5:
        raise ValueError('Archive checksum mismatch. Preserving download for investigation; do not extract.')
    partial.rename(target)
    print(f'Complete; official MD5 verified: {target}', flush=True)
    return target


def digest(path):
    h = hashlib.md5()  # Publisher integrity checksum; not a security signature.
    with Path(path).open('rb') as stream:
        while block := stream.read(8*1024*1024):
            h.update(block)
    return h.hexdigest()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory', type=Path, required=True)
    p.add_argument('--workers', type=int, default=4, choices=range(1,9))
    a = p.parse_args()
    download(a.directory, a.workers)
