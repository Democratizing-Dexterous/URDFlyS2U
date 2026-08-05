import { resetOpfsRoot } from "./opfs";

const KNOWN_DATABASES = ["step2urdf"];
const DB_TIMEOUT_MS = 8000;

export interface SiteCacheUsage {
  caches: number;
  serviceWorkers: number;
  localStorageKeys: number;
  sessionStorageKeys: number;
  databases: number;
  totalBytes: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    const settle = (value: T) => {
      clearTimeout(timer);
      resolve(value);
    };
    promise.then(settle, () => settle(fallback));
  });
}

async function cacheNames(): Promise<string[]> {
  try {
    if (typeof caches === "undefined") return [];
    return await caches.keys();
  } catch {
    return [];
  }
}

async function serviceWorkerRegistrations(): Promise<readonly ServiceWorkerRegistration[]> {
  try {
    if (!navigator.serviceWorker?.getRegistrations) return [];
    return await navigator.serviceWorker.getRegistrations();
  } catch {
    return [];
  }
}

function probeDatabase(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    let existed = true;
    try {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => {
        existed = false;
      };
      request.onsuccess = () => {
        request.result.close();
        if (!existed) indexedDB.deleteDatabase(name);
        resolve(existed);
      };
      request.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function databaseExists(name: string): Promise<boolean> {
  return withTimeout(probeDatabase(name), DB_TIMEOUT_MS, true);
}

async function databaseNames(): Promise<string[]> {
  try {
    const enumerate = (indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> })
      .databases;
    if (typeof enumerate === "function") {
      const list = await enumerate.call(indexedDB);
      return Array.from(
        new Set(list.map((entry) => entry?.name).filter((name): name is string => !!name)),
      );
    }
  } catch {}

  const checked = await Promise.all(
    KNOWN_DATABASES.map(async (name) => ((await databaseExists(name)) ? name : null)),
  );
  return checked.filter((name): name is string => name !== null);
}

function storageKeyCount(storage: Storage | undefined): number {
  try {
    return storage?.length ?? 0;
  } catch {
    return 0;
  }
}

async function opfsRootEntries(): Promise<string[]> {
  try {
    if (typeof navigator.storage?.getDirectory !== "function") return [];
    const base = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const name of (base as unknown as { keys(): AsyncIterable<string> }).keys()) {
      names.push(name);
    }
    return names;
  } catch {
    return [];
  }
}

export async function measureSiteCache(): Promise<SiteCacheUsage> {
  const [names, registrations, databases, estimate] = await Promise.all([
    cacheNames(),
    serviceWorkerRegistrations(),
    databaseNames(),
    navigator.storage?.estimate?.().catch(() => null) ?? Promise.resolve(null),
  ]);

  return {
    caches: names.length,
    serviceWorkers: registrations.length,
    localStorageKeys: storageKeyCount(globalThis.localStorage),
    sessionStorageKeys: storageKeyCount(globalThis.sessionStorage),
    databases: databases.length,
    totalBytes: estimate?.usage ?? 0,
  };
}

function requestDatabaseDelete(name: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
      setTimeout(() => resolve(null), DB_TIMEOUT_MS);
    } catch {
      resolve(false);
    }
  });
}

async function deleteDatabase(name: string): Promise<boolean> {
  const result = await requestDatabaseDelete(name);
  if (result !== null) return result;
  return !(await databaseExists(name));
}

async function clearOpfs(): Promise<string[]> {
  resetOpfsRoot();
  const entries = await opfsRootEntries();
  if (entries.length === 0) return [];

  const base = await navigator.storage.getDirectory();
  const remove = async (name: string): Promise<boolean> => {
    try {
      await base.removeEntry(name, { recursive: true });
      return true;
    } catch (error) {
      return (error as DOMException)?.name === "NotFoundError";
    }
  };

  const failed: string[] = [];
  for (const name of entries) {
    if (!(await remove(name)) && !(await remove(name))) failed.push(name);
  }
  return failed;
}

function clearWebStorage(storage: Storage | undefined): boolean {
  try {
    if (!storage) return true;
    storage.clear();
    return storage.length === 0;
  } catch {
    return false;
  }
}

export async function clearSiteCache(): Promise<string[]> {
  const failures = new Set<string>();

  const registrations = await serviceWorkerRegistrations();
  await Promise.all(
    registrations.map(async (registration) => {
      try {
        if (!(await registration.unregister())) failures.add("Service Worker");
      } catch {
        failures.add("Service Worker");
      }
    }),
  );

  const [names, databases] = await Promise.all([cacheNames(), databaseNames()]);

  await Promise.all([
    ...names.map(async (name) => {
      try {
        if (!(await caches.delete(name))) failures.add(`缓存 ${name}`);
      } catch {
        failures.add(`缓存 ${name}`);
      }
    }),
    ...databases.map(async (name) => {
      if (!(await deleteDatabase(name))) failures.add(`数据库 ${name}`);
    }),
    clearOpfs().then((failed) => {
      for (const name of failed) failures.add(`OPFS ${name}`);
    }),
  ]);

  if (!clearWebStorage(globalThis.localStorage)) failures.add("localStorage");
  if (!clearWebStorage(globalThis.sessionStorage)) failures.add("sessionStorage");

  return Array.from(failures);
}
