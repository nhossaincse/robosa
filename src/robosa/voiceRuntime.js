import { visemeForCharacter } from './browserVoice.js';

const VOICE_RUNTIME_STORAGE_KEY = 'robosa.voice-runtime.v1';
const DEFAULT_OPEN_LLM_VTUBER_ENDPOINT = 'ws://127.0.0.1:12393/client-ws';

export const DEFAULT_VOICE_RUNTIME = Object.freeze({
  mode: 'robosa',
  endpoint: DEFAULT_OPEN_LLM_VTUBER_ENDPOINT,
});

export function normalizeVoiceEndpoint(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return DEFAULT_OPEN_LLM_VTUBER_ENDPOINT;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (!['ws:', 'wss:'].includes(url.protocol)) {
      return DEFAULT_OPEN_LLM_VTUBER_ENDPOINT;
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    if (url.pathname === '/') url.pathname = '/client-ws';
    return url.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_OPEN_LLM_VTUBER_ENDPOINT;
  }
}

export function sanitizeVoiceRuntime(candidate) {
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  return {
    mode: source.mode === 'open-llm-vtuber' ? source.mode : 'robosa',
    endpoint: normalizeVoiceEndpoint(source.endpoint),
  };
}

export function loadVoiceRuntime(storage = globalThis.localStorage) {
  if (!storage) return { ...DEFAULT_VOICE_RUNTIME };
  try {
    return sanitizeVoiceRuntime(
      JSON.parse(storage.getItem(VOICE_RUNTIME_STORAGE_KEY) || 'null'),
    );
  } catch {
    return { ...DEFAULT_VOICE_RUNTIME };
  }
}

