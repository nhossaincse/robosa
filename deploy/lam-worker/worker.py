"""Small authenticated job API for a self-hosted LAM evaluation worker."""

from __future__ import annotations

import hashlib
import json
import os
import queue
import secrets
import shutil
import threading
import traceback
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from gradio_client import Client
from PIL import Image


LAM_ROOT = Path(os.environ.get("LAM_ROOT", "/workspace/src/LAM")).resolve()
DATA_ROOT = Path(os.environ.get("LAM_WORKER_DATA", "/workspace/lam-worker")).resolve()
JOBS_ROOT = DATA_ROOT / "jobs"
GRADIO_URL = os.environ.get("LAM_GRADIO_URL", "http://127.0.0.1:7860")
DRIVER_VIDEO = Path(
    os.environ.get(
        "LAM_DRIVER_VIDEO",
        str(
            LAM_ROOT
            / "assets/sample_motion/export/I_Am_Iron_Man/I_Am_Iron_Man.mp4"
        ),
    )
).resolve()
API_TOKEN = os.environ.get("LAM_WORKER_TOKEN", "")
MAX_PORTRAIT_BYTES = 10 * 1024 * 1024
REQUIRED_ARCHIVE_FILES = {
    "skin.glb",
    "animation.glb",
    "offset.ply",
    "vertex_order.json",
}

app = FastAPI(title="Robosa LAM Worker", version="0.1.0")
job_queue: queue.Queue[str] = queue.Queue()
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()
worker_started = False


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def job_path(job_id: str) -> Path:
    return JOBS_ROOT / job_id


def public_job(job: dict) -> dict:
    result = {
        key: value
        for key, value in job.items()
        if key not in {"portraitPath", "artifactPath"}
    }
    if job.get("status") == "complete":
        result["artifactUrl"] = f"/v1/avatar-jobs/{job['id']}/artifact"
    return result


