const DATABASE_NAME = 'robosa-local-media';
const DATABASE_VERSION = 1;
const STORE_NAME = 'media';

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listMedia() {
  const database = await openDatabase();
  if (!database) return [];
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const records = await requestResult(
      transaction.objectStore(STORE_NAME).getAll(),
    );
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } finally {
    database.close();
  }
}

export async function addMedia(file) {
  const database = await openDatabase();
  if (!database) throw new Error('Local media storage is unavailable.');

  const record = {
    id:
      globalThis.crypto?.randomUUID?.() ||
      `media-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: String(file.name || 'media'),
    type: String(file.type || 'application/octet-stream'),
    size: Number(file.size) || 0,
    createdAt: new Date().toISOString(),
    blob: file,
  };

  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    await requestResult(transaction.objectStore(STORE_NAME).put(record));
    return record;
  } finally {
    database.close();
  }
}

export async function removeMedia(id) {
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    await requestResult(transaction.objectStore(STORE_NAME).delete(id));
  } finally {
    database.close();
  }
}

export function mediaKind(record) {
  if (
    String(record?.type || '') === 'application/zip' ||
    /\.zip$/i.test(String(record?.name || ''))
  ) {
    return 'lam';
  }
  if (String(record?.type || '').startsWith('image/')) return 'image';
  if (String(record?.type || '').startsWith('video/')) return 'video';
  if (
    ['model/gltf-binary', 'model/gltf+json'].includes(
      String(record?.type || ''),
    ) ||
    /\.(glb|gltf|vrm)$/i.test(String(record?.name || ''))
  ) {
    return 'model';
  }
  return 'unknown';
}

export { DATABASE_NAME, STORE_NAME };
