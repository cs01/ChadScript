// @category: text
// Run-length and base-64 codecs written by hand, applied to a file: compress, write, read back,
// decompress, and verify. Also a hex dump of the first bytes.
import { readFileSync, writeFileSync } from "node:fs";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function rleEncode(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    let j = i + 1;
    while (j < s.length && s[j] === s[i] && j - i < 9) j++;
    out += String(j - i) + s[i];
    i = j;
  }
  return out;
}

function rleDecode(s: string): string {
  let out = "";
  for (let i = 0; i + 1 < s.length; i += 2) out += s[i + 1]!.repeat(Number(s[i]));
  return out;
}

function base64Encode(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i += 3) {
    const a = s.charCodeAt(i);
    const b = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
    const c = i + 2 < s.length ? s.charCodeAt(i + 2) : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += i + 1 < s.length ? B64[(n >> 6) & 63]! : "=";
    out += i + 2 < s.length ? B64[n & 63]! : "=";
  }
  return out;
}

function base64Decode(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i += 4) {
    const n = [0, 1, 2, 3].reduce(
      (acc, k) => (acc << 6) | Math.max(0, B64.indexOf(s[i + k] ?? "=")),
      0,
    );
    out += String.fromCharCode((n >> 16) & 255);
    if (s[i + 2] !== "=") out += String.fromCharCode((n >> 8) & 255);
    if (s[i + 3] !== "=") out += String.fromCharCode(n & 255);
  }
  return out;
}

function hexdump(s: string, count: number): string {
  const rows: string[] = [];
  for (let off = 0; off < Math.min(count, s.length); off += 16) {
    const chunk = s.slice(off, off + 16);
    const hex = [...chunk].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
    const ascii = [...chunk].map((c) => (c >= " " && c <= "~" ? c : ".")).join("");
    rows.push(`${off.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  |${ascii}|`);
  }
  return rows.join("\n");
}

const original = readFileSync("fixtures/maze.txt", "utf8");
const rle = rleEncode(original);
writeFileSync("maze.rle", rle);
const restored = rleDecode(readFileSync("maze.rle", "utf8"));
console.log(`rle: ${original.length} -> ${rle.length} chars, round trip ${restored === original}`);
const b64 = base64Encode(original);
writeFileSync("maze.b64", b64 + "\n");
console.log(`base64: ${b64.slice(0, 40)}..., decodes ok: ${base64Decode(b64) === original}`);
for (const s of ["", "f", "fo", "foo", "foob", "fooba", "foobar"])
  console.log(JSON.stringify(s), base64Encode(s));
console.log(hexdump(original, 48));
