const ROOT_DIR = "step2urdf";
const PROJECTS_DIR = "projects";

let rootPromise: Promise<FileSystemDirectoryHandle> | null = null;

export function isOpfsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof FileSystemFileHandle !== "undefined"
  );
}

export function resetOpfsRoot(): void {
  rootPromise = null;
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  if (!rootPromise) {
    rootPromise = (async () => {
      const base = await navigator.storage.getDirectory();
      const app = await base.getDirectoryHandle(ROOT_DIR, { create: true });
      return app.getDirectoryHandle(PROJECTS_DIR, { create: true });
    })().catch((error) => {
      rootPromise = null;
      throw error;
    });
  }
  return rootPromise;
}

async function getProjectDir(
  projectId: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  const root = await getRoot();
  try {
    return await root.getDirectoryHandle(projectId, { create });
  } catch {
    return null;
  }
}

const PERSIST_TIMEOUT_MS = 3000;

export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator.storage?.persisted !== "function") return false;
    if (await navigator.storage.persisted()) return true;
    if (typeof navigator.storage.persist !== "function") return false;
    return await Promise.race([
      navigator.storage.persist(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PERSIST_TIMEOUT_MS)),
    ]);
  } catch {
    return false;
  }
}

export interface StorageEstimate {
  usage: number;
  quota: number;
  available: number;
}

export async function estimateStorage(): Promise<StorageEstimate | null> {
  try {
    if (typeof navigator.storage?.estimate !== "function") return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, available: Math.max(quota - usage, 0) };
  } catch {
    return null;
  }
}

export async function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator.locks?.request !== "function") return fn();
  return navigator.locks.request(`step2urdf:project:${projectId}`, fn) as Promise<T>;
}

export async function writeProjectStream(
  projectId: string,
  fileName: string,
  stream: ReadableStream<Uint8Array>,
): Promise<number> {
  const dir = await getProjectDir(projectId, true);
  if (!dir) throw new Error("无法创建项目存储目录");
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await stream.pipeTo(writable);
  return (await handle.getFile()).size;
}

export async function writeProjectBytes(
  projectId: string,
  fileName: string,
  data: BlobPart,
): Promise<number> {
  const dir = await getProjectDir(projectId, true);
  if (!dir) throw new Error("无法创建项目存储目录");
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {}
    throw error;
  }
  return (await handle.getFile()).size;
}

export async function readProjectFile(projectId: string, fileName: string): Promise<File | null> {
  const dir = await getProjectDir(projectId, false);
  if (!dir) return null;
  try {
    const handle = await dir.getFileHandle(fileName, { create: false });
    return await handle.getFile();
  } catch {
    return null;
  }
}

export async function readProjectBytes(
  projectId: string,
  fileName: string,
): Promise<Uint8Array | null> {
  const file = await readProjectFile(projectId, fileName);
  if (!file) return null;
  return new Uint8Array(await file.arrayBuffer());
}

export async function readProjectText(projectId: string, fileName: string): Promise<string | null> {
  const file = await readProjectFile(projectId, fileName);
  if (!file) return null;
  return file.text();
}

export async function removeProjectFile(projectId: string, fileName: string): Promise<void> {
  const dir = await getProjectDir(projectId, false);
  if (!dir) return;
  try {
    await dir.removeEntry(fileName);
  } catch {}
}

export async function deleteProjectDir(projectId: string): Promise<void> {
  const root = await getRoot();
  try {
    await root.removeEntry(projectId, { recursive: true });
  } catch {}
}

export async function projectFileSize(projectId: string, fileName: string): Promise<number> {
  const file = await readProjectFile(projectId, fileName);
  return file?.size ?? 0;
}

export async function listProjectIds(): Promise<string[]> {
  const root = await getRoot();
  const ids: string[] = [];
  for await (const [name, handle] of root as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind === "directory") ids.push(name);
  }
  return ids;
}

export async function clearAllProjectDirs(): Promise<void> {
  const root = await getRoot();
  await Promise.all(
    (await listProjectIds()).map(async (id) => {
      try {
        await root.removeEntry(id, { recursive: true });
      } catch {}
    }),
  );
}

export async function sha256Hex(data: BufferSource): Promise<string> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}
