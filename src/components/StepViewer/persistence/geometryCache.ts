import type { SerializedSolidData, SerializedTreeNode } from "../types";

const MAGIC = 0x53324755;
const CONTAINER_VERSION = 1;
const ALIGNMENT = 4;

interface BufferRef {
  offset: number;
  length: number;
}

interface SolidHeader {
  name: string;
  color?: number[];
  positions: BufferRef;
  normals: BufferRef;
  indices: BufferRef;
  edgePolylines: BufferRef;
  faceGroups: SerializedSolidData["faceGroups"];
  faceGeometries: SerializedSolidData["faceGeometries"];
  edgeGroups: SerializedSolidData["edgeGroups"];
  edgeGeometries: SerializedSolidData["edgeGeometries"];
  massProps?: SerializedSolidData["massProps"];
}

interface ContainerHeader {
  version: number;
  solids: SolidHeader[];
  tree: SerializedTreeNode | null;
}

function align(value: number): number {
  const remainder = value % ALIGNMENT;
  return remainder === 0 ? value : value + (ALIGNMENT - remainder);
}

export function encodeGeometryCache(
  solids: SerializedSolidData[],
  tree: SerializedTreeNode | null,
): Blob {
  const chunks: ArrayBufferView[] = [];
  let cursor = 0;

  const push = (view: ArrayBufferView): BufferRef => {
    const ref = { offset: cursor, length: view.byteLength };
    chunks.push(view);
    cursor += view.byteLength;
    const padding = align(cursor) - cursor;
    if (padding > 0) {
      chunks.push(new Uint8Array(padding));
      cursor += padding;
    }
    return ref;
  };

  const solidHeaders: SolidHeader[] = solids.map((solid) => ({
    name: solid.name,
    color: solid.color,
    positions: push(solid.positions),
    normals: push(solid.normals),
    indices: push(solid.indices),
    edgePolylines: push(solid.edgePolylines),
    faceGroups: solid.faceGroups,
    faceGeometries: solid.faceGeometries,
    edgeGroups: solid.edgeGroups,
    edgeGeometries: solid.edgeGeometries,
    massProps: solid.massProps,
  }));

  const header: ContainerHeader = { version: CONTAINER_VERSION, solids: solidHeaders, tree };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const headerPadding = align(headerBytes.byteLength) - headerBytes.byteLength;

  const prefix = new ArrayBuffer(12);
  const view = new DataView(prefix);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, CONTAINER_VERSION, true);
  view.setUint32(8, headerBytes.byteLength, true);

  return new Blob([prefix, headerBytes, new Uint8Array(headerPadding), ...(chunks as BlobPart[])]);
}

export interface DecodedGeometryCache {
  solids: SerializedSolidData[];
  tree: SerializedTreeNode | null;
}

export function decodeGeometryCache(buffer: ArrayBuffer): DecodedGeometryCache | null {
  if (buffer.byteLength < 12) return null;

  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) return null;
  if (view.getUint32(4, true) !== CONTAINER_VERSION) return null;

  const headerLength = view.getUint32(8, true);
  const headerStart = 12;
  if (headerStart + headerLength > buffer.byteLength) return null;

  let header: ContainerHeader;
  try {
    header = JSON.parse(
      new TextDecoder().decode(new Uint8Array(buffer, headerStart, headerLength)),
    );
  } catch {
    return null;
  }

  const dataStart = headerStart + align(headerLength);

  const slice = <T>(
    ref: BufferRef,
    make: (buf: ArrayBuffer, offset: number, length: number) => T,
    bytesPerElement: number,
  ): T | null => {
    const start = dataStart + ref.offset;
    if (start + ref.length > buffer.byteLength) return null;
    if (ref.length % bytesPerElement !== 0) return null;
    return make(buffer, start, ref.length / bytesPerElement);
  };

  const solids: SerializedSolidData[] = [];
  for (const entry of header.solids) {
    const positions = slice(
      entry.positions,
      (b, o, l) => new Float32Array(b, o, l),
      Float32Array.BYTES_PER_ELEMENT,
    );
    const normals = slice(
      entry.normals,
      (b, o, l) => new Float32Array(b, o, l),
      Float32Array.BYTES_PER_ELEMENT,
    );
    const indices = slice(
      entry.indices,
      (b, o, l) => new Uint32Array(b, o, l),
      Uint32Array.BYTES_PER_ELEMENT,
    );
    const edgePolylines = slice(
      entry.edgePolylines,
      (b, o, l) => new Float32Array(b, o, l),
      Float32Array.BYTES_PER_ELEMENT,
    );

    if (!positions || !normals || !indices || !edgePolylines) return null;

    solids.push({
      name: entry.name,
      color: entry.color,
      positions,
      normals,
      indices,
      edgePolylines,
      faceGroups: entry.faceGroups,
      faceGeometries: entry.faceGeometries,
      edgeGroups: entry.edgeGroups,
      edgeGeometries: entry.edgeGeometries,
      massProps: entry.massProps,
    });
  }

  return { solids, tree: header.tree ?? null };
}
