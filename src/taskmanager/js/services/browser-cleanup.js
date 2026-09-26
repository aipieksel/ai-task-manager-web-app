const CLEANUP_REGISTRY_CANDIDATES = [
  './data/runtime/config/browser.json',
];

const DEFAULT_CLEANUP_REGISTRY = Object.freeze({
  version: 1,
  browserResidue: {
    enabled: true,
    clearServiceWorkers: true,
    clearCacheStorage: true,
    clearWebStorage: true,
    clearIndexedDb: true,
    clearCookies: false,
  },
});

const DISABLED_CLEANUP_REGISTRY = Object.freeze({
  ...DEFAULT_CLEANUP_REGISTRY,
  browserResidue: {
    ...DEFAULT_CLEANUP_REGISTRY.browserResidue,
    enabled: false,
  },
});

function normalizeRegistry(payload = {}) {
  const browserResidue = payload.browserResidue && typeof payload.browserResidue === 'object'
    ? payload.browserResidue
    : DEFAULT_CLEANUP_REGISTRY.browserResidue;
  return {
    version: 1,
    browserResidue: {
      ...DEFAULT_CLEANUP_REGISTRY.browserResidue,
      ...browserResidue,
      enabled: browserResidue.enabled !== false,
    },
  };
}

async function loadCleanupRegistry() {
  if (!window.fetch || location.protocol === 'file:') return DEFAULT_CLEANUP_REGISTRY;
  if ('onLine' in navigator && !navigator.onLine) return DISABLED_CLEANUP_REGISTRY;
  for (const candidate of CLEANUP_REGISTRY_CANDIDATES) {
    try {
      const url = new URL(candidate, location.href).href;
      const response = await fetch(url, { cache: 'no-store' });
      if (response.status === 404) continue;
      if (!response.ok) continue;
      return normalizeRegistry(await response.json());
    } catch (_) {
      continue;
    }
  }
  return DEFAULT_CLEANUP_REGISTRY;
}

async function clearServiceWorkers() {
  if (!('serviceWorker' in navigator)) return 0;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  return registrations.length;
}

async function clearCacheStorage() {
  if (!('caches' in window)) return 0;
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
  return keys.length;
}

function clearWebStorage() {
  const storageNames = ['localStorage', 'sessionStorage'];
  let cleared = 0;
  storageNames.forEach((name) => {
    try {
      const storage = window[name];
      if (!storage) return;
      const before = storage.length;
      storage.clear();
      cleared += before;
    } catch (_) {
      // Browser privacy settings can block access; cleanup should continue.
    }
  });
  return cleared;
}

async function clearIndexedDb() {
  if (!('indexedDB' in window) || typeof indexedDB.databases !== 'function') return 0;
  const databases = await indexedDB.databases();
  await Promise.all(databases.map((database) => new Promise((resolve) => {
    if (!database.name) {
      resolve(false);
      return;
    }
    const request = indexedDB.deleteDatabase(database.name);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    request.onblocked = () => resolve(false);
  })));
  return databases.length;
}

function clearCookies() {
  const cookies = document.cookie ? document.cookie.split(';') : [];
  cookies.forEach((cookie) => {
    const name = cookie.split('=')[0]?.trim();
    if (!name) return;
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
  return cookies.length;
}

export async function clearBrowserResidueFromRegistry() {
  const registry = await loadCleanupRegistry();
  const settings = registry.browserResidue || {};
  if (!settings.enabled) return { registry, cleared: {}, skipped: true };

  const cleared = {};
  if (settings.clearServiceWorkers) cleared.serviceWorkers = await clearServiceWorkers();
  if (settings.clearCacheStorage) cleared.cacheStorage = await clearCacheStorage();
  if (settings.clearWebStorage) cleared.webStorageKeys = clearWebStorage();
  if (settings.clearIndexedDb) cleared.indexedDbDatabases = await clearIndexedDb();
  if (settings.clearCookies) cleared.cookies = clearCookies();
  return { registry, cleared, skipped: false };
}
