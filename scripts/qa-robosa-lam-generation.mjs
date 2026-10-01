import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = {
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
  if (url.endsWith('/api/robosa/avatar/lam/jobs')) {
    json(
      request,
      { job: { id: 'avjob_aabbcc', status: 'queued', progress: 0 } },
      202,
    );
    return;
  }
  if (url.endsWith('/api/robosa/avatar/lam/jobs/avjob_aabbcc')) {
    json(request, {
      job: {
        id: 'avjob_aabbcc',
        status: 'failed',
        progress: 100,
        error: 'QA stopped before external processing.',
      },
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
await page.waitForSelector('[data-action="generate-lam-twin"]:not([disabled])');

const ready = await page.evaluate(() => ({
  lamLabel: document
    .querySelector('[data-lam-generation-label]')
    ?.textContent.trim(),
  threeDLabel: document
    .querySelector('[data-action="generate-3d-twin"]')
    ?.lastChild.textContent.trim(),
  overflow:
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));

await page.click('[data-action="generate-lam-twin"]');
await page.waitForFunction(() =>
  document
    .querySelector('[data-action="generate-lam-twin"]')
    ?.textContent.includes('Generating'),
);
await page.screenshot({
  path: '/tmp/robosa-lam-generation-desktop.png',
  fullPage: true,
});
const desktop = await page.evaluate(() => ({
  status: document.querySelector('#avatar-build-heading')?.textContent,
  action: document
    .querySelector('[data-lam-generation-label]')
    ?.textContent.trim(),
  buttonWidth: document
    .querySelector('[data-action="generate-lam-twin"]')
    ?.getBoundingClientRect().width,
  overflow:
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await new Promise((resolve) => setTimeout(resolve, 250));
await page.screenshot({
  path: '/tmp/robosa-lam-generation-mobile.png',
  fullPage: true,
});
const mobile = await page.evaluate(() => ({
  action: document
    .querySelector('[data-lam-generation-label]')
    ?.textContent.trim(),
  actionWidth: document
    .querySelector('[data-action="generate-lam-twin"]')
    ?.getBoundingClientRect().width,
  groupWidth: document
    .querySelector('.avatar-generation-buttons')
    ?.getBoundingClientRect().width,
  overflow:
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));

console.log(JSON.stringify({ ready, desktop, mobile, errors }, null, 2));
await browser.close();

if (
  errors.length ||
  ready.lamLabel !== 'Generate LAM portrait' ||
  ready.threeDLabel !== 'Create 3D avatar' ||
  !desktop.action.includes('Generating') ||
  desktop.overflow > 0 ||
  mobile.overflow > 0 ||
  mobile.actionWidth > mobile.groupWidth
) {
  process.exitCode = 1;
}
