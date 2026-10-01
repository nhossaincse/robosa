import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATABASE_VERSION = 1;

function emptyDatabase() {
  return {
    version: DATABASE_VERSION,
    users: [],
    profiles: [],
    sessions: [],
    bookings: [],
    conversations: [],
  };
}

function normalizeDatabase(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    version: DATABASE_VERSION,
    users: Array.isArray(source.users) ? source.users : [],
    profiles: Array.isArray(source.profiles) ? source.profiles : [],
    sessions: Array.isArray(source.sessions) ? source.sessions : [],
    bookings: Array.isArray(source.bookings) ? source.bookings : [],
    conversations: Array.isArray(source.conversations)
      ? source.conversations
      : [],
  };
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

/**
 * Tiny durable store for local product development. All mutations are
 * serialized and written with an atomic rename so the API can later move to a
 * hosted database without leaking file-system details into route handlers.
 */
export function createRobosaStore({
  directory = process.env.ROBOSA_DATA_DIR || path.resolve('.robosa-data'),
} = {}) {
  const filePath = path.join(directory, 'database.json');
  let database;
  let loading;
  let mutationQueue = Promise.resolve();

  async function load() {
    if (database) return database;
    if (!loading) {
      loading = (async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        try {
          database = normalizeDatabase(
            JSON.parse(await readFile(filePath, 'utf8')),
          );
        } catch (error) {
          if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
            throw error;
          }
          database = emptyDatabase();
        }
        return database;
      })();
    }
    return loading;
  }

  async function persist() {
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  }

  async function read(reader) {
    await mutationQueue;
    const current = await load();
    return clone(reader(current));
  }

  function mutate(mutator) {
    const operation = mutationQueue.then(async () => {
      const current = await load();
      const result = await mutator(current);
      await persist();
      return clone(result);
    });
    mutationQueue = operation.catch(() => {});
    return operation;
  }

  return { filePath, read, mutate };
}
