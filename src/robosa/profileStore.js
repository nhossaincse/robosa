const PROFILE_STORAGE_KEY = 'robosa.profile.v1';

export const DEFAULT_PROFILE = Object.freeze({
  handle: 'nazmul',
  displayName: 'Nazmul',
  headline: 'Product builder exploring useful, human-centered AI',
  bio: 'I build interactive products at the edge of AI, voice, and spatial computing. My twin can share what I am working on and help arrange a conversation.',
  projects: [
    {
      name: 'Robosa.me',
      summary:
        'A platform for creating an owner-controlled digital twin that can talk, share knowledge, and help with practical tasks.',
    },
    {
      name: 'Robosa Twin Studio',
      summary:
        'A workspace for building a personal knowledge profile and choosing a talking portrait or interactive 3D presence.',
    },
  ],
  facts: [
    'I am currently exploring voice-first AI and digital-twin experiences.',
    'I care about useful interfaces, clear permissions, and technology that earns trust.',
    'The best way to start a collaboration is to share the problem, timeline, and desired outcome.',
  ],
  avatarMediaId: '',
  avatarMode: '3d',
  allowBooking: true,
  speakReplies: true,
  visibility: 'public',
  avatarModel: null,
  portraitAvatar: null,
  lamAvatar: null,
});

function sanitizeAvatarModel(value) {
  if (value?.status !== 'ready' || !value?.url) return null;
  return {
    status: 'ready',
    provider: String(value.provider || '').slice(0, 40),
    size: Math.max(0, Number(value.size) || 0),
    rigProfile: String(value.rigProfile || '').slice(0, 40),
    updatedAt: String(value.updatedAt || '').slice(0, 40),
    url: String(value.url || '').slice(0, 500),
  };
}

function sanitizePortraitAvatar(value) {
  if (value?.status !== 'ready' || !value?.url) return null;
  return {
    status: 'ready',
    contentType: ['image/jpeg', 'image/png', 'image/webp'].includes(
      value.contentType,
    )
      ? value.contentType
      : 'image/jpeg',
    size: Math.max(0, Number(value.size) || 0),
    updatedAt: String(value.updatedAt || '').slice(0, 40),
    url: String(value.url || '').slice(0, 500),
  };
}

function sanitizeLamAvatar(value) {
  if (value?.status !== 'ready' || !value?.url) return null;
  return {
    status: 'ready',
    provider: String(value.provider || 'lam').slice(0, 40),
    size: Math.max(0, Number(value.size) || 0),
    rigProfile: String(value.rigProfile || 'arkit-52').slice(0, 40),
    updatedAt: String(value.updatedAt || '').slice(0, 40),
    url: String(value.url || '').slice(0, 500),
  };
}

function cloneDefaultProfile() {
  return {
    ...DEFAULT_PROFILE,
    projects: DEFAULT_PROFILE.projects.map((project) => ({ ...project })),
    facts: [...DEFAULT_PROFILE.facts],
  };
}

export function normalizeHandle(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function parseLineList(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30);
}

export function parseProjects(value) {
  return parseLineList(value)
    .map((line) => {
      const separator = line.indexOf(':');
      if (separator < 0) return { name: line, summary: '' };
      return {
        name: line.slice(0, separator).trim(),
        summary: line.slice(separator + 1).trim(),
      };
    })
    .filter((project) => project.name)
    .slice(0, 12);
}

export function projectsToText(projects) {
  return (Array.isArray(projects) ? projects : [])
    .map((project) =>
      project.summary
        ? `${project.name}: ${project.summary}`
        : String(project.name || ''),
    )
    .filter(Boolean)
    .join('\n');
}

export function sanitizeProfile(candidate) {
  const fallback = cloneDefaultProfile();
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const handle = normalizeHandle(source.handle) || fallback.handle;
  const visibility = ['public', 'unlisted', 'private'].includes(
    source.visibility,
  )
    ? source.visibility
    : fallback.visibility;

  return {
    handle,
    displayName:
      String(source.displayName || '')
        .trim()
        .slice(0, 80) || fallback.displayName,
    headline:
      String(source.headline || '')
        .trim()
        .slice(0, 180) || fallback.headline,
    bio:
      String(source.bio || '')
        .trim()
        .slice(0, 900) || fallback.bio,
    projects:
      Array.isArray(source.projects) && source.projects.length
        ? source.projects
            .map((project) => ({
              name: String(project?.name || '')
                .trim()
                .slice(0, 80),
              summary: String(project?.summary || '')
                .trim()
                .slice(0, 500),
            }))
            .filter((project) => project.name)
            .slice(0, 12)
        : fallback.projects,
    facts:
      Array.isArray(source.facts) && source.facts.length
        ? source.facts
            .map((fact) =>
              String(fact || '')
                .trim()
                .slice(0, 500),
            )
            .filter(Boolean)
            .slice(0, 30)
        : fallback.facts,
    avatarMediaId: String(source.avatarMediaId || '').slice(0, 100),
    avatarMode: ['portrait', 'lam'].includes(source.avatarMode)
      ? source.avatarMode
      : '3d',
    allowBooking:
      typeof source.allowBooking === 'boolean'
        ? source.allowBooking
        : fallback.allowBooking,
    speakReplies:
      typeof source.speakReplies === 'boolean'
        ? source.speakReplies
        : fallback.speakReplies,
    visibility,
    avatarModel: sanitizeAvatarModel(source.avatarModel),
    portraitAvatar: sanitizePortraitAvatar(source.portraitAvatar),
    lamAvatar: sanitizeLamAvatar(source.lamAvatar),
  };
}

export function loadProfile(storage = globalThis.localStorage) {
  if (!storage) return cloneDefaultProfile();
  try {
    const saved = JSON.parse(storage.getItem(PROFILE_STORAGE_KEY) || 'null');
    return sanitizeProfile(saved);
  } catch {
    return cloneDefaultProfile();
  }
}

export function saveProfile(profile, storage = globalThis.localStorage) {
  const sanitized = sanitizeProfile(profile);
  if (storage) {
    try {
      storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(sanitized));
    } catch {
      // The in-memory profile still works when browser storage is unavailable.
    }
  }
  return sanitized;
}

export { PROFILE_STORAGE_KEY };
