"""Synthetic contract cases. These fixtures are not surveyed roads or accuracy evidence."""
import copy
import json
import pytest
from fastapi import HTTPException
from app import map_api as maps


def way(ident,nodes,geometry):
    return {"type":"way","id":ident,"nodes":nodes,"tags":{"highway":"residential","name":f"Fixture {ident}"},"geometry":[{"lon":p[0],"lat":p[1]} for p in geometry]}


def observed(score,defects=2,config="same"):
    return {"score":{"score":score,"config_sha256":config,"summary":{"included_count":defects,"by_type":{"Pothole":defects,"Crack":0,"Depression":None},"by_severity":{"Low":0,"Moderate":0,"High":defects}}}}


def test_real_shared_node_splits_way_without_inventing_crossings():
    a=way(1,[1,2,3],[[77,13],[77.001,13],[77.002,13]])
    b=way(2,[2,4],[[77.001,13],[77.001,13.001]])
    result=maps.osm_segments({"elements":[a,b]})
    assert len(result)==3
    assert {r["id"] for r in result}=={"osm-way-1-1-2","osm-way-1-2-3","osm-way-2-2-4"}
    assert all(r["length_m"]>0 and r["source"]=="openstreetmap" for r in result)


def test_crossing_without_shared_osm_node_is_not_a_junction():
    a=way(1,[1,2],[[77,13],[77.002,13]])
    b=way(2,[3,4],[[77.001,12.999],[77.001,13.001]])
    assert len(maps.osm_segments({"elements":[a,b]}))==2


def test_invalid_or_incomplete_geometry_and_duplicate_ways():
    a=way(1,[1,2],[[77,13],[77.001,13]])
    broken=way(2,[3,4],[[77,13]])
    assert len(maps.osm_segments({"elements":[a,a,broken]}))==1


def test_unknown_network_never_becomes_perfect_or_zero_quality():
    result=maps.summary([{"id":"a","length_m":100,"inspection":None}])
    assert result["average_quality"] is None
    assert result["defect_count"] is None
    assert result["not_inspected_segments"]==1
    assert result["represented_length_percent"]==0


def test_length_weighted_average_excludes_unknown_roads():
    rows=[{"length_m":100,"inspection":observed(20)},{"length_m":300,"inspection":observed(80)},{"length_m":600,"inspection":None}]
    result=maps.summary(rows)
    assert result["average_quality"]==65
    assert result["represented_length_percent"]==40
    assert result["defect_count"]==4
    assert "Depression" not in result["by_type"]


def test_mismatched_score_configs_withhold_network_average():
    result=maps.summary([{"length_m":100,"inspection":observed(20,config="a")},{"length_m":100,"inspection":observed(80,config="b")}])
    assert result["average_quality"] is None
    assert not result["comparable_configurations"]


@pytest.mark.parametrize("values",[
 {"south":13,"north":12,"west":77,"east":77.001},
 {"south":12,"north":13,"west":77,"east":78},
 {"south":float("nan"),"north":13,"west":77,"east":77.001},
])
def test_bounds_reject_large_reversed_and_nonfinite(values):
    with pytest.raises(ValueError):maps.Bounds(**values)


def test_declared_capture_distance_is_not_inferred_from_photo():
    assert maps.point_distance_m(13,77.0005,[[77,13],[77.001,13]])<1
    assert maps.point_distance_m(13.01,77.0005,[[77,13],[77.001,13]])>1000


def test_provider_cache_and_limit(monkeypatch,tmp_path):
    monkeypatch.setenv("ROAD_HEALTH_DATA_DIR",str(tmp_path))
    maps._cache.clear()
    class Reply:
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def read(self,size):return b'{"features":[]}'
    calls=[]
    def open_request(request,timeout):calls.append(request);return Reply()
    monkeypatch.setattr(maps.urllib.request,"urlopen",open_request)
    a,cached=maps.remote_json("geocoder","https://example.test",{"q":"fixture"},60)
    assert not cached
    _,cached=maps.remote_json("geocoder","https://example.test",{"q":"fixture"},60)
    assert cached and len(calls)==1
    with pytest.raises(HTTPException) as error:maps.remote_json("geocoder","https://example.test",{"q":"different"},60)
    assert error.value.status_code==429


