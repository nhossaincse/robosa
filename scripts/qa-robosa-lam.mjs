import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const baseUrl = process.env.ROBOSA_QA_URL || 'http://127.0.0.1:4173';
const handle = process.env.ROBOSA_QA_HANDLE || 'lam-render-qa';
const cookieFile =
  process.env.ROBOSA_QA_COOKIE_FILE || '/tmp/robosa-lam-cookie.txt';

function cookieValue(jar) {
  for (const line of jar.split(/\r?\n/)) {
    if (!line.includes('\trobosa_session\t')) continue;
    return line.split('\t').at(-1);
  }
  return '';
}

async function imageMetrics(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const histogram = new Map();
  for (let index = 0; index < data.length; index += 4) {
    const key = `${data[index] >> 3},${data[index + 1] >> 3},${data[index + 2] >> 3}`;
    histogram.set(key, (histogram.get(key) || 0) + 1);
  }
  const pixels = data.length / 4;
  let entropy = 0;
  for (const count of histogram.values()) {
    const probability = count / pixels;
    entropy -= probability * Math.log2(probability);
  }
  return { data, info, entropy: Number(entropy.toFixed(3)) };
}

function frameDifference(first, second) {
  let changed = 0;
  let difference = 0;
  for (let index = 0; index < first.length; index += 4) {
    const delta =
      Math.abs(first[index] - second[index]) +
      Math.abs(first[index + 1] - second[index + 1]) +
      Math.abs(first[index + 2] - second[index + 2]);
    difference += delta;
    if (delta > 8) changed += 1;
  }
  const pixels = first.length / 4;
  return {
    changedPercent: Number(((changed * 100) / pixels).toFixed(2)),
    meanRgbDelta: Number((difference / (pixels * 3)).toFixed(3)),
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

const session = cookieValue(await readFile(cookieFile, 'utf8'));
if (!session)
  throw new Error(`No Robosa session cookie found in ${cookieFile}`);
await page.setCookie({
  name: 'robosa_session',
  value: session,
  domain: '127.0.0.1',
  path: '/',
  httpOnly: true,
  sameSite: 'Lax',
});

await page.goto(`${baseUrl}/studio`, { waitUntil: 'networkidle0' });
await page.click('[data-studio-tab="appearance"]');
await page.waitForSelector('.lam-twin-stage canvas');
await page.waitForFunction(
  () =>
    !document
      .querySelector('[data-twin-stage]')
      ?.classList.contains('is-lam-loading'),
  { timeout: 30_000 },
);
await new Promise((resolve) => setTimeout(resolve, 2000));

const canvas = await page.$('.lam-twin-stage canvas');
const idlePng = await canvas.screenshot({ type: 'png' });
await new Promise((resolve) => setTimeout(resolve, 760));
const idleControlPng = await canvas.screenshot({ type: 'png' });
await page.click('[data-action="test-lip-sync"]');
await new Promise((resolve) => setTimeout(resolve, 760));
const speakingPng = await canvas.screenshot({ type: 'png' });
const idle = await imageMetrics(idlePng);
const idleControl = await imageMetrics(idleControlPng);
const speaking = await imageMetrics(speakingPng);
await page.screenshot({
  path: '/tmp/robosa-lam-studio-desktop.png',
  fullPage: true,
});
const studio = await page.evaluate(() => ({
  badge: document.querySelector('.preview-avatar-badge')?.textContent,
  readiness: document.querySelector('[data-rig-title]')?.textContent,
  mode: document
    .querySelector('[data-avatar-mode="lam"]')
    ?.getAttribute('aria-checked'),
  canvas: {
    width: document.querySelector('[data-twin-stage] canvas')?.width,
    height: document.querySelector('[data-twin-stage] canvas')?.height,
  },
  overflow:
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));

await page.goto(`${baseUrl}/${handle}`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.lam-twin-stage canvas');
await page.waitForFunction(
  () =>
    !document
      .querySelector('[data-twin-stage]')
      ?.classList.contains('is-lam-loading'),
  { timeout: 30_000 },
);
await new Promise((resolve) => setTimeout(resolve, 1200));
await page.screenshot({
  path: '/tmp/robosa-lam-public-desktop.png',
  fullPage: true,
});
const publicDesktop = await page.evaluate(() => ({
  badge: document.querySelector('.public-avatar-mode-badge')?.textContent,
  canvas: document.querySelectorAll('[data-twin-stage] canvas').length,
  overflow:
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await new Promise((resolve) => setTimeout(resolve, 500));
await page.screenshot({
  path: '/tmp/robosa-lam-public-mobile.png',
  fullPage: true,
});
const publicMobile = await page.evaluate(() => ({
  overflow:
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  stageWidth: document.querySelector('[data-twin-stage]')?.clientWidth,
  stageHeight: document.querySelector('[data-twin-stage]')?.clientHeight,
}));

const result = {
  studio,
  publicDesktop,
  publicMobile,
  canvas: {
    size: `${idle.info.width}x${idle.info.height}`,
    entropy: idle.entropy,
    idleMotion: frameDifference(idle.data, idleControl.data),
    speechMotion: frameDifference(idleControl.data, speaking.data),
  },
  errors,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();

if (
  errors.length ||
  studio.badge !== 'LAM portrait' ||
  studio.readiness !== 'LAM facial animation ready' ||
  studio.mode !== 'true' ||
  idle.entropy < 1 ||
  result.canvas.speechMotion.changedPercent < 0.05 ||
  studio.overflow > 0 ||
  publicDesktop.overflow > 0 ||
  publicMobile.overflow > 0
) {
  process.exitCode = 1;
}
