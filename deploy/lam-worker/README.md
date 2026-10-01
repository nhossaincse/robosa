# Robosa LAM Worker

This directory wraps upstream LAM's Gradio application with a small,
authenticated FastAPI job service. Robosa sends a consented portrait, polls the
job, imports the resulting LAM ZIP into its private store, and deletes the
completed worker job.

This worker is for noncommercial evaluation with the released LAM weights. See
[Avatar and Lip-Sync Pipeline](../../docs/ROBOSA-AVATAR-PIPELINE.md#licensing).

## Hardware

A practical evaluation pod has:

- NVIDIA CUDA GPU with at least 24 GB VRAM
- 30 GB or more system RAM
- 4 or more vCPUs
- 50 GB or more persistent storage mounted at `/workspace`

The worker has been exercised on a 24 GB GPU. A 48 GB GPU gives more headroom
for model loading and experimentation. CUDA/PyTorch compatibility matters more
than the marketing name of the GPU.

Persistent storage is strongly recommended. Without it, stopping or deleting a
pod loses the LAM checkout, environment, model downloads, token, logs, and any
worker artifacts that Robosa has not imported yet. Once an artifact is present
under Robosa's local `.robosa-data/avatars/`, that local copy no longer depends
on the pod.

## Expected filesystem

```text
/workspace/
  src/LAM/                 upstream LAM checkout and weights
  lam-env/                 Python/CUDA environment used by LAM
  cache/                   Torch and Hugging Face caches
  lam-worker/
    token                  bearer token, mode 0600
    jobs/                  temporary job records and artifacts
    app/                   this directory's files
  logs/
```

The launch scripts can be relocated with environment variables, but these
defaults match the tested RunPod layout.

## Installation outline

1. Create a GPU pod with persistent `/workspace` storage and expose HTTP port
   `8888`.
2. Install upstream LAM and its released models under `/workspace/src/LAM`
   following the upstream instructions.
3. Create `/workspace/lam-env` with the CUDA/PyTorch versions required by LAM.
4. Copy this directory to `/workspace/lam-worker/app`.
5. Install the wrapper requirements into the same environment.
6. Apply `lam-app.patch` to the upstream checkout if the export path fix is not
   already present.
7. Create a private bearer token and start both services.

Example wrapper setup after LAM itself works:

```bash
mkdir -p /workspace/lam-worker/app /workspace/logs
cd /workspace/lam-worker/app
/workspace/lam-env/bin/pip install -r requirements.txt
chmod +x start-lam.sh start-worker.sh start-services.sh

cd /workspace/src/LAM
git apply --check /workspace/lam-worker/app/lam-app.patch && \
  git apply /workspace/lam-worker/app/lam-app.patch

umask 077
openssl rand -hex 32 > /workspace/lam-worker/token
```

If `git apply --check` reports that the patch is already applied, do not apply
it again.

## Start

Use this as the RunPod start command:

```bash
/workspace/lam-worker/app/start-services.sh
```

`start-services.sh` starts upstream LAM on loopback port `7860`, waits up to
three minutes for it, and then starts the public worker API on port `8888`.
Logs are written to `/workspace/logs/lam-gradio.log`; the worker process logs to
the pod console unless redirected by the platform.

Useful overrides:

| Variable             | Default                                   |
| -------------------- | ----------------------------------------- |
| `LAM_ROOT`           | `/workspace/src/LAM`                      |
| `LAM_ENV`            | `/workspace/lam-env`                      |
| `LAM_WORKER_APP_DIR` | `/workspace/lam-worker/app`               |
| `LAM_WORKER_DATA`    | `/workspace/lam-worker`                   |
| `LAM_LOG_DIR`        | `/workspace/logs`                         |
| `LAM_GRADIO_URL`     | `http://127.0.0.1:7860`                   |
| `LAM_WORKER_PORT`    | `8888`                                    |
| `LAM_WORKER_TOKEN`   | contents of `/workspace/lam-worker/token` |

## Connect Robosa

Add the proxied worker origin and token file to Robosa's `.env`:

```dotenv
ROBOSA_LAM_WORKER_URL=https://POD_ID-8888.proxy.runpod.net
ROBOSA_LAM_WORKER_TOKEN_FILE=.robosa-data/lam-worker-token
```

Store the same token locally:

```bash
mkdir -p .robosa-data
chmod 700 .robosa-data
printf '%s\n' 'WORKER_TOKEN' > .robosa-data/lam-worker-token
chmod 600 .robosa-data/lam-worker-token
```

Restart Robosa after changing `.env`.

## Verify

Health does not require authentication:

```bash
curl https://POD_ID-8888.proxy.runpod.net/health
```

Expected shape:

```json
{
  "status": "ok",
  "generator": "lam-20k",
  "queueDepth": 0
}
```

All `/v1/avatar-jobs` endpoints require:

```http
Authorization: Bearer <token>
```

The application normally calls them through `server/providers/robosa/lamWorker.js`.
The full request and response contract is documented in
[Avatar and Lip-Sync Pipeline](../../docs/ROBOSA-AVATAR-PIPELINE.md#worker-contract).

## Job behavior

- Jobs are processed serially by one background thread.
- Job records and completed artifacts survive worker restarts on persistent
  storage.
- Jobs that were queued or running during a restart are marked failed.
- Uploaded portraits are deleted after generation.
- LAM tracking intermediates are deleted after each job.
- Completed artifacts remain until Robosa imports and deletes the job.
- Running jobs cannot be deleted through the API.

## Stop or delete the pod

It is safe to stop or delete the GPU pod after Robosa has imported the result.
Confirm the profile reports a ready LAM avatar and that the corresponding ZIP
exists in Robosa's `.robosa-data/avatars/` first.

Stopping preserves `/workspace` only when it is backed by a persistent volume.
Deleting the pod preserves data only if the volume is independent and retained
by the platform. Robosa's already imported local ZIP is unaffected.

## Security

- Use a random token with at least 32 bytes of entropy.
- Never place the token in source control or a public notebook.
- Expose only the worker port; keep Gradio port `7860` on loopback.
- Use the platform HTTPS proxy or a TLS reverse proxy.
- Rotate the token after sharing logs, terminals, or pod snapshots.
- Treat portraits and generated avatars as sensitive personal data.
- Delete failed and abandoned jobs according to a retention policy.

The worker is intentionally narrow, but it is not a hardened multi-tenant GPU
service. Add queue isolation, quotas, structured auditing, archive bomb checks,
monitoring, and automated retention before production use.
