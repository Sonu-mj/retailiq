export type SafeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StorageKind = "localStorage" | "sessionStorage";

function createMemoryStorage(): SafeStorage {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function createSafeStorage(kind: StorageKind): SafeStorage {
  const memory = createMemoryStorage();
  let nativeStorage: Storage | null = null;

  try {
    const candidate = window[kind];
    const probeKey = `__retailiq_${kind}_probe__`;
    candidate.setItem(probeKey, probeKey);
    candidate.removeItem(probeKey);
    nativeStorage = candidate;
  } catch {
    nativeStorage = null;
  }

  return {
    getItem(key) {
      if (nativeStorage) {
        try {
          const value = nativeStorage.getItem(key);
          if (value !== null) memory.setItem(key, value);
          return value ?? memory.getItem(key);
        } catch {
          nativeStorage = null;
        }
      }
      return memory.getItem(key);
    },
    setItem(key, value) {
      memory.setItem(key, value);
      if (nativeStorage) {
        try {
          nativeStorage.setItem(key, value);
        } catch {
          nativeStorage = null;
        }
      }
    },
    removeItem(key) {
      memory.removeItem(key);
      if (nativeStorage) {
        try {
          nativeStorage.removeItem(key);
        } catch {
          nativeStorage = null;
        }
      }
    },
  };
}

export const safeLocalStorage = createSafeStorage("localStorage");
export const safeSessionStorage = createSafeStorage("sessionStorage");
