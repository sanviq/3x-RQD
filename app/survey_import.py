"""Review and atomically append explicit GPS inspection records; never overwrite."""
import json
from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from pydantic import ValidationError
from app.storage import SavedSegment, connection

router=APIRouter()
MAX_IMPORT_BYTES=10*1024*1024


def parse_records(data):
    if not isinstance(data,dict) or not isinstance(data.get('segments'),list):
        raise ValueError('Expected a JSON object with a segments array. Use Export local survey or the import format.')
    rows=data['segments']
    if not 1<=len(rows)<=200:raise ValueError('Import between 1 and 200 inspection records at a time.')
    records=[];ids=set()
    for i,row in enumerate(rows,1):
        if not isinstance(row,dict):raise ValueError(f'Record {i} must be an object.')
        if row.get('provenance') not in ('model','manual'):
            raise ValueError(f'Record {i}: live import requires explicit model or manual provenance. Demo records belong in Demo workspace.')
        # Derived exports are never accepted as trusted scores; recompute locally.
        raw={k:v for k,v in row.items() if k not in ('result','updated_at')}
        try:record=SavedSegment.model_validate(raw)
        except ValidationError as exc:
            first=exc.errors()[0]
            raise ValueError(f'Record {i}, '+'.'.join(map(str,first['loc']))+': '+first['msg']) from exc
        if not record.id.strip() or not record.name.strip():raise ValueError(f'Record {i}: segment ID and name cannot be blank.')
        if record.id in ids:raise ValueError(f'Duplicate segment ID in import: {record.id}')
        ids.add(record.id);records.append(record)
    return records


def review_or_save(data,save=False):
    records=parse_records(data)
    with connection() as db:
        if save:db.execute('BEGIN IMMEDIATE')
        existing={row[0] for row in db.execute('SELECT id FROM segments')}
        conflicts=sorted(existing.intersection(r.id for r in records))
        if conflicts:raise ValueError('Existing segment IDs would be overwritten: '+', '.join(conflicts[:10])+'. Rename the imported IDs; existing records are preserved.')
        if len(existing)+len(records)>200:raise ValueError('This import exceeds the local limit of 200 saved segments.')
        if save:
            db.executemany('INSERT INTO segments (id,payload) VALUES (?,?)',[(r.id,r.model_dump_json()) for r in records])
    return {'saved':save,'count':len(records),'defects':sum(len(r.assessment.defects) for r in records),
            'declared_distance_m':sum(r.length_m for r in records),
            'records':[{'id':r.id,'name':r.name,'latitude':r.latitude,'longitude':r.longitude,
                        'provenance':r.provenance,'defects':len(r.assessment.defects)} for r in records],
            'notice':'User-supplied inspection records. GPS, lengths and measurements are not independently verified. Imported scores are discarded and recalculated; model detections do not establish a road-health grade. Existing records are never overwritten.'}


async def read_import(request):
    raw=bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw)>MAX_IMPORT_BYTES:raise HTTPException(413,'Survey JSON exceeds the 10 MiB import limit.')
    try:return json.loads(raw)
    except (ValueError,UnicodeError) as exc:raise HTTPException(422,'Survey file must contain valid UTF-8 JSON.') from exc


async def handle_import(request,save):
    data=await read_import(request)
    try:return await run_in_threadpool(review_or_save,data,save)
    except ValueError as exc:raise HTTPException(422,str(exc)) from exc


@router.post('/segments/import/preview')
async def preview(request:Request):
    return await handle_import(request,False)


@router.post('/segments/import')
async def persist(request:Request):
    return await handle_import(request,True)
