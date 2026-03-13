#!/usr/bin/env python3
"""
Prepare PaddleOCR recognition model for browser ONNX runtime.

What this script does:
1) Download Paddle inference tarball (model + params)
2) Extract model files
3) Download dictionary/charset file
4) Convert Paddle model to ONNX with paddle2onnx
5) Optionally copy outputs to ocrdeveloping/ocr/models as rec.onnx + charset.txt

Usage example:
  python3 ocrdeveloping/scripts/prepare_paddle_ocr_onnx.py \
    --model-url https://paddleocr.bj.bcebos.com/PP-OCRv3/english/en_PP-OCRv3_rec_infer.tar \
    --dict-url https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/en_dict.txt \
    --workdir /tmp/paddle_ocr_build \
    --output-dir ocrdeveloping/ocr/models \
    --final-onnx-name rec.onnx \
    --final-dict-name charset.txt

Prerequisites (from README_en / Paddle2ONNX flow):
  pip install paddle2onnx
  # plus compatible paddle runtime if required by your environment
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path


def log(msg: str) -> None:
    print(f"[prepare_ocr_onnx] {msg}")


def run(cmd: list[str], cwd: Path | None = None) -> None:
    log("$ " + " ".join(cmd))
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def download(url: str, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    log(f"Downloading: {url}")
    with urllib.request.urlopen(url) as response, out_path.open("wb") as f:
        shutil.copyfileobj(response, f)
    log(f"Saved: {out_path}")


def extract_tar(tar_path: Path, out_dir: Path) -> None:
  out_dir.mkdir(parents=True, exist_ok=True)
  log(f"Extracting: {tar_path} -> {out_dir}")
  with tarfile.open(tar_path, "r:*") as tar:
    try:
      tar.extractall(out_dir, filter="data")
    except TypeError:
      # Python versions that don't support the filter argument.
      tar.extractall(out_dir)


def find_model_files(search_dir: Path, model_name_hint: str | None) -> tuple[Path, Path]:
    model_candidates = sorted(search_dir.rglob("*.pdmodel")) + sorted(search_dir.rglob("*.json"))
    param_candidates = sorted(search_dir.rglob("*.pdiparams"))

    if model_name_hint:
        hint_models = [
            p for p in model_candidates
            if p.name in {f"{model_name_hint}.pdmodel", f"{model_name_hint}.json"}
        ]
        hint_params = [p for p in param_candidates if p.name == f"{model_name_hint}.pdiparams"]
        if hint_models and hint_params:
            return hint_models[0], hint_params[0]

    for j in model_candidates:
        stem = j.stem
        match = [p for p in param_candidates if p.stem == stem]
        if match:
            return j, match[0]

    raise FileNotFoundError(
        f"Could not find matching (*.pdmodel|*.json) and *.pdiparams under: {search_dir}\n"
        f"model candidates: {len(model_candidates)}, pdiparams candidates: {len(param_candidates)}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Download + convert PaddleOCR rec model to ONNX")
    parser.add_argument("--model-url", required=True, help="URL to Paddle inference tar (.tar)")
    parser.add_argument("--dict-url", required=True, help="URL to dictionary/charset txt")
    parser.add_argument("--workdir", default="/tmp/paddle_ocr_build", help="Temporary working directory")
    parser.add_argument("--output-dir", default="ocrdeveloping/ocr/models", help="Final output directory")
    parser.add_argument("--final-onnx-name", default="rec.onnx", help="Final ONNX filename")
    parser.add_argument("--final-dict-name", default="charset.txt", help="Final dictionary filename")
    parser.add_argument("--model-name-hint", default=None, help="Optional model base name hint")
    parser.add_argument("--onnx-opset", default="13", help="ONNX opset version for paddle2onnx")
    parser.add_argument("--skip-download", action="store_true", help="Skip downloading files")
    parser.add_argument("--skip-convert", action="store_true", help="Skip conversion and only place dict/files")
    parser.add_argument("--keep-workdir", action="store_true", help="Do not delete workdir at the end")

    args = parser.parse_args()

    workdir = Path(args.workdir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    download_dir = workdir / "downloads"
    extract_dir = workdir / "extracted"
    converted_dir = workdir / "converted"

    model_tar = download_dir / Path(args.model_url).name
    dict_txt = download_dir / Path(args.dict_url).name

    if workdir.exists() and not args.keep_workdir:
        shutil.rmtree(workdir, ignore_errors=True)

    download_dir.mkdir(parents=True, exist_ok=True)
    extract_dir.mkdir(parents=True, exist_ok=True)
    converted_dir.mkdir(parents=True, exist_ok=True)

    if not args.skip_download:
        download(args.model_url, model_tar)
        download(args.dict_url, dict_txt)
    else:
        if not model_tar.exists() or not dict_txt.exists():
            raise FileNotFoundError("--skip-download used but required files are missing in download dir")

    extract_tar(model_tar, extract_dir)

    model_json, model_params = find_model_files(extract_dir, args.model_name_hint)
    model_dir = model_json.parent

    log(f"Detected model file: {model_json}")
    log(f"Detected model params: {model_params}")

    out_onnx = converted_dir / "model.onnx"
    if not args.skip_convert:
        run([
            "paddle2onnx",
            "--model_dir", str(model_dir),
            "--model_filename", model_json.name,
            "--params_filename", model_params.name,
            "--save_file", str(out_onnx),
            "--opset_version", str(args.onnx_opset),
            "--enable_onnx_checker", "True",
        ])
    else:
        if not out_onnx.exists():
            raise FileNotFoundError("--skip-convert used but converted model not found")

    output_dir.mkdir(parents=True, exist_ok=True)
    final_onnx = output_dir / args.final_onnx_name
    final_dict = output_dir / args.final_dict_name

    shutil.copy2(out_onnx, final_onnx)
    shutil.copy2(dict_txt, final_dict)

    log(f"ONNX ready: {final_onnx}")
    log(f"DICT ready: {final_dict}")

    if not args.keep_workdir:
        shutil.rmtree(workdir, ignore_errors=True)
        log(f"Cleaned workdir: {workdir}")
    else:
        log(f"Kept workdir: {workdir}")

    log("Done.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"ERROR: command failed with exit code {exc.returncode}", file=sys.stderr)
        raise SystemExit(exc.returncode)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
