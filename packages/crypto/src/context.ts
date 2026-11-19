import { concat, u16, utf8 } from "./bytes.ts";

// Domain separation for every key derivation, signature and AAD in Waypoint (docs/security.md, "Context strings"):
//   "waypoint/v1/" + label, one 0x00 byte, then each field as a 2-byte big-endian length and its UTF-8 bytes.
export function context(label: string, ...fields: string[]): Uint8Array {
  if (!/^[a-z0-9-]{1,32}$/.test(label)) throw new RangeError("bad context label");
  const parts: Uint8Array[] = [utf8(`waypoint/v1/${label}`), new Uint8Array([0])];
  for (const field of fields) {
    const bytes = utf8(field);
    parts.push(u16(bytes.length), bytes);
  }
  return concat(...parts);
}
