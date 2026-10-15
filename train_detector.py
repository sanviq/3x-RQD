"""Optional road-defect training entrypoint; never runs without an explicit dataset."""
import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description='Train a road-specific YOLO detector/segmenter on your labeled data.')
    parser.add_argument('dataset',type=Path,help='Local YOLO dataset YAML with route-disjoint train/val/test splits.')
    parser.add_argument('--base',required=True,type=Path,help='Trusted local YOLOv8 .pt base weights (detection or segmentation).')
    parser.add_argument('--epochs',type=int,default=100)
    parser.add_argument('--imgsz',type=int,default=640)
    parser.add_argument('--device',default='cpu',help='cpu, mps, or an explicitly selected GPU.')
    args = parser.parse_args()
    if not args.dataset.is_file() or not args.base.is_file():
        parser.error('Both dataset YAML and base weights must exist locally. Nothing is downloaded automatically.')
    if args.epochs < 1 or args.imgsz < 64:
        parser.error('Use positive epochs and imgsz >= 64.')
    try:
        from ultralytics import YOLO
    except ImportError:
        parser.error('Install requirements-model.txt first.')
    model = YOLO(str(args.base.resolve()))
    model.train(data=str(args.dataset.resolve()),epochs=args.epochs,imgsz=args.imgsz,device=args.device,project='runs/road-health',name='detector')
    print('Training finished. Inspect held-out metrics, class mapping and segmentation quality before configuring ROAD_HEALTH_MODEL.')


if __name__=='__main__':
    main()
