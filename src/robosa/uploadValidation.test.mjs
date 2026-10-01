import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  LAM_REQUIRED_FILES,
  portraitContentType,
  validateLamArchive,
} from '../../server/providers/robosa/uploads.js';

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
