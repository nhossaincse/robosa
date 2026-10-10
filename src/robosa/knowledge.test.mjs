import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import JSZip from 'jszip';
import {
  retrieveKnowledge,
  splitKnowledge,
  profileKnowledge,
} from './knowledge.js';
import { DEFAULT_PROFILE } from './profileStore.js';
import { createRobosaStore } from '../../server/providers/robosa/store.js';
import { createRobosaService } from '../../server/providers/robosa/service.js';
import {
  createKnowledgeService,
  sanitizeKnowledge,
} from '../../server/providers/robosa/knowledgeStore.js';
import {
  extractKnowledgeFile,
  extractWebText,
  validateImportUrl,
  importKnowledgeUrl,
  isPublicAddress,
} from '../../server/providers/robosa/knowledgeImport.js';
import {
  indexKnowledgeSource,
  searchKnowledge,
} from '../../server/providers/robosa/knowledgeSearch.js';
import { answerRobosaChat } from '../../server/providers/robosa/chat.js';
import { createRobosaApiHandler } from '../../server/providers/robosa/api.js';
import { chatConfiguration } from '../../server/providers/robosa/openai.js';

const profile = {
  ...DEFAULT_PROFILE,
  projects: [],
  facts: [],
  headline: 'Product builder',
  bio: 'I build useful products.',
};
const story = {
  id: 'story',
  title: 'How Robosa was created',
  kind: 'project',
  status: 'approved',
  text: 'Robosa started as a prototype for an owner-controlled digital twin.\n\nI built Robosa with Three.js for avatars and Vite for the interface. The challenge was keeping answers grounded in approved documents.',
};
const vector = (coordinate = 0) =>
  Array.from({ length: 512 }, (_, index) => (index === coordinate ? 1 : 0));

test('chunking preserves words and limits long passages', () => {
  const text = 'Detailed project notes and decisions. '.repeat(200);
  const chunks = splitKnowledge(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 1200));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(), text.trim());
});

test('retrieval excludes drafts, expired notes, and template placeholders', () => {
  const sources = [
    story,
    {
      ...story,
      id: 'private',
      status: 'draft',
      text: 'Robosa private salary information.',
    },
    {
      ...story,
      id: 'expired',
      validUntil: '2020-01-01',
      text: 'Robosa was previously available on Monday.',
    },
  ];
  const result = retrieveKnowledge({
    profile,
    sources,
    message: 'Tell me about Robosa in detail',
  });
  assert.ok(result.passages.some((passage) => passage.id === 'story'));
  assert.ok(
    result.passages.every(
      (passage) => !['private', 'expired'].includes(passage.id),
    ),
  );

  assert.equal(
    profileKnowledge({
      ...profile,
      projects: [
        {
          name: 'Robosa origin',
          summary: 'I started because [problem or motivation].',
        },
      ],
    }).length,
    1,
  );
});

test('introductions and career-history questions retrieve resume evidence, including common career typos', () => {
  const resume = {
    id: 'cv',
    title: 'My CV',
    kind: 'resume',
    status: 'approved',
    text: 'Employment\nSoftware engineer at Synthetic Labs, 2021–2024.\n\nEducation\nComputer science degree.\n\nSkills\nJavaScript and distributed systems.',
  };
  for (const message of [
    'tell me about yourself',
    'tell about your career history',
    'tell about your carrer history',
    'tell about your carreer history',
  ]) {
    const result = retrieveKnowledge({ profile, sources: [resume], message });
    assert.ok(
      result.passages.some((p) => p.id === 'cv'),
      message,
    );
  }
});

