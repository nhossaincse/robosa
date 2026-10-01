import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadVoiceRuntime,
  normalizeVoiceEndpoint,
  OpenLlmVtuberRuntime,
  runtimeAudioSource,
  runtimeMessageText,
  saveVoiceRuntime,
} from './voiceRuntime.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open', {});
    });
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  close() {
    this.readyState = 3;
    this.emit('close', {});
  }
}

test('voice runtime configuration accepts only WebSocket endpoints', () => {
  assert.equal(
    normalizeVoiceEndpoint('http://localhost:12393/'),
    'ws://localhost:12393/client-ws',
  );
  assert.equal(
    normalizeVoiceEndpoint('javascript:alert(1)'),
    'ws://127.0.0.1:12393/client-ws',
  );

  const storage = memoryStorage();
  saveVoiceRuntime(
    {
      mode: 'open-llm-vtuber',
      endpoint: 'https://voice.example.test/proxy-ws',
    },
    storage,
  );
  assert.deepEqual(loadVoiceRuntime(storage), {
    mode: 'open-llm-vtuber',
    endpoint: 'wss://voice.example.test/proxy-ws',
  });
});

test('Open-LLM-VTuber payload helpers read streamed text and audio', () => {
  assert.equal(
    runtimeMessageText({ display_text: { text: 'Hello there.' } }),
    'Hello there.',
  );
  assert.equal(
    runtimeMessageText({ type: 'full-text', text: 'Thinking...' }),
    '',
  );
  assert.equal(
    runtimeAudioSource({ audio: 'UklGRg==' }),
    'data:audio/wav;base64,UklGRg==',
  );
});

test('Open-LLM-VTuber runtime sends text input and resolves streamed text', async () => {
  FakeWebSocket.instances.length = 0;
  const statuses = [];
  const runtime = new OpenLlmVtuberRuntime({
    WebSocketImpl: FakeWebSocket,
    AudioImpl: null,
    onStatus: (status) => statuses.push(status),
  });

  const answerPromise = runtime.ask(
    'What are you building?',
    'ws://localhost:12393/client-ws',
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = FakeWebSocket.instances[0];
  assert.deepEqual(socket.sent[0], {
    type: 'text-input',
    text: 'What are you building?',
  });

  socket.emit('message', {
    data: JSON.stringify({
      type: 'audio',
      display_text: { text: 'I am building Robosa.' },
    }),
  });
  socket.emit('message', {
    data: JSON.stringify({ type: 'backend-synth-complete' }),
  });

  assert.deepEqual(await answerPromise, { text: 'I am building Robosa.' });
  assert.ok(statuses.includes('thinking'));
  runtime.dispose();
});
