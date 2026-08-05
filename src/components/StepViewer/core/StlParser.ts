export interface RawMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

const BINARY_HEADER_BYTES = 84;
const BINARY_TRIANGLE_BYTES = 50;

export function isBinaryStl(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < BINARY_HEADER_BYTES) return false;

  const view = new DataView(buffer);
  const triangles = view.getUint32(80, true);
  if (BINARY_HEADER_BYTES + triangles * BINARY_TRIANGLE_BYTES === buffer.byteLength) {
    return true;
  }

  const probe = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 512));
  let text = "";
  for (let i = 0; i < probe.length; i++) {
    const code = probe[i];
    if (code === 0) return true;
    text += String.fromCharCode(code);
  }
  return !/^\s*solid/i.test(text);
}

export function parseStl(buffer: ArrayBuffer, scale = 1): RawMesh {
  const raw = isBinaryStl(buffer) ? parseBinaryStl(buffer) : parseAsciiStl(buffer);
  if (scale !== 1) {
    for (let i = 0; i < raw.positions.length; i++) raw.positions[i] *= scale;
  }
  return raw;
}

function parseBinaryStl(buffer: ArrayBuffer): RawMesh {
  const view = new DataView(buffer);
  const triangles = view.getUint32(80, true);
  const usable = Math.min(
    triangles,
    Math.floor((buffer.byteLength - BINARY_HEADER_BYTES) / BINARY_TRIANGLE_BYTES),
  );

  const positions = new Float32Array(usable * 9);
  const normals = new Float32Array(usable * 9);
  const indices = new Uint32Array(usable * 3);

  for (let t = 0; t < usable; t++) {
    const base = BINARY_HEADER_BYTES + t * BINARY_TRIANGLE_BYTES;
    const nx = view.getFloat32(base, true);
    const ny = view.getFloat32(base + 4, true);
    const nz = view.getFloat32(base + 8, true);

    for (let v = 0; v < 3; v++) {
      const off = base + 12 + v * 12;
      const target = t * 9 + v * 3;
      positions[target] = view.getFloat32(off, true);
      positions[target + 1] = view.getFloat32(off + 4, true);
      positions[target + 2] = view.getFloat32(off + 8, true);
      normals[target] = nx;
      normals[target + 1] = ny;
      normals[target + 2] = nz;
      indices[t * 3 + v] = t * 3 + v;
    }
  }

  return fixNormals({ positions, normals, indices });
}

function parseAsciiStl(buffer: ArrayBuffer): RawMesh {
  const text = new TextDecoder().decode(buffer);
  const positionList: number[] = [];
  const normalList: number[] = [];

  const facetRe = /facet\s+normal\s+([^\n]*)\n([\s\S]*?)endfacet/gi;
  const vertexRe = /vertex\s+([^\n]*)/gi;

  let facet: RegExpExecArray | null;
  while ((facet = facetRe.exec(text)) !== null) {
    const n = readTriple(facet[1]);
    const body = facet[2];
    const verts: number[][] = [];
    vertexRe.lastIndex = 0;
    let vertex: RegExpExecArray | null;
    while ((vertex = vertexRe.exec(body)) !== null) {
      verts.push(readTriple(vertex[1]));
    }
    for (let i = 2; i < verts.length; i++) {
      pushTriangle(positionList, normalList, verts[0], verts[i - 1], verts[i], n);
    }
  }

  const count = positionList.length / 3;
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;

  return fixNormals({
    positions: new Float32Array(positionList),
    normals: new Float32Array(normalList),
    indices,
  });
}

function pushTriangle(
  positionList: number[],
  normalList: number[],
  a: number[],
  b: number[],
  c: number[],
  n: number[],
): void {
  positionList.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (let i = 0; i < 3; i++) normalList.push(n[0], n[1], n[2]);
}

function readTriple(str: string): number[] {
  const parts = str.trim().split(/\s+/);
  return [Number(parts[0]) || 0, Number(parts[1]) || 0, Number(parts[2]) || 0];
}

function fixNormals(mesh: RawMesh): RawMesh {
  const { positions, normals, indices } = mesh;
  const triCount = Math.floor(indices.length / 3);

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3] * 3;
    const nx = normals[i0];
    const ny = normals[i0 + 1];
    const nz = normals[i0 + 2];
    if (nx * nx + ny * ny + nz * nz > 1e-12) continue;

    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i1] - positions[i0];
    const ay = positions[i1 + 1] - positions[i0 + 1];
    const az = positions[i1 + 2] - positions[i0 + 2];
    const bx = positions[i2] - positions[i0];
    const by = positions[i2 + 1] - positions[i0 + 1];
    const bz = positions[i2 + 2] - positions[i0 + 2];

    let cx = ay * bz - az * by;
    let cy = az * bx - ax * bz;
    let cz = ax * by - ay * bx;
    const len = Math.hypot(cx, cy, cz);
    if (len > 1e-12) {
      cx /= len;
      cy /= len;
      cz /= len;
    }

    for (let v = 0; v < 3; v++) {
      const target = indices[t * 3 + v] * 3;
      normals[target] = cx;
      normals[target + 1] = cy;
      normals[target + 2] = cz;
    }
  }

  return mesh;
}
