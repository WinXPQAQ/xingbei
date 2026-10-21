#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ml_root="${XINGBEI_ML_ROOT:-/home/xp/.local/share/xingbei-ml}"
ml_python="$ml_root/venv/bin/python"
mkdir -p "$ml_root/evidence" "$ml_root/runs"
for specification in '41 220400000' '73 220500000' '107 220600000'; do
  read -r model_seed game_seed <<< "$specification"
  run_directory="$ml_root/runs/pilot-v2-$model_seed"
  resume_args=()
  if [[ -f "$run_directory/checkpoint.pt" ]]; then
    resume_args=(--resume "$run_directory/checkpoint.pt")
  fi
  systemd-run --user --wait --pipe --unit="xingbei-ml-pilot-v2-$model_seed" \
    --property=MemoryMax=8G --property=CPUQuota=800% --property=RuntimeMaxSec=900 \
    --working-directory="$PWD" \
    /usr/bin/time -v -o "$ml_root/evidence/pilot-v2-$model_seed-resource.txt" \
    "$ml_python" training/train.py --output "$run_directory" \
    --seed "$model_seed" --first-seed "$game_seed" --updates 32 --warmup 4 \
    --games 24 --workers 4 --threads 2 --epochs 3 "${resume_args[@]}" \
    >> "$ml_root/evidence/pilot-v2-$model_seed.log" 2>&1
  "$ml_python" - "$run_directory/checkpoint.pt" <<'PY'
import sys, torch
saved = torch.load(sys.argv[1], map_location='cpu', weights_only=False)
if saved['completed'] != 32:
    raise SystemExit('Pilot stopped before its fixed budget; do not advance or call it complete')
print('Completed fixed-budget pilot:', saved['args']['seed'], flush=True)
PY
done
