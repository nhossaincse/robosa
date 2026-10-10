import { randomUUID } from 'node:crypto';
import { RobosaServiceError } from './service.js';

export const KNOWLEDGE_KINDS = [
  'resume',
  'profile',
  'project',
  'writing',
  'portfolio',
  'availability',
  'other',
];
export const MAX_KNOWLEDGE_TEXT = 100000;

export function safeSourceUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      url.href.length <= 2000
    )
      return url.href;
  } catch {}
  throw new RobosaServiceError(
    400,
    'INVALID_SOURCE_URL',
    'Use a public HTTPS source URL.',
  );
}

export function sanitizeKnowledge(candidate) {
  const title = String(candidate?.title || '').trim();
  const text = String(candidate?.text || '')
    .replace(/\u0000/g, '')
    .trim();
  const kind = KNOWLEDGE_KINDS.includes(candidate?.kind)
    ? candidate.kind
    : 'other';
  const validUntil = String(candidate?.validUntil || '');
  if (!title || title.length > 160)
    throw new RobosaServiceError(
      400,
      'SOURCE_TITLE_REQUIRED',
      'Add a source title of up to 160 characters.',
    );
  if (!text || text.length > MAX_KNOWLEDGE_TEXT)
    throw new RobosaServiceError(
      400,
      'SOURCE_TEXT_INVALID',
      'Add source text of up to 100,000 characters.',
    );
  if (
    validUntil &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) ||
      !Number.isFinite(Date.parse(validUntil)) ||
      new Date(validUntil).toISOString().slice(0, 10) !== validUntil)
  )
    throw new RobosaServiceError(
      400,
      'SOURCE_DATE_INVALID',
      'Choose a valid expiry date.',
    );
  if (kind === 'availability' && !validUntil)
    throw new RobosaServiceError(
      400,
      'AVAILABILITY_EXPIRY_REQUIRED',
      'Set an expiry date for availability notes.',
    );
  return {
    title,
    text,
    kind,
    url: safeSourceUrl(candidate?.url),
    validUntil,
    status: candidate?.status === 'approved' ? 'approved' : 'draft',
  };
}

export function createKnowledgeService(store) {
  return {
    async list(ownerId, { approvedOnly = false, includeIndex = false } = {}) {
      return store.read((database) =>
        (database.knowledgeSources || [])
          .filter(
            (source) =>
              source.ownerId === ownerId &&
              (!approvedOnly || source.status === 'approved'),
          )
          .map(({ ownerId: _, searchIndex, ...source }) =>
            includeIndex ? { ...source, searchIndex } : source,
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
    },
    async save(ownerId, candidate, id = '') {
      const sanitized = sanitizeKnowledge(candidate);
      return store.mutate((database) => {
        if (!database.profiles.some((profile) => profile.ownerId === ownerId))
          throw new RobosaServiceError(
            404,
            'PROFILE_NOT_FOUND',
            'Profile not found.',
          );
        database.knowledgeSources ||= [];
        const current = id
          ? database.knowledgeSources.find(
              (source) => source.id === id && source.ownerId === ownerId,
            )
          : null;
        if (id && !current)
          throw new RobosaServiceError(
            404,
            'SOURCE_NOT_FOUND',
            'Source not found.',
          );
        const otherSources = database.knowledgeSources.filter(
          (source) => source.ownerId === ownerId && source.id !== id,
        );
        if (
          otherSources.length >= 40 ||
          otherSources.reduce(
            (total, source) => total + source.text.length,
            0,
          ) +
            sanitized.text.length >
            2000000
        )
          throw new RobosaServiceError(
            400,
            'KNOWLEDGE_LIMIT',
            'Your knowledge library is full. Remove a source before adding more.',
          );
        const now = new Date().toISOString();
        const source = current || { id: randomUUID(), ownerId, createdAt: now };
        Object.assign(source, sanitized, { updatedAt: now });
        delete source.searchIndex;
        delete source.indexError;
        source.searchMode = 'keyword';
        if (!current) database.knowledgeSources.push(source);
        const { ownerId: _, ...result } = source;
        return result;
      });
    },
    async setIndex(ownerId, id, updatedAt, searchIndex) {
      await store.mutate((database) => {
        const source = database.knowledgeSources.find(
          (item) => item.id === id && item.ownerId === ownerId,
        );
        if (source?.status === 'approved' && source.updatedAt === updatedAt)
          Object.assign(source, { searchIndex, searchMode: 'semantic' });
      });
    },
    async setIndexFailure(ownerId, id, updatedAt, failure) {
      await store.mutate((database) => {
        const source = database.knowledgeSources?.find(
          (item) => item.id === id && item.ownerId === ownerId,
        );
        if (source?.status === 'approved' && source.updatedAt === updatedAt)
          source.indexError = failure;
      });
    },
    async remove(ownerId, id) {
      await store.mutate((database) => {
        const index = (database.knowledgeSources || []).findIndex(
          (source) => source.id === id && source.ownerId === ownerId,
        );
        if (index < 0)
          throw new RobosaServiceError(
            404,
            'SOURCE_NOT_FOUND',
            'Source not found.',
          );
        database.knowledgeSources.splice(index, 1);
      });
    },
  };
}