test('follow-ups recover the project from earlier user turns, never assistant claims', () => {
  const result = retrieveKnowledge({
    profile,
    sources: [story],
    message: 'how was this built?',
    history: [
      { role: 'user', text: 'Tell me about Robosa' },
      { role: 'assistant', text: 'It uses an invented Quantum SDK.' },
      { role: 'user', text: 'tell me more' },
      { role: 'assistant', text: 'Another unsupported claim.' },
    ],
  });
  assert.match(result.query, /Robosa/);
  assert.doesNotMatch(result.query, /Quantum/);
  assert.match(result.passages[0].text, /Three.js/);
  const unrelated = retrieveKnowledge({
    profile,
    sources: [story],
    message: 'Explain space elevators',
    history: [{ role: 'user', text: 'Tell me about Robosa' }],
  });
  assert.equal(unrelated.passages.length, 0);
});

test('availability requires an expiry and date validation is strict', () => {
  assert.throws(
    () => sanitizeKnowledge({ ...story, kind: 'availability' }),
    /expiry/,
  );
  assert.throws(
    () => sanitizeKnowledge({ ...story, validUntil: '2026-02-30' }),
    /valid expiry/,
  );
  assert.throws(
    () => sanitizeKnowledge({ ...story, url: 'javascript:alert(1)' }),
    /HTTPS/,
  );
  const now = Date.parse('2026-10-10T22:00:00Z');
  const source = {
    ...story,
    kind: 'availability',
    validUntil: '2026-10-10',
    text: 'Available for meetings in the America/Toronto timezone on Fridays.',
  };
  assert.ok(
    retrieveKnowledge({
      profile,
      sources: [source],
      message: 'meeting availability',
      now,
    }).passages.length,
  );
  assert.equal(
    retrieveKnowledge({
      profile,
      sources: [source],
      message: 'meeting availability',
      now: now + 86400000,
    }).passages.length,
    0,
  );
});

async function fixture(t) {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'robosa-knowledge-test-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createRobosaStore({ directory });
  const service = createRobosaService(store);
  const owner = await service.register({
    email: 'owner@example.test',
    password: 'knowledge owner password',
    handle: 'knowledge-owner',
    profile,
  });
  const other = await service.register({
    email: 'other@example.test',
    password: 'another owner password',
    handle: 'other-owner',
    profile,
  });
  return {
    directory,
    store,
    service,
    owner,
    other,
    knowledge: createKnowledgeService(store),
  };
}

test('sources persist and owners cannot list, edit, or delete another owner’s knowledge', async (t) => {
  const { directory, owner, other, knowledge } = await fixture(t);
  const saved = await knowledge.save(owner.user.id, story);
  assert.equal(saved.ownerId, undefined);
  assert.deepEqual(await knowledge.list(other.user.id), []);
  await assert.rejects(
    knowledge.save(other.user.id, story, saved.id),
    /Source not found/,
  );
  await assert.rejects(
    knowledge.remove(other.user.id, saved.id),
    /Source not found/,
  );
  const reloaded = createKnowledgeService(createRobosaStore({ directory }));
  assert.equal((await reloaded.list(owner.user.id))[0].text, story.text);
  await knowledge.save(owner.user.id, { ...saved, status: 'draft' }, saved.id);
  assert.deepEqual(
    await knowledge.list(owner.user.id, { approvedOnly: true }),
    [],
  );
});

test('indexes stay on the server and edits discard stale embeddings', async (t) => {
  const { owner, knowledge } = await fixture(t);
  const saved = await knowledge.save(owner.user.id, story);
  const index = {
    model: 'text-embedding-3-small',
    passages: [{ text: story.text, vector: vector() }],
  };
  await knowledge.setIndex(owner.user.id, saved.id, saved.updatedAt, index);
  assert.equal((await knowledge.list(owner.user.id))[0].searchIndex, undefined);
  assert.equal(
    (await knowledge.list(owner.user.id, { includeIndex: true }))[0].searchIndex
      .model,
    index.model,
  );
  await knowledge.save(
    owner.user.id,
    {
      ...saved,
      text: 'Robosa updated project notes for the newer prototype.',
      status: 'draft',
    },
    saved.id,
  );
  await knowledge.setIndex(owner.user.id, saved.id, saved.updatedAt, index);
  const edited = (
    await knowledge.list(owner.user.id, { includeIndex: true })
  )[0];
  assert.equal(edited.status, 'draft');
  assert.equal(edited.searchIndex, undefined);
});

