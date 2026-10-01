import { randomUUID } from 'node:crypto';
import {
  normalizeHandle,
  sanitizeProfile,
} from '../../../src/robosa/profileStore.js';
import { createSessionRecord, hashPassword, verifyPassword } from './auth.js';
import { isReservedHandle } from './paths.js';
const dummyPasswordHash = hashPassword('robosa-invalid-password-target');

export class RobosaServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'RobosaServiceError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new RobosaServiceError(status, code, message);
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, 180);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateHandle(value) {
  const handle = normalizeHandle(value);
  if (
    handle.length < 2 ||
    isReservedHandle(handle) ||
    !/^[a-z0-9][a-z0-9-]{1,39}$/.test(handle)
  ) {
    fail(400, 'INVALID_HANDLE', 'Choose a different public handle.');
  }
  return handle;
}

function ownerProfile(profile) {
  if (!profile) return null;
  const {
    ownerId: _ownerId,
    avatarProviderCode: _avatarProviderCode,
    avatarModel,
    portraitAvatar,
    lamAvatar,
    ...publicProfile
  } = profile;
  return {
    ...publicProfile,
    avatarModel:
      avatarModel?.status === 'ready'
        ? {
            status: 'ready',
            provider: avatarModel.provider,
            size: avatarModel.size,
            rigProfile: avatarModel.rigProfile,
            updatedAt: avatarModel.updatedAt,
            url: `/api/robosa/profiles/${encodeURIComponent(profile.handle)}/avatar.glb?v=${String(avatarModel.sha256 || '').slice(0, 12)}`,
          }
        : null,
    portraitAvatar:
      portraitAvatar?.status === 'ready'
        ? {
            status: 'ready',
            contentType: portraitAvatar.contentType,
            size: portraitAvatar.size,
            updatedAt: portraitAvatar.updatedAt,
            url: `/api/robosa/profiles/${encodeURIComponent(profile.handle)}/portrait?v=${String(portraitAvatar.sha256 || '').slice(0, 12)}`,
          }
        : null,
    lamAvatar:
      lamAvatar?.status === 'ready'
        ? {
            status: 'ready',
            provider: lamAvatar.provider,
            size: lamAvatar.size,
            rigProfile: lamAvatar.rigProfile,
            updatedAt: lamAvatar.updatedAt,
            url: `/api/robosa/profiles/${encodeURIComponent(profile.handle)}/avatar.lam.zip?v=${String(lamAvatar.sha256 || '').slice(0, 12)}`,
          }
        : null,
  };
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    emailVerified: false,
  };
}

function publicBooking(booking) {
  return { ...booking };
}

