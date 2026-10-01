import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { createRobosaStore } from '../../server/providers/robosa/store.js';
import { createRobosaApiHandler } from '../../server/providers/robosa/api.js';
import {
  createRobosaService,
  RobosaServiceError,
} from '../../server/providers/robosa/service.js';
import { answerRobosaChat } from '../../server/providers/robosa/chat.js';
import { DEFAULT_PROFILE } from './profileStore.js';

async function testService() {
  const directory = await mkdtemp(path.join(tmpdir(), 'robosa-test-'));
  const store = createRobosaStore({ directory });
  return { store, service: createRobosaService(store) };
}

function mockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(body = '') {
      this.body = body;
    },
  };
}

test('owner registration persists a claimed public profile and session', async () => {
  const { store, service } = await testService();
  const registration = await service.register({
    email: 'Owner@Example.com',
    password: 'correct horse battery staple',
    handle: 'owner-test',
    profile: { ...DEFAULT_PROFILE, handle: 'owner-test' },
  });

  assert.equal(registration.user.email, 'owner@example.com');
  assert.equal(registration.profile.handle, 'owner-test');
  assert.equal(registration.profile.ownerId, undefined);

  const sessionHash = createHash('sha256')
    .update(registration.token)
    .digest('hex');
  const session = await service.sessionByHash(sessionHash);
  assert.equal(session.user.id, registration.user.id);

  const reloaded = createRobosaService(
    createRobosaStore({ directory: path.dirname(store.filePath) }),
  );
  assert.equal(
    (await reloaded.publicProfile('owner-test')).displayName,
    'Nazmul',
  );
});

test('handles are unique and passwords are checked without exposing hashes', async () => {
  const { service } = await testService();
  await service.register({
    email: 'one@example.com',
    password: 'a secure password',
    handle: 'claimed-handle',
    profile: DEFAULT_PROFILE,
  });

  await assert.rejects(
    service.register({
      email: 'two@example.com',
      password: 'another secure password',
      handle: 'claimed-handle',
      profile: DEFAULT_PROFILE,
    }),
    (error) =>
      error instanceof RobosaServiceError && error.code === 'HANDLE_TAKEN',
  );
  await assert.rejects(
    service.login({ email: 'one@example.com', password: 'wrong password' }),
    (error) => error.code === 'INVALID_CREDENTIALS',
  );
});

test('meeting requests remain pending until their owner reviews them', async () => {
  const { service } = await testService();
  const owner = await service.register({
    email: 'calendar@example.com',
    password: 'calendar password',
    handle: 'calendar-owner',
    profile: DEFAULT_PROFILE,
  });
  const request = await service.createBooking('calendar-owner', {
    guestName: 'Visitor',
    guestEmail: 'visitor@example.com',
    slot: 'Tuesday, 10:00 AM',
  });

  assert.equal(request.status, 'pending');
  const approved = await service.updateBooking(
    owner.user.id,
    request.id,
    'approved',
  );
  assert.equal(approved.status, 'approved');
  assert.equal(
    (await service.listBookings(owner.user.id))[0].status,
    'approved',
  );
});

test('chat uses grounded local answers when no provider key is configured', async () => {
  const answer = await answerRobosaChat({
    profile: DEFAULT_PROFILE,
    message: 'Tell me about Robosa.me',
    apiKey: '',
  });
  assert.equal(answer.mode, 'grounded');
  assert.match(answer.text, /owner-controlled digital twin/i);
});

test('private twins are visible and conversational only to their owner', async () => {
  const { service } = await testService();
  const owner = await service.register({
    email: 'private@example.com',
    password: 'private twin password',
    handle: 'private-owner',
    profile: { ...DEFAULT_PROFILE, visibility: 'private' },
  });

  assert.equal(await service.publicProfile('private-owner'), null);
  assert.equal(
    (await service.publicProfile('private-owner', owner.user.id)).handle,
    'private-owner',
  );
  await assert.rejects(
    service.conversation('private-owner', ''),
    (error) => error.code === 'PROFILE_NOT_FOUND',
  );
  assert.ok(
    (await service.conversation('private-owner', '', owner.user.id)).id,
  );
});

