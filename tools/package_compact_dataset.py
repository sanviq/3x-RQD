"""Package selected original pairs for a GitHub Release without bloating Git history."""
import argparse
import json
from pathlib import Path
import zipfile

from tools.prepare_rdd2022 import file_sha256


def package(source,destination):
    source,destination=Path(source).resolve(),Path(destination).resolve()
    audit=json.loads((source/'collection-audit.json').read_text())
    if audit['status']!='complete':raise ValueError('Collection must be complete')
    if destination.exists():raise ValueError('Archive already exists; preserving it')
    destination.parent.mkdir(parents=True,exist_ok=True)
    files=[source/'collection-audit.json',*sorted(source.glob('*.inventory.json'))]
    for inventory in source.glob('*.inventory.json'):
        for item in json.loads(inventory.read_text()):
            for key,hash_key in [('raw_image','image_sha256'),('raw_xml','xml_sha256')]:
                path=source/item[key]
                if source not in path.resolve().parents or file_sha256(path)!=item[hash_key]:raise ValueError('Unsafe or changed raw file')
                files.append(path)
    if sum(p.stat().st_size for p in files)>700*1024**2:raise ValueError('Release data exceeds compact 700 MiB bound')
    notice='''RDD2022 COMPACT DEVELOPMENT SUBSET — REAL DATA

Source: https://figshare.com/articles/dataset/21431547
DOI: 10.6084/m9.figshare.21431547.v1
Dataset license: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
Attribution: Arya, D., Maeda, H., Ghosh, S. K., Toshniwal, D., and Sekimoto, Y. (2024).
RDD2022: A multi-national image dataset for automatic road damage detection.
Geoscience Data Journal 11(4), 846–862. See official source for all contributing authors.

Original selected JPEG images and VOC XML annotations are unchanged. Only a subset
was selected; this is not the complete official release or a representative road survey.
China includes drone and motorbike views. Indian state metadata is not established.
Unlabelled official test images are excluded. Four target classes: D00/D10/D20/D40.
Seeded class-enriched selection changes prevalence; report metrics only for the stated holdout.
Inventory SHA256 values identify each original file; archive CRCs were checked during collection.
No full-parent-archive MD5 verification is claimed for selective range retrieval.

Run tools.build_compact_dataset from 3x-RQD to reproduce grouped YOLO splits.
Do not train on held-out validation/test data or manually tune against their images.
https://github.com/sanviq/3x-RQD/tree/main/docs/datasets
'''
    temporary=destination.with_suffix('.zip.part')
    with zipfile.ZipFile(temporary,'w',allowZip64=True) as archive:
        archive.writestr('DATASET_LICENSE_AND_SOURCE.txt',notice)
        for path in sorted(set(files)):
            archive.write(path,str(path.relative_to(source)),compress_type=zipfile.ZIP_STORED if path.suffix.lower()=='.jpg' else zipfile.ZIP_DEFLATED)
    temporary.rename(destination)
    checksum=file_sha256(destination)
    destination.with_suffix('.zip.sha256').write_text(f'{checksum}  {destination.name}\n')
    print(json.dumps({'archive':str(destination),'bytes':destination.stat().st_size,'sha256':checksum},indent=2))
    return destination


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();package(a.source,a.output)
