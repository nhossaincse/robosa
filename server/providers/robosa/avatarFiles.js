import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

function ownerFileName(ownerId, extension) {
  return `${createHash('sha256').update(String(ownerId)).digest('hex')}.${extension}`;
}

export function createAvatarFileStore({
  directory = path.join(
    process.env.ROBOSA_DATA_DIR || path.resolve('.robosa-data'),
    'avatars',
  ),
} = {}) {
  async function write(ownerId, model) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filePath = path.join(directory, ownerFileName(ownerId, 'glb'));
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, model, { mode: 0o600 });
    await rename(temporaryPath, filePath);
    return {
      sha256: createHash('sha256').update(model).digest('hex'),
      size: model.length,
    };
  }

  function read(ownerId) {
    return readFile(path.join(directory, ownerFileName(ownerId, 'glb')));
  }

  async function writePortrait(ownerId, portrait) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filePath = path.join(directory, ownerFileName(ownerId, 'portrait'));
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, portrait, { mode: 0o600 });
    await rename(temporaryPath, filePath);
    return {
      sha256: createHash('sha256').update(portrait).digest('hex'),
      size: portrait.length,
    };
  }

  function readPortrait(ownerId) {
    return readFile(path.join(directory, ownerFileName(ownerId, 'portrait')));
  }

  async function writeLam(ownerId, archive) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filePath = path.join(directory, ownerFileName(ownerId, 'lam.zip'));
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, archive, { mode: 0o600 });
    await rename(temporaryPath, filePath);
    return {
      sha256: createHash('sha256').update(archive).digest('hex'),
      size: archive.length,
    };
  }

  function readLam(ownerId) {
    return readFile(path.join(directory, ownerFileName(ownerId, 'lam.zip')));
  }

  return {
    directory,
    read,
    readLam,
    readPortrait,
    write,
    writeLam,
    writePortrait,
  };
}
