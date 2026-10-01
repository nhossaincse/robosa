import { Buffer } from 'node:buffer';

const MAX_LAM_ARCHIVE_BYTES = 120 * 1024 * 1024;

export class LamWorkerError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'LamWorkerError';
    this.code = code;
    this.status = status;
  }
}

function configuration({ baseUrl, token, fetchImpl }) {
  let url;
  try {
    url = new URL(String(baseUrl || ''));
  } catch {
    url = null;
  }
  if (!url || !['https:', 'http:'].includes(url.protocol) || !token) {
    throw new LamWorkerError(
      'LAM_WORKER_NOT_CONFIGURED',
      'The LAM generation worker is not configured.',
      503,
    );
  }
  const request = fetchImpl || globalThis.fetch;
  if (typeof request !== 'function') {
    throw new LamWorkerError(
      'LAM_WORKER_UNAVAILABLE',
      'The LAM generation worker is unavailable.',
      503,
    );
  }
  return { baseUrl: url, token, request };
}

async function workerJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new LamWorkerError(
      'LAM_WORKER_REQUEST_FAILED',
      String(payload?.detail || 'The LAM worker rejected the request.'),
      response.status >= 400 && response.status < 500 ? response.status : 502,
    );
  }
  return payload;
}

export async function createLamWorkerJob({
  baseUrl,
  token,
  portrait,
  contentType,
  consentAt,
  fetchImpl,
}) {
  const config = configuration({ baseUrl, token, fetchImpl });
  const extension =
    contentType === 'image/png'
      ? 'png'
      : contentType === 'image/webp'
        ? 'webp'
        : 'jpg';
  const form = new FormData();
  form.append(
    'portrait',
    new Blob([portrait], { type: contentType }),
    `portrait.${extension}`,
  );
  form.append(
    'consentReceipt',
    JSON.stringify({ subjectAuthorized: true, recordedAt: consentAt }),
  );
  form.append('output', 'lam');
  form.append('rig', 'arkit-52');

  const response = await config.request(
    new URL('/v1/avatar-jobs', config.baseUrl),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    },
  );
  const job = await workerJson(response);
  if (!/^avjob_[a-f0-9]+$/i.test(job.id || '')) {
    throw new LamWorkerError(
      'LAM_WORKER_RESPONSE_INVALID',
      'The LAM worker returned an invalid job.',
    );
  }
  return job;
}

export async function getLamWorkerJob({ baseUrl, token, jobId, fetchImpl }) {
  const config = configuration({ baseUrl, token, fetchImpl });
  const response = await config.request(
    new URL(`/v1/avatar-jobs/${encodeURIComponent(jobId)}`, config.baseUrl),
    {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  return workerJson(response);
}

async function readCapped(response) {
  const declared = Number(response.headers.get('content-length')) || 0;
  if (declared > MAX_LAM_ARCHIVE_BYTES) {
    throw new LamWorkerError(
      'LAM_ARCHIVE_TOO_LARGE',
      'The generated LAM archive is larger than 120 MB.',
      413,
    );
  }
  if (!response.body?.getReader) {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length <= MAX_LAM_ARCHIVE_BYTES) return body;
    throw new LamWorkerError(
      'LAM_ARCHIVE_TOO_LARGE',
      'The generated LAM archive is larger than 120 MB.',
      413,
    );
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_LAM_ARCHIVE_BYTES) {
      await reader.cancel();
      throw new LamWorkerError(
        'LAM_ARCHIVE_TOO_LARGE',
        'The generated LAM archive is larger than 120 MB.',
        413,
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

export async function downloadLamWorkerArtifact({
  baseUrl,
  token,
  artifactUrl,
  fetchImpl,
}) {
  const config = configuration({ baseUrl, token, fetchImpl });
  const artifact = new URL(String(artifactUrl || ''), config.baseUrl);
  if (artifact.origin !== config.baseUrl.origin) {
    throw new LamWorkerError(
      'LAM_ARTIFACT_URL_REJECTED',
      'The LAM worker returned an untrusted artifact URL.',
      400,
    );
  }
  const response = await config.request(artifact, {
    headers: { Authorization: `Bearer ${config.token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new LamWorkerError(
      'LAM_ARTIFACT_DOWNLOAD_FAILED',
      'The generated LAM archive could not be downloaded.',
    );
  }
  return readCapped(response);
}

export async function deleteLamWorkerJob({ baseUrl, token, jobId, fetchImpl }) {
  const config = configuration({ baseUrl, token, fetchImpl });
  const response = await config.request(
    new URL(`/v1/avatar-jobs/${encodeURIComponent(jobId)}`, config.baseUrl),
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  await workerJson(response);
}
