import { canonicalViseme } from './avatarRig.js';

export const ARKIT_EXPRESSION_NAMES = Object.freeze([
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'mouthCheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeLookDownLeft',
  'eyeLookDownRight',
  'eyeLookInLeft',
  'eyeLookInRight',
  'eyeLookOutLeft',
  'eyeLookOutRight',
  'eyeLookUpLeft',
  'eyeLookUpRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'eyeWideLeft',
  'eyeWideRight',
  'jawForward',
  'jawLeft',
  'jawOpen',
  'jawRight',
  'mouthClose',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthFunnel',
  'mouthLeft',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthPucker',
  'mouthRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'noseSneerLeft',
  'noseSneerRight',
  'tongueOut',
]);

const VISEME_TO_ARKIT = Object.freeze({
  sil: {},
  PP: { mouthClose: 0.95, mouthPressLeft: 0.45, mouthPressRight: 0.45 },
  FF: {
    jawOpen: 0.08,
    mouthLowerDownLeft: 0.24,
    mouthLowerDownRight: 0.24,
    mouthUpperUpLeft: 0.12,
    mouthUpperUpRight: 0.12,
  },
  TH: { jawOpen: 0.22, tongueOut: 0.24 },
  DD: { jawOpen: 0.28, mouthClose: 0.12, tongueOut: 0.05 },
  kk: { jawOpen: 0.42, mouthFunnel: 0.08 },
  CH: { jawOpen: 0.3, mouthFunnel: 0.28, mouthPucker: 0.12 },
  SS: {
    jawOpen: 0.1,
    mouthStretchLeft: 0.52,
    mouthStretchRight: 0.52,
  },
  nn: { jawOpen: 0.2, mouthClose: 0.1, tongueOut: 0.04 },
  RR: { jawOpen: 0.28, mouthFunnel: 0.36, mouthPucker: 0.22 },
  aa: {
    jawOpen: 0.9,
    mouthLowerDownLeft: 0.25,
    mouthLowerDownRight: 0.25,
  },
  E: {
    jawOpen: 0.32,
    mouthSmileLeft: 0.38,
    mouthSmileRight: 0.38,
    mouthStretchLeft: 0.48,
    mouthStretchRight: 0.48,
  },
  I: {
    jawOpen: 0.2,
    mouthSmileLeft: 0.2,
    mouthSmileRight: 0.2,
    mouthStretchLeft: 0.66,
    mouthStretchRight: 0.66,
  },
  O: { jawOpen: 0.58, mouthFunnel: 0.78, mouthPucker: 0.28 },
  U: { jawOpen: 0.3, mouthFunnel: 0.28, mouthPucker: 0.88 },
});

const clamp = (value) => Math.min(Math.max(Number(value) || 0, 0), 1);

export function emptyArkitExpression() {
  return Object.fromEntries(ARKIT_EXPRESSION_NAMES.map((name) => [name, 0]));
}

export function arkitExpressionForVisemes(visemeWeights, blink = 0) {
  const expression = emptyArkitExpression();
  for (const [name, strength] of visemeWeights) {
    const shape = VISEME_TO_ARKIT[canonicalViseme(name)] || VISEME_TO_ARKIT.sil;
    for (const [target, value] of Object.entries(shape)) {
      expression[target] = Math.max(
        expression[target],
        value * clamp(strength),
      );
    }
  }
  expression.eyeBlinkLeft = clamp(blink);
  expression.eyeBlinkRight = clamp(blink);
  return expression;
}

function blinkValue(now) {
  const cycle = now % 4800;
  if (cycle < 90) return cycle / 90;
  if (cycle < 180) return 1 - (cycle - 90) / 90;
  return 0;
}

export class LamTwinStage {
  constructor(
    container,
    { assetUrl = '', onError = () => {}, onReady = () => {} } = {},
  ) {
    this.container = container;
    this.assetUrl = assetUrl;
    this.onError = onError;
    this.onReady = onReady;
    this.visemeWeights = new Map();
    this.speaking = false;
    this.disposed = false;
    this.renderer = null;

    container.classList.add('lam-twin-stage', 'is-lam-loading');
    this.loading = document.createElement('span');
    this.loading.className = 'lam-stage-loading';
    this.loading.textContent = 'Loading LAM avatar';
    container.append(this.loading);
    this.mount();
  }

  async mount() {
    try {
      const { GaussianSplatRenderer } =
        await import('gaussian-splat-renderer-for-lam');
      if (this.disposed) return;
      const renderer = await GaussianSplatRenderer.getInstance(
        this.container,
        this.assetUrl,
        {
          backgroundColor: '0xe9eeeb',
          alpha: 1,
          getChatState: () => (this.speaking ? 'Responding' : 'Idle'),
          getExpressionData: () =>
            arkitExpressionForVisemes(
              this.visemeWeights,
              blinkValue(performance.now()),
            ),
        },
      );
      if (!renderer) throw new Error('The LAM archive could not be loaded.');
      if (this.disposed) {
        renderer.dispose();
        return;
      }
      this.renderer = renderer;
      const camera = renderer.getCamera?.();
      if (camera) {
        camera.zoom = 1.5;
        camera.updateProjectionMatrix?.();
      }
      this.container.classList.remove('is-lam-loading');
      this.loading.remove();
      this.onReady({ level: 'arkit', expressions: ARKIT_EXPRESSION_NAMES });
    } catch (error) {
      if (this.disposed) return;
      this.container.classList.remove('is-lam-loading');
      this.container.classList.add('is-lam-error');
      this.loading.textContent = 'LAM avatar unavailable';
      this.onError(error?.message || 'The LAM avatar could not be loaded.');
    }
  }

  setSpeaking(value) {
    this.speaking = Boolean(value);
    if (!this.speaking) this.setViseme('sil', 0);
  }

  setViseme(name, strength = 1) {
    this.visemeWeights.clear();
    const amount = clamp(strength);
    if (amount > 0) this.visemeWeights.set(canonicalViseme(name), amount);
  }

  setVisemeValue(name, strength = 1) {
    const viseme = canonicalViseme(name);
    const amount = clamp(strength);
    if (amount < 0.001) this.visemeWeights.delete(viseme);
    else this.visemeWeights.set(viseme, amount);
  }

  async previewLipSync() {
    this.setSpeaking(true);
    for (const viseme of ['PP', 'FF', 'TH', 'aa', 'E', 'I', 'O', 'U']) {
      if (this.disposed) return;
      this.setViseme(viseme, 0.95);
      await new Promise((resolve) => globalThis.setTimeout(resolve, 180));
    }
    this.setSpeaking(false);
  }

  resetCamera() {
    this.renderer?.viewer?.controls?.reset?.();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer?.dispose();
    this.renderer = null;
    this.loading?.remove();
    this.container.classList.remove(
      'lam-twin-stage',
      'is-lam-loading',
      'is-lam-error',
    );
  }
}

export { VISEME_TO_ARKIT };
