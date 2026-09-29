/**
 * Safe client-side storage wrapper.
 *
 * Catches throwing `localStorage` accessors (e.g. blocked site data in sandboxed iframes,
 * browser settings, or private mode with throwing getters) and QuotaExceededError.
 * Degrades gracefully to fallback values or in-memory operations.
 */

function getStorage(): Storage | null {
  try {
    // The bare identifier (not `window.localStorage`): SSR/Node has no `localStorage`
    // global at all (ReferenceError, caught below), while a stubbed/blocked accessor
    // (tests, sandboxed iframes) is reachable this way in every runtime, `window`-less
    // Node test environments included.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Read and parse JSON from localStorage, returning `fallback` if storage is inaccessible,
 * the key is absent, JSON parsing fails, or optional `validate` returns false.
 */
export function readJSON<T>(
  key: string,
  fallback: T,
  validate?: (val: unknown) => val is T,
): T {
  try {
    const storage = getStorage();
    if (!storage) return fallback;
    const raw = storage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (validate && !validate(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

/**
 * Write a value to localStorage serialized as JSON.
 * Returns true if successful, false if storage is blocked or quota is exceeded.
 */
export function writeJSON<T>(key: string, value: T): boolean {
  try {
    const storage = getStorage();
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove an item from localStorage.
 * Returns true if successful, false if storage is blocked.
 */
export function remove(key: string): boolean {
  try {
    const storage = getStorage();
    if (!storage) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a raw string item from localStorage.
 */
export function getItem(key: string): string | null {
  try {
    const storage = getStorage();
    if (!storage) return null;
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Set a raw string item in localStorage.
 */
export function setItem(key: string, value: string): boolean {
  try {
    const storage = getStorage();
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
