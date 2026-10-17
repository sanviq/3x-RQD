#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export ROAD_HEALTH_DATA_DIR="${ROAD_HEALTH_DATA_DIR:-/var/data}"
export ROAD_HEALTH_PREVIEW_REGISTRY="${ROAD_HEALTH_PREVIEW_REGISTRY:-$ROAD_HEALTH_DATA_DIR/experimental-detector.json}"
export ROAD_HEALTH_DETECTOR_REGISTRY="${ROAD_HEALTH_DETECTOR_REGISTRY:-$ROAD_HEALTH_DATA_DIR/detector.json}"
# The persistent disk is available at runtime, not during the Docker build.
python -m tools.bootstrap_render
# One process keeps tracker/score sessions and SQLite consistent and bounds model RAM.
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}" --workers 1