test('TXT, Markdown, HTML, and DOCX import readable text for owner review', async () => {
  const txt = await extractKnowledgeFile(Buffer.from(story.text), 'project.md');
  assert.equal(txt.text, story.text);
  const web = extractWebText(
    '<html><head><title>My portfolio</title></head><body><nav>Secret navigation</nav><main><h1>Robosa</h1><p>I built a digital twin with approved source knowledge.</p><script>secret code</script></main></body></html>',
  );
  assert.equal(web.title, 'My portfolio');
  assert.match(web.text, /Robosa\n/);
  assert.doesNotMatch(web.text, /Secret|secret/);
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Resume: product builder with </w:t></w:r><w:r><w:t>Three.js experience.</w:t></w:r></w:p><w:p><w:r><w:t>Built Robosa prototypes.</w:t></w:r></w:p></w:body></w:document>',
  );
  const doc = await extractKnowledgeFile(
    await zip.generateAsync({ type: 'nodebuffer' }),
    'resume.docx',
  );
  assert.match(doc.text, /product builder with Three.js experience/);
  assert.match(doc.text, /\n\nBuilt Robosa/);
  await assert.rejects(
    extractKnowledgeFile(Buffer.from('binary'), 'resume.exe'),
    /Supported documents/,
  );
  await assert.rejects(
    extractKnowledgeFile(Buffer.alloc(8 * 1024 * 1024 + 1), 'large.txt'),
    /8 MB/,
  );
});

function minimalPdf(text) {
  const stream = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(content));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}

test('searchable PDFs extract text and blank/scanned PDFs ask for readable text', async () => {
  const pdf = await extractKnowledgeFile(
    minimalPdf('Robosa was built with Three.js and Vite.'),
    'resume.pdf',
  );
  assert.match(pdf.text, /Robosa was built with Three.js/);
  await assert.rejects(
    extractKnowledgeFile(minimalPdf(''), 'scan.pdf'),
    /No readable text/,
  );
});

test('URL import rejects private IPs, mixed DNS results, credentials, and LinkedIn sign-in pages', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    '2001:db8::1',
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.ok(isPublicAddress('93.184.216.34'));
  assert.ok(isPublicAddress('2606:4700:4700::1111'));
  for (const url of [
    '',
    'http://example.com',
    'https://127.0.0.1',
    'https://[::1]',
    'https://user:password@example.com',
    'https://linkedin.com/in/owner',
  ])
    await assert.rejects(
      validateImportUrl(url),
      (error) => error.status === 400,
    );
  await assert.rejects(
    validateImportUrl('https://example.com', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]),
    /public website/,
  );
});

test('URL imports pin DNS and revalidate redirects before requesting them', async () => {
  let calls = 0;
  const requestImpl = (_url, options, callback) => {
    calls++;
    options.lookup('example.com', { all: true }, (error, addresses) => {
      assert.equal(error, null);
      assert.equal(addresses[0].address, '93.184.216.34');
    });
    const req = new EventEmitter();
    req.destroy = (error) => req.emit('error', error);
    req.end = () => {
      const response = Readable.from([]);
      response.statusCode = 302;
      response.headers = { location: 'https://127.0.0.1/private' };
      callback(response);
    };
    return req;
  };
  await assert.rejects(
    importKnowledgeUrl('https://example.com', {
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
      requestImpl,
    }),
    /public website/,
  );
  assert.equal(calls, 1);
});

