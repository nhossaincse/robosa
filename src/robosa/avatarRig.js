export const VISEME_IDS = Object.freeze([
  'sil',
  'PP',
  'FF',
  'TH',
  'DD',
  'kk',
  'CH',
  'SS',
  'nn',
  'RR',
  'aa',
  'E',
  'I',
  'O',
  'U',
]);

export const VRM_MOUTH_EXPRESSIONS = Object.freeze([
  'aa',
  'ih',
  'ou',
  'ee',
  'oh',
]);

const VISEME_ALIASES = Object.freeze({
  sil: ['viseme_sil', 'sil'],
  PP: ['viseme_pp', 'viseme_mbp', 'mbp'],
  FF: ['viseme_ff', 'viseme_fv', 'fv'],
  TH: ['viseme_th'],
  DD: ['viseme_dd'],
  kk: ['viseme_kk'],
  CH: ['viseme_ch'],
  SS: ['viseme_ss'],
  nn: ['viseme_nn'],
  RR: ['viseme_rr'],
  aa: ['viseme_aa', 'aa', 'mouth_a'],
  E: ['viseme_e', 'ee', 'mouth_e'],
  I: ['viseme_i', 'ih', 'mouth_i'],
  O: ['viseme_o', 'oh', 'mouth_o'],
  U: ['viseme_u', 'ou', 'mouth_u'],
});

const AUXILIARY_ALIASES = Object.freeze({
  jawOpen: ['jaw_open', 'jawopen', 'mouth_open', 'mouthopen'],
  mouthClose: ['mouth_close', 'mouthclose'],
  mouthFunnel: ['mouth_funnel', 'mouthfunnel'],
  mouthPucker: ['mouth_pucker', 'mouthpucker'],
  mouthSmileLeft: ['mouth_smile_left', 'mouthsmileleft'],
  mouthSmileRight: ['mouth_smile_right', 'mouthsmileright'],
  blinkLeft: ['eye_blink_left', 'eyeblinkleft', 'blink_left', 'blinkleft'],
  blinkRight: ['eye_blink_right', 'eyeblinkright', 'blink_right', 'blinkright'],
  blink: ['eyes_closed', 'eyesclosed', 'blink'],
});

const CANONICAL_LOOKUP = new Map(
  VISEME_IDS.flatMap((id) => [
    [normalizeMorphName(id), id],
    [normalizeMorphName(`viseme_${id}`), id],
  ]),
);
CANONICAL_LOOKUP.set('mbp', 'PP');
CANONICAL_LOOKUP.set('fv', 'FF');
CANONICAL_LOOKUP.set('rest', 'sil');

export function normalizeMorphName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function canonicalViseme(value) {
  return CANONICAL_LOOKUP.get(normalizeMorphName(value)) || 'sil';
}

function targetIndex(entries, aliases) {
  for (const alias of aliases) {
    const index = entries.get(normalizeMorphName(alias));
    if (Number.isInteger(index)) return index;
  }
  return -1;
}

export function createMorphBinding(dictionary = {}) {
  const entries = new Map();
  for (const [name, index] of Object.entries(dictionary)) {
    if (Number.isInteger(index)) entries.set(normalizeMorphName(name), index);
  }

  const visemes = {};
  for (const id of VISEME_IDS) {
    visemes[id] = targetIndex(entries, VISEME_ALIASES[id]);
  }

  const binding = { visemes };
  for (const [name, aliases] of Object.entries(AUXILIARY_ALIASES)) {
    binding[name] = targetIndex(entries, aliases);
  }
  binding.mouthIndices = [
    ...Object.values(visemes),
    binding.jawOpen,
    binding.mouthClose,
    binding.mouthFunnel,
    binding.mouthPucker,
    binding.mouthSmileLeft,
    binding.mouthSmileRight,
  ].filter(
    (index, position, values) =>
      index >= 0 && values.indexOf(index) === position,
  );
  return binding;
}

