import { BrowserVoice } from './browserVoice.js';
import { AudioDrivenLipSync } from './audioLipSync.js';
import { loadAvatarConfig, saveAvatarConfig } from './avatarStore.js';
import { addMedia, listMedia, mediaKind, removeMedia } from './mediaStore.js';
import { LamTwinStage } from './lamTwin.js';
import { MetaPersonCreator } from './metaPersonCreator.js';
import { PortraitTwinStage } from './portraitTwin.js';
import {
  loadProfile,
  normalizeHandle,
  parseLineList,
  parseProjects,
  projectsToText,
  saveProfile,
} from './profileStore.js';
import { answerTwin, suggestedQuestions } from './twinBrain.js';
import { Twin3DStage } from './twin3d.js';
import {
  loadVoiceRuntime,
  OpenLlmVtuberRuntime,
  saveVoiceRuntime,
} from './voiceRuntime.js';

const app = document.querySelector('#robosa-app');
const toast = document.querySelector('#robosa-toast');
const DEFAULT_AVATAR = '/robosa-twin-default.png';
const MAX_MEDIA_BYTES = 30 * 1024 * 1024;
const MAX_LAM_BYTES = 120 * 1024 * 1024;
const localProfile = loadProfile();

const STUDIO_TABS = Object.freeze([
  { id: 'identity', label: 'Identity', icon: 'person' },
  { id: 'knowledge', label: 'Knowledge', icon: 'description' },
  { id: 'appearance', label: 'Twin look', icon: 'view_in_ar' },
  { id: 'voice', label: 'Voice', icon: 'record_voice_over' },
  { id: 'permissions', label: 'Boundaries', icon: 'shield' },
]);

const state = {
  profile: localProfile,
  avatar: loadAvatarConfig(),
  voiceRuntime: loadVoiceRuntime(),
  deviceAvatarMediaId: localProfile.avatarMediaId,
  ownerHandle: '',
  media: [],
  mediaUrls: new Map(),
  bookings: [],
  authStatus: 'loading',
  authMode: 'register',
  owner: null,
  routeLoading: true,
  publicFound: true,
  activeHandle: '',
  conversationId: '',
  activeStudioTab: 'identity',
  messages: [],
  pendingReply: false,
  listening: false,
  speaking: false,
  runtimeStatus: 'disconnected',
  rigReport: null,
  lamJob: null,
  audioEnabled: true,
  selectedSlot: '',
  toastTimer: 0,
};
state.audioEnabled = state.profile.speakReplies;
let twinStage = null;

const voice = new BrowserVoice({
  onTranscript: (transcript) => sendMessage(transcript),
  onListeningChange: (listening) => {
    state.listening = listening;
    updateVoiceUi();
  },
  onSpeakingChange: (speaking) => {
    state.speaking = speaking;
    twinStage?.setSpeaking(speaking);
    updateVoiceUi();
  },
  onViseme: (viseme, strength) => twinStage?.setViseme(viseme, strength),
  onError: (message) => showToast(message),
});

const audioLipSync = new AudioDrivenLipSync({
  onValue: (viseme, strength) => twinStage?.setVisemeValue(viseme, strength),
  onError: (message) => showToast(message),
});

const openLlmRuntime = new OpenLlmVtuberRuntime({
  onStatus: (status) => {
    state.runtimeStatus = status;
    updateRuntimeUi();
  },
  onSpeaking: (speaking) => {
    state.speaking = speaking;
    twinStage?.setSpeaking(speaking);
    updateVoiceUi();
  },
  onViseme: (viseme, strength) => twinStage?.setViseme(viseme, strength),
  onError: (message) => showToast(message),
  audioLipSync,
});

const metaPersonCreator = new MetaPersonCreator({
  apiRequest,
  onState: updateMetaPersonUi,
  onExport: importGeneratedAvatar,
});