export function createRobosaService(store) {
  async function sessionByHash(sessionHash) {
    if (!sessionHash) return null;
    const now = Date.now();
    return store.read((database) => {
      const session = database.sessions.find(
        (item) =>
          item.tokenHash === sessionHash && Date.parse(item.expiresAt) > now,
      );
      if (!session) return null;
      const user = database.users.find((item) => item.id === session.userId);
      const profile = database.profiles.find(
        (item) => item.ownerId === session.userId,
      );
      if (!user || !profile) return null;
      return { user: publicUser(user), profile: ownerProfile(profile) };
    });
  }

  async function register(candidate) {
    const email = normalizeEmail(candidate?.email);
    const password = String(candidate?.password || '');
    const profileInput = sanitizeProfile(candidate?.profile);
    const handle = validateHandle(candidate?.handle || profileInput.handle);
    if (!validEmail(email)) {
      fail(400, 'INVALID_EMAIL', 'Enter a valid email address.');
    }
    if (password.length < 10 || password.length > 256) {
      fail(
        400,
        'INVALID_PASSWORD',
        'Use a password with at least 10 characters.',
      );
    }

    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    return store.mutate((database) => {
      if (database.users.some((item) => item.email === email)) {
        fail(409, 'EMAIL_TAKEN', 'An account already uses this email.');
      }
      if (database.profiles.some((item) => item.handle === handle)) {
        fail(409, 'HANDLE_TAKEN', 'That public handle is already claimed.');
      }

      const user = {
        id: randomUUID(),
        email,
        passwordHash,
        createdAt: now,
        updatedAt: now,
      };
      const profile = {
        ...profileInput,
        handle,
        avatarMediaId: '',
        avatarModel: null,
        portraitAvatar: null,
        lamAvatar: null,
        ownerId: user.id,
        createdAt: now,
        updatedAt: now,
      };
      const { token, record } = createSessionRecord(user.id);
      database.users.push(user);
      database.profiles.push(profile);
      database.sessions = database.sessions.filter(
        (session) => Date.parse(session.expiresAt) > Date.now(),
      );
      database.sessions.push(record);
      return {
        token,
        user: publicUser(user),
        profile: ownerProfile(profile),
      };
    });
  }

  async function login(candidate) {
    const email = normalizeEmail(candidate?.email);
    const password = String(candidate?.password || '');
    const user = await store.read((database) =>
      database.users.find((item) => item.email === email),
    );
    const passwordMatches =
      password.length <= 256 &&
      (await verifyPassword(
        password,
        user?.passwordHash || (await dummyPasswordHash),
      ));
    if (!user || !passwordMatches) {
      fail(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    return store.mutate((database) => {
      const now = Date.now();
      database.sessions = database.sessions.filter(
        (session) => Date.parse(session.expiresAt) > now,
      );
      const { token, record } = createSessionRecord(user.id, now);
      database.sessions.push(record);
      const profile = database.profiles.find(
        (item) => item.ownerId === user.id,
      );
      return {
        token,
        user: publicUser(user),
        profile: ownerProfile(profile),
      };
    });
  }

  async function logout(sessionHash) {
    if (!sessionHash) return;
    await store.mutate((database) => {
      database.sessions = database.sessions.filter(
        (item) => item.tokenHash !== sessionHash,
      );
    });
  }

  async function publicProfile(handle, ownerId = '') {
    const normalized = normalizeHandle(handle);
    return store.read((database) => {
      const profile = database.profiles.find(
        (item) => item.handle === normalized,
      );
      if (!profile) return null;
      if (profile.visibility === 'private' && profile.ownerId !== ownerId) {
        return null;
      }
      return ownerProfile(profile);
    });
  }

  async function updateProfile(ownerId, candidate) {
    const sanitized = sanitizeProfile(candidate);
    const handle = validateHandle(sanitized.handle);
    const {
      avatarModel: _candidateAvatar,
      portraitAvatar: _candidatePortrait,
      lamAvatar: _candidateLam,
      ...editableProfile
    } = sanitized;
    return store.mutate((database) => {
      const profile = database.profiles.find(
        (item) => item.ownerId === ownerId,
      );
      if (!profile) fail(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
      if (
        database.profiles.some(
          (item) => item.handle === handle && item.ownerId !== ownerId,
        )
      ) {
        fail(409, 'HANDLE_TAKEN', 'That public handle is already claimed.');
      }
      Object.assign(profile, editableProfile, {
        handle,
        avatarMediaId: '',
        ownerId,
        updatedAt: new Date().toISOString(),
      });
      return ownerProfile(profile);
    });
  }

  async function createBooking(profileHandle, candidate) {
    const guestName = String(candidate?.guestName || '')
      .trim()
      .slice(0, 100);
    const guestEmail = normalizeEmail(candidate?.guestEmail);
    const slot = String(candidate?.slot || '')
      .trim()
      .slice(0, 120);
    if (!guestName || !validEmail(guestEmail) || !slot) {
      fail(400, 'INVALID_BOOKING', 'Complete the meeting request fields.');
    }
    return store.mutate((database) => {
      const profile = database.profiles.find(
        (item) => item.handle === normalizeHandle(profileHandle),
      );
      if (
        !profile ||
        profile.visibility === 'private' ||
        !profile.allowBooking
      ) {
        fail(404, 'BOOKING_UNAVAILABLE', 'Meeting requests are unavailable.');
      }
      const booking = {
        id: randomUUID(),
        profileId: profile.ownerId,
        guestName,
        guestEmail,
        slot,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      database.bookings.push(booking);
      return publicBooking(booking);
    });
  }

  async function listBookings(ownerId) {
    return store.read((database) =>
      database.bookings
        .filter((item) => item.profileId === ownerId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50)
        .map(publicBooking),
    );
  }

  async function updateBooking(ownerId, bookingId, status) {
    if (!['approved', 'declined'].includes(status)) {
      fail(400, 'INVALID_STATUS', 'Choose approved or declined.');
    }
    return store.mutate((database) => {
      const booking = database.bookings.find(
        (item) => item.id === bookingId && item.profileId === ownerId,
      );
      if (!booking) fail(404, 'BOOKING_NOT_FOUND', 'Request not found.');
      booking.status = status;
      booking.updatedAt = new Date().toISOString();
      return publicBooking(booking);
    });
  }

  async function conversation(profileHandle, conversationId, ownerId = '') {
    return store.mutate((database) => {
      const profile = database.profiles.find(
        (item) =>
          item.handle === normalizeHandle(profileHandle) &&
          (item.visibility !== 'private' || item.ownerId === ownerId),
      );
      if (!profile) fail(404, 'PROFILE_NOT_FOUND', 'Twin not found.');
      let conversation = database.conversations.find(
        (item) =>
          item.id === conversationId && item.profileId === profile.ownerId,
      );
      if (!conversation) {
        conversation = {
          id: randomUUID(),
          profileId: profile.ownerId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
        };
        database.conversations.push(conversation);
      }
      return {
        id: conversation.id,
        profile: ownerProfile(profile),
        messages: conversation.messages.slice(-10),
      };
    });
  }

  async function appendTurn(conversationId, userText, assistantText) {
    await store.mutate((database) => {
      const conversation = database.conversations.find(
        (item) => item.id === conversationId,
      );
      if (!conversation) return;
      const now = new Date().toISOString();
      conversation.messages.push(
        { role: 'user', text: userText, createdAt: now },
        { role: 'assistant', text: assistantText, createdAt: now },
      );
      conversation.messages = conversation.messages.slice(-24);
      conversation.updatedAt = now;
      database.conversations = database.conversations
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 1000);
    });
  }

  async function completeAvatar(ownerId, candidate) {
    return store.mutate((database) => {
      const profile = database.profiles.find(
        (item) => item.ownerId === ownerId,
      );
      if (!profile) fail(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
      const now = new Date().toISOString();
      profile.avatarModel = {
        status: 'ready',
        provider: 'metaperson',
        size: Number(candidate?.size) || 0,
        sha256: String(candidate?.sha256 || ''),
        rigProfile: 'oculus-15',
        updatedAt: now,
      };
      profile.avatarMode = '3d';
      profile.avatarProviderCode = String(candidate?.avatarCode || '').slice(
        0,
        200,
      );
      profile.updatedAt = now;
      return ownerProfile(profile);
    });
  }

  async function avatarAccess(profileHandle, ownerId = '') {
    const normalized = normalizeHandle(profileHandle);
    return store.read((database) => {
      const profile = database.profiles.find(
        (item) => item.handle === normalized,
      );
      if (
        !profile ||
        profile.avatarModel?.status !== 'ready' ||
        (profile.visibility === 'private' && profile.ownerId !== ownerId)
      ) {
        return null;
      }
      return {
        ownerId: profile.ownerId,
        handle: profile.handle,
        avatarModel: { ...profile.avatarModel },
      };
    });
  }

  async function completePortrait(ownerId, candidate) {
    return store.mutate((database) => {
      const profile = database.profiles.find(
        (item) => item.ownerId === ownerId,
      );
      if (!profile) fail(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
      const now = new Date().toISOString();
      profile.portraitAvatar = {
        status: 'ready',
        contentType: String(candidate?.contentType || 'image/jpeg'),
        size: Number(candidate?.size) || 0,
        sha256: String(candidate?.sha256 || ''),
        updatedAt: now,
      };
      profile.avatarMode = 'portrait';
      profile.updatedAt = now;
      return ownerProfile(profile);
    });
  }

  async function portraitAccess(profileHandle, ownerId = '') {
    const normalized = normalizeHandle(profileHandle);
    return store.read((database) => {
      const profile = database.profiles.find(
        (item) => item.handle === normalized,
      );
      if (
        !profile ||
        profile.portraitAvatar?.status !== 'ready' ||
        (profile.visibility === 'private' && profile.ownerId !== ownerId)
      ) {
        return null;
      }
      return {
        ownerId: profile.ownerId,
        handle: profile.handle,
        portraitAvatar: { ...profile.portraitAvatar },
      };
    });
  }

  async function completeLamAvatar(ownerId, candidate) {
    return store.mutate((database) => {
      const profile = database.profiles.find(
        (item) => item.ownerId === ownerId,
      );
      if (!profile) fail(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
      const now = new Date().toISOString();
      profile.lamAvatar = {
        status: 'ready',
        provider: 'lam',
        size: Number(candidate?.size) || 0,
        sha256: String(candidate?.sha256 || ''),
        rigProfile: 'arkit-52',
        updatedAt: now,
      };
      profile.avatarMode = 'lam';
      profile.updatedAt = now;
      return ownerProfile(profile);
    });
  }

  async function lamAvatarAccess(profileHandle, ownerId = '') {
    const normalized = normalizeHandle(profileHandle);
    return store.read((database) => {
      const profile = database.profiles.find(
        (item) => item.handle === normalized,
      );
      if (
        !profile ||
        profile.lamAvatar?.status !== 'ready' ||
        (profile.visibility === 'private' && profile.ownerId !== ownerId)
      ) {
        return null;
      }
      return {
        ownerId: profile.ownerId,
        handle: profile.handle,
        lamAvatar: { ...profile.lamAvatar },
      };
    });
  }

  return {
    appendTurn,
    avatarAccess,
    completeAvatar,
    completeLamAvatar,
    completePortrait,
    conversation,
    createBooking,
    listBookings,
    login,
    lamAvatarAccess,
    logout,
    publicProfile,
    portraitAccess,
    register,
    sessionByHash,
    updateBooking,
    updateProfile,
  };
}