test('semantic search finds paraphrases and excludes draft and expired vectors', async () => {
  const fetchImpl = async (_url, request) => ({
    ok: true,
    json: async () => ({
      data: JSON.parse(request.body).input.map((_, index) => ({
        index,
        embedding: vector(),
      })),
    }),
  });
  const semantic = {
    ...story,
    text: 'I designed a system that keeps personal information under owner control.',
  };
  semantic.searchIndex = await indexKnowledgeSource(semantic, {
    apiKey: 'test-only',
    fetchImpl,
  });
  const result = await searchKnowledge({
    profile,
    sources: [
      semantic,
      { ...semantic, id: 'draft', status: 'draft' },
      { ...semantic, id: 'expired', validUntil: '2020-01-01' },
    ],
    message: 'How does your product protect privacy?',
    apiKey: 'test-only',
    fetchImpl,
  });
  assert.ok(result.passages.some((passage) => passage.id === 'story'));
  assert.ok(
    result.passages.every(
      (passage) => !['draft', 'expired'].includes(passage.id),
    ),
  );
  assert.equal(result.passages[0].searchIndex, undefined);
  const fallback = await searchKnowledge({
    profile,
    sources: [semantic],
    message: 'Robosa',
    apiKey: 'test-only',
    fetchImpl: async () => {
      throw new Error('Offline');
    },
  });
  assert.ok(fallback.passages.length);
});

test('local chat uses detailed source text with citations and supports contextual follow-ups', async () => {
  const answer = await answerRobosaChat({
    profile,
    sources: [story],
    message: 'how was this built?',
    history: [{ role: 'user', text: 'Tell me about Robosa' }],
    apiKey: '',
  });
  assert.match(answer.text, /Three.js/);
  assert.deepEqual(
    answer.citations.map((citation) => citation.id),
    ['story'],
  );
  assert.equal(answer.mode, 'grounded');
});

test('AI receives retrieved approved evidence, conversation context, and valid source IDs', async () => {
  let payload;
  const answer = await answerRobosaChat({
    profile,
    sources: [
      story,
      { ...story, id: 'private', status: 'draft', text: 'SECRET PRIVATE DATA' },
    ],
    message: 'how was this built?',
    history: [{ role: 'user', text: 'Tell me about Robosa' }],
    apiKey: 'test-only',
    fetchImpl: async (_url, request) => {
      payload = JSON.parse(request.body);
      const input = JSON.parse(payload.input);
      const id = input.retrievedPassages.find(
        (passage) => passage.title === story.title,
      ).passageId;
      return {
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            answer:
              'Robosa uses Three.js for avatars and Vite for its interface.',
            citation_ids: [id],
          }),
        }),
      };
    },
  });
  assert.equal(answer.mode, 'ai');
  assert.equal(answer.citations[0].title, story.title);
  assert.doesNotMatch(payload.input, /SECRET PRIVATE DATA/);
  assert.match(JSON.parse(payload.input).resolvedQuestion, /Robosa/);
  assert.match(payload.instructions, /untrusted data/);
  assert.equal(payload.text.format.type, 'json_schema');
  assert.equal(payload.store, false);
  assert.ok(payload.max_output_tokens >= 2400);
});

test('invalid AI citations or provider failures fall back to approved excerpts', async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error('Provider offline');
    },
    async () => ({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          answer: 'An invented story.',
          citation_ids: ['unapproved:0'],
        }),
      }),
    }),
  ]) {
    const answer = await answerRobosaChat({
      profile,
      sources: [story],
      message: 'How was Robosa built?',
      apiKey: 'test-only',
      fetchImpl,
    });
    assert.equal(answer.mode, 'grounded');
    assert.match(answer.text, /Three.js/);
    assert.doesNotMatch(answer.text, /invented/);
  }
});

function mockResponse() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body = '') {
      this.body = body;
    },
  };
}

