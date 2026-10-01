#!/usr/bin/env bash
set -euo pipefail

export LAM_ROOT="${LAM_ROOT:-/workspace/src/LAM}"
export LAM_WORKER_DATA="${LAM_WORKER_DATA:-/workspace/lam-worker}"
export LAM_GRADIO_URL="${LAM_GRADIO_URL:-http://127.0.0.1:7860}"

if [[ -z "${LAM_WORKER_TOKEN:-}" && -f /workspace/lam-worker/token ]]; then
  LAM_WORKER_TOKEN="$(cat /workspace/lam-worker/token)"
  export LAM_WORKER_TOKEN
fi

exec /workspace/lam-env/bin/uvicorn worker:app \
  --app-dir /workspace/lam-worker/app \
  --host 0.0.0.0 \
  --port "${LAM_WORKER_PORT:-8888}"
