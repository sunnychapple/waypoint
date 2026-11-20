// Vectors are stored as int8 with one scale per vector, after L2 normalisation.
export type StoredVector = { scale: number; bytes: Uint8Array };

// False for an empty vector or one of all zeros: neither can be normalised, so neither is stored or searched.
export function hasDirection(vector: readonly number[]): boolean {
  return vector.some((v) => v !== 0);
}

export function quantize(vector: readonly number[]): StoredVector {
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (vector.length === 0 || norm === 0) throw new RangeError("empty or zero vector");
  let maxAbs = 0;
  for (const v of vector) maxAbs = Math.max(maxAbs, Math.abs(v / norm));
  const scale = maxAbs / 127;
  const q = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i++) q[i] = Math.round((vector[i] ?? 0) / norm / scale);
  return { scale, bytes: new Uint8Array(q.buffer) };
}

// Cosine similarity of two stored vectors of the same length (about -1 to 1).
export function similarity(a: StoredVector, b: StoredVector): number {
  if (a.bytes.length !== b.bytes.length) throw new RangeError("dimension mismatch");
  const x = new Int8Array(a.bytes.buffer, a.bytes.byteOffset, a.bytes.length);
  const y = new Int8Array(b.bytes.buffer, b.bytes.byteOffset, b.bytes.length);
  let dot = 0;
  for (let i = 0; i < x.length; i++) dot += (x[i] ?? 0) * (y[i] ?? 0);
  return dot * a.scale * b.scale;
}

// Reciprocal rank fusion of ranked id lists: score(id) = sum of 1 / (k + rank), rank starting at 1.
export function fuse(lists: readonly (readonly number[])[], k = 60): number[] {
  const scores = new Map<number, number>();
  for (const list of lists) list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...scores.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0]).map(([id]) => id);
}