async function apiRequest(path, options = {}) {
  const response = await fetch(`/api/robosa${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'Request failed.');
    error.status = response.status;
    error.code = payload?.error?.code || 'REQUEST_FAILED';
    throw error;
  }
  return payload;
}

async function loadOwnerSession() {
  try {
    const session = await apiRequest('/session');
    if (!session.authenticated) {
      state.authStatus = 'guest';
      state.owner = null;
      state.ownerHandle = '';
      state.bookings = [];
      return;
    }
    state.authStatus = 'owner';
    state.owner = session.user;
    state.ownerHandle = session.profile.handle;
    state.profile = saveProfile({
      ...session.profile,
      avatarMediaId: state.deviceAvatarMediaId,
    });
    await loadOwnerBookings();
  } catch (error) {
    showToast('The Robosa server is unavailable.');
    state.authStatus = 'guest';
    state.owner = null;
    state.bookings = [];
  }
}

async function loadOwnerBookings() {
  if (state.authStatus !== 'owner') return;
  try {
    const result = await apiRequest('/bookings');
    state.bookings = result.bookings || [];
  } catch {
    state.bookings = [];
  }
}

async function loadPublicProfile(handle) {
  state.routeLoading = true;
  state.publicFound = true;
  render();
  try {
    const result = await apiRequest(`/profiles/${encodeURIComponent(handle)}`);
    state.profile = {
      ...result.profile,
      avatarMediaId:
        state.authStatus === 'owner' &&
        result.profile.handle === state.ownerHandle
          ? state.deviceAvatarMediaId
          : '',
    };
    state.publicFound = true;
    if (state.activeHandle !== handle) {
      state.messages = [];
      state.conversationId = '';
    }
    state.activeHandle = handle;
  } catch (error) {
    state.publicFound = false;
    if (error.status !== 404) showToast('The public twin could not be loaded.');
  } finally {
    state.routeLoading = false;
  }
}

async function hydrateRoute() {
  const route = routeFromLocation();
  if (route.view === 'studio') {
    state.routeLoading = true;
    render();
    await loadOwnerSession();
    state.routeLoading = false;
    return;
  }
  await loadPublicProfile(route.handle);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function icon(name) {
  return `<span class="material-symbols-outlined" aria-hidden="true">${escapeHtml(name)}</span>`;
}

function showToast(message) {
  if (!toast) return;
  window.clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');
  state.toastTimer = window.setTimeout(() => {
    toast.classList.remove('visible');
  }, 2600);
}

function runtimeStatusLabel(status = state.runtimeStatus) {
  return (
    {
      connected: 'Runtime connected',
      connecting: 'Connecting',
      thinking: 'Generating response',
      speaking: 'Speaking',
      error: 'Connection failed',
    }[status] || 'Runtime disconnected'
  );
}

function updateRuntimeUi() {
  const element = document.querySelector('[data-runtime-status]');
  if (!element) return;
  element.dataset.status = state.runtimeStatus;
  const label = element.querySelector('strong');
  if (label) label.textContent = runtimeStatusLabel();
}

function stopAllSpeech() {
  voice.stopSpeaking();
  openLlmRuntime.interrupt();
}

function mediaUrl(record) {
  if (!record) return '';
  if (!state.mediaUrls.has(record.id)) {
    state.mediaUrls.set(record.id, URL.createObjectURL(record.blob));
  }
  return state.mediaUrls.get(record.id);
}

function avatarUrl() {
  const portrait = portraitSourceUrl();
  if (portrait) return portrait;
  const avatar = state.media.find(
    (record) =>
      record.id === state.profile.avatarMediaId &&
      mediaKind(record) === 'image',
  );
  return avatar ? mediaUrl(avatar) : DEFAULT_AVATAR;
}

function localAvatarApplies() {
  return (
    routeFromLocation().view === 'studio' ||
    state.avatar.profileHandle === state.profile.handle
  );
}

function portraitSourceUrl() {
  const localPortrait = localAvatarApplies() ? avatarPortraitRecord() : null;
  if (localPortrait) return mediaUrl(localPortrait);
  return state.profile.portraitAvatar?.status === 'ready'
    ? state.profile.portraitAvatar.url
    : '';
}

function avatarPortraitRecord() {
  const portraitId =
    state.avatar.portraitMediaId || state.profile.avatarMediaId;
  return state.media.find(
    (record) => record.id === portraitId && mediaKind(record) === 'image',
  );
}

function avatarModelRecord() {
  return state.media.find(
    (record) =>
      record.id === state.avatar.modelMediaId && mediaKind(record) === 'model',
  );
}

function lamAvatarRecord() {
  return state.media.find(
    (record) =>
      record.id === state.avatar.lamMediaId && mediaKind(record) === 'lam',
  );
}

function hostedAvatarModel() {
  return state.profile.avatarModel?.status === 'ready'
    ? state.profile.avatarModel
    : null;
}

function hostedLamAvatar() {
  return state.profile.lamAvatar?.status === 'ready'
    ? state.profile.lamAvatar
    : null;
}

function activeAvatarKind() {
  if (state.profile.avatarMode === 'lam' && hostedLamAvatar()) {
    return 'lam';
  }
  if (state.profile.avatarMode === 'portrait' && portraitSourceUrl()) {
    return 'portrait';
  }
  if (
    localAvatarApplies() &&
    state.avatar.mode === 'model' &&
    avatarModelRecord()
  ) {
    return 'imported';
  }
  if (hostedAvatarModel()) return 'generated';
  return 'demo';
}

function avatarKindLabel(kind = activeAvatarKind()) {
  return (
    {
      portrait: 'Static portrait',
      lam: 'LAM portrait',
      generated: 'Generated 3D',
      imported: 'Imported 3D',
      demo: 'Demo character',
    }[kind] || 'Demo character'
  );
}

function mountTwinStage() {
  const container = document.querySelector('[data-twin-stage]');
  if (!container) return;
  const avatarKind = activeAvatarKind();
  if (avatarKind === 'lam') {
    twinStage = new LamTwinStage(container, {
      assetUrl: hostedLamAvatar().url,
      onError: showToast,
      onReady: (report) => {
        state.rigReport = report;
        updateRigReadiness();
      },
    });
    twinStage.setSpeaking(state.speaking);
    return;
  }
  if (avatarKind === 'portrait') {
    twinStage = new PortraitTwinStage(container, {
      imageUrl: portraitSourceUrl(),
    });
    twinStage.setSpeaking(state.speaking);
    return;
  }
  const model = localAvatarApplies() ? avatarModelRecord() : null;
  const localModelActive = state.avatar.mode === 'model' && model;
  const generatedModel = hostedAvatarModel();
  twinStage = new Twin3DStage(container, {
    modelUrl: localModelActive
      ? mediaUrl(model)
      : generatedModel?.url || '/robosa-default.glb',
    onModelError: showToast,
    onModelReady: (report) => {
      state.rigReport = report;
      updateRigReadiness();
    },
  });
  twinStage.setSpeaking(state.speaking);
  document
    .querySelectorAll('[data-action="reset-3d"]')
    .forEach((button) =>
      button.addEventListener('click', () => twinStage?.resetCamera()),
    );
}

function rigReadinessCopy(report = state.rigReport) {
  if (!report) {
    return {
      level: 'checking',
      title: 'Inspecting facial rig',
      detail: 'Checking morph targets and VRM expressions.',
    };
  }
  if (report.level === 'arkit') {
    return {
      level: report.level,
      title: 'LAM facial animation ready',
      detail: `${report.expressions?.length || 52} ARKit expressions available for speech and blinks.`,
    };
  }
  if (report.level === 'full') {
    return {
      level: report.level,
      title: 'Full lip sync ready',
      detail: `${report.oculusCount}/14 Oculus speech shapes detected.`,
    };
  }
  if (report.level === 'vrm') {
    return {
      level: report.level,
      title: 'VRM lip sync ready',
      detail: 'The aa, ih, ou, ee, and oh expressions are available.',
    };
  }
  if (report.level === 'basic') {
    return {
      level: report.level,
      title: 'Basic mouth animation only',
      detail:
        'Add Oculus visemes or VRM vowel expressions for accurate speech.',
    };
  }
  return {
    level: report.level,
    title: 'No facial speech rig detected',
    detail: 'This model can render, but its mouth cannot follow speech yet.',
  };
}

function updateRigReadiness() {
  const container = document.querySelector('[data-rig-readiness]');
  if (!container) return;
  const copy = rigReadinessCopy();
  container.dataset.level = copy.level;
  const title = container.querySelector('[data-rig-title]');
  const detail = container.querySelector('[data-rig-detail]');
  const test = container.querySelector('[data-action="test-lip-sync"]');
  if (title) title.textContent = copy.title;
  if (detail) detail.textContent = copy.detail;
  if (test)
    test.disabled = !state.rigReport || state.rigReport.level === 'none';
}

function disposeTwinStage() {
  twinStage?.dispose();
  twinStage = null;
}

function routeFromLocation() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const query = new URLSearchParams(window.location.search);

  if (!path || path === 'robosa.html') {
    const profile = normalizeHandle(query.get('profile'));
    if (profile) return { view: 'profile', handle: profile };
    return {
      view: query.get('view') === 'profile' ? 'profile' : 'studio',
      handle: state.profile.handle,
    };
  }
  if (path === 'studio' || path === 'robosa') {
    return { view: 'studio', handle: state.profile.handle };
  }
  return { view: 'profile', handle: normalizeHandle(path) };
}

async function navigateTo(path) {
  window.history.pushState({}, '', path);
  stopAllSpeech();
  await hydrateRoute();
  render();
}

function loadingTemplate() {
  return `
    <main class="loading-shell" aria-live="polite">
      <span class="brand-mark">R</span>
      <div class="typing-bubble" aria-label="Loading Robosa"><i></i><i></i><i></i></div>
    </main>`;
}

function authTemplate() {
  const registering = state.authMode === 'register';
  return `
    <main class="auth-shell">
      <header class="auth-header">
        <a class="brand" href="/studio" aria-label="Robosa twin studio">
          <span class="brand-mark">R</span>
          <span>robosa<span class="brand-domain">.me</span></span>
        </a>
        <a class="secondary-button" href="/${escapeHtml(state.profile.handle)}">${icon('public')} View public twin</a>
      </header>
      <section class="auth-workspace" aria-labelledby="auth-title">
        <div class="auth-context">
          <span class="eyebrow">Owner access</span>
          <h1 id="auth-title">${registering ? 'Claim your twin.' : 'Welcome back.'}</h1>
          <p>${registering ? 'Create the owner account for your public profile and approval inbox.' : 'Sign in to manage your twin and meeting requests.'}</p>
          <div class="auth-preview">
            <img src="${escapeHtml(avatarUrl())}" alt="Twin portrait preview" />
            <div><strong>${escapeHtml(state.profile.displayName)}</strong><span>robosa.me/${escapeHtml(state.profile.handle)}</span></div>
          </div>
        </div>
        <div class="auth-form-wrap">
          <div class="auth-tabs" role="tablist" aria-label="Owner access mode">
            <button type="button" role="tab" aria-selected="${registering}" data-auth-mode="register">Create account</button>
            <button type="button" role="tab" aria-selected="${!registering}" data-auth-mode="login">Sign in</button>
          </div>
          <form class="auth-form" id="auth-form">
            ${
              registering
                ? `<label class="form-field">
                    <span class="field-label">Public handle</span>
                    <span class="handle-input"><span>robosa.me/</span><input name="handle" required minlength="2" maxlength="40" value="${escapeHtml(state.profile.handle)}" /></span>
                  </label>`
                : ''
            }
            <label class="form-field">
              <span class="field-label">Email</span>
              <input name="email" type="email" autocomplete="email" required maxlength="180" />
            </label>
            <label class="form-field">
              <span class="field-label">Password</span>
              <input name="password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" required minlength="10" maxlength="256" />
              ${registering ? '<span class="field-hint">At least 10 characters</span>' : ''}
            </label>
            <button class="primary-button auth-submit" type="submit">${registering ? 'Create owner account' : 'Sign in'} ${icon('arrow_forward')}</button>
            <p class="auth-note">${icon('lock')} Your password is hashed on the server. Email verification is not active in this local milestone.</p>
          </form>
        </div>
      </section>
    </main>`;
}

function studioHeader() {
  return `
    <header class="app-header">
      <a class="brand" href="/studio" data-route="studio" aria-label="Robosa twin studio">
        <span class="brand-mark">R</span>
        <span>robosa<span class="brand-domain">.me</span></span>
      </a>
      <div class="header-tabs" role="tablist" aria-label="Robosa views">
        <button class="header-tab" type="button" role="tab" aria-selected="true" data-route="studio">Twin studio</button>
        <button class="header-tab" type="button" role="tab" aria-selected="false" data-route="profile">Public twin</button>
      </div>
      <div class="header-actions">
        <span class="save-state">Saved to account</span>
        <button class="secondary-button" type="button" data-action="copy-link">
          ${icon('content_copy')}<span>Copy link</span>
        </button>
        <button class="icon-button" type="button" data-action="logout" aria-label="Sign out" title="Sign out">
          ${icon('logout')}
        </button>
        <button class="primary-button" type="button" data-route="profile">
          <span>Preview</span>${icon('arrow_forward')}
        </button>
      </div>
    </header>`;
}

function studioSidebar() {
  return `
    <aside class="studio-sidebar" aria-label="Twin setup">
      <p class="sidebar-label">Twin setup</p>
      <nav class="studio-nav">
        ${STUDIO_TABS.map(
          (tab) => `
            <button
              class="studio-nav-button"
              type="button"
              data-studio-tab="${tab.id}"
              aria-current="${state.activeStudioTab === tab.id ? 'page' : 'false'}"
            >
              ${icon(tab.icon)}
              <span>${tab.label}</span>
              ${icon('chevron_right')}
            </button>`,
        ).join('')}
      </nav>
      <p class="sidebar-footnote">Profile and requests are saved to your owner account. Source media stays on this device.</p>
    </aside>`;
}

function identityPanel() {
  return `
    <div class="editor-heading">
      <span class="eyebrow">Identity</span>
      <h1>Shape how your twin introduces you.</h1>
      <p>This is the owner-approved identity visitors see and hear. Keep it direct, specific, and true.</p>
    </div>
    <section class="editor-panel" aria-labelledby="identity-heading">
      <div class="panel-heading">
        <h2 id="identity-heading">Public profile</h2>
        <p>The twin uses these details when someone asks who you are.</p>
      </div>
      <div class="form-grid">
        <label class="form-field">
          <span class="field-label">Display name</span>
          <input name="displayName" data-profile-field="displayName" maxlength="80" value="${escapeHtml(state.profile.displayName)}" />
        </label>
        <label class="form-field">
          <span class="field-label">Public handle</span>
          <span class="handle-input">
            <span>robosa.me/</span>
            <input name="handle" data-profile-field="handle" maxlength="40" value="${escapeHtml(state.profile.handle)}" aria-label="Public handle" />
          </span>
        </label>
        <label class="form-field full">
          <span class="field-label">Headline</span>
          <input name="headline" data-profile-field="headline" maxlength="180" value="${escapeHtml(state.profile.headline)}" />
        </label>
        <label class="form-field full">
          <span class="field-label">Introduction</span>
          <textarea name="bio" data-profile-field="bio" maxlength="900">${escapeHtml(state.profile.bio)}</textarea>
          <span class="field-hint">The twin will not claim feelings, opinions, or experience beyond this approved profile.</span>
        </label>
      </div>
    </section>`;
}

function knowledgePanel() {
  return `
    <div class="editor-heading">
      <span class="eyebrow">Knowledge</span>
      <h1>Give the twin a reliable source of truth.</h1>
      <p>For this prototype, responses come only from the profile, projects, and facts you approve here.</p>
    </div>
    <section class="editor-panel" aria-labelledby="knowledge-heading">
      <div class="panel-heading">
        <h2 id="knowledge-heading">Approved knowledge</h2>
        <p>One project or fact per line keeps the answers predictable.</p>
      </div>
      <div class="form-grid">
        <label class="form-field full">
          <span class="field-label">Projects</span>
          <textarea name="projects" data-profile-field="projects" placeholder="Project name: What it is">${escapeHtml(projectsToText(state.profile.projects))}</textarea>
          <span class="field-hint">Format: project name, colon, then a short description.</span>
        </label>
        <label class="form-field full">
          <span class="field-label">Facts and working preferences</span>
          <textarea name="facts" data-profile-field="facts" placeholder="One approved fact per line">${escapeHtml(state.profile.facts.join('\n'))}</textarea>
        </label>
      </div>
    </section>`;
}

function mediaItem(record) {
  const kind = mediaKind(record);
  const url = mediaUrl(record);
  const isAvatar = state.avatar.portraitMediaId === record.id;
  const isReference = state.avatar.referenceVideoId === record.id;
  const isLam = state.avatar.lamMediaId === record.id;
  const canPublishLam = Boolean(state.avatar.consentAt);
  const isModel =
    state.avatar.mode === 'model' && state.avatar.modelMediaId === record.id;
  const modelFormat =
    kind === 'lam' ? 'LAM ZIP' : /\.vrm$/i.test(record.name) ? 'VRM' : 'GLB';
  let media = `<div class="model-media-preview">${icon('view_in_ar')}<span>${modelFormat}</span></div>`;
  if (kind === 'image') {
    media = `<img src="${escapeHtml(url)}" alt="${escapeHtml(record.name)}" />`;
  } else if (kind === 'video') {
    media = `<video src="${escapeHtml(url)}" aria-label="${escapeHtml(record.name)}" muted playsinline preload="metadata"></video>`;
  }
  return `
    <article class="media-item" data-media-id="${escapeHtml(record.id)}">
      ${media}
      <div class="media-item-actions">
        ${
          kind === 'image'
            ? `<button class="media-action" type="button" data-action="set-avatar" data-media-id="${escapeHtml(record.id)}" ${isAvatar ? 'disabled' : ''} title="${isAvatar ? 'Selected portrait' : 'Use as portrait'}" aria-label="${isAvatar ? 'Selected portrait' : `Use ${escapeHtml(record.name)} as portrait`}">${isAvatar ? icon('check') : icon('person')}</button>`
            : kind === 'video'
              ? `<button class="media-action" type="button" data-action="set-reference-video" data-media-id="${escapeHtml(record.id)}" ${isReference ? 'disabled' : ''} title="${isReference ? 'Selected reference video' : 'Use as reference video'}" aria-label="${isReference ? 'Selected reference video' : `Use ${escapeHtml(record.name)} as reference video`}">${isReference ? icon('check') : icon('video_library')}</button>`
              : kind === 'lam'
                ? `<button class="media-action" type="button" data-action="use-lam-avatar" data-media-id="${escapeHtml(record.id)}" ${isLam && state.profile.avatarMode === 'lam' ? 'disabled' : canPublishLam ? '' : 'disabled'} title="${isLam && state.profile.avatarMode === 'lam' ? 'Active LAM avatar' : canPublishLam ? 'Publish LAM avatar' : 'Record consent before publishing'}" aria-label="${isLam && state.profile.avatarMode === 'lam' ? 'Active LAM avatar' : canPublishLam ? `Publish ${escapeHtml(record.name)} as LAM avatar` : 'Record consent before publishing this LAM avatar'}">${isLam && state.profile.avatarMode === 'lam' ? icon('check') : icon('face')}</button>`
                : `<button class="media-action" type="button" data-action="use-3d-model" data-media-id="${escapeHtml(record.id)}" ${isModel ? 'disabled' : ''} title="${isModel ? 'Active 3D model' : 'Use 3D model'}" aria-label="${isModel ? 'Active 3D model' : `Use ${escapeHtml(record.name)} as 3D model`}">${isModel ? icon('check') : icon('view_in_ar')}</button>`
        }
        <button class="media-action" type="button" data-action="remove-media" data-media-id="${escapeHtml(record.id)}" title="Remove" aria-label="Remove ${escapeHtml(record.name)}">${icon('delete')}</button>
      </div>
    </article>`;
}

function appearancePanel() {
  const hasLocalPortrait = Boolean(avatarPortraitRecord());
  const hasPortrait = Boolean(hasLocalPortrait || state.profile.portraitAvatar);
  const hasVideo = Boolean(
    state.media.find(
      (record) =>
        record.id === state.avatar.referenceVideoId &&
        mediaKind(record) === 'video',
    ),
  );
  const hasConsent = Boolean(state.avatar.consentAt);
  const canUseLam = Boolean(
    hostedLamAvatar() || (lamAvatarRecord() && hasConsent),
  );
  const canUsePortrait = Boolean(
    state.profile.portraitAvatar || (hasLocalPortrait && hasConsent),
  );
  const avatarKind = activeAvatarKind();
  const lamJobActive = ['queued', 'running'].includes(state.lamJob?.status);
  const status =
    avatarKind === 'lam'
      ? 'LAM portrait active'
      : avatarKind === 'portrait'
        ? 'Static portrait active'
        : avatarKind === 'generated'
          ? 'Generated 3D twin active'
          : avatarKind === 'imported'
            ? 'Imported 3D model active'
            : lamJobActive
              ? `Generating LAM portrait ${Math.round(state.lamJob.progress || 0)}%`
              : state.avatar.captureStatus === 'ready'
                ? 'Capture package ready'
                : 'Demo character active';
  const rigCopy =
    avatarKind === 'lam'
      ? {
          level: 'arkit',
          title: 'LAM facial animation ready',
          detail: 'Speech visemes drive the reconstructed ARKit face shapes.',
        }
      : avatarKind === 'portrait'
        ? {
            level: 'none',
            title: 'Static portrait',
            detail: 'Upload a LAM export to animate the reconstructed face.',
          }
        : rigReadinessCopy();
  return `
    <div class="editor-heading">
      <span class="eyebrow">Twin look</span>
      <h1>Choose a reconstructed face or interactive 3D twin.</h1>
      <p>A LAM export animates the person's reconstructed face with ARKit expressions. A plain source photo remains static.</p>
    </div>
    <section class="editor-panel avatar-mode-panel" aria-labelledby="avatar-mode-heading">
      <div class="panel-heading">
        <h2 id="avatar-mode-heading">Published appearance</h2>
        <p>The selected mode appears on the public twin page.</p>
      </div>
      <div class="avatar-mode-switch" role="radiogroup" aria-label="Published twin appearance">
        <button type="button" role="radio" aria-checked="${state.profile.avatarMode === 'lam'}" data-avatar-mode="lam" ${canUseLam ? '' : 'disabled'}>${icon('face')}<span><strong>LAM portrait</strong><small>Reconstructed Gaussian face</small></span></button>
        <button type="button" role="radio" aria-checked="${state.profile.avatarMode === '3d'}" data-avatar-mode="3d">${icon('view_in_ar')}<span><strong>Interactive 3D</strong><small>Generated or imported GLB/VRM</small></span></button>
        <button type="button" role="radio" aria-checked="${state.profile.avatarMode === 'portrait'}" data-avatar-mode="portrait" ${canUsePortrait ? '' : 'disabled'}>${icon('photo_camera')}<span><strong>Static photo</strong><small>Source image, no lip sync</small></span></button>
      </div>
    </section>
    <section class="avatar-build-section" aria-labelledby="avatar-build-heading">
      <div class="avatar-build-heading">
        <div>
          <span class="avatar-state-dot"></span>
          <strong id="avatar-build-heading">${status}</strong>
        </div>
        ${state.avatar.builtAt ? `<span>Updated ${escapeHtml(new Date(state.avatar.builtAt).toLocaleDateString())}</span>` : state.avatar.capturePreparedAt ? `<span>Prepared ${escapeHtml(new Date(state.avatar.capturePreparedAt).toLocaleDateString())}</span>` : ''}
      </div>
      <div class="avatar-build-flow">
        <div class="avatar-build-step ${hasPortrait ? 'complete' : ''}"><span>1</span><div><strong>Front portrait</strong><small>${hasPortrait ? 'Selected' : 'Neutral, evenly lit'}</small></div></div>
        <div class="avatar-build-step ${hasVideo ? 'complete' : ''}"><span>2</span><div><strong>Expression video</strong><small>${hasVideo ? 'Selected for capture record' : 'Optional for this generator'}</small></div></div>
        <div class="avatar-build-step ${hasConsent ? 'complete' : ''}"><span>3</span><div><strong>Consent</strong><small>${hasConsent ? 'Recorded on this device' : 'Required for processing'}</small></div></div>
      </div>
      <label class="consent-row">
        <input id="avatar-consent" type="checkbox" ${hasConsent ? 'checked' : ''} />
        <span>I confirm that this media depicts me or a person who has explicitly authorized this twin.</span>
      </label>
      <div class="avatar-build-actions">
        <span class="field-hint" data-lam-generation>${lamJobActive ? 'Reconstructing the approved portrait on the private GPU worker.' : 'Generate an animated LAM portrait or a customizable 3D avatar.'}</span>
        <div class="avatar-generation-buttons">
          <button class="secondary-button" type="button" data-action="generate-lam-twin" ${hasLocalPortrait && hasConsent && !lamJobActive ? '' : 'disabled'}>${icon('face')}<span data-lam-generation-label>${lamJobActive ? `Generating ${Math.round(state.lamJob.progress || 0)}%` : 'Generate LAM portrait'}</span></button>
          <button class="primary-button" type="button" data-action="generate-3d-twin" ${hasLocalPortrait && hasConsent && !lamJobActive ? '' : 'disabled'}>${icon('view_in_ar')} Create 3D avatar</button>
        </div>
      </div>
    </section>
    ${
      avatarKind !== 'demo'
        ? `<section class="rig-readiness" data-rig-readiness data-level="${escapeHtml(rigCopy.level)}" aria-live="polite">
            <span class="rig-readiness-icon">${icon('graphic_eq')}</span>
            <div><strong data-rig-title>${escapeHtml(rigCopy.title)}</strong><span data-rig-detail>${escapeHtml(rigCopy.detail)}</span></div>
            <button class="secondary-button" type="button" data-action="test-lip-sync" ${avatarKind === 'lam' || (avatarKind !== 'portrait' && state.rigReport && state.rigReport.level !== 'none') ? '' : 'disabled'}>${icon('play_arrow')} Test lips</button>
          </section>`
        : ''
    }
    <section class="editor-panel" aria-labelledby="appearance-heading">
      <div class="panel-heading">
        <h2 id="appearance-heading">Source media</h2>
        <p>Capture media, GLB/VRM, or a LAM avatar ZIP. LAM archives can be up to 120 MB.</p>
      </div>
      <label class="drop-zone" id="media-drop-zone" for="media-input">
        <span>
          ${icon('upload')}
          <strong>Add capture media or generated model</strong>
          <small>Images, videos, GLB, VRM, and LAM ZIP files</small>
        </span>
      </label>
      <input class="media-input" id="media-input" type="file" accept="image/*,video/*,.glb,.vrm,.zip,model/gltf-binary,application/zip" multiple />
      <div class="media-grid" id="media-grid">
        ${state.media.length ? state.media.map(mediaItem).join('') : '<div class="media-empty">No source media yet. The interactive procedural twin remains active.</div>'}
      </div>
    </section>`;
}

function voicePanel() {
  const external = state.voiceRuntime.mode === 'open-llm-vtuber';
  return `
    <div class="editor-heading">
      <span class="eyebrow">Voice</span>
      <h1>Choose the conversation runtime.</h1>
      <p>Use Robosa's grounded conversation by default, or connect a self-hosted Open-LLM-VTuber WebSocket for its configured local agent, speech, and interruption pipeline.</p>
    </div>
    <section class="editor-panel" aria-labelledby="voice-runtime-heading">
      <div class="panel-heading">
        <h2 id="voice-runtime-heading">Runtime</h2>
        <p>The selection is stored on this device.</p>
      </div>
      <div class="runtime-options" role="radiogroup" aria-label="Conversation runtime">
        <label class="runtime-option ${external ? '' : 'selected'}">
          <input type="radio" name="voiceRuntime" value="robosa" ${external ? '' : 'checked'} />
          <span>${icon('shield')}<strong>Robosa grounded</strong><small>Owner-approved profile and browser voice</small></span>
        </label>
        <label class="runtime-option ${external ? 'selected' : ''}">
          <input type="radio" name="voiceRuntime" value="open-llm-vtuber" ${external ? 'checked' : ''} />
          <span>${icon('graphic_eq')}<strong>Open-LLM-VTuber</strong><small>Self-hosted agent, TTS, and audio streaming</small></span>
        </label>
      </div>
      <div class="runtime-connection ${external ? '' : 'is-disabled'}">
        <label class="form-field">
          <span class="field-label">WebSocket endpoint</span>
          <input id="voice-runtime-endpoint" type="url" value="${escapeHtml(state.voiceRuntime.endpoint)}" ${external ? '' : 'disabled'} />
        </label>
        <button class="secondary-button" type="button" data-action="test-runtime" ${external ? '' : 'disabled'}>${icon('graphic_eq')} Test connection</button>
      </div>
      <div class="runtime-status" data-runtime-status data-status="${escapeHtml(state.runtimeStatus)}">
        <span></span><strong>${escapeHtml(runtimeStatusLabel())}</strong>
      </div>
      <p class="runtime-note">Open-LLM-VTuber mode uses the character and knowledge configured on that runtime. Robosa's public profile safeguards apply only in grounded mode.</p>
    </section>`;
}

function bookingRequestList() {
  if (!state.bookings.length) {
    return '<div class="media-empty">No meeting requests yet.</div>';
  }
  return state.bookings
    .slice(0, 8)
    .map(
      (booking) => `
        <div class="permission-row booking-review-row">
          <div class="permission-copy">
            <strong>${escapeHtml(booking.guestName || 'Guest')} &middot; ${escapeHtml(booking.slot)}</strong>
            <span>${escapeHtml(booking.guestEmail)} &middot; <b class="booking-status ${escapeHtml(booking.status)}">${escapeHtml(booking.status)}</b></span>
          </div>
          ${
            booking.status === 'pending'
              ? `<div class="booking-actions">
                  <button class="quiet-button" type="button" data-booking-status="declined" data-booking-id="${escapeHtml(booking.id)}">Decline</button>
                  <button class="primary-button" type="button" data-booking-status="approved" data-booking-id="${escapeHtml(booking.id)}">${icon('check')} Approve</button>
                </div>`
              : icon(booking.status === 'approved' ? 'check' : 'close')
          }
        </div>`,
    )
    .join('');
}

function permissionsPanel() {
  return `
    <div class="editor-heading">
      <span class="eyebrow">Boundaries</span>
      <h1>Decide what the twin may do.</h1>
      <p>Public conversation and owner actions stay separate. The twin never exposes private calendar details.</p>
    </div>
    <section class="editor-panel" aria-labelledby="permissions-heading">
      <div class="panel-heading">
        <h2 id="permissions-heading">Public permissions</h2>
        <p>Save changes to update the public twin.</p>
      </div>
      <div class="form-grid">
        <label class="form-field full">
          <span class="field-label">Profile visibility</span>
          <select name="visibility" data-profile-field="visibility">
            <option value="public" ${state.profile.visibility === 'public' ? 'selected' : ''}>Public and discoverable</option>
            <option value="unlisted" ${state.profile.visibility === 'unlisted' ? 'selected' : ''}>Unlisted link</option>
            <option value="private" ${state.profile.visibility === 'private' ? 'selected' : ''}>Private preview</option>
          </select>
        </label>
      </div>
      <div class="permission-list">
        <div class="permission-row">
          <div class="permission-copy">
            <strong>Accept meeting requests</strong>
            <span>Visitors can propose a time without seeing calendar details.</span>
          </div>
          <label class="switch">
            <input type="checkbox" name="allowBooking" data-profile-field="allowBooking" ${state.profile.allowBooking ? 'checked' : ''} aria-label="Accept meeting requests" />
            <span class="switch-track"></span>
          </label>
        </div>
        <div class="permission-row">
          <div class="permission-copy">
            <strong>Speak replies</strong>
            <span>Use the browser's synthetic voice for public answers.</span>
          </div>
          <label class="switch">
            <input type="checkbox" name="speakReplies" data-profile-field="speakReplies" ${state.profile.speakReplies ? 'checked' : ''} aria-label="Speak replies" />
            <span class="switch-track"></span>
          </label>
        </div>
      </div>
    </section>
    <section class="editor-panel" aria-labelledby="requests-heading" style="margin-top: 38px">
      <div class="panel-heading">
        <h2 id="requests-heading">Recent requests</h2>
        <p>${state.bookings.filter((booking) => booking.status === 'pending').length} awaiting review</p>
      </div>
      <div class="permission-list">${bookingRequestList()}</div>
    </section>`;
}

function editorPanel() {
  switch (state.activeStudioTab) {
    case 'knowledge':
      return knowledgePanel();
    case 'appearance':
      return appearancePanel();
    case 'voice':
      return voicePanel();
    case 'permissions':
      return permissionsPanel();
    default:
      return identityPanel();
  }
}

function twinPreview() {
  const avatarKind = activeAvatarKind();
  const isStaticPortrait = avatarKind === 'portrait';
  return `
    <aside class="preview-column" aria-label="Live twin preview">
      <div class="preview-heading">
        <span class="preview-label">Live preview</span>
        <span class="preview-status">Ready to talk</span>
      </div>
      <div class="twin-preview">
        <div class="preview-avatar-wrap twin-stage-wrap">
          <div class="twin-3d-stage" data-twin-stage role="img" aria-label="${isStaticPortrait ? 'Static portrait twin preview' : avatarKind === 'lam' ? 'Animated LAM portrait twin preview' : 'Interactive 3D twin preview'}"></div>
          <div class="twin-stage-tools">
            <span class="preview-avatar-badge">${avatarKindLabel(avatarKind)}</span>
            ${isStaticPortrait ? '' : `<button class="stage-icon-button" type="button" data-action="reset-3d" aria-label="Reset avatar view" title="Reset avatar view">${icon('3d_rotation')}</button>`}
          </div>
        </div>
        <div class="preview-copy">
          <span class="section-kicker">Meet the twin</span>
          <h3 data-preview="displayName">${escapeHtml(state.profile.displayName)}</h3>
          <p data-preview="headline">${escapeHtml(state.profile.headline)}</p>
          <button class="primary-button" type="button" data-route="profile">${icon('mic')} Talk to my twin</button>
          <button class="quiet-button preview-edit-avatar" type="button" data-studio-tab="appearance">${icon('view_in_ar')} Edit twin look</button>
          <div class="preview-url">
            <span data-preview="url">robosa.me/${escapeHtml(state.profile.handle)}</span>
            ${icon('public')}
          </div>
        </div>
      </div>
    </aside>`;
}

function studioTemplate() {
  return `
    ${studioHeader()}
    <main class="studio-shell">
      ${studioSidebar()}
      <div class="studio-workspace">
        <form class="editor-column" id="studio-form">
          ${editorPanel()}
          <div class="editor-actions">
            <span class="field-hint">Owner-controlled twin</span>
            <div class="editor-actions-right">
              <button class="secondary-button" type="button" data-action="save-profile">Save changes</button>
              <button class="primary-button" type="button" data-route="profile">Publish preview ${icon('arrow_forward')}</button>
            </div>
          </div>
        </form>
        ${twinPreview()}
      </div>
    </main>
    ${metaPersonDialog()}`;
}

function metaPersonDialog() {
  return `
    <dialog class="avatar-creator-dialog" id="avatar-creator-dialog">
      <div class="avatar-creator-header">
        <div>
          <span class="section-kicker">3D generation</span>
          <h2>Create your 3D twin</h2>
        </div>
        <button class="icon-button small" type="button" data-action="close-avatar-creator" aria-label="Close 3D twin creator">${icon('close')}</button>
      </div>
      <div class="avatar-creator-status" data-avatar-creator-status data-status="loading" aria-live="polite">
        <span class="avatar-state-dot"></span>
        <strong>Loading creator</strong>
      </div>
      <iframe class="avatar-creator-frame" id="avatar-creator-frame" title="MetaPerson 3D avatar creator" allow="fullscreen"></iframe>
      <div class="avatar-creator-actions">
        <span>Owner-approved portrait</span>
        <button class="primary-button" type="button" data-action="export-avatar" disabled>${icon('download')} Export and use</button>
      </div>
    </dialog>`;
}

function publicHeader() {
  return `
    <header class="public-header">
      <a class="brand" href="/studio" data-route="studio" aria-label="Robosa twin studio">
        <span class="brand-mark">R</span>
        <span>robosa<span class="brand-domain">.me</span></span>
      </a>
      <div class="public-header-actions">
        <button class="secondary-button" type="button" data-action="copy-link">${icon('content_copy')}<span>Share twin</span></button>
        <button class="primary-button" type="button" data-route="studio">${icon('add')}<span>Create my twin</span></button>
      </div>
    </header>`;
}

function publicIdentity() {
  const avatarKind = activeAvatarKind();
  const isStaticPortrait = avatarKind === 'portrait';
  return `
    <section class="public-identity" aria-labelledby="public-name">
      <div class="identity-inner">
        <div class="public-twin-stage-wrap ${state.speaking ? 'is-speaking' : ''}" data-speaking-frame>
          <div class="twin-3d-stage public-twin-stage" data-twin-stage role="img" aria-label="${escapeHtml(state.profile.displayName)}'s ${isStaticPortrait ? 'static portrait' : avatarKind === 'lam' ? 'animated LAM portrait' : 'interactive 3D'} AI representative"></div>
          <span class="preview-avatar-badge public-avatar-mode-badge">${avatarKindLabel(avatarKind)}</span>
          <span class="speaking-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          ${isStaticPortrait ? '' : `<button class="stage-icon-button public-stage-reset" type="button" data-action="reset-3d" aria-label="Reset avatar view" title="Reset avatar view">${icon('3d_rotation')}</button>`}
        </div>
        <span class="identity-badge">${icon('smart_toy')} AI representative</span>
        <h1 id="public-name">${escapeHtml(state.profile.displayName)}</h1>
        <p class="identity-headline">${escapeHtml(state.profile.headline)}</p>
        <p class="identity-bio">${escapeHtml(state.profile.bio)}</p>
        <div class="identity-actions">
          ${state.profile.allowBooking ? `<button class="primary-button" type="button" data-action="open-booking">${icon('calendar_month')} Request a meeting</button>` : ''}
          <button class="secondary-button" type="button" data-action="ask-work">${icon('auto_awesome')} Ask about my work</button>
        </div>
      </div>
    </section>`;
}

function messageTemplate(message) {
  if (message.role === 'user') {
    return `
      <article class="message user">
        <div class="message-bubble">${escapeHtml(message.text)}</div>
        <span class="message-avatar" aria-hidden="true">${icon('person')}</span>
      </article>`;
  }
  return `
    <article class="message assistant">
      <span class="message-avatar" aria-hidden="true"><img src="${escapeHtml(avatarUrl())}" alt="" /></span>
      <div class="message-bubble">${escapeHtml(message.text)}</div>
    </article>`;
}

function bookingDialog() {
  const slots = [
    'Tuesday, 10:00 AM',
    'Tuesday, 2:30 PM',
    'Wednesday, 11:00 AM',
    'Thursday, 3:00 PM',
  ];
  return `
    <dialog class="booking-dialog" id="booking-dialog">
      <div class="dialog-header">
        <div>
          <span class="section-kicker">Meeting request</span>
          <h2>Talk with ${escapeHtml(state.profile.displayName)}</h2>
        </div>
        <button class="icon-button small" type="button" data-action="close-booking" aria-label="Close meeting request">${icon('close')}</button>
      </div>
      <form class="booking-form" id="booking-form">
        <div>
          <span class="field-label">Choose a proposed time</span>
          <div class="slot-grid" style="margin-top: 8px">
            ${slots
              .map(
                (slot) =>
                  `<button class="slot-button" type="button" data-slot="${escapeHtml(slot)}" aria-pressed="${state.selectedSlot === slot}">${escapeHtml(slot)}</button>`,
              )
              .join('')}
          </div>
        </div>
        <label class="form-field">
          <span class="field-label">Your name</span>
          <input name="guestName" autocomplete="name" required maxlength="100" />
        </label>
        <label class="form-field">
          <span class="field-label">Email</span>
          <input name="guestEmail" type="email" autocomplete="email" required maxlength="180" />
        </label>
        <p class="dialog-note">This request goes to the owner's approval inbox. It does not create a calendar event yet.</p>
        <div class="dialog-actions">
          <button class="secondary-button" type="button" data-action="close-booking">Cancel</button>
          <button class="primary-button" type="submit" ${state.selectedSlot ? '' : 'disabled'}>Send request ${icon('arrow_forward')}</button>
        </div>
      </form>
    </dialog>`;
}

function publicConversation() {
  const questions = suggestedQuestions(state.profile);
  const externalRuntime = state.voiceRuntime.mode === 'open-llm-vtuber';
  return `
    <section class="public-conversation" aria-label="Talk to the twin">
      <div class="conversation-header">
        <div class="conversation-heading">
          <span class="conversation-icon">${icon('graphic_eq')}</span>
          <span>
            <strong>Conversation</strong>
            <span>${externalRuntime ? 'Open-LLM-VTuber runtime' : 'Answers from owner-approved knowledge'}</span>
          </span>
        </div>
        <div class="conversation-tools">
          <button class="icon-button small" type="button" data-action="toggle-audio" aria-label="${state.audioEnabled ? 'Mute spoken replies' : 'Enable spoken replies'}" aria-pressed="${state.audioEnabled}">${icon(state.audioEnabled ? 'volume_up' : 'volume_off')}</button>
        </div>
      </div>
      <div class="messages" id="messages" aria-live="polite">
        ${state.messages.map(messageTemplate).join('')}
        ${
          state.pendingReply
            ? `<article class="message assistant"><span class="message-avatar" aria-hidden="true"><img src="${escapeHtml(avatarUrl())}" alt="" /></span><div class="message-bubble typing-bubble" aria-label="Twin is thinking"><i></i><i></i><i></i></div></article>`
            : ''
        }
      </div>
      <div class="suggestions" aria-label="Suggested questions">
        ${questions.map((question) => `<button class="suggestion-chip" type="button" data-question="${escapeHtml(question)}">${escapeHtml(question)}</button>`).join('')}
      </div>
      <div class="composer-wrap">
        <div class="voice-status ${state.listening ? 'visible' : ''}" id="voice-status"><span class="voice-status-dot"></span><span>Listening. Speak now.</span></div>
        <form class="chat-form" id="chat-form">
          <button class="mic-button" type="button" data-action="toggle-mic" aria-label="${state.listening ? 'Stop listening' : 'Talk to the twin'}" aria-pressed="${state.listening}">${icon(state.listening ? 'mic_off' : 'mic')}</button>
          <input class="chat-input" name="message" autocomplete="off" placeholder="Ask about work, projects, or availability" aria-label="Message for the twin" />
          <button class="send-button" type="submit" aria-label="Send message">${icon('send')}</button>
        </form>
        <p class="disclosure">You are talking to an AI representative, not ${escapeHtml(state.profile.displayName)} directly. Meeting requests are not confirmed until the owner accepts.</p>
      </div>
    </section>`;
}

function publicTemplate() {
  return `
    <main class="public-shell">
      ${publicHeader()}
      <div class="public-grid">
        ${publicIdentity()}
        ${publicConversation()}
      </div>
      ${bookingDialog()}
    </main>`;
}

function notFoundTemplate(handle) {
  return `
    <main class="not-found">
      <div class="not-found-inner">
        <span class="not-found-code">robosa.me/${escapeHtml(handle || 'unknown')}</span>
        <h1>This twin is not here yet.</h1>
        <p>The handle may be unclaimed, renamed, or private.</p>
        <button class="primary-button" type="button" data-route="studio">${icon('arrow_back')} Open twin studio</button>
      </div>
    </main>`;
}

function ensureWelcomeMessage() {
  if (state.messages.length) return;
  state.messages.push({
    role: 'assistant',
    text: `Hi, I am ${state.profile.displayName}'s AI representative. Ask me about the work, current projects, or request a meeting.`,
  });
}

