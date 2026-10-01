import { Buffer } from 'node:buffer';

const TOKEN_URL = 'https://api.avatarsdk.com/o/token/';
export const MAX_AVATAR_BYTES = 30 * 1024 * 1024;

export class MetaPersonError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'MetaPersonError';
    this.code = code;
    this.status = status;
  }
}

function allowedHost(hostname, additionalHosts = []) {
  const host = String(hostname || '').toLowerCase();
  if (host === 'avatarsdk.com' || host.endsWith('.avatarsdk.com')) return true;
  return additionalHosts.some((candidate) => {
    const allowed = String(candidate || '')
      .trim()
      .toLowerCase();
    return allowed && (host === allowed || host.endsWith(`.${allowed}`));
  });
}

export function trustedMetaPersonUrl(value, additionalHosts = []) {
  try {
    const url = new URL(String(value || ''));
    return (
      url.protocol === 'https:' && allowedHost(url.hostname, additionalHosts)
    );
  } catch {
    return false;
  }
}

function configuredFetch(fetchImpl) {
  const implementation = fetchImpl || globalThis.fetch;
  if (typeof implementation !== 'function') {
    throw new MetaPersonError(
      'PROVIDER_UNAVAILABLE',
      'The avatar provider is unavailable.',
      503,
    );
  }
  return implementation;
}

export async function requestMetaPersonAccessToken({
  clientId,
  clientSecret,
  fetchImpl,
} = {}) {
  if (!clientId || !clientSecret) {
    throw new MetaPersonError(
      'METAPERSON_NOT_CONFIGURED',
      'Add MetaPerson credentials to enable 3D twin generation.',
      503,
    );
  }

  const response = await configuredFetch(fetchImpl)(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new MetaPersonError(
      'METAPERSON_AUTH_FAILED',
      'MetaPerson authentication failed. Check the server credentials and plan.',
      502,
    );
  }
  return {
    accessToken: String(payload.access_token),
    expiresIn: Math.max(0, Number(payload.expires_in) || 0),
  };
}

export function validateGlb(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) {
    throw new MetaPersonError(
      'INVALID_AVATAR_MODEL',
      'The avatar provider did not return a GLB model.',
    );
  }
  if (
    buffer.toString('ascii', 0, 4) !== 'glTF' ||
    buffer.readUInt32LE(4) !== 2
  ) {
    throw new MetaPersonError(
      'INVALID_AVATAR_MODEL',
      'The avatar provider returned an unsupported model.',
    );
  }
  return buffer;
}

async function readModelBody(response) {
  if (!response.body?.getReader) {
    const model = Buffer.from(await response.arrayBuffer());
    if (model.length <= MAX_AVATAR_BYTES) return model;
    throw new MetaPersonError(
      'AVATAR_TOO_LARGE',
      'The generated avatar is larger than 30 MB.',
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
    if (size > MAX_AVATAR_BYTES) {
      await reader.cancel();
      throw new MetaPersonError(
        'AVATAR_TOO_LARGE',
        'The generated avatar is larger than 30 MB.',
        413,
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

export async function downloadMetaPersonModel({
  url,
  fetchImpl,
  additionalHosts = [],
} = {}) {
  if (!trustedMetaPersonUrl(url, additionalHosts)) {
    throw new MetaPersonError(
      'AVATAR_URL_REJECTED',
      'The exported avatar URL was rejected.',
      400,
    );
  }

  const response = await configuredFetch(fetchImpl)(url, {
    headers: { Accept: 'model/gltf-binary,application/octet-stream' },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new MetaPersonError(
      'AVATAR_DOWNLOAD_FAILED',
      'The generated avatar could not be downloaded.',
    );
  }
  if (!trustedMetaPersonUrl(response.url || url, additionalHosts)) {
    throw new MetaPersonError(
      'AVATAR_REDIRECT_REJECTED',
      'The generated avatar redirected to an unapproved host.',
      400,
    );
  }
  const declaredSize = Number(response.headers.get('content-length')) || 0;
  if (declaredSize > MAX_AVATAR_BYTES) {
    throw new MetaPersonError(
      'AVATAR_TOO_LARGE',
      'The generated avatar is larger than 30 MB.',
      413,
    );
  }
  const model = await readModelBody(response);
  return validateGlb(model);
}
