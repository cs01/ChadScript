// @category: async-io
// An async pipeline: read several input files concurrently, transform them, write outputs, then
// append a manifest. Errors from a missing file are caught per file.
import { readFile, writeFile, appendFile } from "node:fs/promises";

interface Stats {
  file: string;
  lines: number;
  bytes: number;
  checksum: number;
}

function checksum(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

async function processFile(path: string): Promise<Stats> {
  const text = await readFile(path, "utf8");
  const upper = text
    .split("\n")
    .map((l, i) => (l ? `${String(i + 1).padStart(3, "0")} ${l.toUpperCase()}` : l))
    .join("\n");
  const outName = path.replace(/^fixtures\//, "").replace(/\.\w+$/, ".upper.txt");
  await writeFile(outName, upper);
  return {
    file: path,
    lines: text.split("\n").length - 1,
    bytes: text.length,
    checksum: checksum(text),
  };
}

async function main(): Promise<void> {
  const inputs = [
    "fixtures/words.txt",
    "fixtures/graph.txt",
    "fixtures/does-not-exist.txt",
    "fixtures/expr.txt",
  ];
  const results = await Promise.allSettled(inputs.map(processFile));
  const ok: Stats[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") ok.push(r.value);
    else console.log(`skipped ${inputs[i]}: ${(r.reason as NodeJS.ErrnoException).code}`);
  });
  for (const s of ok)
    console.log(`${s.file}: ${s.lines} lines, ${s.bytes} bytes, checksum ${s.checksum}`);

  await writeFile("manifest.txt", "# manifest\n");
  for (const s of ok) {
    await appendFile("manifest.txt", `${s.file}\t${s.checksum}\n`);
  }
  const manifest = await readFile("manifest.txt", "utf8");
  console.log(manifest.trimEnd());

  const sequential: number[] = [];
  for (const f of ["fixtures/words.txt", "fixtures/graph.txt"]) {
    const t = await readFile(f, "utf8");
    sequential.push(t.length);
  }
  console.log("sequential sizes:", sequential);
}

main().then(
  () => console.log("done"),
  (e: unknown) => {
    console.log("pipeline failed", e);
    process.exit(1);
  },
);
