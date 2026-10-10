import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { robosaApiPlugin } from '../server/providers/robosa/api.js';
import { robosaRoutesPlugin } from '../server/providers/robosa/routes.js';
import { createRobosaStore } from '../server/providers/robosa/store.js';
import { createAvatarFileStore } from '../server/providers/robosa/avatarFiles.js';

// Isolated account, database, and server: never changes the owner's real profile.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'robosa-knowledge-qa-'));
const document = path.join(directory, 'Robosa project story.txt');
await writeFile(
  document,
  'Robosa started as a prototype for an owner-controlled digital twin.\n\nThe QA prototype was built with Three.js for avatars and Vite for the interface. The challenge was keeping answers grounded in approved documents.',
);
let server, browser;
const previousProvider = process.env.ROBOSA_CHAT_PROVIDER;
process.env.ROBOSA_CHAT_PROVIDER = 'openai';
// All provider requests stay inside this stub; no real documents or keys are used.
const mockOpenAi = async (url, options) => {
  const body = JSON.parse(options.body);
  if (url.endsWith('/embeddings')) {
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    return Response.json({
      data: inputs.map((_, index) => ({
        index,
        embedding: [1, ...Array(511).fill(0)],
      })),
    });
  }
  const input = JSON.parse(body.input);
  if (input.visitorMessage === 'simulate provider failure') {
    return Response.json(
      { error: { code: 'insufficient_quota' } },
      { status: 429 },
    );
  }
  const passage =
    input.retrievedPassages.find((item) => item.kind === 'project') ||
    input.retrievedPassages[0];
  return Response.json({
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              answer: passage.text,
              citation_ids: [passage.passageId],
            }),
          },
        ],
      },
    ],
  });
};
try {
  server = await createServer({
    root,
    configFile: false,
    envFile: false,
    plugins: [
      robosaApiPlugin({
        store: createRobosaStore({ directory }),
        avatarFiles: createAvatarFileStore({
          directory: path.join(directory, 'avatars'),
        }),
        apiKey: 'qa-fixture-key',
        fetchImpl: mockOpenAi,
      }),
      robosaRoutesPlugin(),
    ],
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(`${base}/studio`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#auth-form');
  await page.$eval('[name="handle"]', (input) => {
    input.value = 'knowledge-qa';
  });
  await page.type('[name="email"]', 'knowledge-qa@example.test');
  await page.type('[name="password"]', 'isolated knowledge QA password');
  await page.click('#auth-form [type="submit"]');
  await page.waitForSelector('[data-studio-tab="knowledge"]');
  await page.click('[data-studio-tab="knowledge"]');
  await page.waitForSelector('#knowledge-file');
  const oversizedStatus = await page.evaluate(async () => {
    const response = await fetch(
      '/api/robosa/knowledge/import/file?filename=large.txt',
      {
        method: 'POST',
        body: new Uint8Array(8 * 1024 * 1024 + 1),
      },
    );
    return response.status;
  });
  assert.equal(
    oversizedStatus,
    413,
    'Oversized documents receive a readable HTTP error',
  );
  await page.select('[data-knowledge-field="kind"]', 'project');
  await (await page.$('#knowledge-file')).uploadFile(document);
  await page.waitForFunction(() =>
    document
      .querySelector('[data-knowledge-field="text"]')
      ?.value.includes('Three.js'),
  );
  const before = await page.evaluate(
    async () =>
      (await fetch('/api/robosa/knowledge').then((response) => response.json()))
        .sources.length,
  );
  assert.equal(before, 0, 'Import is a preview, never an automatic approval');
  await page.click('[data-action="save-knowledge-draft"]');
  await page.waitForFunction(
    () => document.querySelector('.knowledge-status')?.textContent === 'Draft',
  );
  await page.click('[data-action="approve-knowledge"]');
  await page.waitForFunction(
    () =>
      document.querySelector('.knowledge-status')?.textContent === 'Approved',
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: '/tmp/robosa-knowledge-desktop.png',
    fullPage: true,
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.screenshot({
    path: '/tmp/robosa-knowledge-mobile.png',
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'Mobile knowledge layout has no horizontal overflow',
  );
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.click('[data-studio-tab="voice"]');
  await page.waitForSelector('[data-action="test-openai"]');
  await page.click('[data-action="test-openai"]');
  await page.waitForSelector('.ai-test-success');
  await page.screenshot({
    path: '/tmp/robosa-openai-voice.png',
    fullPage: true,
  });
  await page.click('[data-action="logout"]');
  await page.waitForSelector('[data-auth-mode="login"]');
  await page.click('[data-auth-mode="login"]');
  await page.type('[name="email"]', 'knowledge-qa@example.test');
  await page.type('[name="password"]', 'isolated knowledge QA password');
  await page.click('#auth-form [type="submit"]');
  await page.waitForSelector('[data-studio-tab="knowledge"]');
  await page.click('[data-studio-tab="knowledge"]');
  await page.waitForFunction(
    () =>
      document.querySelector('.knowledge-status')?.textContent === 'Approved',
  );
  await page.goto(`${base}/knowledge-qa`, { waitUntil: 'networkidle0' });
  async function ask(message) {
    const count = await page.$$eval(
      '.message.assistant',
      (messages) => messages.length,
    );
    await page.type('.chat-input', message);
    await page.click('#chat-form [type="submit"]');
    await page.waitForFunction(
      (previous) =>
        document.querySelectorAll(
          '.message.assistant:not(:has(.typing-bubble))',
        ).length > previous,
      {},
      count,
    );
  }
  await ask('Tell me about Robosa');
  await ask('How was this built?');
  const last = await page.$eval(
    '.message.assistant:last-child',
    (message) => message.textContent,
  );
  assert.match(last, /Three.js/);
  assert.match(last, /Sources/);
  assert.match(last, /OpenAI ·/);
  await page.click('.message.assistant:last-child .message-sources summary');
  await page.screenshot({
    path: '/tmp/robosa-knowledge-chat.png',
    fullPage: true,
  });
  await ask('simulate provider failure');
  const failure = await page.$eval(
    '.message.assistant:last-child',
    (message) => message.textContent,
  );
  assert.match(failure, /OpenAI unavailable/);
  assert.match(failure, /quota|credit|billing/i);
  assert.doesNotMatch(failure, /Three.js/);
  await page.screenshot({
    path: '/tmp/robosa-openai-error.png',
    fullPage: true,
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          'document extraction',
          'draft review',
          'approval',
          'mobile layout',
          'sign-in persistence',
          'follow-up context',
          'source citations',
          'synthetic OpenAI connection check',
          'actual provider label',
          'OpenAI error without rule-based fallback',
        ],
        screenshots: [
          '/tmp/robosa-knowledge-desktop.png',
          '/tmp/robosa-knowledge-mobile.png',
          '/tmp/robosa-knowledge-chat.png',
          '/tmp/robosa-openai-voice.png',
          '/tmp/robosa-openai-error.png',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (previousProvider === undefined) delete process.env.ROBOSA_CHAT_PROVIDER;
  else process.env.ROBOSA_CHAT_PROVIDER = previousProvider;
  await browser?.close();
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
