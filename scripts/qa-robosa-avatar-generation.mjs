import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = {
  handle: 'nazmul',
  displayName: 'Nazmul',
  headline: 'Product builder exploring useful, human-centered AI',
  bio: 'I build interactive products at the edge of AI and voice.',
  projects: [{ name: 'Robosa.me', summary: 'Digital twin platform' }],
  facts: ['Voice-first AI'],
  allowBooking: true,
  speakReplies: true,
  visibility: 'public',
  avatarModel: null,
};

const creatorHtml = `<!doctype html><html><body><main>Simulated avatar creator</main><script>
  const send = (eventName, extra = {}) => parent.postMessage({ source: 'metaperson_creator', eventName, ...extra }, '*');
  addEventListener('message', (event) => {
    if (event.data?.eventName === 'authenticate') send('authentication_status', { isAuthenticated: true });
    if (event.data?.eventName === 'generate_avatar') {
      send('model_generated', { avatarCode: 'qa-avatar' });
      send('action_availability_changed', { actionName: 'avatar_export', isAvailable: true });
    }
    if (event.data?.eventName === 'export_avatar') send('model_exported', { avatarCode: 'qa-avatar', url: 'https://cdn.avatarsdk.com/qa.glb' });
  });
  send('metaperson_creator_loaded');
<\/script></body></html>`;

function json(request, body, status = 200) {
  return request.respond({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function frameMetrics(first, second, info) {
  let difference = 0;
  let changed = 0;
  const histogram = new Map();
  for (let index = 0; index < first.length; index += 4) {
    const key = `${first[index]},${first[index + 1]},${first[index + 2]},${first[index + 3]}`;
    histogram.set(key, (histogram.get(key) || 0) + 1);
    const delta =
      Math.abs(first[index] - second[index]) +
      Math.abs(first[index + 1] - second[index + 1]) +
      Math.abs(first[index + 2] - second[index + 2]);
    difference += delta;
    if (delta > 6) changed += 1;
  }
  const pixels = first.length / 4;
  let entropy = 0;
  for (const count of histogram.values()) {
    const probability = count / pixels;
    entropy -= probability * Math.log2(probability);
  }
  return {
    size: `${info.width}x${info.height}`,
    entropy: Number(entropy.toFixed(3)),
    meanRgbDelta: Number((difference / (pixels * 3)).toFixed(3)),
    changedPercent: Number(((changed * 100) / pixels).toFixed(2)),
  };
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
  if (url.endsWith('/api/robosa/avatar/metaperson/token')) {
    json(request, {
      accessToken: 'qa-short-lived-token',
      expiresIn: 3600,
      creatorUrl: 'https://metaperson.avatarsdk.com/iframe.html',
    });
    return;
  }
  if (url.endsWith('/api/robosa/avatar/metaperson/import')) {
    json(
      request,
      {
        profile: {
          ...profile,
          avatarModel: {
            status: 'ready',
            provider: 'metaperson',
            size: 463000,
            rigProfile: 'oculus-15',
            updatedAt: new Date().toISOString(),
            url: '/robosa-default.glb',
          },
        },
      },
      201,
    );
    return;
  }
  if (url === 'https://metaperson.avatarsdk.com/iframe.html') {
    request.respond({
      status: 200,
      contentType: 'text/html',
      body: creatorHtml,
    });
    return;
  }
  request.continue();
});

await page.goto('http://127.0.0.1:4173/studio', { waitUntil: 'networkidle0' });
await page.click('[data-studio-tab="appearance"]');
await page.waitForSelector('#media-input');
const input = await page.$('#media-input');
await input.uploadFile(path.join(root, 'public/robosa-twin-default.png'));
await page.waitForSelector('.media-item img');
await page.$eval('#avatar-consent', (checkbox) => checkbox.click());
await page.waitForSelector('[data-action="generate-3d-twin"]:not([disabled])');
await page.click('[data-action="generate-3d-twin"]');
await page.waitForSelector('[data-action="export-avatar"]:not([disabled])');
const customizing = await page.$eval(
  '[data-avatar-creator-status] strong',
  (element) => element.textContent,
);
await page.click('[data-action="export-avatar"]');
await page.waitForFunction(
  () =>
    document.querySelector('.preview-avatar-badge')?.textContent ===
    'Generated 3D',
);
await page.waitForSelector('canvas');

const canvas = await page.$('canvas');
const firstPng = await canvas.screenshot({ type: 'png' });
await new Promise((resolve) => setTimeout(resolve, 650));
const secondPng = await canvas.screenshot({ type: 'png' });
const first = await sharp(firstPng)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const second = await sharp(secondPng).ensureAlpha().raw().toBuffer();
await page.screenshot({
  path: '/tmp/robosa-avatar-generation-desktop.png',
  fullPage: true,
});
const desktop = await page.evaluate(() => ({
  badge: document.querySelector('.preview-avatar-badge')?.textContent,
  status: document.querySelector('#avatar-build-heading')?.textContent,
  rig: document.querySelector('[data-rig-title]')?.textContent,
  overflow:
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await new Promise((resolve) => setTimeout(resolve, 250));
await page.screenshot({
  path: '/tmp/robosa-avatar-generation-mobile.png',
  fullPage: true,
});
const mobile = await page.evaluate(() => ({
  overflow:
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  badge: document.querySelector('.preview-avatar-badge')?.textContent,
}));

console.log(
  JSON.stringify(
    {
      customizing,
      desktop,
      mobile,
      canvas: frameMetrics(first.data, second, first.info),
      errors,
    },
    null,
    2,
  ),
);
await browser.close();