test('knowledge API authenticates uploads, persists approvals, and cites only the chat owner’s sources', async (t) => {
  const { store, owner, other } = await fixture(t);
  const handler = createRobosaApiHandler({ store, apiKey: '' });
  const call = apiCaller(handler);
  assert.equal((await call('GET', '/knowledge')).status, 401);
  assert.equal(
    (
      await call(
        'POST',
        '/knowledge/import/file?filename=resume.txt',
        story.text,
      )
    ).status,
    401,
  );
  const imported = await call(
    'POST',
    '/knowledge/import/file?filename=resume.txt',
    story.text,
    owner.token,
  );
  assert.equal(imported.status, 200);
  assert.equal(imported.body.text, story.text);
  assert.deepEqual(
    (await call('GET', '/knowledge', null, owner.token)).body.sources,
    [],
  );
  const saved = await call('POST', '/knowledge', story, owner.token);
  assert.equal(saved.status, 201);
  const source = saved.body.source;
  assert.equal(
    (await call('DELETE', `/knowledge/${source.id}`, null, other.token)).status,
    404,
  );
  await call(
    'POST',
    '/knowledge',
    {
      ...story,
      text: 'Robosa is a completely different owner’s secret project.',
    },
    other.token,
  );
  const answer = await call('POST', '/profiles/knowledge-owner/chat', {
    message: 'How was Robosa built?',
  });
  assert.equal(answer.status, 200);
  assert.match(answer.body.text, /Three.js/);
  assert.doesNotMatch(answer.body.text, /secret project/);
  assert.equal(answer.body.citations[0].id, source.id);
  await call(
    'PUT',
    `/knowledge/${source.id}`,
    { ...source, status: 'draft' },
    owner.token,
  );
  const excluded = await call('POST', '/profiles/knowledge-owner/chat', {
    message: 'How was Robosa built?',
  });
  assert.doesNotMatch(excluded.body.text, /Three.js/);
  assert.ok(
    excluded.body.citations.every((citation) => citation.id !== source.id),
  );
});

function apiCaller(handler) {
  return async function call(method, url, body, token) {
    const request = Readable.from(
      body
        ? [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]
        : [],
    );
    Object.assign(request, {
      method,
      url,
      headers: {
        host: 'localhost',
        origin: 'http://localhost',
        ...(token ? { cookie: `robosa_session=${token}` } : {}),
      },
      socket: { remoteAddress: '127.0.0.1' },
    });
    const response = mockResponse();
    await handler(request, response);
    return { status: response.statusCode, body: JSON.parse(response.body) };
  };
}

function useProvider(t, provider) {
  const previous = process.env.ROBOSA_CHAT_PROVIDER;
  process.env.ROBOSA_CHAT_PROVIDER = provider;
  t.after(() => {
    if (previous === undefined) delete process.env.ROBOSA_CHAT_PROVIDER;
    else process.env.ROBOSA_CHAT_PROVIDER = previous;
  });
}

test('OpenAI-only mode reports a missing key instead of returning the generic bio', async (t) => {
  useProvider(t, 'openai');
  const answer = await answerRobosaChat({
    profile,
    sources: [story],
    message: 'How was Robosa built?',
    apiKey: '',
  });
  assert.equal(answer.mode, 'error');
  assert.equal(answer.providerError.code, 'missing_key');
  assert.equal(answer.answerProvider, 'unavailable');
  assert.doesNotMatch(answer.text, /Three.js/);
  assert.equal(
    chatConfiguration('replace-with-your-openai-api-key').keyConfigured,
    false,
  );
});

test('provider failures are visible and raw error text is never exposed', async (t) => {
  useProvider(t, 'openai');
  const failures = [
    [
      401,
      { error: { code: 'invalid_api_key', message: 'secret-key value' } },
      'authentication_failed',
    ],
    [
      429,
      {
        error: { code: 'insufficient_quota', message: 'private request data' },
      },
      'quota_exceeded',
    ],
    [
      200,
      {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      },
      'output_limit',
    ],
  ];
  for (const [status, data, code] of failures) {
    const answer = await answerRobosaChat({
      profile,
      sources: [story],
      message: 'How was Robosa built?',
      apiKey: 'test-only',
      fetchImpl: async () => ({
        ok: status === 200,
        status,
        json: async () => data,
      }),
    });
    assert.equal(answer.mode, 'error');
    assert.equal(answer.providerError.code, code);
    assert.doesNotMatch(
      JSON.stringify(answer),
      /secret-key|private request data/,
    );
  }
});

