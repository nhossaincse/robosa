import JSZip from 'jszip';
import { readRequestBodyCapped } from '../common/request.js';
import { RobosaServiceError } from './service.js';

export const PORTRAIT_LIMIT = 10 * 1024 * 1024;
export const LAM_ARCHIVE_LIMIT = 120 * 1024 * 1024;
export const LAM_REQUIRED_FILES = Object.freeze([
  'skin.glb',
  'animation.glb',
  'offset.ply',
  'vertex_order.json',
]);

export function portraitContentType(buffer) {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return '';
}

export async function readPortrait(request) {
  try {
    const portrait = await readRequestBodyCapped(request, PORTRAIT_LIMIT);
    const contentType = portraitContentType(portrait);
    if (!contentType) {
      throw new RobosaServiceError(
        415,
        'PORTRAIT_FORMAT_UNSUPPORTED',
        'Use a JPEG, PNG, or WebP portrait.',
      );
    }
    return { portrait, contentType };
  } catch (error) {
    if (error?.code === 'BODY_TOO_LARGE') {
      throw new RobosaServiceError(
        413,
        'PORTRAIT_TOO_LARGE',
        'Portrait images must be 10 MB or smaller.',
      );
    }
    throw error;
  }
}

export async function validateLamArchive(archive) {
  if (
    archive.length < 4 ||
    archive[0] !== 0x50 ||
    archive[1] !== 0x4b ||
    archive[2] !== 0x03 ||
    archive[3] !== 0x04
  ) {
    throw new RobosaServiceError(
      415,
      'LAM_FORMAT_UNSUPPORTED',
      'Import the ZIP exported by LAM.',
    );
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(archive);
  } catch {
    throw new RobosaServiceError(
      415,
      'LAM_ARCHIVE_INVALID',
      'The LAM ZIP could not be read.',
    );
  }

  const names = Object.values(zip.files)
    .filter((entry) => !entry.dir && !entry.name.startsWith('__MACOSX/'))
    .map((entry) => entry.name);
  const skin = names.find((name) => name.endsWith('/skin.glb'));
  const root = skin?.slice(0, -'skin.glb'.length) || '';
  if (
    !root ||
    !LAM_REQUIRED_FILES.every((name) => names.includes(`${root}${name}`))
  ) {
    throw new RobosaServiceError(
      415,
      'LAM_ARCHIVE_INVALID',
      'The ZIP is missing required LAM avatar files.',
    );
  }
  return archive;
}

export async function readLamArchive(request) {
  try {
    const archive = await readRequestBodyCapped(request, LAM_ARCHIVE_LIMIT);
    return await validateLamArchive(archive);
  } catch (error) {
    if (error?.code === 'BODY_TOO_LARGE') {
      throw new RobosaServiceError(
        413,
        'LAM_ARCHIVE_TOO_LARGE',
        'LAM avatar archives must be 120 MB or smaller.',
      );
    }
    throw error;
  }
}
