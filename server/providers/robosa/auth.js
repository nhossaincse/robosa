import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'robosa_session';
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function tokenHash(token) {
  return createHash('sha256')
    .update(String(token || ''))
    .digest('hex');
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(String(password), salt, 32);
  return `scrypt$${salt}$${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, salt, expectedHex] = String(encoded || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(await scrypt(String(password), salt, 32));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionRecord(userId, now = Date.now()) {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    record: {
      id: randomUUID(),
      userId,
      tokenHash: tokenHash(token),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_LIFETIME_MS).toISOString(),
    },
  };
}

export function parseCookies(header) {
  return Object.fromEntries(
    String(header || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=');
        if (separator < 0) return [part, ''];
        try {
          return [
            decodeURIComponent(part.slice(0, separator)),
            decodeURIComponent(part.slice(separator + 1)),
          ];
        } catch {
          return ['', ''];
        }
      }),
  );
}

export function sessionHashFromRequest(request) {
  return tokenHash(parseCookies(request.headers.cookie)[SESSION_COOKIE]);
}

export function sessionCookie(token, request) {
  const forwarded = String(request.headers['x-forwarded-proto'] || '');
  const secure = request.socket?.encrypted || forwarded === 'https';
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_LIFETIME_MS / 1000)}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function expiredSessionCookie(request) {
  const secure =
    request.socket?.encrypted ||
    String(request.headers['x-forwarded-proto'] || '') === 'https';
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}