function render() {
  disposeTwinStage();
  const route = routeFromLocation();
  if (state.routeLoading) {
    app.innerHTML = loadingTemplate();
    return;
  }
  if (route.view === 'studio') {
    document.title = 'Robosa.me - Digital twin studio';
    if (state.authStatus !== 'owner') {
      app.innerHTML = authTemplate();
      bindAuthEvents();
      return;
    }
    app.innerHTML = studioTemplate();
    bindStudioEvents();
    mountTwinStage();
    return;
  }

  if (!state.publicFound) {
    document.title = 'Twin not found - Robosa.me';
    app.innerHTML = notFoundTemplate(route.handle);
    bindRouteEvents();
    return;
  }

  ensureWelcomeMessage();
  document.title = `${state.profile.displayName}'s AI twin - Robosa.me`;
  app.innerHTML = publicTemplate();
  bindPublicEvents();
  mountTwinStage();
  window.requestAnimationFrame(scrollMessagesToEnd);
}

function bindRouteEvents() {
  document.querySelectorAll('[data-route]').forEach((element) => {
    element.addEventListener('click', async (event) => {
      event.preventDefault();
      const route = element.dataset.route;
      if (
        route === 'profile' &&
        routeFromLocation().view === 'studio' &&
        state.authStatus === 'owner'
      ) {
        const saved = await saveOwnerProfile({ quiet: true });
        if (!saved) return;
      }
      await navigateTo(
        route === 'studio' ? '/studio' : `/${state.profile.handle}`,
      );
    });
  });
}

