import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  LAM_REQUIRED_FILES,
  MODEL_LIMIT,
  portraitContentType,
  readAvatarModel,
  validateAvatarModel,
  validateLamArchive,
} from '../../server/providers/robosa/uploads.js';

test('avatar upload accepts the supplied GLB and rejects invalid or external models', async () => {
  const model = await readFile(
    new URL('../../public/nazmul_full_body_3d_avatar.glb', import.meta.url),
  );
  assert.equal(validateAvatarModel(model), model);
  const badLength = Buffer.from(model);
  badLength.writeUInt32LE(model.length + 4, 8);
  for (const invalid of [
    Buffer.alloc(0),
    Buffer.from('not a GLB'),
    badLength,
    model.subarray(0, 40),
  ]) {
    assert.throws(
      () => validateAvatarModel(invalid),
      (error) => error.code === 'MODEL_INVALID',
    );
  }
  const document = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' },
      meshes: [{}],
      buffers: [{ uri: 'https://example.test/mesh.bin' }],
    }).padEnd(160, ' '),
  );
  const external = Buffer.alloc(20 + document.length);
  external.write('glTF');
  external.writeUInt32LE(2, 4);
  external.writeUInt32LE(external.length, 8);
  external.writeUInt32LE(document.length, 12);
  external.writeUInt32LE(0x4e4f534a, 16);
  document.copy(external, 20);
  assert.throws(
    () => validateAvatarModel(external),
    (error) => error.code === 'MODEL_INVALID',
  );
  await assert.rejects(
    readAvatarModel(Readable.from([Buffer.alloc(MODEL_LIMIT + 1)])),
    (error) => error.code === 'MODEL_TOO_LARGE',
  );
});

test('portrait validation identifies supported image signatures', () => {
  assert.equal(
    portraitContentType(Buffer.from([0xff, 0xd8, 0xff])),
    'image/jpeg',
  );
  assert.equal(
    portraitContentType(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
    'image/png',
  );
  assert.equal(
    portraitContentType(Buffer.from('RIFF0000WEBP', 'ascii')),
    'image/webp',
  );
  assert.equal(portraitContentType(Buffer.from('not-an-image')), '');
});

test('LAM validation requires the complete renderer archive contract', async () => {
  const validZip = new JSZip();
  for (const name of LAM_REQUIRED_FILES) {
    validZip.file(`avatar/${name}`, name);
  }
  const archive = await validZip.generateAsync({ type: 'nodebuffer' });
  assert.equal(await validateLamArchive(archive), archive);

  const incompleteZip = new JSZip();
  incompleteZip.file('avatar/skin.glb', 'skin');
  await assert.rejects(
    validateLamArchive(
      await incompleteZip.generateAsync({ type: 'nodebuffer' }),
    ),
    (error) => error.code === 'LAM_ARCHIVE_INVALID',
  );
});
