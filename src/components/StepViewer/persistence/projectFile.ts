import { zip, unzip, type Zippable, type Unzipped } from "fflate";
import {
  MILES_EXTENSION,
  ProjectFormatError,
  migrateSnapshot,
  type LoadedProject,
  type ProjectSnapshot,
} from "./types";

const ENTRY_MANIFEST = "manifest.json";
const ENTRY_URDF = "urdf.json";
const ENTRY_COLLISION = "collision.json";
const ENTRY_VIEWPORT = "viewport.json";
const ENTRY_STEP = "model.step";
const ENTRY_THUMBNAIL = "thumbnail.png";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function zipAsync(input: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(input, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

function unzipAsync(input: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(input, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value, null, 2));
}

export async function packProject(
  snapshot: ProjectSnapshot,
  stepBytes: Uint8Array,
  thumbnail?: Blob,
): Promise<Blob> {
  const entries: Zippable = {
    [ENTRY_MANIFEST]: json(snapshot.manifest),
    [ENTRY_URDF]: json(snapshot.urdf),
    [ENTRY_COLLISION]: json(snapshot.collision),
    [ENTRY_VIEWPORT]: json(snapshot.viewport),
    [ENTRY_STEP]: stepBytes,
  };

  if (thumbnail) {
    entries[ENTRY_THUMBNAIL] = new Uint8Array(await thumbnail.arrayBuffer());
  }

  const packed = await zipAsync(entries);
  return new Blob([packed as BlobPart], { type: "application/zip" });
}

export async function unpackProject(file: Blob): Promise<LoadedProject> {
  let entries: Unzipped;
  try {
    entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new ProjectFormatError("无法解析项目文件，请确认它是完整的 .miles 文件");
  }

  const read = (name: string): unknown => {
    const raw = entries[name];
    if (!raw) throw new ProjectFormatError(`项目文件缺少 ${name}`);
    try {
      return JSON.parse(decoder.decode(raw));
    } catch {
      throw new ProjectFormatError(`项目文件中的 ${name} 无法解析`);
    }
  };

  const snapshot = migrateSnapshot({
    manifest: read(ENTRY_MANIFEST),
    urdf: read(ENTRY_URDF),
    collision: read(ENTRY_COLLISION),
    viewport: read(ENTRY_VIEWPORT),
  });

  const stepBytes = entries[ENTRY_STEP];
  if (!stepBytes || stepBytes.byteLength === 0) {
    throw new ProjectFormatError("项目文件中没有 STEP 模型数据");
  }

  const thumbBytes = entries[ENTRY_THUMBNAIL];
  const thumbnail = thumbBytes
    ? new Blob([thumbBytes as BlobPart], { type: "image/png" })
    : undefined;

  return { snapshot, stepBytes, thumbnail };
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "project";
}

export async function saveProjectFile(blob: Blob, suggestedName: string): Promise<boolean> {
  const fileName = `${sanitizeFileName(suggestedName)}${MILES_EXTENSION}`;

  const picker = (
    window as unknown as {
      showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;

  if (typeof picker === "function") {
    try {
      const handle = await picker.call(window, {
        suggestedName: fileName,
        types: [
          {
            description: "step2urdf 项目",
            accept: { "application/zip": [MILES_EXTENSION] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return false;
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
