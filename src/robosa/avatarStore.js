const AVATAR_STORAGE_KEY = 'robosa.avatar.v1';

export const DEFAULT_AVATAR_CONFIG = Object.freeze({
  mode: 'procedural',
  portraitMediaId: '',
  referenceVideoId: '',
  modelMediaId: '',
  lamMediaId: '',
  profileHandle: '',
  consentAt: '',
  captureStatus: 'draft',
  capturePreparedAt: '',
  builtAt: '',
});

function sanitizeAvatarConfig(candidate) {
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  return {
    mode: ['model', 'hosted', 'lam'].includes(source.mode)
      ? source.mode
      : 'procedural',
    portraitMediaId: String(source.portraitMediaId || '').slice(0, 100),
    referenceVideoId: String(source.referenceVideoId || '').slice(0, 100),
    modelMediaId: String(source.modelMediaId || '').slice(0, 100),
    lamMediaId: String(source.lamMediaId || '').slice(0, 100),
    profileHandle: String(source.profileHandle || '')
      .trim()
      .toLowerCase()
      .slice(0, 40),
    consentAt: String(source.consentAt || '').slice(0, 40),
    captureStatus: source.captureStatus === 'ready' ? 'ready' : 'draft',
    capturePreparedAt: String(source.capturePreparedAt || '').slice(0, 40),
    builtAt: String(source.builtAt || '').slice(0, 40),
  };
}

export function loadAvatarConfig(storage = globalThis.localStorage) {
  if (!storage) return { ...DEFAULT_AVATAR_CONFIG };
  try {
    return sanitizeAvatarConfig(
      JSON.parse(storage.getItem(AVATAR_STORAGE_KEY) || 'null'),
    );
  } catch {
    return { ...DEFAULT_AVATAR_CONFIG };
  }
}

export function saveAvatarConfig(config, storage = globalThis.localStorage) {
  const sanitized = sanitizeAvatarConfig(config);
  try {
    storage?.setItem(AVATAR_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // The procedural character remains usable without persistent storage.
  }
  return sanitized;
}

export { AVATAR_STORAGE_KEY, sanitizeAvatarConfig };
