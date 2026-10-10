import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createAvatarFileStore } from '../server/providers/robosa/avatarFiles.js';
import { createRobosaApiHandler } from '../server/providers/robosa/api.js';
import { robosaRoutesPlugin } from '../server/providers/robosa/routes.js';
import { createRobosaService } from '../server/providers/robosa/service.js';
import { createRobosaStore } from '../server/providers/robosa/store.js';
import { DEFAULT_PROFILE } from '../src/robosa/profileStore.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir('/tmp/robosa-own-glb-qa', { recursive: true });
const directory = await mkdtemp(path.join(tmpdir(), 'robosa-model-qa-'));
const store = createRobosaStore({ directory });
const service = createRobosaService(store);
const owner = await service.register({
  email: 'model-qa@example.test',
  password: 'temporary model QA password',
  handle: 'model-qa',
  profile: { ...DEFAULT_PROFILE, displayName: 'Model QA' },
});
await service.register({
  email: 'nazmul-qa@example.test',
  password: 'temporary Nazmul QA password',
  handle: 'nazmul',
  profile: DEFAULT_PROFILE,
});
const handler = createRobosaApiHandler({
  store,
  avatarFiles: createAvatarFileStore({
    directory: path.join(directory, 'avatars'),
  }),
});
const server = await createServer({
  root,
  configFile: false,
  server: { host: '127.0.0.1', port: 4175, strictPort: true },
  plugins: [
    {
      name: 'model-qa-api',
      configureServer(server) {
        server.middlewares.use('/api/robosa', handler);
      },
    },
    robosaRoutesPlugin(),
  ],
});
let browser;
const errors = [];
try {
  await server.listen();
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4175/nazmul', {
    waitUntil: 'networkidle0',
  });
  assert.equal(
    await page.$eval(
      '.public-avatar-mode-badge',
      (element) => element.textContent,
    ),
    'Nazmul 3D',
  );
  await page.screenshot({
    path: '/tmp/robosa-own-glb-qa/nazmul.png',
    fullPage: true,
  });
  await browser.defaultBrowserContext().setCookie({
    name: 'robosa_session',
    value: owner.token,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
  });
  await page.goto('http://127.0.0.1:4175/studio', {
    waitUntil: 'networkidle0',
  });
  await page.click('[data-studio-tab="appearance"]');
  assert.ok(await page.$('[data-action="upload-model"]:not([disabled])'));
  await (
    await page.$('#model-input')
  ).uploadFile(path.join(root, 'public/nazmul_digital_twin_lipsync.glb'));
  await page.waitForFunction(
    () =>
      document.querySelector('#avatar-build-heading')?.textContent ===
        'Imported 3D model active' &&
      document.querySelector('[data-action="upload-model"]:not([disabled])'),
  );
  await page.waitForFunction(
    () =>
      document.querySelector('[data-rig-title]')?.textContent ===
      'Full lip sync ready',
  );
  assert.equal(
    (await service.publicProfile('model-qa')).avatarModel.provider,
    'upload',
  );
  await page.screenshot({
    path: '/tmp/robosa-own-glb-qa/upload-desktop.png',
    fullPage: true,
  });
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(
    await page.$eval('.preview-avatar-badge', (element) => element.textContent),
    'Imported 3D',
  );
  const guest = await browser.createBrowserContext();
  const visitor = await guest.newPage();
  visitor.on('pageerror', (error) => errors.push(error.message));
  await visitor.setViewport({ width: 390, height: 844 });
  await visitor.goto('http://127.0.0.1:4175/model-qa', {
    waitUntil: 'networkidle0',
  });
  assert.equal(
    await visitor.$eval(
      '.public-avatar-mode-badge',
      (element) => element.textContent,
    ),
    'Imported 3D',
  );
  assert.equal(
    await visitor.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
    0,
  );
  await visitor.screenshot({
    path: '/tmp/robosa-own-glb-qa/upload-public-mobile.png',
    fullPage: true,
  });
  await page.setViewport({ width: 390, height: 844 });
  await page.click('[data-studio-tab="appearance"]');
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
    0,
  );
  await page.screenshot({
    path: '/tmp/robosa-own-glb-qa/upload-studio-mobile.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        nazmul: 'bundled model rendered',
        upload: 'saved and activated',
        reload: 'preserved',
        guest: 'separate browser can see uploaded model',
        mobile: 'no horizontal overflow',
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
