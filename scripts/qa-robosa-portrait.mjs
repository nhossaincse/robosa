import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let profile = {
  handle: 'nazmul',
  displayName: 'Nazmul',
  headline: 'Product builder exploring useful, human-centered AI',
  bio: 'I build interactive products at the edge of AI and voice.',
  projects: [{ name: 'Robosa.me', summary: 'Digital twin platform' }],
  facts: ['Voice-first AI'],
  avatarMode: '3d',
  allowBooking: true,
  speakReplies: true,
  visibility: 'public',
  avatarModel: null,
  portraitAvatar: null,
  lamAvatar: null,
};

function json(request, body, status = 200) {
  return request.respond({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.setRequestInterception(true);
page.on('request', (request) => {
  const url = request.url();
  if (url.endsWith('/api/robosa/session')) {
    json(request, {
      authenticated: true,
      user: { id: 'qa-owner', email: 'qa@robosa.test' },
      profile,
    });
    return;
  }
  if (url.endsWith('/api/robosa/bookings')) {
    json(request, { bookings: [] });
    return;
  }
  if (url.endsWith('/api/robosa/avatar/portrait')) {
    profile = {
      ...profile,
      avatarMode: 'portrait',
      portraitAvatar: {
        status: 'ready',
        contentType: 'image/png',
        size: 1000,
        updatedAt: new Date().toISOString(),
        url: '/robosa-twin-default.png',
      },
    };
    json(request, { profile }, 201);
    return;
  }
  if (url.endsWith('/api/robosa/profiles/nazmul')) {
    json(request, { profile });
    return;
  }
  request.continue();
});

await page.goto('http://127.0.0.1:4173/studio', {
  waitUntil: 'networkidle0',
});
await page.click('[data-studio-tab="appearance"]');
await page.waitForSelector('#media-input');
const input = await page.$('#media-input');
await input.uploadFile(path.join(root, 'public/robosa-twin-default.png'));
await page.waitForSelector('.media-item img');
await page.$eval('#avatar-consent', (checkbox) => checkbox.click());
await page.waitForSelector('[data-avatar-mode="portrait"]:not([disabled])');
await page.click('[data-avatar-mode="portrait"]');
await page.waitForFunction(
  () =>
    document.querySelector('.preview-avatar-badge')?.textContent ===
      'Static portrait' && document.querySelector('.portrait-twin-image'),
);
await page.screenshot({
  path: '/tmp/robosa-portrait-studio-desktop.png',
  fullPage: true,
});
const studio = await page.evaluate(() => ({
  badge: document.querySelector('.preview-avatar-badge')?.textContent,
  mode: document
    .querySelector('[data-avatar-mode="portrait"]')
    ?.getAttribute('aria-checked'),
  readiness: document.querySelector('[data-rig-title]')?.textContent,
  portraitImages: document.querySelectorAll('.portrait-twin-image').length,
  mouthLayers: document.querySelectorAll('[class*="portrait-mouth"]').length,
  canvases: document.querySelectorAll('[data-twin-stage] canvas').length,
  lipTestDisabled: document.querySelector('[data-action="test-lip-sync"]')
    ?.disabled,
  overflow:
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));

await page.goto('http://127.0.0.1:4173/nazmul', {
  waitUntil: 'networkidle0',
});
await page.waitForSelector('.portrait-twin-image');
await page.screenshot({
  path: '/tmp/robosa-portrait-public-desktop.png',
  fullPage: true,
});
const publicDesktop = await page.evaluate(() => ({
  badge: document.querySelector('.public-avatar-mode-badge')?.textContent,
  portraitImages: document.querySelectorAll('.portrait-twin-image').length,
  overflow:
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await new Promise((resolve) => setTimeout(resolve, 250));
await page.screenshot({
  path: '/tmp/robosa-portrait-public-mobile.png',
  fullPage: true,
});
const publicMobile = await page.evaluate(() => ({
  badge: document.querySelector('.public-avatar-mode-badge')?.textContent,
  overflow:
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  stageWidth: document.querySelector('[data-twin-stage]')?.clientWidth,
  stageHeight: document.querySelector('[data-twin-stage]')?.clientHeight,
}));

console.log(
  JSON.stringify({ studio, publicDesktop, publicMobile, errors }, null, 2),
);
await browser.close();

if (
  errors.length ||
  studio.badge !== 'Static portrait' ||
  studio.readiness !== 'Static portrait' ||
  studio.portraitImages !== 1 ||
  studio.mouthLayers !== 0 ||
  studio.canvases !== 0 ||
  !studio.lipTestDisabled ||
  studio.overflow > 0 ||
  publicDesktop.overflow > 0 ||
  publicMobile.overflow > 0
) {
  process.exitCode = 1;
}