def test_provider_failure_never_returns_demo_geometry(monkeypatch,tmp_path):
    monkeypatch.setenv("ROAD_HEALTH_DATA_DIR",str(tmp_path));maps._cache.clear()
    def fail(*a,**k):raise OSError("offline")
    monkeypatch.setattr(maps.urllib.request,"urlopen",fail)
    with pytest.raises(HTTPException) as e:maps.remote_json("overpass","https://example.test",{},60)
    assert e.value.status_code==503
    assert maps.network()["segments"]==[]


def test_http_remote_endpoint_requires_tls(monkeypatch):
    monkeypatch.setenv("TEST_MAP_URL","http://example.test")
    with pytest.raises(HTTPException):maps.configured_url("TEST_MAP_URL","")


def test_osm_api_fallback_joins_real_nodes_and_keeps_unknown_condition(monkeypatch, tmp_path):
    monkeypatch.setenv("ROAD_HEALTH_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ROAD_HEALTH_OVERPASS_URL", raising=False)
    monkeypatch.delenv("ROAD_HEALTH_OSM_FALLBACK", raising=False)
    calls = []
    def remote(provider, url, fields, ttl, **kwargs):
        calls.append(provider)
        if provider == "overpass":
            raise HTTPException(503, "Provider unavailable")
        assert url == "https://api.openstreetmap.org/api/0.6/map.json"
        assert fields["bbox"] == "77.000000,12.999000,77.002000,13.001000"
        return {"elements": [
            {"type": "node", "id": 1, "lon": 77, "lat": 13},
            {"type": "node", "id": 2, "lon": 77.001, "lat": 13},
            {"type": "way", "id": 10, "nodes": [1, 2], "tags": {"highway": "residential", "name": "Fixture road"}},
            {"type": "way", "id": 20, "nodes": [2, 999], "tags": {"highway": "residential"}},
        ]}, False
    monkeypatch.setattr(maps, "remote_json", remote)
    result = maps.roads(maps.Bounds(south=12.999, north=13.001, west=77, east=77.002))
    assert calls == ["overpass", "osm"]
    assert result["segments"][0]["id"] == "osm-way-10-1-2"
    assert len(result["segments"]) == 1  # incomplete way cannot invent a road
    assert result["segments"][0]["inspection"] is None
    assert result["summary"]["average_quality"] is None
    assert result["geometry_provider"] == "OpenStreetMap API"
    assert "Overpass is unavailable" in result["provider_notice"]


def test_custom_or_disabled_provider_is_not_silently_replaced(monkeypatch):
    monkeypatch.setenv("ROAD_HEALTH_OVERPASS_URL", "https://private.example/interpreter")
    monkeypatch.delenv("ROAD_HEALTH_OSM_MAP_URL", raising=False)
    calls = []
    def remote(provider, *a, **k):
        calls.append(provider)
        raise HTTPException(503, "Unavailable")
    monkeypatch.setattr(maps, "remote_json", remote)
    bounds = maps.Bounds(south=13, north=13.001, west=77, east=77.001)
    with pytest.raises(HTTPException): maps.road_geometry(bounds, "query")
    assert calls == ["overpass"]
    calls.clear()
    monkeypatch.delenv("ROAD_HEALTH_OVERPASS_URL")
    monkeypatch.setenv("ROAD_HEALTH_OSM_FALLBACK", "false")
    with pytest.raises(HTTPException): maps.road_geometry(bounds, "query")
    assert calls == ["overpass"]


def test_both_geometry_providers_failing_preserves_saved_inspection(monkeypatch, inspection_case):
    data, _ = inspection_case
    before = maps.save_inspection(data, "fixture-road", "test-token", [], 13, 77.0005, True, True)
    monkeypatch.delenv("ROAD_HEALTH_OVERPASS_URL", raising=False)
    monkeypatch.delenv("ROAD_HEALTH_OSM_FALLBACK", raising=False)
    calls = []
    def remote(provider, *a, **k):
        calls.append(provider)
        raise HTTPException(503, "Unavailable")
    monkeypatch.setattr(maps, "remote_json", remote)
    with pytest.raises(HTTPException):
        maps.roads(maps.Bounds(south=13, north=13.001, west=77, east=77.001))
    assert calls == ["overpass", "osm"]
    assert maps.network() == before


def test_location_confirmation_is_required():
    with pytest.raises(HTTPException) as e:maps.save_inspection(b"image","segment","token",[],13,77,False,False)
    assert e.value.status_code==422