def persist_job(job: dict) -> None:
    directory = job_path(job["id"])
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination = directory / "job.json"
    temporary = directory / "job.json.tmp"
    temporary.write_text(json.dumps(job, indent=2), encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(destination)


def update_job(job_id: str, **changes) -> dict:
    with jobs_lock:
        job = jobs[job_id]
        job.update(changes, updatedAt=now_iso())
        persist_job(job)
        return dict(job)


def validate_archive(path: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        names = {
            name
            for name in archive.namelist()
            if not name.endswith("/") and not name.startswith("__MACOSX/")
        }
        skin = next((name for name in names if name.endswith("/skin.glb")), "")
        root = skin[: -len("skin.glb")] if skin else ""
        if not root or not all(f"{root}{name}" in names for name in REQUIRED_ARCHIVE_FILES):
            raise RuntimeError("LAM export is missing required avatar files")
        bad_file = archive.testzip()
        if bad_file:
            raise RuntimeError(f"LAM export contains a corrupt file: {bad_file}")


def resolve_export(value: object) -> Path:
    export = Path(str(value))
    if not export.is_absolute():
        export = LAM_ROOT / export
    export = export.resolve()
    if export.suffix.lower() != ".zip" or not export.is_file():
        raise RuntimeError(f"LAM did not return an avatar archive: {value}")
    return export


def generate_avatar(job_id: str) -> None:
    job = jobs[job_id]
    portrait = Path(job["portraitPath"])
    artifact = job_path(job_id) / "avatar.lam.zip"
    export = None
    try:
        update_job(job_id, status="running", progress=5)
        client = Client(GRADIO_URL, verbose=False)
        client.predict(str(portrait), fn_index=2)
        client.predict(fn_index=3)
        update_job(job_id, progress=15)
        result = client.predict(
            str(portrait),
            str(DRIVER_VIDEO),
            True,
            fn_index=4,
        )
        export = resolve_export(result[2])
        validate_archive(export)
        shutil.copyfile(export, artifact)
        digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
        update_job(
            job_id,
            status="complete",
            progress=100,
            artifactPath=str(artifact),
            sha256=digest,
            size=artifact.stat().st_size,
            rigProfile="arkit-52",
            blink=True,
            completedAt=now_iso(),
        )
    except Exception as error:
        traceback.print_exc()
        update_job(
            job_id,
            status="failed",
            progress=100,
            error=str(error)[:500],
        )
    finally:
        portrait.unlink(missing_ok=True)
        if export and export.is_relative_to(LAM_ROOT / "output/open_avatar_chat"):
            export.unlink(missing_ok=True)
        shutil.rmtree(LAM_ROOT / "output/tracking", ignore_errors=True)
        shutil.rmtree(LAM_ROOT / "output/open_avatar_chat/image", ignore_errors=True)


def consume_jobs() -> None:
    while True:
        generate_avatar(job_queue.get())
        job_queue.task_done()


def load_jobs() -> None:
    JOBS_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    for record in JOBS_ROOT.glob("*/job.json"):
        try:
            job = json.loads(record.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if job.get("status") in {"queued", "running"}:
            job["status"] = "failed"
            job["error"] = "Worker restarted before generation completed"
            job["updatedAt"] = now_iso()
            persist_job(job)
        jobs[job["id"]] = job


def require_token(authorization: Annotated[str | None, Header()] = None) -> None:
    if not API_TOKEN:
        raise HTTPException(503, "LAM_WORKER_TOKEN is not configured")
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not secrets.compare_digest(token, API_TOKEN):
        raise HTTPException(401, "Invalid worker token")


@app.on_event("startup")
def startup() -> None:
    global worker_started
    load_jobs()
    if not worker_started:
        threading.Thread(target=consume_jobs, daemon=True).start()
        worker_started = True


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "generator": "lam-20k",
        "queueDepth": job_queue.qsize(),
    }


@app.post("/v1/avatar-jobs", status_code=202, dependencies=[Depends(require_token)])
async def create_job(
    portrait: Annotated[UploadFile, File()],
    consentReceipt: Annotated[str, Form()],
    output: Annotated[str, Form()] = "lam",
    rig: Annotated[str, Form()] = "arkit-52",
) -> dict:
    try:
        consent = json.loads(consentReceipt)
    except ValueError as error:
        raise HTTPException(400, "consentReceipt must be valid JSON") from error
    if consent.get("subjectAuthorized") is not True:
        raise HTTPException(400, "Explicit subject authorization is required")
    if output != "lam" or rig != "arkit-52":
        raise HTTPException(400, "This worker supports output=lam and rig=arkit-52")

    content = await portrait.read(MAX_PORTRAIT_BYTES + 1)
    if not content or len(content) > MAX_PORTRAIT_BYTES:
        raise HTTPException(413, "Portrait must be between 1 byte and 10 MB")
    job_id = f"avjob_{secrets.token_hex(12)}"
    directory = job_path(job_id)
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    portrait_path = directory / f"{job_id}.png"
    portrait_path.write_bytes(content)
    os.chmod(portrait_path, 0o600)
    try:
        with Image.open(portrait_path) as image:
            image.verify()
    except Exception as error:
        portrait_path.unlink(missing_ok=True)
        raise HTTPException(415, "Portrait must be a valid JPEG, PNG, or WebP image") from error

    job = {
        "id": job_id,
        "status": "queued",
        "progress": 0,
        "portraitPath": str(portrait_path),
        "generator": "lam-20k",
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
    with jobs_lock:
        jobs[job_id] = job
        persist_job(job)
    job_queue.put(job_id)
    return public_job(job)


@app.get("/v1/avatar-jobs/{job_id}", dependencies=[Depends(require_token)])
def get_job(job_id: str) -> dict:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Avatar job not found")
        return public_job(dict(job))


@app.get(
    "/v1/avatar-jobs/{job_id}/artifact",
    response_class=FileResponse,
    dependencies=[Depends(require_token)],
)
def get_artifact(job_id: str) -> FileResponse:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job or job.get("status") != "complete":
            raise HTTPException(404, "Avatar artifact not found")
        artifact = Path(job["artifactPath"])
    return FileResponse(
        artifact,
        media_type="application/zip",
        filename=f"{job_id}.lam.zip",
    )


@app.delete("/v1/avatar-jobs/{job_id}", dependencies=[Depends(require_token)])
def delete_job(job_id: str) -> dict:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Avatar job not found")
        if job.get("status") in {"queued", "running"}:
            raise HTTPException(409, "A running avatar job cannot be deleted")
        jobs.pop(job_id)
    shutil.rmtree(job_path(job_id), ignore_errors=True)
    return {"ok": True}
