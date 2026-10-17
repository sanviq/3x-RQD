"""Real OSM geometry and evidence-bound inspection analytics. No demo fallbacks."""
import base64
import copy
import hashlib
import json
import logging
import math
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.concurrency import run_in_threadpool
from app.features import MAX_BYTES, decode_image
from app.road_quality_score import snapshot, calculate, ScoreSettings

router = APIRouter(prefix="/map", tags=["Inspection map"])
ATTRIBUTION = "© OpenStreetMap contributors · ODbL"
USER_AGENT = "RoadHealth/1.0 (+https://github.com/sanviq/3x-RQD)"
_cache = {}
_provider_lock = threading.Lock()
MAX_SEGMENTS = 3000


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def provider_slot():
    if not _provider_lock.acquire(blocking=False):
        raise HTTPException(429, "A map provider request is already running. Retry shortly.", headers={"Retry-After":"2"})
    try:
        yield
    finally:
        _provider_lock.release()


@contextmanager
def database():
    root = Path(os.environ.get("ROAD_HEALTH_DATA_DIR", str(Path(__file__).resolve().parents[1] / ".local-road-health")))
    root.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(root / "map.sqlite3", timeout=20)
    try:
        with db:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("CREATE TABLE IF NOT EXISTS roads (id TEXT PRIMARY KEY, geometry TEXT NOT NULL, batch TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS inspections (id INTEGER PRIMARY KEY AUTOINCREMENT, segment_id TEXT NOT NULL REFERENCES roads(id), source_hash TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, created TEXT NOT NULL)")
            db.execute("CREATE INDEX IF NOT EXISTS map_inspection_segment ON inspections(segment_id,id DESC)")
            db.execute("CREATE TABLE IF NOT EXISTS map_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS provider_clock (key TEXT PRIMARY KEY, used REAL NOT NULL)")
            yield db

    finally:
        db.close()


def configured_url(name, default):
    value = os.environ.get(name, default).strip()
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")):
        raise HTTPException(503, "Map providers require HTTPS (HTTP allowed only for a local service).")
    return value


