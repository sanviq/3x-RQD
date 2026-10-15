"""Audit RDD2022 and build grouped YOLO splits without modifying the source archive."""
import argparse
from collections import Counter, defaultdict
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path, PurePosixPath
import random
import re
import shutil
import xml.etree.ElementTree as ET
import zipfile
import io

import numpy as np
from PIL import Image

CLASSES = {'D00': 0, 'D10': 1, 'D20': 2, 'D40': 3}


class DatasetArchive:
    """Read the official ZIP-of-country-ZIPs without temporary multi-GB copies.

    Official country archives are ZIP_STORED members, allowing direct bounded
    seeks through ZipExtFile. Inner read() still verifies each image/XML CRC.
    """
    def __init__(self, path):
        self.stack = ExitStack()
        outer = self.stack.enter_context(zipfile.ZipFile(path))
        self.members = {}
        try:
            for info in outer.infolist():
                if info.is_dir(): continue
                if info.filename.lower().endswith('.zip'):
                    if info.compress_type != zipfile.ZIP_STORED:
                        raise ValueError('Nested archives must be stored, as in the official release; no implicit large extraction.')
                    stream = self.stack.enter_context(outer.open(info))
                    child = self.stack.enter_context(zipfile.ZipFile(stream))
                    for entry in child.infolist():
                        if not entry.is_dir(): self._add(info.filename+'/'+entry.filename, child, entry)
                else: self._add(info.filename, outer, info)
        except Exception:
            self.stack.close()
            raise
    def _add(self, name, archive, info):
        if name in self.members: raise ValueError('Duplicate member path: '+name)
        self.members[name]=(archive,info)
    def __enter__(self): return self
    def __exit__(self,*args): return self.stack.__exit__(*args)
    def namelist(self): return list(self.members)
    def read(self,name):
        archive,info=self.members[name]
        return archive.read(info)
    def getinfo(self,name): return self.members[name][1]


def parse_annotation(data, image_name, width, height):
    root = ET.fromstring(data)
    if root.tag != 'annotation':
        raise ValueError('Not a Pascal VOC annotation')
    declared = root.findtext('filename')
    if declared and Path(declared.replace('\\', '/')).stem != Path(image_name).stem:
        raise ValueError('XML filename does not match image')
    if (int(root.findtext('size/width', '0')), int(root.findtext('size/height', '0'))) != (width, height):
        raise ValueError('XML dimensions do not match decoded image')
    labels = []
    difficult = 0
    for obj in root.findall('object'):
        name = (obj.findtext('name') or '').strip()
        if name not in CLASSES:
            raise ValueError('Unsupported annotation class: ' + name)
        b = obj.find('bndbox')
        if b is None:
            raise ValueError('Missing bounding box')
        values = [float(b.findtext(k, 'nan')) for k in ('xmin','ymin','xmax','ymax')]
        # Pascal VOC is 1-based inclusive; convert to zero-based half-open extents.
        x1,y1,x2,y2 = values[0]-1, values[1]-1, values[2], values[3]
        if not all(np.isfinite(values)) or not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height):
            raise ValueError('Invalid or out-of-bounds VOC box')
        labels.append((CLASSES[name], (x1+x2)/2/width, (y1+y2)/2/height, (x2-x1)/width, (y2-y1)/height))
        difficult += obj.findtext('difficult', '0') == '1'
    return labels, difficult


class Union:
    def __init__(self, count): self.parents = list(range(count))
    def find(self, i):
        while self.parents[i] != i:
            self.parents[i] = self.parents[self.parents[i]]
            i = self.parents[i]
        return i
    def join(self, a, b): self.parents[self.find(a)] = self.find(b)


