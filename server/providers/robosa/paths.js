const RESERVED_HANDLES = new Set([
  'api',
  'assets',
  'favicon',
  'index',
  'node_modules',
  'public',
  'robosa',
  'robots',
  'src',
  'studio',
]);

export function isReservedHandle(value) {
  return RESERVED_HANDLES.has(String(value || '').toLowerCase());
}
