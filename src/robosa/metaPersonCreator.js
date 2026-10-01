const METAPERSON_ORIGIN = 'https://metaperson.avatarsdk.com';

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Read failed.'));
    reader.onload = () => {
      const value = String(reader.result || '');
      resolve(value.slice(value.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export class MetaPersonCreator {
  constructor({ apiRequest, onState = () => {}, onExport = async () => {} }) {
    this.apiRequest = apiRequest;
    this.onState = onState;
    this.onExport = onExport;
    this.frame = null;
    this.portrait = null;
    this.listener = (event) => this.handleMessage(event);
    this.exportReady = false;
    this.active = false;
  }

  async open({ frame, portrait }) {
    this.close();
    this.frame = frame;
    this.portrait = portrait;
    this.active = true;
    this.exportReady = false;
    window.addEventListener('message', this.listener);
    this.onState({ status: 'loading', exportReady: false });
    frame.src = `${METAPERSON_ORIGIN}/iframe.html`;
  }

  post(message) {
    this.frame?.contentWindow?.postMessage(message, METAPERSON_ORIGIN);
  }

  async handleMessage(event) {
    if (
      !this.active ||
      event.origin !== METAPERSON_ORIGIN ||
      event.source !== this.frame?.contentWindow ||
      event.data?.source !== 'metaperson_creator'
    ) {
      return;
    }

    const data = event.data;
    try {
      switch (data.eventName) {
        case 'metaperson_creator_loaded': {
          this.onState({ status: 'authenticating', exportReady: false });
          const token = await this.apiRequest('/avatar/metaperson/token', {
            method: 'POST',
          });
          this.post({
            eventName: 'authenticate',
            accessToken: token.accessToken,
          });
          this.post({
            eventName: 'set_export_parameters',
            format: 'glb',
            lod: 1,
            textureProfile: '1K.jpg',
            useZip: false,
            exportTemplateJson: JSON.stringify({
              blendshapes: {
                embed: true,
                list: ['mobile_51', 'visemes_15'],
              },
            }),
          });
          this.post({
            eventName: 'set_ui_parameters',
            isExportButtonVisible: false,
            skipViewerControls: ['animations'],
          });
          break;
        }
        case 'authentication_status':
          if (!data.isAuthenticated) {
            throw new Error(
              data.errorMessage || 'MetaPerson authentication failed.',
            );
          }
          this.onState({ status: 'generating', exportReady: false });
          this.post({
            eventName: 'generate_avatar',
            gender: '',
            age: 'adult',
            image: await blobToBase64(this.portrait),
          });
          break;
        case 'model_generated':
          this.onState({
            status: 'customizing',
            exportReady: this.exportReady,
          });
          break;
        case 'action_availability_changed':
          if (data.actionName === 'avatar_export') {
            this.exportReady = Boolean(data.isAvailable);
            this.onState({
              status: this.exportReady ? 'customizing' : 'generating',
              exportReady: this.exportReady,
            });
          }
          break;
        case 'model_exported':
          this.onState({ status: 'importing', exportReady: false });
          await this.onExport({
            url: data.url,
            avatarCode: data.avatarCode,
          });
          this.onState({ status: 'complete', exportReady: false });
          break;
        default:
          break;
      }
    } catch (error) {
      this.onState({
        status: 'error',
        exportReady: false,
        error: error.message || '3D twin generation failed.',
      });
    }
  }

  exportAvatar() {
    if (!this.active || !this.exportReady) return;
    this.exportReady = false;
    this.onState({ status: 'exporting', exportReady: false });
    this.post({ eventName: 'export_avatar' });
  }

  close() {
    window.removeEventListener('message', this.listener);
    if (this.frame) this.frame.src = 'about:blank';
    this.frame = null;
    this.portrait = null;
    this.exportReady = false;
    this.active = false;
  }
}
