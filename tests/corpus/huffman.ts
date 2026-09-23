// @category: algorithms
// Huffman coding: frequency table, tree built with a sorted work list, code table, encoding to a
// bit string, decoding back, and the compression ratio. Writes the code table to a file.
import { readFileSync, writeFileSync } from "node:fs";

type HNode =
  | { kind: "leaf"; ch: string; freq: number }
  | { kind: "node"; left: HNode; right: HNode; freq: number };

function buildTree(text: string): HNode {
  const freq = new Map<string, number>();
  for (const ch of text) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let nodes: HNode[] = [...freq.entries()]
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
    .map(([ch, f]) => ({ kind: "leaf", ch, freq: f }));
  if (nodes.length === 1)
    return { kind: "node", left: nodes[0]!, right: nodes[0]!, freq: nodes[0]!.freq };
  while (nodes.length > 1) {
    const [a, b, ...rest] = nodes;
    const merged: HNode = { kind: "node", left: a!, right: b!, freq: a!.freq + b!.freq };
    let i = 0;
    while (i < rest.length && rest[i]!.freq <= merged.freq) i++;
    rest.splice(i, 0, merged);
    nodes = rest;
  }
  return nodes[0]!;
}

function codes(tree: HNode, prefix = "", out = new Map<string, string>()): Map<string, string> {
  if (tree.kind === "leaf") out.set(tree.ch, prefix || "0");
  else {
    codes(tree.left, prefix + "0", out);
    codes(tree.right, prefix + "1", out);
  }
  return out;
}

function encode(text: string, table: Map<string, string>): string {
  let bits = "";
  for (const ch of text) bits += table.get(ch);
  return bits;
}

function decode(bits: string, tree: HNode): string {
  let out = "";
  let node = tree;
  for (const b of bits) {
    if (node.kind === "node") node = b === "0" ? node.left : node.right;
    if (node.kind === "leaf") {
      out += node.ch;
      node = tree;
    }
  }
  return out;
}

const text = readFileSync("fixtures/words.txt", "utf8");
const tree = buildTree(text);
const table = codes(tree);
const bits = encode(text, table);
const decoded = decode(bits, tree);
console.log(
  `symbols: ${table.size}, original ${text.length * 8} bits, encoded ${bits.length} bits`,
);
console.log(
  `ratio: ${((bits.length / (text.length * 8)) * 100).toFixed(1)}%, round trip ok: ${decoded === text}`,
);
const rows = [...table.entries()]
  .sort((a, b) => a[1].length - b[1].length || (a[0] < b[0] ? -1 : 1))
  .map(([ch, code]) => `${JSON.stringify(ch)}\t${code}`);
writeFileSync("codes.tsv", rows.join("\n") + "\n");
console.log(rows.slice(0, 6).join("\n"));
console.log(bits.slice(0, 64));
