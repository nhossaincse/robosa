#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${LAM_WORKER_APP_DIR:-/workspace/lam-worker/app}"
LAM_ROOT="${LAM_ROOT:-/workspace/src/LAM}"
LOG_DIR="${LAM_LOG_DIR:-/workspace/logs}"
DRIVER_NAME="I_Am_Iron_Man"
DRIVER_KEY="workspacesrcLAMassetssample_motionexportI_Am_Iron_ManI_Am_Iron_Man"
DRIVER_DIR="$LAM_ROOT/assets/sample_motion/export/$DRIVER_NAME"

mkdir -p "$LOG_DIR" /workspace/lam-worker/jobs

# Gradio 3 sanitizes local upload paths into this key. Keep LAM's bundled
# driver discoverable under both its source name and the sanitized name.
ln -sfn "$DRIVER_NAME" "$LAM_ROOT/assets/sample_motion/export/$DRIVER_KEY"
ln -sfn "$DRIVER_NAME.wav" "$DRIVER_DIR/$DRIVER_KEY.wav"

if ! curl -fsS http://127.0.0.1:7860/ >/dev/null 2>&1; then
  setsid -f "$APP_DIR/start-lam.sh" > "$LOG_DIR/lam-gradio.log" 2>&1
fi

for _ in $(seq 1 36); do
  if curl -fsS http://127.0.0.1:7860/ >/dev/null 2>&1; then
    exec "$APP_DIR/start-worker.sh"
  fi
  sleep 5
done

echo "LAM did not become ready within 180 seconds." >&2
exit 1