function bindAuthEvents() {
  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.authMode = button.dataset.authMode;
      render();
    });
  });
  document.querySelector('#auth-form')?.addEventListener('submit', submitAuth);
}

async function submitAuth(event) {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('[type="submit"]');
  const form = new FormData(event.currentTarget);
  submit.disabled = true;
  try {
    const registering = state.authMode === 'register';
    const payload = await apiRequest(
      registering ? '/auth/register' : '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
          handle: form.get('handle'),
          profile: registering ? state.profile : undefined,
        }),
      },
    );
    state.authStatus = 'owner';
    state.owner = payload.user;
    state.ownerHandle = payload.profile.handle;
    state.profile = saveProfile({
      ...payload.profile,
      avatarMediaId: state.deviceAvatarMediaId,
    });
    await loadOwnerBookings();
    showToast(registering ? 'Owner account created.' : 'Signed in.');
    render();
  } catch (error) {
    showToast(error.message);
    submit.disabled = false;
  }
}

function updateProfileField(element) {
  const field = element.dataset.profileField;
  if (!field) return;
  if (field === 'handle') {
    state.profile.handle = normalizeHandle(element.value) || 'twin';
  } else if (field === 'projects') {
    state.profile.projects = parseProjects(element.value);
  } else if (field === 'facts') {
    state.profile.facts = parseLineList(element.value);
  } else if (element.type === 'checkbox') {
    state.profile[field] = element.checked;
  } else {
    state.profile[field] = element.value;
  }
  state.profile = saveProfile(state.profile);
  state.audioEnabled = state.profile.speakReplies;
  updateStudioPreview();
}