def group_records(records, frame_block=100, near_distance=2):
    """Group pixel duplicates, close dHashes, and consecutive filename blocks together."""
    union = Union(len(records)); exact = {}; sequence = {}; bands = defaultdict(list)
    for i, r in enumerate(records):
        if r['pixel_sha256'] in exact: union.join(i, exact[r['pixel_sha256']])
        exact[r['pixel_sha256']] = i
        match = re.match(r'^(.*?)(\d+)$', Path(r['source_image']).stem)
        if match:
            key = (r['country'], match[1], int(match[2])//frame_block)
            if key in sequence: union.join(i, sequence[key])
            sequence[key] = i
        value = r['dhash']
        # Three bands guarantee a candidate when Hamming distance <= 2.
        candidates = set()
        for band, shift, bits in ((0,0,22),(1,22,21),(2,43,21)):
            candidates.update(bands[(band, (value >> shift) & ((1<<bits)-1))])
        for j in candidates:
            if (value ^ records[j]['dhash']).bit_count() <= near_distance:
                # Similar road/sky layouts can collide in dHash despite being
                # different captures. Require close color thumbnails as well.
                left, right = r.get('thumbnail'), records[j].get('thumbnail')
                if left is not None and right is not None:
                    delta = np.abs(np.frombuffer(bytes.fromhex(left),np.uint8).astype(float)-np.frombuffer(bytes.fromhex(right),np.uint8))
                    if delta.mean()>3 or np.quantile(delta,.99)>12: continue
                union.join(i,j)
        for band, shift, bits in ((0,0,22),(1,22,21),(2,43,21)):
            bands[(band, (value >> shift) & ((1<<bits)-1))].append(i)
    groups = defaultdict(list)
    for i in range(len(records)): groups[union.find(i)].append(i)
    return list(groups.values())


def assign_splits(records, groups, seed=42):
    """Deterministic grouped allocation balancing image, class and country counts."""
    rng = random.Random(seed)
    countries = sorted({r['country'] for r in records})
    vectors = []
    for group in groups:
        v = np.zeros(5+len(countries))
        v[0] = len(group)
        for i in group:
            for label in records[i]['labels']: v[1+label[0]] += 1
            v[5+countries.index(records[i]['country'])] += 1
        vectors.append((group,v,rng.random()))
    vectors.sort(key=lambda item:(-len(item[0]),item[2]))
    total = sum((v for _,v,_ in vectors), np.zeros(5+len(countries)))
    targets = np.array([.8,.1,.1])[:,None] * total
    counts = np.zeros_like(targets)
    denominator = np.maximum(total,1)
    result = {}
    assigned = []
    for group, v, _ in vectors:
        errors=[]
        for split in range(3):
            candidate = counts.copy(); candidate[split] += v
            errors.append(np.sum((candidate-targets)**2/denominator))
        chosen = int(np.argmin(errors)); counts[chosen] += v
        assigned.append(chosen)
        for i in group: result[i] = ('train','val','test')[chosen]
    # A single large-first pass can fill training with early country groups,
    # leaving later, smaller countries to supply the holdouts. Refine complete
    # group placements after all countries are represented in the objective.
    for _ in range(30):
        moved = False
        for index,(group,v,_) in enumerate(vectors):
            old = assigned[index]
            best = old
            error = np.sum((counts-targets)**2/denominator)
            for split in range(3):
                if split == old or counts[old,0] <= v[0]: continue
                candidate = counts.copy();candidate[old] -= v;candidate[split] += v
                value = np.sum((candidate-targets)**2/denominator)
                if value < error-1e-9:best,error = split,value
            if best != old:
                counts[old] -= v;counts[best] += v;assigned[index] = best;moved = True
        if not moved:break
    # Exchange whole groups within a country as well: single-group moves can
    # get stuck with one large holdout group and an almost-empty other holdout.
    for _ in range(5):
        swapped = False
        for i,(_,left,_) in enumerate(vectors):
            for j in range(i+1,len(vectors)):
                right=vectors[j][1];a,b=assigned[i],assigned[j]
                if a==b or not np.any(left[5:]*right[5:]):continue
                delta=left-right
                before=np.sum(((counts[a]-targets[a])**2+(counts[b]-targets[b])**2)/denominator)
                after=np.sum(((counts[a]-delta-targets[a])**2+(counts[b]+delta-targets[b])**2)/denominator)
                if after<before-1e-9:
                    counts[a]-=delta;counts[b]+=delta;assigned[i],assigned[j]=b,a;swapped=True
        if not swapped:break
    for (group,_,_),split in zip(vectors,assigned):
        for i in group:result[i] = ('train','val','test')[split]
    if len(set(result.values())) < 3:
        raise ValueError('Not enough independent groups for three nonempty splits')
    return result


def prepare(archive, output, seed=42, frame_block=100):
    archive, output = Path(archive).resolve(), Path(output).resolve()
    if output.exists():
        raise ValueError('Output already exists; use a new versioned directory. Nothing overwritten.')
    if archive in output.parents or output in archive.parents:
        raise ValueError('Output must be separate from the source')
    output.mkdir(parents=True)
    report = {'source_archive':archive.name, 'seed':seed, 'class_mapping':CLASSES,
              'coordinates':'VOC 1-based inclusive -> YOLO normalized center/width/height',
              'issues':[], 'countries':{}, 'source_annotation_classes':{}, 'official_unlabelled_test_images':0,
              'difficult_policy':'Include difficult objects as annotated positives; no ignored regions are invented.',
              'limitations':['Filename blocks are a conservative related-frame proxy, not verified route IDs.',
                            'Pixel SHA256 and dHash <=2 plus close color thumbnails group identifiable duplicates; unidentified related scenes can remain.',
                            'Splits are internal holdouts of labelled training data, not the official challenge test.']}
    records=[]; country_stats=defaultdict(Counter)
    try:
        with DatasetArchive(archive) as z:
            entries = [n for n in z.namelist() if not n.endswith('/') and not n.startswith('__MACOSX/')]
            if len(entries) != len(set(entries)): raise ValueError('Duplicate archive member names')
            xml_by_key={}; train_images=[]; matched_xml=set()
            for name in sorted(entries):
                parts=PurePosixPath(name).parts
                if '..' in parts or name.startswith('/'): raise ValueError('Unsafe archive member name')
                if 'test' in parts and Path(name).suffix.lower() in {'.jpg','.jpeg','.png'}:
                    report['official_unlabelled_test_images'] += 1
                    country_stats[parts[parts.index('test')-1]]['official_test_images'] += 1
                if 'train' not in parts: continue
                idx=parts.index('train'); country=parts[idx-1].removesuffix('.zip'); key=(country,Path(name).stem)
                if name.lower().endswith('.xml'):
                    if key in xml_by_key: raise ValueError('Ambiguous XML stem: '+str(key))
                    xml_by_key[key]=name
                elif Path(name).suffix.lower() in {'.jpg','.jpeg','.png'}: train_images.append((country,name))
            if not train_images: raise ValueError('No labelled-training image layout found in archive')
            image_keys=[(c,Path(n).stem) for c,n in train_images]
            if len(image_keys)!=len(set(image_keys)): raise ValueError('Ambiguous image stems within a country')
            for number,(country,name) in enumerate(train_images):
                stats=country_stats[country]; stats['train_images_seen'] += 1
                key=(country,Path(name).stem); xml=xml_by_key.get(key)
                if xml is None:
                    stats['missing_xml'] += 1; report['issues'].append({'image':name,'reason':'Missing XML; excluded, never used as negative'})
                    continue
                matched_xml.add(xml)
                try:
                    data=z.read(name)
                    with Image.open(io.BytesIO(data)) as im: im.verify()
                    with Image.open(io.BytesIO(data)) as im:
                        width,height=im.size; rgb=im.convert('RGB')
                        pixels=rgb.tobytes()
                        small=np.asarray(rgb.convert('L').resize((9,8),Image.Resampling.BILINEAR))
                        dhash=int.from_bytes(np.packbits(small[:,1:]>small[:,:-1]).tobytes(),'big')
                        thumbnail=rgb.resize((16,16),Image.Resampling.BILINEAR).tobytes().hex()
                    xml_data=z.read(xml)
                    raw_classes=report['source_annotation_classes'].setdefault(country,{})
                    for obj in ET.fromstring(xml_data).findall('object'):
                        code=(obj.findtext('name') or '').strip()
                        raw_classes[code]=raw_classes.get(code,0)+1
                    labels,difficult=parse_annotation(xml_data,name,width,height)
                    fingerprint=hashlib.sha256(f'{width}x{height}:'.encode()+pixels).hexdigest()
                    records.append({'country':country,'source_image':name,'source_xml':xml,'width':width,'height':height,
                                    'pixel_sha256':fingerprint,'dhash':dhash,'thumbnail':thumbnail,'labels':labels,
                                    'image_sha256':hashlib.sha256(data).hexdigest()})
                    stats['valid_pairs'] += 1; stats['difficult_objects'] += difficult
                    if not labels: stats['explicit_empty_annotations'] += 1
                    for label in labels: stats[list(CLASSES)[label[0]]] += 1
                except Exception as exc:
                    stats['invalid_pairs'] += 1; report['issues'].append({'image':name,'xml':xml,'reason':str(exc)})
                if number%1000==0: print(f'Audited {number+1}/{len(train_images)} images',flush=True)
            report['orphan_xml'] = sorted(set(xml_by_key.values())-matched_xml)
            # Conflicting labels on identical pixels are quarantined, not silently made negatives.
            by_hash=defaultdict(list)
            for r in records: by_hash[r['pixel_sha256']].append(r)
            conflicts={h for h,rs in by_hash.items() if len({json.dumps(sorted(r['labels'])) for r in rs})>1}
            report['conflicting_duplicate_images']=sum(len(by_hash[h]) for h in conflicts)
            for h in sorted(conflicts):
                report['issues'].append({'images':[r['source_image'] for r in by_hash[h]],'reason':'Identical pixels with inconsistent annotations; all excluded'})
            records=[r for r in records if r['pixel_sha256'] not in conflicts]
            if not records: raise ValueError('No valid labelled pairs remain')
            groups=group_records(records,frame_block)
            report['groups']={'count':len(groups),'largest_images':max(map(len,groups)), 'filename_block_size':frame_block,
                              'dhash_distance':2,'near_duplicate_thumbnail_mae_max':3,'near_duplicate_thumbnail_p99_max':12}
            assignment=assign_splits(records,groups,seed)
            for group_id,group in enumerate(groups):
                for i in group: records[i]['group']=group_id
            for r in records: r.pop('thumbnail',None)
            report['splits']={s:{'images':0,'objects':dict.fromkeys(CLASSES,0),'countries':{}} for s in ('train','val','test')}
            for s in report['splits']:
                (output/'images'/s).mkdir(parents=True)
                (output/'labels'/s).mkdir(parents=True)
            needed=sum(z.getinfo(r['source_image']).file_size for r in records)
            if shutil.disk_usage(output).free < needed+5*1024**3: raise ValueError('Insufficient space for prepared images plus 5 GiB reserve')
            for i,r in enumerate(records):
                s=assignment[i]; r['split']=s
                unique=hashlib.sha256(r['source_image'].encode()).hexdigest()[:16]
                filename=f'{r["country"]}_{Path(r["source_image"]).stem}_{unique}{Path(r["source_image"]).suffix.lower()}'
                r['prepared_image']=f'images/{s}/{filename}'
                (output/r['prepared_image']).write_bytes(z.read(r['source_image']))
                labelpath=output/'labels'/s/Path(filename).with_suffix('.txt')
                labelpath.write_text(''.join(f'{c} {x:.10f} {y:.10f} {w:.10f} {h:.10f}\n' for c,x,y,w,h in r['labels']))
                summary=report['splits'][s]; summary['images'] += 1
                summary['countries'][r['country']]=summary['countries'].get(r['country'],0)+1
                for label in r['labels']: summary['objects'][list(CLASSES)[label[0]]] += 1
        report['countries']={k:dict(v) for k,v in sorted(country_stats.items())}
        report['country_counts_scope']='Valid-pair counts precede conflict quarantine; final split counts are authoritative.'
        report['official_test_audit']='Counted only; unlabelled test images were not decoded or evaluated.'
        report['missing_classes_by_split']={s:[c for c,n in v['objects'].items() if n==0] for s,v in report['splits'].items()}
        report['prepared_images']=len(records)
        report['source_sha256']=file_sha256(archive)
        (output/'manifest.json').write_text(json.dumps(records,indent=2))
        (output/'data.yaml').write_text('path: '+json.dumps(str(output))+'\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n  0: D00\n  1: D10\n  2: D20\n  3: D40\n')
        report['status']='complete'
    except Exception as exc:
        report['status']='failed';report['error']=str(exc)
        raise
    finally:
        report['countries']={k:dict(v) for k,v in sorted(country_stats.items())}
        (output/'audit.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report['splits'],indent=2),flush=True)
    return report


def file_sha256(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        while b:=f.read(8*1024**2):h.update(b)
    return h.hexdigest()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive',type=Path);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--seed',type=int,default=42);p.add_argument('--frame-block',type=int,default=100)
    a=p.parse_args()
    if a.frame_block<1:p.error('Frame block must be positive')
    prepare(a.archive,a.output,a.seed,a.frame_block)
