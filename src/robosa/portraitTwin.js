export class PortraitTwinStage {
  constructor(container, { imageUrl = '' } = {}) {
    this.container = container;
    this.disposed = false;
    this.image = document.createElement('img');
    this.image.className = 'portrait-twin-image';
    this.image.src = imageUrl;
    this.image.alt = '';
    this.image.draggable = false;
    container.classList.add('portrait-twin-stage');
    container.append(this.image);
  }

  setSpeaking(value) {
    this.container.classList.toggle('is-portrait-speaking', Boolean(value));
  }

  setViseme() {}
  setVisemeValue() {}
  async previewLipSync() {}
  resetCamera() {}

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.container.classList.remove(
      'portrait-twin-stage',
      'is-portrait-speaking',
    );
    this.image.remove();
  }
}