function updateStudioPreview() {
  const name = document.querySelector('[data-preview="displayName"]');
  const headline = document.querySelector('[data-preview="headline"]');
  const url = document.querySelector('[data-preview="url"]');
  if (name) name.textContent = state.profile.displayName;
  if (headline) headline.textContent = state.profile.headline;
  if (url) url.textContent = `robosa.me/${state.profile.handle}`;
}

function bindStudioEvents() {
  bindRouteEvents();

  document.querySelectorAll('[data-studio-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeStudioTab = button.dataset.studioTab;
      render();
    });
  });

  document.querySelectorAll('[data-profile-field]').forEach((element) => {
    const eventName =
      element.type === 'checkbox' || element.tagName === 'SELECT'
        ? 'change'
        : 'input';
    element.addEventListener(eventName, () => updateProfileField(element));
  });

  document
    .querySelectorAll('[data-action="save-profile"]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        saveOwnerProfile();
      });
    });

  document
    .querySelector('[data-action="logout"]')
    ?.addEventListener('click', logoutOwner);

  document.querySelectorAll('[data-booking-status]').forEach((button) => {
    button.addEventListener('click', () =>
      updateBookingStatus(
        button.dataset.bookingId,
        button.dataset.bookingStatus,
      ),
    );
  });

  document.querySelectorAll('[data-action="copy-link"]').forEach((button) => {
    button.addEventListener('click', copyShareLink);
  });

  bindMediaEvents();
  bindMetaPersonEvents();
  bindVoiceRuntimeEvents();
}

