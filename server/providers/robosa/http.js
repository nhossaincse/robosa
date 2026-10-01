import { readRequestBody } from '../common/request.js';
import { RobosaServiceError } from './service.js';

export const JSON_BODY_LIMIT = 64 * 1024;

export function writeJson(response, status, payload, headers = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
  response.end(JSON.stringify(payload));
}

export async function readJson(request, limit = JSON_BODY_LIMIT) {
  try {
    return JSON.parse((await readRequestBody(request, limit)) || '{}');
  } catch (error) {
    if (error?.code === 'BODY_TOO_LARGE') {
      throw new RobosaServiceError(
        413,
        'BODY_TOO_LARGE',
        'Request is too large.',
      );
    }
    throw new RobosaServiceError(
      400,
      'INVALID_JSON',
      'Request body is invalid.',
    );
  }
}

export function requestPath(request) {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

export function clientAddress(request) {
  return String(
    request.headers['x-forwarded-for'] ||
      request.socket?.remoteAddress ||
      'local',
  )
    .split(',')[0]
    .trim();
}

export function createLimiter() {
  const buckets = new Map();
  return function allow(key, max, windowMs) {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (bucket.count >= max) return false;
    bucket.count += 1;
    if (buckets.size > 2000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    return true;
  };
}
