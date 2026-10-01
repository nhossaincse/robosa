#!/usr/bin/env bash
set -euo pipefail

LAM_ROOT="${LAM_ROOT:-/workspace/src/LAM}"
LAM_ENV="${LAM_ENV:-/workspace/lam-env}"

export CUDA_HOME="$LAM_ENV"
export CPATH="$LAM_ENV/targets/x86_64-linux/include${CPATH:+:$CPATH}"
export CPLUS_INCLUDE_PATH="$LAM_ENV/targets/x86_64-linux/include${CPLUS_INCLUDE_PATH:+:$CPLUS_INCLUDE_PATH}"
export LIBRARY_PATH="$LAM_ENV/targets/x86_64-linux/lib${LIBRARY_PATH:+:$LIBRARY_PATH}"
export LD_LIBRARY_PATH="$LAM_ENV/targets/x86_64-linux/lib:$LAM_ENV/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export TORCH_EXTENSIONS_DIR="${TORCH_EXTENSIONS_DIR:-/workspace/cache/torch-extensions}"
export TORCH_HOME="${TORCH_HOME:-/workspace/cache/torch}"
export HF_HOME="${HF_HOME:-/workspace/cache/huggingface}"
export PATH="$LAM_ENV/bin:$PATH"

cd "$LAM_ROOT"
exec "$LAM_ENV/bin/python" app_lam.py \
  --blender_path "$LAM_ROOT/thirdparties/blender/blender"