export function saveVoiceRuntime(config, storage = globalThis.localStorage) {
  const sanitized = sanitizeVoiceRuntime(config);
  try {
    storage?.setItem(VOICE_RUNTIME_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // The built-in Robosa voice remains available without local storage.
  }
  return sanitized;
}

export function runtimeMessageText(message) {
  if (!message || typeof message !== 'object') return '';
  if (typeof message.display_text === 'string') {
    return message.display_text.trim();
  }
  if (typeof message.display_text?.text === 'string') {
    return message.display_text.text.trim();
  }
  if (message.type === 'full-text' && typeof message.text === 'string') {
    const text = message.text.trim();
    if (/^(connection established|thinking\.\.\.)$/i.test(text)) return '';
    return text;
  }
  return '';
}

export function runtimeAudioSource(message) {
  const direct = String(message?.audio_url || '').trim();
  if (direct) return direct;
  const encoded = String(message?.audio || '').trim();
  if (!encoded) return '';
  return encoded.startsWith('data:')
    ? encoded
    : `data:audio/wav;base64,${encoded}`;
}

function uniqueText(parts, text) {
  const normalized = String(text || '').trim();
  if (!normalized || parts.at(-1) === normalized) return;
  parts.push(normalized);
}

/**
 * Small adapter for Open-LLM-VTuber's JSON WebSocket protocol. Robosa keeps
 * ownership of its UI and 3D renderer while this client receives generated
 * text/audio and acknowledges browser playback.
 */
export class OpenLlmVtuberRuntime {
  constructor({
    WebSocketImpl = globalThis.WebSocket,
    AudioImpl = globalThis.Audio,
    onStatus = () => {},
    onSpeaking = () => {},
    onViseme = () => {},
    onError = () => {},
    audioLipSync = null,
  } = {}) {
    this.WebSocketImpl = WebSocketImpl;
    this.AudioImpl = AudioImpl;
    this.onStatus = onStatus;
    this.onSpeaking = onSpeaking;
    this.onViseme = onViseme;
    this.onError = onError;
    this.audioLipSync = audioLipSync;
    this.endpoint = '';
    this.socket = null;
    this.connectPromise = null;
    this.pending = null;
    this.audioQueue = [];
    this.currentAudio = null;
    this.preparingAudio = false;
    this.visemeTimer = 0;
    this.status = 'disconnected';
    this.audioEnabled = true;
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }

  async connect(endpoint) {
    const normalized = normalizeVoiceEndpoint(endpoint);
    if (
      this.socket?.readyState === this.WebSocketImpl?.OPEN &&
      this.endpoint === normalized
    ) {
      return;
    }
    if (this.connectPromise && this.endpoint === normalized) {
      return this.connectPromise;
    }
    if (!this.WebSocketImpl) {
      throw new Error(
        'WebSocket voice runtimes are unavailable in this browser.',
      );
    }

    this.disconnect({ rejectPending: false });
    this.endpoint = normalized;
    this.setStatus('connecting');
    this.connectPromise = new Promise((resolve, reject) => {
      const socket = new this.WebSocketImpl(normalized);
      this.socket = socket;
      const timer = globalThis.setTimeout(() => {
        socket.close();
        reject(new Error('Open-LLM-VTuber did not respond.'));
      }, 6000);

      socket.addEventListener('open', () => {
        globalThis.clearTimeout(timer);
        this.setStatus('connected');
        resolve();
      });
      socket.addEventListener('message', (event) => this.handleMessage(event));
      socket.addEventListener('close', () => {
        globalThis.clearTimeout(timer);
        if (this.socket === socket) {
          this.socket = null;
          this.connectPromise = null;
          this.setStatus('disconnected');
        }
      });
      socket.addEventListener('error', () => {
        globalThis.clearTimeout(timer);
        this.setStatus('error');
        reject(new Error('Could not connect to Open-LLM-VTuber.'));
      });
    }).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  async test(endpoint) {
    await this.connect(endpoint);
    return true;
  }

  async ask(text, endpoint) {
    const prompt = String(text || '').trim();
    if (!prompt) throw new Error('Enter a message.');
    if (this.pending) throw new Error('The voice runtime is still responding.');
    await this.connect(endpoint);

    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        this.finishPending(
          new Error('Open-LLM-VTuber took too long to respond.'),
        );
      }, 90_000);
      this.pending = {
        resolve,
        reject,
        timeout,
        parts: [],
        chainComplete: false,
        synthComplete: false,
      };
      this.setStatus('thinking');
      this.send({ type: 'text-input', text: prompt });
    });
  }

  send(payload) {
    if (this.socket?.readyState !== this.WebSocketImpl?.OPEN) return false;
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  handleMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event?.data || '{}'));
    } catch {
      return;
    }

    if (message.type === 'error') {
      const error = new Error(message.message || 'Open-LLM-VTuber failed.');
      this.onError(error.message);
      this.finishPending(error);
      return;
    }

    const text = runtimeMessageText(message);
    if (text && this.pending) uniqueText(this.pending.parts, text);

    if (message.type === 'audio') {
      const source = runtimeAudioSource(message);
      if (source) {
        this.audioQueue.push({
          source,
          text,
          displayText: message.display_text,
          forwarded: Boolean(message.forwarded),
          volumes: Array.isArray(message.volumes) ? message.volumes : [],
        });
        this.playNextAudio();
      }
      return;
    }

    if (message.type === 'backend-synth-complete') {
      if (this.pending) this.pending.synthComplete = true;
      this.maybeFinishPending();
      return;
    }

    if (message.type === 'control') {
      if (message.text === 'conversation-chain-start') {
        this.setStatus('thinking');
      }
      if (message.text === 'conversation-chain-end') {
        if (this.pending) this.pending.chainComplete = true;
        this.maybeFinishPending();
      }
    }
  }

  async playNextAudio() {
    if (this.currentAudio || this.preparingAudio || !this.audioQueue.length) {
      this.maybeFinishPending();
      return;
    }
    if (!this.AudioImpl) {
      this.audioQueue.length = 0;
      this.maybeFinishPending();
      return;
    }

    const item = this.audioQueue.shift();
    if (!this.audioEnabled) {
      this.send({ type: 'frontend-playback-complete' });
      this.playNextAudio();
      return;
    }
    const audio = new this.AudioImpl(item.source);
    this.currentAudio = audio;
    this.preparingAudio = true;
    let audioDriven = false;
    try {
      audioDriven = Boolean(await this.audioLipSync?.attach(audio));
    } catch {
      audioDriven = false;
    } finally {
      this.preparingAudio = false;
    }
    if (this.currentAudio !== audio) {
      this.audioLipSync?.detach(audio);
      return;
    }
    audio.addEventListener('play', () => {
      this.setStatus('speaking');
      this.onSpeaking(true);
      if (!audioDriven) this.startVisemes(item.text, item.volumes, audio);
      this.send({
        type: 'audio-play-start',
        display_text: item.displayText || { text: item.text },
        forwarded: item.forwarded,
      });
    });
    const complete = () => {
      if (this.currentAudio !== audio) return;
      this.audioLipSync?.detach(audio);
      this.stopVisemes();
      this.currentAudio = null;
      this.onSpeaking(false);
      this.send({ type: 'frontend-playback-complete' });
      this.playNextAudio();
    };
    audio.addEventListener('ended', complete, { once: true });
    audio.addEventListener('error', complete, { once: true });
    Promise.resolve(audio.play()).catch(complete);
  }

  startVisemes(text, volumes, audio) {
    this.stopVisemes();
    const characters = String(text || 'a').split('');
    let index = 0;
    this.visemeTimer = globalThis.setInterval(() => {
      const progress =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.currentTime / audio.duration
          : index / Math.max(characters.length, 1);
      const volumeIndex = Math.min(
        Math.floor(progress * volumes.length),
        Math.max(volumes.length - 1, 0),
      );
      const volume = Number(volumes[volumeIndex]);
      const strength = Number.isFinite(volume)
        ? Math.max(0.12, Math.min(volume, 1))
        : 0.82;
      const character = characters[index % characters.length] || 'a';
      this.onViseme(visemeForCharacter(character), strength);
      index += 1;
    }, 72);
  }

  stopVisemes() {
    globalThis.clearInterval(this.visemeTimer);
    this.visemeTimer = 0;
    this.onViseme('rest', 0);
  }

  setAudioEnabled(value) {
    this.audioEnabled = Boolean(value);
    if (this.audioEnabled || !this.currentAudio) return;
    this.audioLipSync?.detach(this.currentAudio);
    this.currentAudio.pause();
    this.currentAudio = null;
    this.audioQueue.length = 0;
    this.stopVisemes();
    this.onSpeaking(false);
    this.send({ type: 'frontend-playback-complete' });
    this.maybeFinishPending();
  }

  maybeFinishPending() {
    if (!this.pending || this.currentAudio || this.audioQueue.length) return;
    if (!this.pending.chainComplete && !this.pending.synthComplete) return;
    this.finishPending();
  }

  finishPending(error) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    globalThis.clearTimeout(pending.timeout);
    this.setStatus(this.socket ? 'connected' : 'disconnected');
    if (error) pending.reject(error);
    else {
      pending.resolve({
        text:
          pending.parts.join(' ').trim() ||
          'The connected voice runtime completed without returning text.',
      });
    }
  }

  interrupt() {
    this.send({ type: 'interrupt-signal', text: '' });
    this.audioQueue.length = 0;
    if (this.currentAudio) {
      this.audioLipSync?.detach(this.currentAudio);
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.stopVisemes();
    this.onSpeaking(false);
    this.finishPending(new Error('The previous response was interrupted.'));
  }

  disconnect({ rejectPending = true } = {}) {
    this.audioQueue.length = 0;
    if (this.currentAudio) {
      this.audioLipSync?.detach(this.currentAudio);
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.stopVisemes();
    this.onSpeaking(false);
    if (rejectPending) {
      this.finishPending(new Error('The voice runtime disconnected.'));
    }
    const socket = this.socket;
    this.socket = null;
    this.connectPromise = null;
    socket?.close();
    this.setStatus('disconnected');
  }

  dispose() {
    this.disconnect();
    this.audioLipSync?.dispose?.();
  }
}

export { DEFAULT_OPEN_LLM_VTUBER_ENDPOINT, VOICE_RUNTIME_STORAGE_KEY };