function metaPersonStatusLabel(status) {
  return (
    {
      loading: 'Loading creator',
      authenticating: 'Connecting securely',
      generating: 'Generating your avatar',
      customizing: 'Avatar ready to customize',
      exporting: 'Exporting facially rigged GLB',
      importing: 'Saving your generated twin',
      complete: '3D twin ready',
      error: 'Generation needs attention',
    }[status] || 'Preparing creator'
  );
}

function updateMetaPersonUi({ status, exportReady, error = '' }) {
  const statusElement = document.querySelector('[data-avatar-creator-status]');
  if (statusElement) {
    statusElement.dataset.status = status;
    const label = statusElement.querySelector('strong');
    if (label) label.textContent = metaPersonStatusLabel(status);
  }
  const exportButton = document.querySelector('[data-action="export-avatar"]');
  if (exportButton) exportButton.disabled = !exportReady;
  if (error) showToast(error);
  if (status === 'complete') {
    metaPersonCreator.close();
    document.querySelector('#avatar-creator-dialog')?.close();
    showToast('Generated 3D twin saved and activated.');
    render();
  }
}

async function importGeneratedAvatar({ url, avatarCode }) {
  const result = await apiRequest('/avatar/metaperson/import', {
    method: 'POST',
    body: JSON.stringify({ url, avatarCode }),
  });
  state.profile = saveProfile({
    ...result.profile,
    avatarMediaId: state.deviceAvatarMediaId,
  });
  state.avatar.mode = 'hosted';
  state.avatar.modelMediaId = '';
  state.avatar.captureStatus = 'ready';
  state.avatar.capturePreparedAt ||= new Date().toISOString();
  state.avatar.builtAt = new Date().toISOString();
  state.avatar.profileHandle = state.profile.handle;
  state.avatar = saveAvatarConfig(state.avatar);
  state.rigReport = null;
}

function closeMetaPersonDialog() {
  metaPersonCreator.close();
  document.querySelector('#avatar-creator-dialog')?.close();
}

function bindMetaPersonEvents() {
  document
    .querySelector('[data-action="generate-lam-twin"]')
    ?.addEventListener('click', generateLamTwin);
  document
    .querySelector('[data-action="generate-3d-twin"]')
    ?.addEventListener('click', async () => {
      const portrait = avatarPortraitRecord();
      if (!portrait || !state.avatar.consentAt) return;
      state.avatar.captureStatus = 'ready';
      state.avatar.capturePreparedAt = new Date().toISOString();
      state.avatar.profileHandle = state.profile.handle;
      state.avatar = saveAvatarConfig(state.avatar);
      const dialog = document.querySelector('#avatar-creator-dialog');
      const frame = document.querySelector('#avatar-creator-frame');
      if (!dialog || !frame) return;
      dialog.showModal();
      await metaPersonCreator.open({ frame, portrait: portrait.blob });
    });
  document
    .querySelector('[data-action="close-avatar-creator"]')
    ?.addEventListener('click', closeMetaPersonDialog);
  document
    .querySelector('#avatar-creator-dialog')
    ?.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeMetaPersonDialog();
    });
  document
    .querySelector('[data-action="export-avatar"]')
    ?.addEventListener('click', () => metaPersonCreator.exportAvatar());
}

function updateLamJobUi() {
  const active = ['queued', 'running'].includes(state.lamJob?.status);
  const progress = Math.round(state.lamJob?.progress || 0);
  const button = document.querySelector('[data-action="generate-lam-twin"]');
  if (button && active) {
    button.disabled = true;
    const label = button.querySelector('[data-lam-generation-label]');
    if (label) label.textContent = `Generating ${progress}%`;
  }
  const status = document.querySelector('[data-lam-generation]');
  if (status && active) {
    status.textContent =
      'Reconstructing the approved portrait on the private GPU worker.';
  }
}