export function morphValuesForViseme(binding, viseme, strength = 1) {
  const id = canonicalViseme(viseme);
  const amount = Math.max(0, Math.min(Number(strength) || 0, 1));
  const values = new Map();
  const direct = binding?.visemes?.[id] ?? -1;
  if (direct >= 0) {
    values.set(direct, amount);
    return values;
  }

  const set = (name, value) => {
    const index = binding?.[name] ?? -1;
    if (index >= 0 && value > 0) {
      values.set(index, Math.max(values.get(index) || 0, value * amount));
    }
  };

  switch (id) {
    case 'PP':
      set('mouthClose', 1);
      break;
    case 'FF':
      set('mouthFunnel', 0.34);
      set('jawOpen', 0.12);
      break;
    case 'TH':
      set('jawOpen', 0.28);
      break;
    case 'DD':
    case 'nn':
      set('jawOpen', 0.18);
      break;
    case 'kk':
    case 'CH':
      set('jawOpen', 0.3);
      break;
    case 'SS':
      set('mouthSmileLeft', 0.28);
      set('mouthSmileRight', 0.28);
      set('jawOpen', 0.08);
      break;
    case 'RR':
      set('mouthPucker', 0.2);
      set('jawOpen', 0.2);
      break;
    case 'aa':
      set('jawOpen', 0.72);
      break;
    case 'E':
    case 'I':
      set('mouthSmileLeft', id === 'E' ? 0.4 : 0.3);
      set('mouthSmileRight', id === 'E' ? 0.4 : 0.3);
      set('jawOpen', id === 'E' ? 0.32 : 0.24);
      break;
    case 'O':
      set('mouthFunnel', 0.78);
      set('jawOpen', 0.42);
      break;
    case 'U':
      set('mouthPucker', 0.85);
      set('jawOpen', 0.2);
      break;
    default:
      break;
  }
  return values;
}

export function vrmValuesForViseme(viseme, strength = 1) {
  const id = canonicalViseme(viseme);
  const amount = Math.max(0, Math.min(Number(strength) || 0, 1));
  const values = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  const expression = {
    aa: 'aa',
    E: 'ee',
    I: 'ih',
    O: 'oh',
    U: 'ou',
    FF: 'ee',
    TH: 'ih',
    DD: 'ih',
    kk: 'aa',
    CH: 'ih',
    SS: 'ee',
    nn: 'ih',
    RR: 'oh',
  }[id];
  if (expression) {
    const consonant = !['aa', 'E', 'I', 'O', 'U'].includes(id);
    values[expression] = amount * (consonant ? 0.34 : 1);
  }
  return values;
}

export function analyzeAvatarRig(
  bindings = [],
  { vrmExpressions = [], skinnedMeshes = 0 } = {},
) {
  const supported = new Set();
  let hasJaw = false;
  let morphTargetCount = 0;
  for (const binding of bindings) {
    for (const id of VISEME_IDS) {
      if ((binding?.visemes?.[id] ?? -1) >= 0) supported.add(id);
    }
    hasJaw ||= (binding?.jawOpen ?? -1) >= 0;
    morphTargetCount += binding?.mouthIndices?.length || 0;
  }

  const expressions = new Set(vrmExpressions.map((name) => String(name)));
  const hasVrmMouth = VRM_MOUTH_EXPRESSIONS.every((name) =>
    expressions.has(name),
  );
  const oculusCount = VISEME_IDS.filter(
    (id) => id !== 'sil' && supported.has(id),
  ).length;
  const vowelCount = ['aa', 'E', 'I', 'O', 'U'].filter((id) =>
    supported.has(id),
  ).length;
  let level = 'none';
  if (oculusCount >= 10) level = 'full';
  else if (hasVrmMouth || vowelCount === 5) level = 'vrm';
  else if (hasJaw || supported.size) level = 'basic';

  return {
    level,
    standard:
      level === 'full'
        ? 'Oculus visemes'
        : level === 'vrm'
          ? 'VRM vowels'
          : level === 'basic'
            ? 'Jaw fallback'
            : 'No facial rig',
    supportedVisemes: [...supported],
    oculusCount,
    hasVrmMouth,
    hasJaw,
    morphTargetCount,
    skinnedMeshes,
  };
}

export function visemeForText(text, index = 0) {
  const value = String(text || '').toLowerCase();
  const current = value[index] || '';
  const pair = value.slice(index, index + 2);
  if (pair === 'th') return 'TH';
  if (pair === 'sh' || pair === 'ch') return 'CH';
  if ('mbp'.includes(current)) return 'PP';
  if ('fv'.includes(current)) return 'FF';
  if ('td'.includes(current)) return 'DD';
  if ('kg'.includes(current)) return 'kk';
  if ('sz'.includes(current)) return 'SS';
  if ('nl'.includes(current)) return 'nn';
  if (current === 'r') return 'RR';
  if (current === 'a') return 'aa';
  if (current === 'e') return 'E';
  if ('iy'.includes(current)) return 'I';
  if (current === 'o') return 'O';
  if ('uwq'.includes(current)) return 'U';
  return 'sil';
}
