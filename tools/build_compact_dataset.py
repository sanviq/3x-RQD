"""Build a grouped YOLO dataset from immutable selected pairs, plus a tiny Git gallery."""
import argparse
from collections import defaultdict
import hashlib
import io
import json
from pathlib import Path
import shutil
import zipfile

import numpy as np
from PIL import Image

from tools.prepare_rdd2022 import parse_annotation,group_records,assign_splits,CLASSES,file_sha256


def build(source,output,gallery=None,prior_manifest=None,fresh_test_only=False):
    source,output=Path(source).resolve(),Path(output).resolve()
    audit=json.loads((source/'collection-audit.json').read_text())
    if audit['status']!='complete':raise ValueError('Collection incomplete')
    if output.exists():raise ValueError('New output directory required')
    records=[];raw_paths={}
    for inventory in sorted(source.glob('*.inventory.json')):
        for item in json.loads(inventory.read_text()):
            image=source/item['raw_image'];xml=source/item['raw_xml']
            if file_sha256(image)!=item['image_sha256'] or file_sha256(xml)!=item['xml_sha256']:raise ValueError('Raw selected file changed')
            with Image.open(image) as im:
                rgb=im.convert('RGB');w,h=rgb.size
                small=np.asarray(rgb.convert('L').resize((9,8),Image.Resampling.BILINEAR))
                dhash=int.from_bytes(np.packbits(small[:,1:]>small[:,:-1]).tobytes(),'big')
                pixel_sha=hashlib.sha256(f'{w}x{h}:'.encode()+rgb.tobytes()).hexdigest()
                thumb=rgb.resize((16,16),Image.Resampling.BILINEAR).tobytes().hex()
            labels,_=parse_annotation(xml.read_bytes(),image.name,w,h)
            path=f'{item["subset"]}/train/images/{image.name}'
            records.append({'country':item['subset'],'source_image':path,'source_xml':item['source_xml'],
                            'source_outer_member':item['source_outer_member'],'width':w,'height':h,'pixel_sha256':pixel_sha,
                            'dhash':dhash,'thumbnail':thumb,'labels':labels,'image_sha256':item['image_sha256'],
                            'xml_sha256':item['xml_sha256']})
            raw_paths[path]=(image,xml)
    by_pixels=defaultdict(list)
    for r in records:by_pixels[r['pixel_sha256']].append(r)
    conflicts={sha for sha,rs in by_pixels.items() if len({json.dumps(sorted(r['labels'])) for r in rs})>1}
    excluded=[r['source_image'] for r in records if r['pixel_sha256'] in conflicts]
    records=[r for r in records if r['pixel_sha256'] not in conflicts]
    groups=group_records(records,frame_block=100)
    # A previously evaluated image/group must never enter the fresh test set.
    # Include old records while grouping so even unselected old frames protect neighbours.
    prior=json.loads(Path(prior_manifest).read_text()) if prior_manifest else []
    quarantined=[]
    if prior:
        for r in prior:
            if r.get('thumbnail'):continue
            original=Path(prior_manifest).parent/r['prepared_image']
            with Image.open(original) as image:
                r['thumbnail']=image.convert('RGB').resize((16,16),Image.Resampling.BILINEAR).tobytes().hex()
        combined=records+prior
        protected_groups=group_records(combined,frame_block=100)
        locked={};groups=[]
        for group in protected_groups:
            current=[i for i in group if i<len(records)]
            if not current:continue
            old=[combined[i]['split'] for i in group if i>=len(records)]
            # Old train data and its neighbours stay train. Old exposed holdouts
            # and any connected groups stay validation and never enter training.
            if old:
                for i in current:locked[i]='val' if any(s!='train' for s in old) else 'train'
            groups.append(current)
        fresh_groups=[g for g in groups if g[0] not in locked]
        fresh_indices=[i for g in fresh_groups for i in g]
        remap={v:i for i,v in enumerate(fresh_indices)}
        fresh=({i:'test' for i in range(len(fresh_indices))} if fresh_test_only else
               assign_splits([records[i] for i in fresh_indices],[[remap[i] for i in g] for g in fresh_groups],seed=42))
        splits={**locked,**{i:fresh[remap[i]] for i in fresh_indices}}
        # A bridge connecting previously trained images to old holdouts cannot
        # supply clean validation; quarantine it instead of leaking either way.
        quarantine=set()
        for group in protected_groups:
            old={combined[i]['split'] for i in group if i>=len(records)}
            if 'train' in old and any(s!='train' for s in old):
                quarantine.update(i for i in group if i<len(records))
        if quarantine:
            quarantined=[records[i]['source_image'] for i in sorted(quarantine)]
            kept=[i for i in range(len(records)) if i not in quarantine]
            remap={i:j for j,i in enumerate(kept)}
            records=[records[i] for i in kept]
            splits={remap[i]:s for i,s in splits.items() if i in remap}
            groups=[[remap[i] for i in g if i in remap] for g in groups]
            groups=[g for g in groups if g]
    else:splits=assign_splits(records,groups,seed=42)
    for g,items in enumerate(groups):
        for i in items:records[i]['group']=g
    output.mkdir(parents=True)
    summary={s:{'images':0,'objects':dict.fromkeys(CLASSES,0),'countries':{}} for s in ('train','val','test')}
    gallery_items=[];picked=set()
    if gallery:
        gallery=Path(gallery).resolve()
        if gallery.exists():raise ValueError('Gallery already exists; refusing overwrite')
        gallery.mkdir(parents=True)
    for i,r in enumerate(records):
        s=splits[i];r['split']=s;r.pop('thumbnail',None)
        original,xml=raw_paths[r['source_image']]
        name=r['country']+'_'+original.stem+'_'+r['image_sha256'][:12]+original.suffix.lower()
        r['prepared_image']=f'images/{s}/{name}'
        destination=output/r['prepared_image'];destination.parent.mkdir(parents=True,exist_ok=True)
        # Independent copies preserve raw originals if a prepared image is edited.
        shutil.copyfile(original,destination)
        label=output/'labels'/s/Path(name).with_suffix('.txt');label.parent.mkdir(parents=True,exist_ok=True)
        label.write_text(''.join(f'{c} {x:.10f} {y:.10f} {w:.10f} {h:.10f}\n' for c,x,y,w,h in r['labels']))
        stats=summary[s];stats['images']+=1;stats['countries'][r['country']]=stats['countries'].get(r['country'],0)+1
        for c,*_ in r['labels']:stats['objects'][list(CLASSES)[c]]+=1
        # Git gallery comes only from training: no visual tuning on held-out test.
        codes={list(CLASSES)[l[0]] for l in r['labels']} or {'negative'}
        missing=[c for c in codes if (r['country'],c) not in picked]
        if gallery and s=='train' and missing:
            stem=r['country']+'_'+original.stem
            with Image.open(original) as im:
                view=im.convert('RGB');view.thumbnail((800,800),Image.Resampling.LANCZOS)
                view.save(gallery/(stem+'.jpg'),quality=88,optimize=True)
            (gallery/(stem+'.txt')).write_text(label.read_text())
            # Preserve the authentic XML; its dimensions refer to the original image.
            (gallery/(stem+'.original.xml')).write_bytes(xml.read_bytes())
            gallery_items.append({'image':stem+'.jpg','yolo_labels':stem+'.txt','original_xml':stem+'.original.xml',
                                  'country':r['country'],'damage_codes':sorted(codes),'source_image':r['source_image'],
                                  'original_size':[r['width'],r['height']],'original_sha256':r['image_sha256'],
                                  'change':'JPEG preview resized to fit 800x800, quality 88. Original XML is unchanged; YOLO boxes remain normalized.',
                                  'split':'train','license':'CC BY 4.0'})
            picked.update((r['country'],c) for c in codes)
    result={'status':'complete','scope':'Bounded class-enriched multinational development subset; not a representative road survey',
            'source_archive':'RDD2022 selected real pairs','seed':42,'class_mapping':CLASSES,'prepared_images':len(records),
            'splits':summary,'countries':audit['subsets'],'groups':{'count':len(groups),'largest_images':max(map(len,groups))},
            'conflicting_duplicates_excluded':excluded,'missing_classes_by_split':{s:[c for c,n in v['objects'].items() if not n] for s,v in summary.items()},
            'limitations':['Country/view labels only; Indian states not established.','Class-enriched sampling changes prevalence; internal metrics describe this subset.',
                           'Filename blocks, exact pixels and close thumbnails group identifiable related scenes, not proven route-disjointness.',
                           'No official unlabelled test images are used. No universal accuracy claim.'],
            'collection_audit_sha256':file_sha256(source/'collection-audit.json')}
    if prior:
        result['prior_manifest_sha256']=file_sha256(prior_manifest)
        result['prior_training_holdout_bridge_quarantine']=quarantined
        result['fresh_groups_reserved_for_final_test']=fresh_test_only
        result['missing_countries_by_split']={s:sorted(set(r['country'] for r in records)-set(v['countries'])) for s,v in summary.items()}
        result['holdout_policy']='Old training groups remain training; previously exposed validation/test groups become validation. Final test contains only newly collected groups without identified connections to any old image.'
    (output/'manifest.json').write_text(json.dumps(records,indent=2)+'\n')
    (output/'audit.json').write_text(json.dumps(result,indent=2)+'\n')
    (output/'data.yaml').write_text('path: '+json.dumps(str(output))+'\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n  0: D00\n  1: D10\n  2: D20\n  3: D40\n')
    if gallery:
        (gallery/'catalog.json').write_text(json.dumps(gallery_items,indent=2)+'\n')
        total=sum(p.stat().st_size for p in gallery.iterdir())
        if total>20*1024**2:raise ValueError('Git gallery exceeded 20 MiB budget')
    print(json.dumps(result,indent=2),flush=True)
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('--output',type=Path,required=True);p.add_argument('--gallery',type=Path)
    p.add_argument('--prior-manifest',type=Path)
    p.add_argument('--fresh-test-only',action='store_true',help='Reserve every wholly new group for the final test; validation uses previous untrained holdout groups')
    a=p.parse_args()
    if a.fresh_test_only and not a.prior_manifest:p.error('--fresh-test-only requires --prior-manifest')
    build(a.source,a.output,a.gallery,a.prior_manifest,a.fresh_test_only)
