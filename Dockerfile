FROM node:24-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    YOLO_AUTOINSTALL=false \
    YOLO_CONFIG_DIR=/tmp/Ultralytics \
    ROAD_HEALTH_DATA_DIR=/var/data \
    ROAD_HEALTH_PREVIEW_REGISTRY=/var/data/experimental-detector.json \
    ROAD_HEALTH_DETECTOR_REGISTRY=/var/data/detector.json
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt requirements-model.txt ./
# CPU wheels avoid installing CUDA libraries on this CPU-only web service.
RUN python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && python -m pip install -r requirements-model.txt
COPY . ./
COPY --from=frontend /build/frontend/dist ./frontend/dist
EXPOSE 10000
CMD ["sh", "scripts/start-render.sh"]
