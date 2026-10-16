"""Collect a bounded real multinational subset using local/HTTP ZIP byte ranges."""
import argparse
from collections import Counter, OrderedDict
from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path, PurePosixPath
import random
import struct
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
import zlib

from tools.download_rdd2022 import URL, SIZE, NAME
from tools.prepare_rdd2022 import CLASSES, parse_annotation, file_sha256
from PIL import Image


class RangeSource:
    def __init__(self, original=None, cache=None, reuse_cache=None):
        self.original=Path(original) if original else None
        self.cache=Path(cache) if cache else None
        self.reuse_cache=Path(reuse_cache) if reuse_cache else None
        if self.cache:self.cache.mkdir(parents=True,exist_ok=True)
        self.ranges=[];self.lock=threading.Lock();self.network_bytes=0;self.local_bytes=0
        if self.original:
            state=self.original/(NAME+'.download.json')
            if state.exists():
                d=json.loads(state.read_text())
                self.ranges=[(0,d['prefix'])]+[tuple(d['chunks'][i]) for i in d['done']]
        self.memory=OrderedDict()
    def read_at(self,start,count):
        if count==0:return b''
        end=start+count
        if start<0 or end>SIZE:raise ValueError('Archive range out of bounds')
        if self.original and any(a<=start and end<=b for a,b in self.ranges):
            with (self.original/(NAME+'.part')).open('rb') as f:f.seek(start);data=f.read(count)
            if len(data)!=count:raise ValueError('Short local read')
            with self.lock:self.local_bytes+=count
            return data
        # Cache range pages on disk so interruption never requires a full restart.
        page_size=512*1024
        chunks=[]
        for page in range(start//page_size,(end-1)//page_size+1):
            a=page*page_size;b=min(SIZE,a+page_size)
            path=self.cache/f'{page:08d}.bin' if self.cache else None
            with self.lock:data=self.memory.get(page)
            if data is None and path and path.is_file():data=path.read_bytes()
            if data is None and self.reuse_cache:
                previous=self.reuse_cache/f'{page:08d}.bin'
                if previous.is_file():data=previous.read_bytes()
            if data is None:
                for attempt in range(4):
                    try:
                        request=urllib.request.Request(URL,headers={'Range':f'bytes={a}-{b-1}'})
                        with urllib.request.urlopen(request,timeout=60) as response:
                            if response.status!=206 or response.headers.get('Content-Range')!=f'bytes {a}-{b-1}/{SIZE}':
                                raise ValueError('Server did not return the exact requested byte range')
                            data=response.read(b-a+1)
                        if len(data)!=b-a:raise ValueError('Short HTTP range')
                        if path:
                            temp=path.with_suffix(f'.{threading.get_ident()}.tmp');temp.write_bytes(data);temp.replace(path)
                        with self.lock:self.network_bytes+=len(data)
                        break
                    except Exception:
                        if attempt==3:raise
                        time.sleep(2**attempt)
            if len(data)!=b-a:raise ValueError('Corrupt cached range page')
            with self.lock:
                self.memory[page]=data;self.memory.move_to_end(page)
                while len(self.memory)>32:self.memory.popitem(last=False)
            chunks.append(data[max(0,start-a):min(b-a,end-a)])
        return b''.join(chunks)


class Slice(io.RawIOBase):
    def __init__(self,source,offset=0,size=None):self.source=source;self.offset=offset;self.size=SIZE if size is None else size;self.position=0
    def readable(self):return True
    def seekable(self):return True
    def tell(self):return self.position
    def seek(self,offset,whence=0):
        position=offset if whence==0 else self.position+offset if whence==1 else self.size+offset
        if position<0:raise ValueError('Negative seek')
        self.position=position;return position
    def read(self,size=-1):
        size=max(0,min(self.size-self.position,self.size if size<0 else size))
        result=self.source.read_at(self.offset+self.position,size);self.position+=size;return result


def country_archive(source,info):
    if info.compress_type!=zipfile.ZIP_STORED:raise ValueError('Expected official stored country ZIP')
    h=struct.unpack('<4s5H3I2H',source.read_at(info.header_offset,30))
    if h[0]!=b'PK\x03\x04':raise ValueError('Invalid local ZIP header')
    offset=info.header_offset+30+h[-2]+h[-1]
    return zipfile.ZipFile(Slice(source,offset,info.file_size))


def collect(original,output,per_subset=250,seed=42,max_mib=650,reuse=None):
    output=Path(output).resolve();output.mkdir(parents=True,exist_ok=True)
    source=RangeSource(original,output/'range-cache',Path(reuse)/'range-cache' if reuse else None)
    report={'status':'collecting','source_url':URL,'source_file_id':38030910,'seed':seed,'target_per_subset':per_subset,
            'raw_byte_budget':max_mib*1024**2,'class_mapping':CLASSES,'subsets':{},
            'location_scope':'Six countries; China has drone/motorbike subsets. Indian state/route metadata not established.',
            'integrity':'Exact HTTP ranges and inner member CRCs plus saved SHA256; full archive MD5 not claimed for a partial download.',
            'selection':'Seeded class-coverage sampling of labelled training data, approximately 10% explicit empty annotations. Unsupported-class images excluded. Not representative prevalence.',
            'training_started':False}
    budget_lock=threading.Lock();reserved=0
    with zipfile.ZipFile(Slice(source)) as outer:infos=[i for i in outer.infolist() if i.filename.lower().endswith('.zip')]
    def one(info):
        nonlocal reserved
        country=Path(info.filename).stem
        print('Indexing '+country,flush=True)
        stats={'source_train_images':0,'source_official_test_images':0,'candidate_pairs':0,'excluded_xml_reasons':{},'selected_images':0,'selected_bytes':0,'boxes':dict.fromkeys(CLASSES,0)}
        records=[]
        with country_archive(source,info) as z:
            entries=z.infolist();images={};xmls=[]
            for item in entries:
                parts=PurePosixPath(item.filename).parts
                if '..' in parts or item.filename.startswith('/'):raise ValueError('Unsafe member name')
                if 'test' in parts and Path(item.filename).suffix.lower() in {'.jpg','.png','.jpeg'}:stats['source_official_test_images']+=1
                if 'train' not in parts:continue
                if Path(item.filename).suffix.lower() in {'.jpg','.png','.jpeg'}:images[Path(item.filename).stem]=item
                elif item.filename.lower().endswith('.xml'):xmls.append(item)
            stats['source_train_images']=len(images)
            candidates=[];reasons=Counter()
            # Physical order makes remote annotation reads mostly sequential.
            for item in sorted(xmls,key=lambda i:i.header_offset):
                image=images.get(Path(item.filename).stem)
                if image is None:reasons['missing_image']+=1;continue
                try:
                    data=z.read(item);root=ET.fromstring(data)
                    width=int(root.findtext('size/width','0'));height=int(root.findtext('size/height','0'))
                    if width<64 or height<64:raise ValueError('Invalid declared dimensions')
                    labels,_=parse_annotation(data,image.filename,width,height)
                    candidates.append({'image':image,'xml':item,'xml_data':data,'classes':{list(CLASSES)[v[0]] for v in labels}})
                except Exception as exc:reasons[str(exc)]+=1
            stats['candidate_pairs']=len(candidates);stats['excluded_xml_reasons']=dict(reasons)
            rng=random.Random(seed+sum(map(ord,country)));rng.shuffle(candidates)
            selected=[];counts=Counter();negative_target=max(1,per_subset//10)
            positives=[c for c in candidates if c['classes']];negatives=[c for c in candidates if not c['classes']]
            # Prefer the least represented available class without fabricating missing classes.
            available={c for item in positives for c in item['classes']}
            while positives and len(selected)<per_subset-negative_target:
                target=min(available,key=lambda c:(counts[c],c))
                index=next((i for i,c in enumerate(positives) if target in c['classes']),None)
                if index is None:
                    available.discard(target)
                    if not available:break
                    continue
                item=positives.pop(index);selected.append(item);counts.update(item['classes'])
            selected.extend(negatives[:per_subset-len(selected)])
            if len(selected)<per_subset:selected.extend(positives[:per_subset-len(selected)])
            print(f'{country}: {len(candidates)} candidates; collecting {len(selected)} pairs',flush=True)
            for item in sorted(selected,key=lambda c:c['image'].header_offset):
                needed=item['image'].file_size+len(item['xml_data'])
                with budget_lock:
                    if reserved+needed>report['raw_byte_budget']:stats['budget_skipped']=stats.get('budget_skipped',0)+1;continue
                    reserved+=needed
                image_path=output/'raw'/country/'train/images'/Path(item['image'].filename).name
                xml_path=output/'raw'/country/'train/annotations/xmls'/Path(item['xml'].filename).name
                image_path.parent.mkdir(parents=True,exist_ok=True);xml_path.parent.mkdir(parents=True,exist_ok=True)
                previous=Path(reuse)/'raw'/country/'train/images'/image_path.name if reuse else None
                data=image_path.read_bytes() if image_path.exists() else previous.read_bytes() if previous and previous.is_file() else z.read(item['image'])
                # Existing cached files must also match the original member CRC.
                if len(data)!=item['image'].file_size or zlib.crc32(data)!=item['image'].CRC:raise ValueError('Image CRC mismatch')
                with Image.open(io.BytesIO(data)) as im:im.verify()
                with Image.open(io.BytesIO(data)) as im:width,height=im.size
                labels,_=parse_annotation(item['xml_data'],item['image'].filename,width,height)
                if not image_path.exists():image_path.write_bytes(data)
                if xml_path.exists() and xml_path.read_bytes()!=item['xml_data']:raise ValueError('Existing XML changed')
                if not xml_path.exists():xml_path.write_bytes(item['xml_data'])
                records.append({'subset':country,'source_outer_member':info.filename,'source_image':item['image'].filename,
                                'source_xml':item['xml'].filename,'image_sha256':file_sha256(image_path),'xml_sha256':file_sha256(xml_path),
                                'image_crc32':item['image'].CRC,'raw_image':str(image_path.relative_to(output)),
                                'raw_xml':str(xml_path.relative_to(output)),'width':width,'height':height})
                stats['selected_images']+=1;stats['selected_bytes']+=needed
                for c,*_ in labels:stats['boxes'][list(CLASSES)[c]]+=1
            (output/f'{country}.inventory.json').write_text(json.dumps(records,indent=2)+'\n')
        print(f'{country}: saved {stats["selected_images"]} real pairs',flush=True)
        return country,stats
    try:
        with ThreadPoolExecutor(max_workers=3) as pool:
            for country,stats in pool.map(one,infos):report['subsets'][country]=stats
        report['status']='complete';report['selected_images']=sum(s['selected_images'] for s in report['subsets'].values())
        report['network_bytes_this_run']=source.network_bytes;report['local_bytes_reused_this_run']=source.local_bytes
    except Exception as exc:report['status']='failed';report['error']=str(exc);raise
    finally:(output/'collection-audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2),flush=True)
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--original',type=Path);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--per-subset',type=int,default=250);p.add_argument('--seed',type=int,default=42);p.add_argument('--max-mib',type=int,default=650)
    p.add_argument('--reuse',type=Path,help='Read unchanged existing selected pairs and cached ranges before using the network')
    a=p.parse_args()
    if not 20<=a.per_subset<=1000 or not 20<=a.max_mib<=2200:p.error('Use a bounded subset: 20..1000 images/view and 20..2200 MiB')
    collect(a.original,a.output,a.per_subset,a.seed,a.max_mib,a.reuse)
