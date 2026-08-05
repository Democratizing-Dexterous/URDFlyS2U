import * as Comlink from "comlink";

export interface WorkerClient<T> {
  get(): Comlink.Remote<T>;
  ready(): Promise<Comlink.Remote<T>>;
  isReady(): boolean;
  dispose(): void;
}

export function createWorkerClient<T extends object>(
  spawn: () => Worker,
  init?: (proxy: Comlink.Remote<T>) => Promise<unknown>,
): WorkerClient<T> {
  let worker: Worker | null = null;
  let proxy: Comlink.Remote<T> | null = null;
  let initPromise: Promise<void> | null = null;
  let initialized = false;

  function get(): Comlink.Remote<T> {
    if (!proxy) {
      worker = spawn();
      proxy = Comlink.wrap<T>(worker);
    }
    return proxy;
  }

  async function ready(): Promise<Comlink.Remote<T>> {
    const p = get();
    if (!init) return p;
    if (!initPromise) {
      initPromise = init(p)
        .then(() => {
          initialized = true;
        })
        .catch((err) => {
          initPromise = null;
          throw err;
        });
    }
    await initPromise;
    return p;
  }

  function dispose(): void {
    proxy?.[Comlink.releaseProxy]();
    worker?.terminate();
    proxy = null;
    worker = null;
    initPromise = null;
    initialized = false;
  }

  return { get, ready, isReady: () => initialized, dispose };
}
