import type { PackageFile } from "./RobotPackage";
import { isDescriptorPath, isMeshPath, normalizePath } from "./RobotPackage";

const MAX_ENTRIES = 5000;
const IGNORED_DIRS = /(^|\/)(\.git|__pycache__|node_modules|\.vscode|\.idea)(\/|$)/i;

function isUseful(path: string): boolean {
  if (IGNORED_DIRS.test(path)) return false;
  return isDescriptorPath(path) || isMeshPath(path);
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  fullPath: string;
  name: string;
  file: (cb: (file: File) => void, err: (e: unknown) => void) => void;
  createReader: () => {
    readEntries: (cb: (entries: FileSystemEntryLike[]) => void, err: (e: unknown) => void) => void;
  };
}

function readEntries(entry: FileSystemEntryLike): Promise<FileSystemEntryLike[]> {
  const reader = entry.createReader();
  const all: FileSystemEntryLike[] = [];
  return new Promise((resolve, reject) => {
    const step = (): void => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        step();
      }, reject);
    };
    step();
  });
}

function entryFile(entry: FileSystemEntryLike): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(
  entry: FileSystemEntryLike,
  prefix: string,
  out: PackageFile[],
): Promise<void> {
  if (out.length >= MAX_ENTRIES) return;

  if (entry.isFile) {
    const path = normalizePath(prefix ? `${prefix}/${entry.name}` : entry.name);
    if (!isUseful(path)) return;
    try {
      out.push({ path, file: await entryFile(entry) });
    } catch {}
    return;
  }

  if (!entry.isDirectory) return;
  if (IGNORED_DIRS.test(`${entry.name}/`)) return;

  const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
  const children = await readEntries(entry);
  for (const child of children) {
    await walkEntry(child, nextPrefix, out);
  }
}

export async function collectFilesFromDataTransfer(transfer: DataTransfer): Promise<PackageFile[]> {
  const out: PackageFile[] = [];
  const items = Array.from(transfer.items ?? []);
  const entries: FileSystemEntryLike[] = [];

  for (const item of items) {
    if (item.kind !== "file") continue;
    const getter = (
      item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }
    ).webkitGetAsEntry;
    const entry = getter ? getter.call(item) : null;
    if (entry) entries.push(entry);
  }

  if (entries.length > 0) {
    for (const entry of entries) {
      await walkEntry(entry, "", out);
    }
    if (out.length > 0) return out;
  }

  for (const file of Array.from(transfer.files ?? [])) {
    const path = normalizePath(
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    );
    if (isUseful(path)) out.push({ path, file });
  }

  return out;
}

export function collectFilesFromInput(fileList: FileList | File[]): PackageFile[] {
  const out: PackageFile[] = [];
  for (const file of Array.from(fileList)) {
    const path = normalizePath(
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    );
    if (isUseful(path)) out.push({ path, file });
  }
  return out;
}
