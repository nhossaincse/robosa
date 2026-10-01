import headAudioModelUrl from '@met4citizen/headaudio/dist/model-en-mixed.bin?url';
import headAudioWorkletUrl from '@met4citizen/headaudio/dist/headworklet.min.mjs?url';
import { VISEME_IDS } from './avatarRig.js';

/** Analyze streamed speech audio into Oculus visemes in the browser. */
export class AudioDrivenLipSync {
  constructor({
    AudioContextImpl = globalThis.AudioContext || globalThis.webkitAudioContext,
    onValue = () => {},
    onError = () => {},
  } = {}) {
    this.AudioContextImpl = AudioContextImpl;
    this.onValue = onValue;
    this.onError = onError;
    this.context = null;
    this.node = null;
    this.readyPromise = null;
    this.sources = new WeakMap();
    this.frame = 0;
    this.lastFrame = 0;
    this.disposed = false;
  }

  get supported() {
    return Boolean(
      this.AudioContextImpl &&
      globalThis.AudioWorkletNode &&
      globalThis.isSecureContext,
    );
  }

  async ensureReady() {
    if (this.disposed || !this.supported) return false;
    if (this.node) return true;
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = (async () => {
      this.context = new this.AudioContextImpl();
      await this.context.audioWorklet.addModule(headAudioWorkletUrl);
      const { HeadAudio } =
        await import('@met4citizen/headaudio/dist/headaudio.min.mjs');
      this.node = new HeadAudio(this.context, {
        parameterData: {
          vadMode: 1,
          vadGateActiveDb: -42,
          vadGateInactiveDb: -56,
          silMode: 0,
        },
      });
      await this.node.loadModel(headAudioModelUrl);
      this.node.onvalue = (name, value) => this.onValue(name, value);
      this.node.start();
      this.lastFrame = performance.now();
      this.update();
      return true;
    })()
      .catch((error) => {
        this.onError('Audio-driven lip sync could not start.');
        this.node = null;
        this.context?.close?.();
        this.context = null;
        return false;
      })
      .finally(() => {
        this.readyPromise = null;
      });
    return this.readyPromise;
  }

  update = (time = performance.now()) => {
    if (this.disposed || !this.node) return;
    const delta = Math.min(Math.max(time - this.lastFrame, 0), 100);
    this.lastFrame = time;
    this.node.update(delta);
    this.frame = requestAnimationFrame(this.update);
  };

  async attach(audio) {
    if (!audio || this.sources.has(audio)) return Boolean(this.node);
    if (!(await this.ensureReady())) return false;
    await this.context.resume();
    const source = this.context.createMediaElementSource(audio);
    source.connect(this.context.destination);
    source.connect(this.node);
    this.sources.set(audio, source);
    return true;
  }

  detach(audio) {
    const source = audio ? this.sources.get(audio) : null;
    if (source) {
      source.disconnect();
      this.sources.delete(audio);
    }
    this.reset();
  }

  reset() {
    for (const viseme of VISEME_IDS) this.onValue(`viseme_${viseme}`, 0);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.reset();
    this.node?.stop();
    this.node?.disconnect();
    this.context?.close?.();
    this.node = null;
    this.context = null;
  }
}