async function generateLamTwin() {
  const portrait = avatarPortraitRecord();
  if (!portrait || !state.avatar.consentAt || state.lamJob) return;
  try {
    const result = await apiRequest('/avatar/lam/jobs', {
      method: 'POST',
      headers: {
        'Content-Type': portrait.blob.type || 'application/octet-stream',
        'X-Robosa-Consent-At': state.avatar.consentAt,
      },
      body: portrait.blob,
    });
    state.lamJob = result.job;
    render();
    while (['queued', 'running'].includes(state.lamJob.status)) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 2000));
      const status = await apiRequest(
        `/avatar/lam/jobs/${encodeURIComponent(state.lamJob.id)}`,
      );
      state.lamJob = status.job;
      updateLamJobUi();
      if (status.profile) {
        state.profile = saveProfile({
          ...status.profile,
          avatarMediaId: state.deviceAvatarMediaId,
        });
      }
    }
    if (state.lamJob.status !== 'complete') {
      throw new Error(state.lamJob.error || 'LAM portrait generation failed.');
    }
    state.avatar.mode = 'lam';
    state.avatar.captureStatus = 'ready';
    state.avatar.capturePreparedAt ||= new Date().toISOString();
    state.avatar.builtAt = new Date().toISOString();
    state.avatar.profileHandle = state.profile.handle;
    state.avatar = saveAvatarConfig(state.avatar);
    state.rigReport = null;
    showToast('Animated LAM portrait generated and published.');
  } catch (error) {
    showToast(error.message);
  } finally {
    state.lamJob = null;
    render();
  }
}

function bindVoiceRuntimeEvents() {
  document.querySelectorAll('input[name="voiceRuntime"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      state.voiceRuntime.mode = input.value;
      state.voiceRuntime = saveVoiceRuntime(state.voiceRuntime);
      if (state.voiceRuntime.mode === 'robosa') openLlmRuntime.disconnect();
      render();
    });
  });

  document
    .querySelector('#voice-runtime-endpoint')
    ?.addEventListener('change', (event) => {
      state.voiceRuntime.endpoint = event.currentTarget.value;
      state.voiceRuntime = saveVoiceRuntime(state.voiceRuntime);
      event.currentTarget.value = state.voiceRuntime.endpoint;
      openLlmRuntime.disconnect();
      updateRuntimeUi();
    });

  document
    .querySelector('[data-action="test-runtime"]')
    ?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await openLlmRuntime.test(state.voiceRuntime.endpoint);
        showToast('Open-LLM-VTuber is connected.');
      } catch (error) {
        showToast(error.message);
      } finally {
        button.disabled = false;
        updateRuntimeUi();
      }
    });
}

async function saveOwnerProfile({ quiet = false } = {}) {
  if (state.authStatus !== 'owner') return false;
  try {
    const previousHandle = state.ownerHandle;
    const result = await apiRequest('/profile', {
      method: 'PUT',
      body: JSON.stringify(state.profile),
    });
    state.ownerHandle = result.profile.handle;
    if (state.avatar.profileHandle === previousHandle) {
      state.avatar.profileHandle = result.profile.handle;
      state.avatar = saveAvatarConfig(state.avatar);
    }
    state.profile = saveProfile({
      ...result.profile,
      avatarMediaId: state.deviceAvatarMediaId,
    });
    if (!quiet) showToast('Twin changes saved to your account.');
    return true;
  } catch (error) {
    showToast(error.message);
    return false;
  }
}

async function logoutOwner() {
  try {
    await apiRequest('/auth/logout', { method: 'POST' });
  } catch {
    // Clear the local owner view even if the server session already expired.
  }
  state.authStatus = 'guest';
  state.owner = null;
  state.ownerHandle = '';
  state.bookings = [];
  showToast('Signed out.');
  render();
}

