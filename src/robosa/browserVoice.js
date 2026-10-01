import { visemeForText } from './avatarRig.js';

function visemeForCharacter(character) {
  return visemeForText(character, 0);
}

export class BrowserVoice {
  constructor({
    onTranscript,
    onListeningChange,
    onSpeakingChange,
    onViseme,
    onError,
  }) {
    this.onTranscript = onTranscript;
    this.onListeningChange = onListeningChange;
    this.onSpeakingChange = onSpeakingChange;
    this.onViseme = onViseme;
    this.onError = onError;
    this.recognition = null;
    this.listening = false;
    this.visemeTimer = 0;
    this.visemeCharacters = [];
    this.visemeText = '';
    this.visemeIndex = 0;

    const Recognition =
      globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (Recognition) {
      this.recognition = new Recognition();
      this.recognition.lang = 'en-US';
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.maxAlternatives = 1;
      this.recognition.onstart = () => this.setListening(true);
      this.recognition.onend = () => this.setListening(false);
      this.recognition.onerror = (event) => {
        this.setListening(false);
        const message =
          event.error === 'not-allowed'
            ? 'Microphone permission was not granted.'
            : 'I could not hear that. Try again or type your message.';
        this.onError?.(message);
      };
      this.recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0]?.transcript || '')
          .join(' ')
          .trim();
        if (transcript) this.onTranscript?.(transcript);
      };
    }
  }

  get canListen() {
    return Boolean(this.recognition);
  }

  get canSpeak() {
    return Boolean(
      globalThis.speechSynthesis && globalThis.SpeechSynthesisUtterance,
    );
  }

  setListening(value) {
    this.listening = value;
    this.onListeningChange?.(value);
  }

  toggleListening() {
    if (!this.recognition) {
      this.onError?.(
        'Voice input is not supported in this browser. You can still type below.',
      );
      return;
    }
    if (this.listening) this.recognition.stop();
    else {
      globalThis.speechSynthesis?.cancel();
      this.recognition.start();
    }
  }

  speak(text) {
    if (!this.canSpeak || !String(text || '').trim()) return;
    globalThis.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text));
    utterance.rate = 0.94;
    utterance.pitch = 0.72;
    utterance.volume = 1;

    const voices = globalThis.speechSynthesis.getVoices();
    utterance.voice =
      voices.find(
        (voice) => /^en[-_]/i.test(voice.lang) && voice.localService,
      ) ||
      voices.find((voice) => /^en[-_]/i.test(voice.lang)) ||
      voices[0] ||
      null;
    utterance.onstart = () => {
      this.onSpeakingChange?.(true);
      this.startVisemes(String(text));
    };
    utterance.onboundary = (event) => {
      if (Number.isInteger(event.charIndex)) this.visemeIndex = event.charIndex;
    };
    utterance.onend = () => {
      this.stopVisemes();
      this.onSpeakingChange?.(false);
    };
    utterance.onerror = () => {
      this.stopVisemes();
      this.onSpeakingChange?.(false);
    };
    globalThis.speechSynthesis.speak(utterance);
  }

  startVisemes(text) {
    this.stopVisemes();
    this.visemeText = String(text || '').replace(/\s+/g, ' ');
    this.visemeCharacters = this.visemeText.split('');
    this.visemeIndex = 0;
    this.visemeTimer = globalThis.setInterval(() => {
      const index =
        this.visemeIndex % Math.max(this.visemeCharacters.length, 1);
      const viseme = visemeForText(this.visemeText, index);
      this.onViseme?.(viseme, viseme === 'sil' ? 0.12 : 0.9);
      this.visemeIndex += 1;
    }, 72);
  }

  stopVisemes() {
    globalThis.clearInterval(this.visemeTimer);
    this.visemeTimer = 0;
    this.onViseme?.('sil', 0);
  }

  stopSpeaking() {
    globalThis.speechSynthesis?.cancel();
    this.stopVisemes();
    this.onSpeakingChange?.(false);
  }

  dispose() {
    if (this.listening) this.recognition?.stop();
    this.stopSpeaking();
  }
}

export { visemeForCharacter };
