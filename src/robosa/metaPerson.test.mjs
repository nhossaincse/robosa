import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAvatarFileStore } from '../../server/providers/robosa/avatarFiles.js';
import {
  downloadMetaPersonModel,
  requestMetaPersonAccessToken,
  trustedMetaPersonUrl,
} from '../../server/providers/robosa/metaperson.js';

function minimalGlb() {
  const model = Buffer.alloc(20);
  model.write('glTF', 0, 'ascii');
  model.writeUInt32LE(2, 4);
  model.writeUInt32LE(model.length, 8);
  return model;
}

test('MetaPerson token exchange keeps the client secret in server auth', async () => {
  let request;
  const token = await requestMetaPersonAccessToken({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(
        JSON.stringify({ access_token: 'short-token', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
  });

  assert.deepEqual(token, { accessToken: 'short-token', expiresIn: 3600 });
  assert.equal(request.url, 'https://api.avatarsdk.com/o/token/');
  assert.equal(
    request.options.headers.Authorization,
    `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
  );
  assert.equal(String(request.options.body), 'grant_type=client_credentials');
});

test('MetaPerson model downloads accept only approved HTTPS hosts and GLB data', async () => {
  assert.equal(
    trustedMetaPersonUrl('https://cdn.avatarsdk.com/avatar/model.glb'),
    true,
  );
  assert.equal(
    trustedMetaPersonUrl('https://avatarsdk.com.attacker.test/model.glb'),
    false,
  );
  assert.equal(
    trustedMetaPersonUrl('https://models.example.test/model.glb', [
      'models.example.test',
    ]),
    true,
  );

  const model = minimalGlb();
  const downloaded = await downloadMetaPersonModel({
    url: 'https://cdn.avatarsdk.com/avatar/model.glb',
    fetchImpl: async () =>
      new Response(model, {
        status: 200,
        headers: { 'Content-Length': String(model.length) },
      }),
  });
  assert.deepEqual(downloaded, model);
});

test('generated avatar files are isolated by owner and retain exact bytes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'robosa-avatar-test-'));
  const files = createAvatarFileStore({ directory });
  const model = minimalGlb();
  const stored = await files.write('owner-one', model);

  assert.equal(stored.size, model.length);
  assert.match(stored.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await files.read('owner-one'), model);
  await assert.rejects(files.read('owner-two'), { code: 'ENOENT' });
});

test('published portrait files use isolated storage alongside 3D models', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'robosa-portrait-test-'));
  const files = createAvatarFileStore({ directory });
  const portrait = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
  ]);
  const stored = await files.writePortrait('owner-one', portrait);

  assert.equal(stored.size, portrait.length);
  assert.match(stored.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await files.readPortrait('owner-one'), portrait);
  await assert.rejects(files.readPortrait('owner-two'), { code: 'ENOENT' });
});