test('generated avatar metadata follows profile visibility', async () => {
  const { service } = await testService();
  const owner = await service.register({
    email: 'avatar@example.com',
    password: 'avatar owner password',
    handle: 'avatar-owner',
    profile: DEFAULT_PROFILE,
  });
  const profile = await service.completeAvatar(owner.user.id, {
    size: 2048,
    sha256: 'a'.repeat(64),
    avatarCode: 'provider-private-code',
  });

  assert.equal(profile.avatarModel.rigProfile, 'oculus-15');
  assert.match(profile.avatarModel.url, /avatar-owner\/avatar\.glb/);
  assert.equal(
    (await service.avatarAccess('avatar-owner')).ownerId,
    owner.user.id,
  );

  await service.updateProfile(owner.user.id, {
    ...profile,
    visibility: 'private',
  });
  assert.equal(await service.avatarAccess('avatar-owner'), null);
  assert.equal(
    (await service.avatarAccess('avatar-owner', owner.user.id)).ownerId,
    owner.user.id,
  );
});

test('generated GLBs are delivered through the public profile model route', async () => {
  const { store, service } = await testService();
  const owner = await service.register({
    email: 'model-route@example.com',
    password: 'model route password',
    handle: 'model-route',
    profile: DEFAULT_PROFILE,
  });
  const model = Buffer.from('glTF-generated-model');
  await service.completeAvatar(owner.user.id, {
    size: model.length,
    sha256: 'b'.repeat(64),
  });
  const handler = createRobosaApiHandler({
    store,
    avatarFiles: { read: async () => model },
  });
  const response = mockResponse();
  await handler(
    {
      method: 'GET',
      url: '/profiles/model-route/avatar.glb',
      headers: { host: 'localhost' },
      socket: {},
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'model/gltf-binary');
  assert.deepEqual(response.body, model);
});

test('published portraits are visible through the selected public profile', async () => {
  const { store, service } = await testService();
  const owner = await service.register({
    email: 'portrait-route@example.com',
    password: 'portrait route password',
    handle: 'portrait-route',
    profile: DEFAULT_PROFILE,
  });
  const portrait = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
  ]);
  const profile = await service.completePortrait(owner.user.id, {
    contentType: 'image/png',
    size: portrait.length,
    sha256: 'c'.repeat(64),
  });

  assert.equal(profile.avatarMode, 'portrait');
  assert.equal(profile.portraitAvatar.contentType, 'image/png');
  assert.match(profile.portraitAvatar.url, /portrait-route\/portrait/);

  const handler = createRobosaApiHandler({
    store,
    avatarFiles: { readPortrait: async () => portrait },
  });
  const response = mockResponse();
  await handler(
    {
      method: 'GET',
      url: '/profiles/portrait-route/portrait',
      headers: { host: 'localhost' },
      socket: {},
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/png');
  assert.deepEqual(response.body, portrait);
});

test('LAM archives are published with ARKit metadata and visibility checks', async () => {
  const { store, service } = await testService();
  const owner = await service.register({
    email: 'lam-route@example.com',
    password: 'lam route password',
    handle: 'lam-route',
    profile: DEFAULT_PROFILE,
  });
  const archive = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]);
  const profile = await service.completeLamAvatar(owner.user.id, {
    size: archive.length,
    sha256: 'e'.repeat(64),
  });

  assert.equal(profile.avatarMode, 'lam');
  assert.equal(profile.lamAvatar.rigProfile, 'arkit-52');
  assert.match(profile.lamAvatar.url, /lam-route\/avatar\.lam\.zip/);

  const handler = createRobosaApiHandler({
    store,
    avatarFiles: { readLam: async () => archive },
  });
  const response = mockResponse();
  await handler(
    {
      method: 'GET',
      url: '/profiles/lam-route/avatar.lam.zip',
      headers: { host: 'localhost' },
      socket: {},
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/zip');
  assert.deepEqual(response.body, archive);
});

test('LAM uploads reject non-ZIP bytes', async () => {
  const { store, service } = await testService();
  const owner = await service.register({
    email: 'lam-upload@example.com',
    password: 'lam upload password',
    handle: 'lam-upload',
    profile: DEFAULT_PROFILE,
  });
  const handler = createRobosaApiHandler({
    store,
    avatarFiles: { writeLam: async () => assert.fail('must not write') },
  });
  const request = Readable.from([Buffer.from('not a zip')]);
  request.method = 'PUT';
  request.url = '/avatar/lam';
  request.headers = {
    host: 'localhost',
    cookie: `robosa_session=${owner.token}`,
  };
  request.socket = {};
  const response = mockResponse();

  await handler(request, response);

  assert.equal(response.statusCode, 415);
  assert.match(response.body, /LAM_FORMAT_UNSUPPORTED/);
});

test('LAM uploads require the renderer asset contract', async () => {
  const { store, service } = await testService();
  const owner = await service.register({
    email: 'lam-contract@example.com',
    password: 'lam contract password',
    handle: 'lam-contract',
    profile: DEFAULT_PROFILE,
  });
  const zip = new JSZip();
  zip.file('not-lam/readme.txt', 'hello');
  const archive = await zip.generateAsync({ type: 'nodebuffer' });
  const handler = createRobosaApiHandler({
    store,
    avatarFiles: { writeLam: async () => assert.fail('must not write') },
  });
  const request = Readable.from([archive]);
  request.method = 'PUT';
  request.url = '/avatar/lam';
  request.headers = {
    host: 'localhost',
    cookie: `robosa_session=${owner.token}`,
  };
  request.socket = {};
  const response = mockResponse();

  await handler(request, response);

  assert.equal(response.statusCode, 415);
  assert.match(response.body, /LAM_ARCHIVE_INVALID/);
});

test('LAM worker jobs import completed archives for the authenticated owner', async () => {
  const { store, service } = await testService();
  const owner = await service.register({
    email: 'lam-worker@example.com',
    password: 'lam worker password',
    handle: 'lam-worker',
    profile: DEFAULT_PROFILE,
  });
  const zip = new JSZip();
  for (const name of [
    'skin.glb',
    'animation.glb',
    'offset.ply',
    'vertex_order.json',
  ]) {
    zip.file(`avatar/${name}`, name);
  }
  const archive = await zip.generateAsync({ type: 'nodebuffer' });
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/v1/avatar-jobs')) {
      assert.equal(options.headers.Authorization, 'Bearer worker-secret');
      assert.equal(options.body.get('output'), 'lam');
      return new Response(
        JSON.stringify({ id: 'avjob_aabbcc', status: 'queued', progress: 0 }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      );
    }
    if (String(url).endsWith('/v1/avatar-jobs/avjob_aabbcc')) {
      if (options.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          id: 'avjob_aabbcc',
          status: 'complete',
          progress: 100,
          artifactUrl: '/v1/avatar-jobs/avjob_aabbcc/artifact',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(archive, {
      status: 200,
      headers: {
        'content-length': String(archive.length),
        'content-type': 'application/zip',
      },
    });
  };
  let storedArchive;
  const handler = createRobosaApiHandler({
    store,
    fetchImpl,
    lamWorkerUrl: 'https://worker.example',
    lamWorkerToken: 'worker-secret',
    avatarFiles: {
      writeLam: async (_ownerId, bytes) => {
        storedArchive = bytes;
        return { size: bytes.length, sha256: 'f'.repeat(64) };
      },
    },
  });
  const portrait = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
  ]);
  const createRequest = Readable.from([portrait]);
  createRequest.method = 'POST';
  createRequest.url = '/avatar/lam/jobs';
  createRequest.headers = {
    host: 'localhost',
    cookie: `robosa_session=${owner.token}`,
    'x-robosa-consent-at': new Date().toISOString(),
  };
  createRequest.socket = {};
  const createResponse = mockResponse();

  await handler(createRequest, createResponse);

  assert.equal(createResponse.statusCode, 202);
  const statusResponse = mockResponse();
  await handler(
    {
      method: 'GET',
      url: '/avatar/lam/jobs/avjob_aabbcc',
      headers: {
        host: 'localhost',
        cookie: `robosa_session=${owner.token}`,
      },
      socket: {},
    },
    statusResponse,
  );

  assert.equal(statusResponse.statusCode, 200);
  assert.deepEqual(storedArchive, archive);
  assert.equal(JSON.parse(statusResponse.body).profile.avatarMode, 'lam');
  assert.equal(requests.length, 4);
  assert.equal(requests.at(-1).options.method, 'DELETE');
});

test('portrait uploads detect image bytes and activate portrait mode', async () => {
  const { store, service } = await testService();
  const owner = await service.register({
    email: 'portrait-upload@example.com',
    password: 'portrait upload password',
    handle: 'portrait-upload',
    profile: DEFAULT_PROFILE,
  });
  const portrait = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
  ]);
  let storedPortrait;
  const handler = createRobosaApiHandler({
    store,
    avatarFiles: {
      writePortrait: async (_ownerId, bytes) => {
        storedPortrait = bytes;
        return { size: bytes.length, sha256: 'd'.repeat(64) };
      },
    },
  });
  const request = Readable.from([portrait]);
  request.method = 'PUT';
  request.url = '/avatar/portrait';
  request.headers = {
    host: 'localhost',
    cookie: `robosa_session=${owner.token}`,
    'content-type': 'application/octet-stream',
  };
  request.socket = {};
  const response = mockResponse();

  await handler(request, response);

  assert.equal(response.statusCode, 201);
  assert.deepEqual(storedPortrait, portrait);
  const payload = JSON.parse(response.body);
  assert.equal(payload.profile.avatarMode, 'portrait');
  assert.equal(payload.profile.portraitAvatar.contentType, 'image/png');
});