def remote_json(provider, url, fields, ttl, post=False, timeout=30):
    """Only admin-configured URLs; serialized, shared SQLite throttle, bounded cache/body."""
    key = (provider, url, json.dumps(fields, sort_keys=True))
    with provider_slot():
        entry = _cache.get(key)
        if entry and time.monotonic() - entry[0] < ttl:
            return copy.deepcopy(entry[1]), True
        # Cross-worker throttle. Do not queue automatic retries or sleeping requests.
        with database() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT used FROM provider_clock WHERE key=?", (provider,)).fetchone()
            interval = 2 if provider in ("overpass", "osm") else 1.1
            if row and time.time() - row[0] < interval:
                raise HTTPException(429, "Map service is busy. Wait before trying again.", headers={"Retry-After": str(max(2,math.ceil(interval-time.time()+row[0])))})
            db.execute("INSERT OR REPLACE INTO provider_clock VALUES (?,?)", (provider, time.time()))
        encoded = urllib.parse.urlencode(fields)
        headers = {"User-Agent": os.environ.get("ROAD_HEALTH_MAP_USER_AGENT", USER_AGENT), "Accept": "application/json"}
        token = os.environ.get("ROAD_HEALTH_" + provider.upper() + "_API_KEY")
        if token:
            headers["Authorization"] = "Bearer " + token
        if post:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        request = urllib.request.Request(url if post else url + ("&" if "?" in url else "?") + encoded,
                                         data=encoded.encode() if post else None, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read(8 * 1024 * 1024 + 1)
            if len(body) > 8 * 1024 * 1024:
                raise HTTPException(413, "Road response is too large. Zoom into a smaller area.")
            result = json.loads(body)
            if not isinstance(result, dict) or result.get("remark") or not isinstance(result.get("elements" if provider in ("overpass", "osm") else "features"),list):
                raise ValueError("Provider returned incomplete data")
        except (OSError, ValueError, urllib.error.URLError) as exc:
            logging.getLogger(__name__).warning("%s request failed: %s (HTTP %s)", provider, type(exc).__name__, getattr(exc, "code", "unavailable"))
            status = getattr(exc, "code", None)
            if status in (429,406):
                with database() as db:
                    db.execute("INSERT OR REPLACE INTO provider_clock VALUES (?,?)",(provider,time.time()+30))
            raise HTTPException(503, "The map data provider is unavailable" + (f" (HTTP {status})" if status else "") + ". Your inspections are preserved; retry or configure another provider.") from exc
        if len(_cache) >= 64:
            del _cache[min(_cache, key=lambda k: _cache[k][0])]
        _cache[key] = (time.monotonic(), result)
        return copy.deepcopy(result), False


def osm_map_geometry(data):
    """Join real OSM API node references, preserving the same way/node identities."""
    nodes = {e.get("id"): e for e in data["elements"] if isinstance(e, dict) and e.get("type") == "node"}
    ways = []
    for element in data["elements"]:
        if not isinstance(element, dict) or element.get("type") != "way" or not element.get("tags", {}).get("highway"):
            continue
        refs = element.get("nodes", [])
        # Never bridge a missing node or create substitute coordinates.
        if len(refs) < 2 or any(n not in nodes for n in refs):
            continue
        ways.append({**element, "geometry": [{"lat": nodes[n].get("lat"), "lon": nodes[n].get("lon")} for n in refs]})
    return {"elements": ways}


def road_geometry(bounds, query):
    primary = configured_url("ROAD_HEALTH_OVERPASS_URL", "https://overpass-api.de/api/interpreter")
    try:
        data, cached = remote_json("overpass", primary, {"data": query}, 3600, timeout=8)
        return data, cached, "Overpass", ""
    except HTTPException as exc:
        # An explicitly configured private service is not silently replaced.
        fallback_enabled = os.environ.get("ROAD_HEALTH_OSM_FALLBACK", "true").lower() == "true"
        if exc.status_code != 503 or not fallback_enabled or (primary != "https://overpass-api.de/api/interpreter" and "ROAD_HEALTH_OSM_MAP_URL" not in os.environ):
            raise
    if bounds.north - bounds.south > .02 or bounds.east - bounds.west > .02:
        raise HTTPException(503, "Road-line service unavailable. Zoom into a smaller area (under 0.02 degrees) and load roads again. Saved inspections are preserved.")
    url = configured_url("ROAD_HEALTH_OSM_MAP_URL", "https://api.openstreetmap.org/api/0.6/map.json")
    bbox = f"{bounds.west:.6f},{bounds.south:.6f},{bounds.east:.6f},{bounds.north:.6f}"
    data, cached = remote_json("osm", url, {"bbox": bbox}, 3600, timeout=15)
    return osm_map_geometry(data), cached, "OpenStreetMap API", "Road lines loaded from OpenStreetMap's small-area API because Overpass is unavailable. Roads remain Not inspected until you link a capture."


class Bounds(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    south: float = Field(ge=-85, le=85)
    west: float = Field(ge=-180, le=180)
    north: float = Field(ge=-85, le=85)
    east: float = Field(ge=-180, le=180)

    @model_validator(mode="after")
    def small_area(self):
        if not self.south < self.north or not self.west < self.east:
            raise ValueError("Use ordered bounds without an antimeridian crossing.")
        if self.north - self.south > .04 or self.east - self.west > .04:
            raise ValueError("Zoom in: load at most 0.04 degrees in each direction.")
        return self


def length_m(points):
    total = 0.
    for a, b in zip(points, points[1:]):
        p, q = math.radians(b[1] - a[1]), math.radians(b[0] - a[0])
        h = math.sin(p / 2) ** 2 + math.cos(math.radians(a[1])) * math.cos(math.radians(b[1])) * math.sin(q / 2) ** 2
        total += 6371008.8 * 2 * math.atan2(math.sqrt(h), math.sqrt(max(0., 1-h)))
    return total


def intersects_bounds(a,b,bounds):
    # Liang-Barsky intersection test. Retain real OSM endpoints; never invent node IDs.
    dx,dy=b[0]-a[0],b[1]-a[1]
    lo,hi=0.,1.
    for p,q in zip((-dx,dx,-dy,dy),(a[0]-bounds.west,bounds.east-a[0],a[1]-bounds.south,bounds.north-a[1])):
        if abs(p)<1e-15:
            if q<0:return False
        else:
            t=q/p
            if p<0:lo=max(lo,t)
            else:hi=min(hi,t)
            if lo>hi:return False
    return True


def osm_segments(data, bounds=None):
    """Stable node-pair road edges; IDs never change merely because the viewport changes."""
    allowed = {"motorway","trunk","primary","secondary","tertiary","unclassified","residential","living_street","service","motorway_link","trunk_link","primary_link","secondary_link","tertiary_link"}
    ways = list({w["id"]: w for w in data.get("elements", []) if w.get("type") == "way" and isinstance(w.get("id"),int) and w.get("tags", {}).get("highway") in allowed}.values())
    roads = []
    for w in ways:
        nodes, geometry = w.get("nodes", []), w.get("geometry", [])
        if not isinstance(nodes,list) or not isinstance(geometry,list) or len(nodes) != len(geometry) or len(nodes) < 2 or any(not isinstance(p,dict) for p in geometry):
            continue
        points = [[p.get("lon"), p.get("lat")] for p in geometry]
        if any(not isinstance(v, (float, int)) or not math.isfinite(v) for p in points for v in p):
            continue
        if any(abs(p[0]) > 180 or abs(p[1]) > 85 for p in points):
            continue
        tags = w.get("tags", {})
        for i in range(1, len(nodes)):
            start = i-1
            line = points[start:i+1]
            if bounds and not intersects_bounds(line[0],line[1],bounds):
                continue
            distance = length_m(line)
            if distance > .1:
                roads.append({"id": f"osm-way-{w['id']}-{nodes[start]}-{nodes[i]}", "name": tags.get("name", tags.get("ref", "Unnamed " + tags["highway"] + " road"))[:160],
                              "coordinates": line, "length_m": distance, "source": "openstreetmap", "osm_way_id": str(w["id"]),
                              "start_node": str(nodes[start]), "end_node": str(nodes[i]), "highway": tags["highway"],
                              "oneway": tags.get("oneway", "no"), "bridge": tags.get("bridge", "no"), "layer": tags.get("layer", "0")})
            if len(roads) > MAX_SEGMENTS:
                raise HTTPException(413, "Too many road segments. Zoom into a smaller area.")
    # Invalid duplicate ways never count twice in the network.
    return list({r["id"]: r for r in roads}.values())


def summary(segments):
    inspected = [s for s in segments if s.get("inspection")]
    valid = [s for s in inspected if isinstance(s["inspection"].get("score", {}).get("score"), (float, int))]
    total = sum(s["length_m"] for s in segments)
    represented = sum(s["length_m"] for s in valid)
    scores = [s["inspection"]["score"] for s in valid]
    by_type, by_severity = {}, {"Low": 0, "Moderate": 0, "High": 0}
    for score in scores:
        for kind, count in score["summary"]["by_type"].items():
            if count is not None:
                by_type[kind] = by_type.get(kind, 0) + count
        for kind, count in score["summary"]["by_severity"].items():
            by_severity[kind] = by_severity.get(kind, 0) + count
    configs = {s["config_sha256"] for s in scores}
    comparable = len(configs) <= 1
    return {"segment_count": len(segments), "inspected_segments": len(valid), "not_inspected_segments": len(segments)-len(valid),
            "mapped_length_m": total, "represented_segment_length_m": represented,
            "represented_length_percent": represented/total*100 if total else 0,
            "average_quality": round(sum(s["length_m"]*s["inspection"]["score"]["score"] for s in valid)/represented, 1) if represented and comparable else None,
            "comparable_configurations": comparable, "defect_count": sum(s["summary"]["included_count"] for s in scores) if scores else None,
            "by_type": by_type, "by_severity": by_severity,
            "needs_attention": sum(s["score"] < 55 for s in scores), "provisional": True,
            "methodology": "Length-weighted mean of latest evidence-backed scores on inspected segments only. Segment length is not photographed coverage. Counts are latest-image candidates, not a census. Unknown roads are excluded. Different scoring configurations are not averaged."}


def network():
    with database() as db:
        state = db.execute("SELECT value FROM map_state WHERE key='batch'").fetchone()
        rows = db.execute("SELECT r.geometry, i.payload FROM roads r LEFT JOIN inspections i ON i.id=(SELECT id FROM inspections WHERE segment_id=r.id ORDER BY id DESC LIMIT 1) WHERE r.batch=? OR i.id IS NOT NULL ORDER BY r.id", (state[0] if state else "",)).fetchall()
    segments = [{**json.loads(r[0]), "inspection": json.loads(r[1]) if r[1] else None} for r in rows]
    return {"segments": segments, "summary": summary(segments), "attribution": ATTRIBUTION}


@router.get("/config")
def configuration():
    try:
        latitude = float(os.environ.get("ROAD_HEALTH_MAP_LATITUDE", "12.9716"))
        longitude = float(os.environ.get("ROAD_HEALTH_MAP_LONGITUDE", "77.5946"))
        if not math.isfinite(latitude + longitude) or abs(latitude) > 85 or abs(longitude) > 180:
            raise ValueError()
    except ValueError as exc:
        raise HTTPException(503, "Invalid default map coordinates.") from exc
    tile_url = configured_url("ROAD_HEALTH_TILE_URL", "https://tile.openstreetmap.org/{z}/{x}/{y}.png")
    # Tile keys are browser-visible public credentials only. Server tokens never leave this module.
    tile_url = tile_url.replace("{apikey}", urllib.parse.quote(os.environ.get("ROAD_HEALTH_TILE_PUBLIC_KEY", ""), safe=""))
    return {"center": [latitude, longitude], "location_label": os.environ.get("ROAD_HEALTH_MAP_LOCATION", "Bengaluru · default map view, not an inspection location"),
            "tile_url": tile_url, "tile_attribution": os.environ.get("ROAD_HEALTH_TILE_ATTRIBUTION", ATTRIBUTION), "max_zoom": 19,
            "attribution": ATTRIBUTION, "search_provider": "Photon", "geometry_provider": "Overpass",
            "notice": "Map imagery and road geometry do not establish pavement condition. Public services are best effort; searches and road downloads are bounded and cached."}


@router.get("/search")
def search(q: str = Query(min_length=2, max_length=160)):
    text = " ".join(q.split())
    if len(text) < 2:
        raise HTTPException(422, "Enter a location name.")
    url = configured_url("ROAD_HEALTH_GEOCODER_URL", "https://photon.komoot.io/api/")
    data, cached = remote_json("geocoder", url, {"q": text, "limit": 5}, 86400)
    results = []
    for f in data.get("features", [])[:5]:
        p, g = f.get("properties", {}), f.get("geometry", {})
        xy = g.get("coordinates", [])
        if g.get("type") != "Point" or len(xy) != 2 or not all(isinstance(v,(int,float)) and math.isfinite(v) for v in xy) or abs(xy[0])>180 or abs(xy[1])>85:
            continue
        label = ", ".join(dict.fromkeys(str(p[k]) for k in ("name", "street", "city", "state", "country") if p.get(k)))
        results.append({"label": label[:300], "latitude": xy[1], "longitude": xy[0]})
    return {"results": results, "cached": cached, "attribution": ATTRIBUTION}


@router.post("/roads")
def roads(bounds: Bounds):
    # Query fixed road classes only. No user-supplied Overpass program.
    b = bounds
    query = f'[out:json][timeout:20];way["highway"]({b.south:.6f},{b.west:.6f},{b.north:.6f},{b.east:.6f});out body geom;'
    data, cached, provider, notice = road_geometry(bounds, query)
    segments = osm_segments(data, bounds)
    if sum(len(s["coordinates"]) for s in segments) > 40000:
        raise HTTPException(413, "Too much geometry. Zoom into a smaller area.")
    batch = hashlib.sha256(query.encode()).hexdigest()
    with database() as db:
        for s in segments:
            db.execute("INSERT INTO roads VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET geometry=excluded.geometry,batch=excluded.batch", (s["id"], json.dumps(s), batch))
        db.execute("INSERT OR REPLACE INTO map_state VALUES ('batch',?)", (batch,))
        db.execute("DELETE FROM roads WHERE batch<>? AND id NOT IN (SELECT segment_id FROM inspections)", (batch,))
    return {**network(), "cached": cached, "loaded_segments": len(segments), "bounds": bounds.model_dump(), "fetched_at": now(),
            "geometry_provider": provider, "provider_notice": notice}


@router.get("/network")
def saved_network():
    return network()


def point_distance_m(latitude, longitude, coordinates):
    scale = math.cos(math.radians(latitude))
    line = [((p[0]-longitude)*111195*scale, (p[1]-latitude)*111195) for p in coordinates]
    distances = []
    for a,b in zip(line,line[1:]):
        dx,dy = b[0]-a[0],b[1]-a[1]
        t = max(0.,min(1.,-(a[0]*dx+a[1]*dy)/max(1e-12,dx*dx+dy*dy)))
        distances.append(math.hypot(a[0]+t*dx,a[1]+t*dy))
    return min(distances, default=float("inf"))


def save_inspection(data, segment_id, score_token, excluded, latitude, longitude, location_confirmed, reviewed):
    if not location_confirmed:
        raise HTTPException(422, "Confirm that the capture belongs to this road segment.")
    if not math.isfinite(latitude+longitude) or abs(latitude)>85 or abs(longitude)>180:
        raise HTTPException(422, "Invalid capture coordinates.")
    record = snapshot(score_token)
    if hashlib.sha256(data).hexdigest() != record["metadata"]["sha256"]:
        raise HTTPException(409, "This image does not match the detector evidence. Detect the current image again.")
    with database() as db:
        row = db.execute("SELECT geometry FROM roads WHERE id=?", (segment_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Load and select a mapped segment first.")
    segment = json.loads(row[0])
    if point_distance_m(latitude,longitude,segment["coordinates"]) > 100:
        raise HTTPException(422, "The declared capture is over 100 m from this segment. Select the correct road or correct its coordinates.")
    try:
        score = calculate(record["detection"], record["metadata"], excluded, ScoreSettings.model_validate(record["config"]), record["config_source"])
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    score["snapshot_id"] = score_token
    image = decode_image(data)
    # Native coordinate overlays, then a separate bounded evidence preview. Never rewrite the upload.
    outlined = image.copy()
    h,w = image.shape[:2]
    for d in record["detection"]["defects"]:
        if d["id"] in excluded:
            continue
        polygon = np.rint([[p["x"]*(w-1),p["y"]*(h-1)] for p in d["polygon"]]).astype(np.int32)
        color = (68,76,185) if d["severity"]>=.67 else (65,154,202) if d["severity"]>=.34 else (122,145,87)
        cv2.polylines(outlined,[polygon],True,color,max(1,round(w/400)))
    def preview(pixels):
        ph,pw=pixels.shape[:2]
        if max(ph,pw)>1200:
            pixels=cv2.resize(pixels,(round(pw*1200/max(ph,pw)),round(ph*1200/max(ph,pw))),interpolation=cv2.INTER_AREA)
        ok, encoded = cv2.imencode(".jpg",pixels,[cv2.IMWRITE_JPEG_QUALITY,85])
        if not ok:
            raise HTTPException(500,"Could not encode evidence preview.")
        return "data:image/jpeg;base64,"+base64.b64encode(encoded).decode()
    payload={"score":score,"analyzed_at":score["generated_at"],"saved_at":now(),"latitude":latitude,"longitude":longitude,
             "source_hash":record["metadata"]["sha256"],"source_width":w,"source_height":h,
             "evidence_verified":True,"review_status":"user_reviewed" if reviewed else "unreviewed",
             "location_source":"user_confirmed_map_assignment","detector_method":record["detection"]["method"],
             "original_preview":preview(image),"outlined_preview":preview(outlined),
             "scope":"One photo sample assigned to this segment; neither full-length coverage nor engineering validation."}
    with database() as db:
        # Preserve the trusted fetched geometry if another viewport was loaded while scoring.
        db.execute("INSERT INTO roads VALUES (?,?,?) ON CONFLICT(id) DO NOTHING",(segment_id,json.dumps(segment),"inspection"))
        # A source image belongs to one observation. Reruns/reviews replace it, not inflate totals.
        db.execute("DELETE FROM inspections WHERE source_hash=?",(payload["source_hash"],))
        db.execute("INSERT INTO inspections(segment_id,source_hash,payload,created) VALUES (?,?,?,?)",(segment_id,payload["source_hash"],json.dumps(payload),now()))
    return network()


@router.post("/inspections")
async def attach_inspection(image:UploadFile=File(...),segment_id:str=Form(min_length=1,max_length=160),score_token:str=Form(min_length=20,max_length=80),
                            excluded_ids:str=Form("[]"),latitude:float=Form(ge=-85,le=85),longitude:float=Form(ge=-180,le=180),
                            location_confirmed:bool=Form(False),reviewed:bool=Form(False)):
    try:
        data=await image.read(MAX_BYTES+1)
    finally:
        await image.close()
    if len(data)>MAX_BYTES:
        raise HTTPException(413,"Image exceeds 12 MiB.")
    try:
        ids=json.loads(excluded_ids)
        if not isinstance(ids,list) or len(ids)>80 or any(not isinstance(v,str) for v in ids) or len(set(ids))!=len(ids):
            raise ValueError()
    except (ValueError,TypeError) as exc:
        raise HTTPException(422,"Use a unique list of excluded defect IDs.") from exc
    return await run_in_threadpool(save_inspection,data,segment_id,score_token,ids,latitude,longitude,location_confirmed,reviewed)
