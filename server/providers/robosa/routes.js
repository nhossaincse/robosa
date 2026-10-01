import { isReservedHandle } from './paths.js';

/** Resolve studio and public-profile URLs for the standalone Robosa app. */
export function resolveRobosaPath(pathname) {
  const normalized = String(pathname || '').replace(/^\/+|\/+$/g, '');
  if (!normalized) return 'studio';
  if (normalized === 'robosa' || normalized === 'studio') return 'studio';
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/i.test(normalized)) return null;
  if (isReservedHandle(normalized)) return null;
  return 'profile';
}

function install(server) {
  server.middlewares.use((request, _response, next) => {
    if (!request.url) return next();

    const url = new URL(request.url, 'http://localhost');
    if (!resolveRobosaPath(url.pathname)) return next();

    request.url = `/robosa.html${url.search}`;
    next();
  });
}

/** Serve Robosa studio/profile routes through its dedicated HTML entry. */
export function robosaRoutesPlugin() {
  return {
    name: 'robosa-routes',
    configureServer: install,
    configurePreviewServer: install,
  };
}
