// @category: text
// A line-based diff (LCS over lines) that prints a unified-style patch with hunks and context,
// writes the patch file, and applies it back to verify it.
import { writeFileSync } from "node:fs";

type Edit = { kind: " " | "-" | "+"; line: string };

function diffLines(a: string[], b: string[]): Edit[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) dp.push(new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      edits.push({ kind: " ", line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      edits.push({ kind: "-", line: a[i++]! });
    } else {
      edits.push({ kind: "+", line: b[j++]! });
    }
  }
  while (i < n) edits.push({ kind: "-", line: a[i++]! });
  while (j < m) edits.push({ kind: "+", line: b[j++]! });
  return edits;
}

function unified(edits: Edit[], context = 1): string[] {
  const out: string[] = [];
  const changed = edits.map((e) => e.kind !== " ");
  let k = 0;
  while (k < edits.length) {
    if (!changed[k]) {
      k++;
      continue;
    }
    const start = Math.max(0, k - context);
    let end = k;
    while (
      end < edits.length &&
      (changed[end] || changed.slice(end, end + context * 2 + 1).some(Boolean))
    )
      end++;
    end = Math.min(edits.length, end + context);
    const hunk = edits.slice(start, end);
    const aStart = edits.slice(0, start).filter((e) => e.kind !== "+").length + 1;
    const bStart = edits.slice(0, start).filter((e) => e.kind !== "-").length + 1;
    const aLen = hunk.filter((e) => e.kind !== "+").length;
    const bLen = hunk.filter((e) => e.kind !== "-").length;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const e of hunk) out.push(e.kind + e.line);
    k = end;
  }
  return out;
}

function apply(original: string[], edits: Edit[]): string[] {
  const out: string[] = [];
  let i = 0;
  for (const e of edits) {
    if (e.kind === " ") {
      if (original[i] !== e.line) throw new Error(`context mismatch at line ${i + 1}`);
      out.push(original[i++]!);
    } else if (e.kind === "-") {
      i++;
    } else {
      out.push(e.line);
    }
  }
  return out;
}

const before = `function greet(name) {
  console.log("Hello " + name);
}

greet("world");
greet("there");
// end of file`.split("\n");

const after = `function greet(name, punctuation) {
  const p = punctuation ?? "!";
  console.log("Hello " + name + p);
}

greet("world");
greet("there", "?");
// end of file`.split("\n");

const edits = diffLines(before, after);
const patch = ["--- a/greet.js", "+++ b/greet.js", ...unified(edits)];
console.log(patch.join("\n"));
writeFileSync("greet.patch", patch.join("\n") + "\n");
const stats = {
  added: edits.filter((e) => e.kind === "+").length,
  removed: edits.filter((e) => e.kind === "-").length,
};
console.log(`${stats.added} insertions(+), ${stats.removed} deletions(-)`);
console.log("round trip ok:", apply(before, edits).join("\n") === after.join("\n"));
console.log(
  unified(diffLines(["a", "b", "c"], ["a", "b", "c"])).length === 0 ? "identical" : "different",
);