def test_source_hash_must_match_actual_detection(monkeypatch):
    monkeypatch.setattr(maps,"snapshot",lambda token:{"metadata":{"sha256":"wrong"}})
    with pytest.raises(HTTPException) as e:maps.save_inspection(b"image","segment","token",[],13,77,True,False)
    assert e.value.status_code==409


@pytest.fixture
def inspection_case(monkeypatch,tmp_path):
    import cv2
    import numpy as np
    import hashlib
    from app import road_quality_score as q
    monkeypatch.setenv("ROAD_HEALTH_DATA_DIR",str(tmp_path))
    pixels=np.full((100,120,3),120,np.uint8)
    ok,encoded=cv2.imencode(".png",pixels);assert ok
    data=encoded.tobytes()
    defect={"id":"A","kind":"Pothole","polygon":[{"x":.3,"y":.3},{"x":.6,"y":.3},{"x":.6,"y":.6},{"x":.3,"y":.6}],"severity":.8,"confidence":.8,"provenance":"opencv_candidate"}
    detection={"image":{"width":120,"height":100},"road_quad":q.FULL_QUAD,"method":"opencv_multiscale_contours","defects":[defect]}
    record={"metadata":{"width":120,"height":100,"sha256":hashlib.sha256(data).hexdigest(),"source_file_unchanged":True,"quality":{"flags":[]}},"detection":detection,"config":q.ScoreSettings().model_dump(),"config_source":"untuned_defaults"}
    monkeypatch.setattr(maps,"snapshot",lambda token:copy.deepcopy(record))
    segment={"id":"fixture-road","name":"Fixture road — test only","length_m":100,"coordinates":[[77,13],[77.001,13]],"source":"openstreetmap"}
    with maps.database() as db:
        db.execute("INSERT INTO roads VALUES (?,?,?)",("fixture-road",json.dumps(segment),"fixture"))
        db.execute("INSERT INTO map_state VALUES ('batch','fixture')")
    return data,record


def test_save_uses_authoritative_score_and_preserves_native_metadata(inspection_case):
    data,record=inspection_case
    result=maps.save_inspection(data,"fixture-road","test-token",[],13,77.0005,True,True)
    saved=result["segments"][0]["inspection"]
    assert saved["evidence_verified"] is True
    assert saved["review_status"]=="user_reviewed"
    assert saved["source_width"]==120 and saved["source_height"]==100
    assert saved["score"]["score"]<100
    assert saved["outlined_preview"]!=saved["original_preview"]
    assert result["summary"]["average_quality"]==saved["score"]["score"]


def test_resaving_same_photo_and_exclusions_do_not_inflate_network(inspection_case):
    data,_=inspection_case
    maps.save_inspection(data,"fixture-road","test-token",[],13,77.0005,True,False)
    result=maps.save_inspection(data,"fixture-road","test-token",["A"],13,77.0005,True,True)
    assert result["summary"]["defect_count"]==0
    assert result["summary"]["inspected_segments"]==1
    with maps.database() as db:assert db.execute("SELECT count(*) FROM inspections").fetchone()[0]==1


def test_rejects_remote_location_and_foreign_exclusions(inspection_case):
    data,_=inspection_case
    with pytest.raises(HTTPException) as a:maps.save_inspection(data,"fixture-road","token",[],13.02,77.0005,True,False)
    assert a.value.status_code==422
    with pytest.raises(HTTPException) as b:maps.save_inspection(data,"fixture-road","token",["foreign"],13,77.0005,True,False)
    assert b.value.status_code==422


def test_road_ids_are_independent_of_other_ways_in_view():
    a=way(1,[1,2,3],[[77,13],[77.001,13],[77.002,13]])
    b=way(2,[2,4],[[77.001,13],[77.001,13.001]])
    alone=maps.osm_segments({"elements":[a]})
    connected=maps.osm_segments({"elements":[a,b]})
    assert {r["id"] for r in alone}=={r["id"] for r in connected if r["osm_way_id"]=="1"}


def test_viewport_filters_real_edges_without_changing_coordinates_or_ids():
    a=way(1,[1,2,3],[[77,13],[77.001,13],[77.002,13]])
    bounds=maps.Bounds(south=12.9999,north=13.0001,west=77.0015,east=77.0021)
    roads=maps.osm_segments({"elements":[a]},bounds)
    assert len(roads)==1
    assert roads[0]["coordinates"]==[[77.001,13],[77.002,13]]
    assert roads[0]["id"]=="osm-way-1-2-3"
