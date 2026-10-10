import {
  retrieveKnowledge,
  splitKnowledge,
} from '../../../src/robosa/knowledge.js';
import { openAiFailure } from './openai.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const DIMENSIONS = 512;

async function embed(input, { apiKey, fetchImpl = fetch }) {
  const response = await fetchImpl('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      dimensions: DIMENSIONS,
      encoding_format: 'float',
      input,
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error('Semantic indexing unavailable.'), {
      providerFailure: openAiFailure({
        status: response.status,
        code: data.error?.code,
      }),
    });
  }
  const data = await response.json();
  const rows = [...(data.data || [])].sort((a, b) => a.index - b.index);
  if (
    rows.length !== input.length ||
    rows.some(
      (row, index) =>
        row.index !== index ||
        !Array.isArray(row.embedding) ||
        row.embedding.length !== DIMENSIONS ||
        row.embedding.some((value) => !Number.isFinite(value)),
    )
  )
    throw new Error('Invalid embedding response.');
  return rows.map((row) => row.embedding);
}

export async function indexKnowledgeSource(source, options) {
  const passages = splitKnowledge(source.text);
  const vectors = await embed(
    passages.map((text) => `${source.title}\n${text}`),
    options,
  );
  return {
    model: EMBEDDING_MODEL,
    dimensions: DIMENSIONS,
    passages: passages.map((text, index) => ({ text, vector: vectors[index] })),
  };
}

export function cosineSimilarity(first, second) {
  if (first.length !== second.length) return 0;
  let dot = 0,
    left = 0,
    right = 0;
  for (let index = 0; index < first.length; index++) {
    dot += first[index] * second[index];
    left += first[index] ** 2;
    right += second[index] ** 2;
  }
  return left && right ? dot / Math.sqrt(left * right) : 0;
}

export async function searchKnowledge(options) {
  const lexical = retrieveKnowledge({
    ...options,
    sources: (options.sources || []).map(
      ({ searchIndex: _, ...source }) => source,
    ),
  });
  const indexed = (options.sources || []).filter(
    (source) =>
      source.status === 'approved' &&
      source.searchIndex?.model === EMBEDDING_MODEL &&
      Array.isArray(source.searchIndex.passages) &&
      (!source.validUntil ||
        Date.parse(`${source.validUntil}T23:59:59.999Z`) >=
          (options.now ?? Date.now())),
  );
  if (!options.apiKey || !indexed.length) return lexical;
  try {
    const [queryVector] = await embed([lexical.query], options);
    const semantic = indexed
      .flatMap((source) =>
        source.searchIndex.passages.map((passage, index) => {
          const { searchIndex: _, ...metadata } = source;
          return {
            ...metadata,
            text: passage.text,
            passageId: `${source.id}:${index}`,
            score: cosineSimilarity(queryVector, passage.vector),
          };
        }),
      )
      .filter((passage) => passage.score >= 0.35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    const merged = new Map();
    for (const list of [lexical.passages, semantic])
      for (const [rank, passage] of list.entries()) {
        const previous = merged.get(passage.passageId);
        merged.set(passage.passageId, {
          ...passage,
          score: (previous?.score || 0) + 1 / (60 + rank),
        });
      }
    return {
      ...lexical,
      passages: [...merged.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, lexical.detailed ? 7 : 4),
    };
  } catch {
    return lexical;
  }
}