async function updateBookingStatus(bookingId, status) {
  try {
    const result = await apiRequest(`/bookings/${bookingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    state.bookings = state.bookings.map((booking) =>
      booking.id === result.booking.id ? result.booking : booking,
    );
    showToast(
      status === 'approved' ? 'Request approved.' : 'Request declined.',
    );
    render();
  } catch (error) {
    showToast(error.message);
  }
}

async function publishPortrait(record) {
  if (!record || mediaKind(record) !== 'image') {
    throw new Error('Choose a portrait image first.');
  }
  const result = await apiRequest('/avatar/portrait', {
    method: 'PUT',
    headers: {
      'Content-Type': record.blob.type || 'application/octet-stream',
    },
    body: record.blob,
  });
  state.profile = saveProfile({
    ...result.profile,
    avatarMediaId: state.deviceAvatarMediaId,
  });
  state.avatar.profileHandle = state.profile.handle;
  state.avatar = saveAvatarConfig(state.avatar);
}

async function publishLamAvatar(record) {
  if (!state.avatar.consentAt) {
    throw new Error('Confirm consent before publishing this LAM avatar.');
  }
  if (!record || mediaKind(record) !== 'lam') {
    throw new Error('Choose a LAM avatar ZIP first.');
  }
  const result = await apiRequest('/avatar/lam', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/zip' },
    body: record.blob,
  });
  state.profile = saveProfile({
    ...result.profile,
    avatarMediaId: state.deviceAvatarMediaId,
  });
  state.avatar.mode = 'lam';
  state.avatar.lamMediaId = record.id;
  state.avatar.profileHandle = state.profile.handle;
  state.avatar.builtAt = new Date().toISOString();
  state.avatar = saveAvatarConfig(state.avatar);
}

async function selectAvatarMode(mode, button) {
  if (!['portrait', 'lam', '3d'].includes(mode)) return;
  button.disabled = true;
  try {
    if (mode === 'lam') {
      const archive = lamAvatarRecord();
      if (archive) await publishLamAvatar(archive);
      else {
        state.profile.avatarMode = 'lam';
        if (!(await saveOwnerProfile({ quiet: true }))) return;
      }
      showToast('LAM portrait published with ARKit facial animation.');
    } else if (mode === 'portrait') {
      const portrait = avatarPortraitRecord();
      if (portrait) await publishPortrait(portrait);
      else {
        state.profile.avatarMode = 'portrait';
        if (!(await saveOwnerProfile({ quiet: true }))) return;
      }
      showToast('Static portrait published.');
    } else {
      state.profile.avatarMode = '3d';
      if (!(await saveOwnerProfile({ quiet: true }))) return;
      showToast('Interactive 3D appearance published.');
    }
    state.rigReport = null;
    render();
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
}

function bindMediaEvents() {
  const input = document.querySelector('#media-input');
  const dropZone = document.querySelector('#media-drop-zone');
  if (input) {
    input.addEventListener('change', () => handleMediaFiles(input.files));
  }
  if (dropZone) {
    dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropZone.classList.add('dragging');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragging');
    });
    dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropZone.classList.remove('dragging');
      handleMediaFiles(event.dataTransfer?.files);
    });
  }

  document.querySelectorAll('[data-avatar-mode]').forEach((button) => {
    button.addEventListener('click', () =>
      selectAvatarMode(button.dataset.avatarMode, button),
    );
  });

  document.querySelectorAll('[data-action="set-avatar"]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.profile.avatarMediaId = button.dataset.mediaId;
      state.deviceAvatarMediaId = button.dataset.mediaId;
      state.avatar.portraitMediaId = button.dataset.mediaId;
      state.avatar.profileHandle = state.profile.handle;
      state.avatar.captureStatus = 'draft';
      state.avatar.capturePreparedAt = '';
      state.avatar = saveAvatarConfig(state.avatar);
      state.profile = saveProfile(state.profile);
      if (state.profile.avatarMode === 'portrait' && state.avatar.consentAt) {
        try {
          await publishPortrait(avatarPortraitRecord());
          showToast('Portrait source updated and published.');
        } catch (error) {
          showToast(error.message);
        }
      } else {
        showToast('Portrait source updated.');
      }
      render();
    });
  });

  document
    .querySelectorAll('[data-action="set-reference-video"]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        state.avatar.referenceVideoId = button.dataset.mediaId;
        state.avatar.profileHandle = state.profile.handle;
        state.avatar.captureStatus = 'draft';
        state.avatar.capturePreparedAt = '';
        state.avatar = saveAvatarConfig(state.avatar);
        showToast('Motion reference selected.');
        render();
      });
    });

  document
    .querySelectorAll('[data-action="use-lam-avatar"]')
    .forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        const record = state.media.find(
          (item) => item.id === button.dataset.mediaId,
        );
        try {
          await publishLamAvatar(record);
          state.rigReport = null;
          showToast('LAM avatar uploaded and activated.');
          render();
        } catch (error) {
          showToast(error.message);
          button.disabled = false;
        }
      });
    });

  document
    .querySelectorAll('[data-action="use-3d-model"]')
    .forEach((button) => {
      button.addEventListener('click', async () => {
        state.avatar.modelMediaId = button.dataset.mediaId;
        state.avatar.profileHandle = state.profile.handle;
        state.avatar.mode = 'model';
        state.avatar.builtAt = new Date().toISOString();
        state.rigReport = null;
        state.avatar = saveAvatarConfig(state.avatar);
        state.profile.avatarMode = '3d';
        await saveOwnerProfile({ quiet: true });
        showToast('3D model activated. Inspecting its facial rig.');
        render();
      });
    });

  document
    .querySelector('[data-action="test-lip-sync"]')
    ?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      await twinStage?.previewLipSync();
      button.disabled = state.rigReport?.level === 'none';
    });

  document
    .querySelector('#avatar-consent')
    ?.addEventListener('change', (event) => {
      state.avatar.consentAt = event.currentTarget.checked
        ? new Date().toISOString()
        : '';
      state.avatar.captureStatus = 'draft';
      state.avatar.capturePreparedAt = '';
      state.avatar = saveAvatarConfig(state.avatar);
      render();
    });

  document
    .querySelectorAll('[data-action="remove-media"]')
    .forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.mediaId;
        await removeMedia(id);
        const url = state.mediaUrls.get(id);
        if (url) URL.revokeObjectURL(url);
        state.mediaUrls.delete(id);
        state.media = state.media.filter((record) => record.id !== id);
        if (state.profile.avatarMediaId === id) {
          state.profile.avatarMediaId = '';
          state.deviceAvatarMediaId = '';
          state.profile = saveProfile(state.profile);
        }
        if (state.avatar.portraitMediaId === id) {
          state.avatar.portraitMediaId = '';
        }
        if (state.avatar.referenceVideoId === id) {
          state.avatar.referenceVideoId = '';
        }
        if (state.avatar.modelMediaId === id) {
          state.avatar.modelMediaId = '';
          state.avatar.mode = 'procedural';
          state.rigReport = null;
        }
        if (state.avatar.lamMediaId === id) {
          state.avatar.lamMediaId = '';
          if (state.avatar.mode === 'lam') state.avatar.mode = 'procedural';
          state.rigReport = null;
        }
        state.avatar.captureStatus = 'draft';
        state.avatar.capturePreparedAt = '';
        state.avatar = saveAvatarConfig(state.avatar);
        showToast('Media removed from this browser.');
        render();
      });
    });
}

async function handleMediaFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  let added = 0;

  for (const file of files) {
    const isModel = /\.(glb|vrm)$/i.test(file.name);
    const isLam = /\.zip$/i.test(file.name);
    if (
      !file.type.startsWith('image/') &&
      !file.type.startsWith('video/') &&
      !isModel &&
      !isLam
    ) {
      showToast(`${file.name} is not supported capture or avatar media.`);
      continue;
    }
    const maximumSize = isLam ? MAX_LAM_BYTES : MAX_MEDIA_BYTES;
    if (file.size > maximumSize) {
      showToast(`${file.name} is larger than ${isLam ? '120' : '30'} MB.`);
      continue;
    }
    try {
      const record = await addMedia(file);
      state.media.unshift(record);
      if (!state.profile.avatarMediaId && mediaKind(record) === 'image') {
        state.profile.avatarMediaId = record.id;
        state.deviceAvatarMediaId = record.id;
        state.avatar.portraitMediaId = record.id;
      }
      if (!state.avatar.referenceVideoId && mediaKind(record) === 'video') {
        state.avatar.referenceVideoId = record.id;
      }
      if (!state.avatar.modelMediaId && mediaKind(record) === 'model') {
        state.avatar.modelMediaId = record.id;
      }
      if (!state.avatar.lamMediaId && mediaKind(record) === 'lam') {
        state.avatar.lamMediaId = record.id;
      }
      added += 1;
    } catch {
      showToast('This browser could not store the selected media.');
    }
  }

  state.profile = saveProfile(state.profile);
  if (added) {
    state.avatar.captureStatus = 'draft';
    state.avatar.capturePreparedAt = '';
  }
  state.avatar = saveAvatarConfig(state.avatar);
  if (added)
    showToast(`${added} media ${added === 1 ? 'item' : 'items'} added.`);
  render();
}

function bindPublicEvents() {
  bindRouteEvents();

  document.querySelectorAll('[data-action="copy-link"]').forEach((button) => {
    button.addEventListener('click', copyShareLink);
  });
  document
    .querySelector('[data-action="toggle-audio"]')
    ?.addEventListener('click', () => {
      state.audioEnabled = !state.audioEnabled;
      openLlmRuntime.setAudioEnabled(state.audioEnabled);
      if (!state.audioEnabled) voice.stopSpeaking();
      render();
    });
  document
    .querySelector('[data-action="toggle-mic"]')
    ?.addEventListener('click', () => voice.toggleListening());
  document
    .querySelector('[data-action="ask-work"]')
    ?.addEventListener('click', () => sendMessage('What are you building?'));
  document
    .querySelector('[data-action="open-booking"]')
    ?.addEventListener('click', openBookingDialog);
  document
    .querySelectorAll('[data-action="close-booking"]')
    .forEach((button) => {
      button.addEventListener('click', closeBookingDialog);
    });
  document.querySelectorAll('[data-question]').forEach((button) => {
    button.addEventListener('click', () =>
      sendMessage(button.dataset.question),
    );
  });
  document.querySelectorAll('[data-slot]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedSlot = button.dataset.slot;
      document.querySelectorAll('[data-slot]').forEach((slotButton) => {
        slotButton.setAttribute(
          'aria-pressed',
          String(slotButton.dataset.slot === state.selectedSlot),
        );
      });
      const submit = document.querySelector('#booking-form [type="submit"]');
      if (submit) submit.disabled = false;
    });
  });

  document.querySelector('#chat-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    sendMessage(form.get('message'));
  });
  document
    .querySelector('#booking-form')
    ?.addEventListener('submit', submitBookingRequest);
}

function updateVoiceUi() {
  document
    .querySelector('#voice-status')
    ?.classList.toggle('visible', state.listening);
  const mic = document.querySelector('[data-action="toggle-mic"]');
  if (mic) {
    mic.setAttribute('aria-pressed', String(state.listening));
    mic.setAttribute(
      'aria-label',
      state.listening ? 'Stop listening' : 'Talk to the twin',
    );
    mic.innerHTML = icon(state.listening ? 'mic_off' : 'mic');
  }
  document
    .querySelector('[data-speaking-frame]')
    ?.classList.toggle('is-speaking', state.speaking);
}

async function sendMessage(input) {
  const text = String(input || '').trim();
  if (!text || state.pendingReply) return;
  stopAllSpeech();
  state.messages.push({ role: 'user', text });
  state.pendingReply = true;
  render();

  let response;
  try {
    if (state.voiceRuntime.mode === 'open-llm-vtuber') {
      openLlmRuntime.setAudioEnabled(state.audioEnabled);
      response = await openLlmRuntime.ask(text, state.voiceRuntime.endpoint);
      response.action = null;
    } else {
      response = await apiRequest(
        `/profiles/${encodeURIComponent(state.activeHandle || state.profile.handle)}/chat`,
        {
          method: 'POST',
          body: JSON.stringify({
            message: text,
            conversationId: state.conversationId,
          }),
        },
      );
      state.conversationId = response.conversationId;
    }
  } catch (error) {
    response =
      state.voiceRuntime.mode === 'open-llm-vtuber'
        ? {
            text: `${error.message} Switch to Robosa grounded mode in the Voice settings or start the configured runtime.`,
            action: null,
          }
        : error.status
          ? { text: error.message, action: null }
          : answerTwin(state.profile, text);
  }
  state.messages.push({ role: 'assistant', text: response.text });
  state.pendingReply = false;
  render();
  if (state.audioEnabled && state.voiceRuntime.mode !== 'open-llm-vtuber')
    voice.speak(response.text);
  if (response.action === 'booking') openBookingDialog();
}

function scrollMessagesToEnd() {
  const messages = document.querySelector('#messages');
  if (messages) messages.scrollTop = messages.scrollHeight;
}

function openBookingDialog() {
  if (!state.profile.allowBooking) return;
  const dialog = document.querySelector('#booking-dialog');
  if (dialog && !dialog.open) dialog.showModal();
}

function closeBookingDialog() {
  document.querySelector('#booking-dialog')?.close();
}

async function submitBookingRequest(event) {
  event.preventDefault();
  if (!state.selectedSlot) {
    showToast('Choose a proposed meeting time.');
    return;
  }
  const form = new FormData(event.currentTarget);
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await apiRequest(
      `/profiles/${encodeURIComponent(state.activeHandle || state.profile.handle)}/bookings`,
      {
        method: 'POST',
        body: JSON.stringify({
          slot: state.selectedSlot,
          guestName: form.get('guestName'),
          guestEmail: form.get('guestEmail'),
        }),
      },
    );
    state.selectedSlot = '';
    const confirmation = `Your meeting request for ${result.booking.slot} is awaiting owner approval. No calendar event has been created yet.`;
    state.messages.push({ role: 'assistant', text: confirmation });
    closeBookingDialog();
    render();
    if (state.audioEnabled) voice.speak(confirmation);
    showToast('Meeting request sent for approval.');
  } catch (error) {
    showToast(error.message);
    submit.disabled = false;
  }
}

async function copyShareLink() {
  const link = `${window.location.origin}/${state.profile.handle}`;
  try {
    await navigator.clipboard.writeText(link);
    showToast(`Copied ${link}`);
  } catch {
    showToast(`Share link: ${link}`);
  }
}

window.addEventListener('popstate', async () => {
  await hydrateRoute();
  render();
});
window.addEventListener('beforeunload', () => {
  disposeTwinStage();
  metaPersonCreator.close();
  voice.dispose();
  openLlmRuntime.dispose();
  state.mediaUrls.forEach((url) => URL.revokeObjectURL(url));
});

async function start() {
  openLlmRuntime.setAudioEnabled(state.audioEnabled);
  try {
    state.media = await listMedia();
  } catch {
    state.media = [];
  }
  await hydrateRoute();
  render();
}

start();