test('automatic mode labels excerpt fallback and reserves enough space for reasoning and answers', async (t) => {
  useProvider(t, 'auto');
  let payload;
  const answer = await answerRobosaChat({
    profile,
    sources: [story],
    message: 'Tell me about Robosa',
    apiKey: 'test-only',
    fetchImpl: async (_url, request) => {
      payload = JSON.parse(request.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
        }),
      };
    },
  });
  assert.equal(answer.mode, 'grounded');
  assert.equal(answer.answerProvider, 'local');
  assert.equal(answer.providerError.code, 'output_limit');
  assert.ok(payload.max_output_tokens >= 6000);
  assert.equal(payload.reasoning.effort, 'low');
});

test('the owner-only OpenAI connection check sends synthetic data, never uploaded sources', async (t) => {
  useProvider(t, 'openai');
  const { store, owner, knowledge } = await fixture(t);
  await knowledge.save(owner.user.id, {
    ...story,
    text: 'OWNER DOCUMENT CONTENT MUST NOT BE SENT',
  });
  let input;
  const call = apiCaller(
    createRobosaApiHandler({
      store,
      apiKey: 'test-only',
      fetchImpl: async (_url, request) => {
        input = JSON.parse(request.body).input;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            output_text: JSON.stringify({
              answer: 'Synthetic test profile.',
              citation_ids: [],
            }),
          }),
        };
      },
    }),
  );
  assert.equal((await call('POST', '/ai/test')).status, 401);
  const response = await call('POST', '/ai/test', null, owner.token);
  assert.equal(response.body.ok, true);
  assert.match(input, /Synthetic test profile/);
  assert.doesNotMatch(input, /OWNER DOCUMENT CONTENT|Nazmul|Three.js/);
  assert.equal(response.body.keyConfigured, true);
  assert.equal(response.body.apiKey, undefined);
});

test('API approval indexes approved text, persists vectors privately, and uses them for AI answers', async (t) => {
  const { store, owner, knowledge } = await fixture(t);
  const requests = [];
  const handler = createRobosaApiHandler({
    store,
    apiKey: 'test-only',
    fetchImpl: async (url, request) => {
      const payload = JSON.parse(request.body);
      requests.push(url);
      if (url.endsWith('/embeddings'))
        return {
          ok: true,
          json: async () => ({
            data: payload.input.map((_, index) => ({
              index,
              embedding: vector(),
            })),
          }),
        };
      const evidence = JSON.parse(payload.input).retrievedPassages.find(
        (passage) => passage.title === story.title,
      );
      return {
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            answer:
              'The approved project notes describe Three.js avatars and a Vite interface.',
            citation_ids: [evidence.passageId],
          }),
        }),
      };
    },
  });
  const call = apiCaller(handler);
  const draft = await call(
    'POST',
    '/knowledge',
    { ...story, status: 'draft' },
    owner.token,
  );
  assert.equal(draft.status, 201);
  assert.deepEqual(requests, [], 'Draft text is not sent for indexing');
  const approved = await call(
    'PUT',
    `/knowledge/${draft.body.source.id}`,
    story,
    owner.token,
  );
  assert.equal(approved.body.source.searchMode, 'semantic');
  assert.equal(approved.body.source.searchIndex, undefined);
  assert.equal(
    (await knowledge.list(owner.user.id, { includeIndex: true }))[0].searchIndex
      .passages[0].vector.length,
    512,
  );
  const listed = await call('GET', '/knowledge', null, owner.token);
  assert.equal(listed.body.sources[0].searchIndex, undefined);
  const answer = await call('POST', '/profiles/knowledge-owner/chat', {
    message: 'How was Robosa built?',
  });
  assert.equal(answer.body.mode, 'ai');
  assert.equal(answer.body.citations[0].id, draft.body.source.id);
  assert.equal(requests.filter((url) => url.endsWith('/embeddings')).length, 2);
  assert.equal(requests.filter((url) => url.endsWith('/responses')).length, 1);
});
