// Minimal base58 (bitcoin alphabet) decode — the wasm-sdk returns block-proposer
// identifiers as base58 strings while every other layer speaks hex.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const INDEX = new Map(Array.from(ALPHABET, (c, i) => [c, i]));

export function base58Decode(s: string): Uint8Array {
  const bytes: number[] = [0];
  for (const c of s) {
    const v = INDEX.get(c);
    if (v === undefined) throw new Error(`invalid base58 character ${c}`);
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      const x = bytes[i] * 58 + carry;
      bytes[i] = x & 0xff;
      carry = x >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's are leading zero bytes.
  for (const c of s) {
    if (c !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

const HEX_RE = /^[0-9a-fA-F]{64}$/;

/** Normalize a 32-byte identifier from hex or base58 into lowercase hex. */
export function idToHex(key: string): string {
  if (HEX_RE.test(key)) return key.toLowerCase();
  const bytes = base58Decode(key);
  if (bytes.length !== 32) throw new Error(`identifier ${key} decodes to ${bytes.length} bytes`);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
