// @category: async-io
// Async iteration: an async generator that yields a file's lines, a transform stage, batching,
// and `for await` consumption; the result is written as JSON lines.
import { readFile, writeFile } from "node:fs/promises";

async function* readLines(path: string): AsyncGenerator<string> {
  const text = await readFile(path, "utf8");
  for (const line of text.split("\n")) {
    if (line.length > 0) yield line;
  }
}

async function* parseLog(
  lines: AsyncIterable<string>,
): AsyncGenerator<{ ip: string; status: number; path: string }> {
  for await (const line of lines) {
    const parts = line.split(" ");
    const status = Number(parts[8]);
    if (parts.length < 10 || Number.isNaN(status)) continue;
    yield { ip: parts[0] ?? "", status, path: parts[6] ?? "" };
  }
}

async function* batch<T>(items: AsyncIterable<T>, size: number): AsyncGenerator<T[]> {
  let buf: T[] = [];
  for await (const item of items) {
    buf.push(item);
    if (buf.length === size) {
      yield buf;
      buf = [];
    }
  }
  if (buf.length > 0) yield buf;
}

async function main(): Promise<void> {
  const out: string[] = [];
  let batches = 0;
  for await (const group of batch(parseLog(readLines("fixtures/access.log")), 4)) {
    batches++;
    const errors = group.filter((e) => e.status >= 400).length;
    console.log(
      `batch ${batches}: ${group.length} entries, ${errors} errors, paths ${group.map((e) => e.path).join(" ")}`,
    );
    for (const e of group) out.push(JSON.stringify(e));
  }
  await writeFile("entries.jsonl", out.join("\n") + "\n");
  const back = (await readFile("entries.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { status: number });
  console.log(`wrote ${back.length} entries; status sum ${back.reduce((s, e) => s + e.status, 0)}`);
}

main().catch((e: unknown) => {
  console.log("failed:", (e as Error).message);
  process.exitCode = 1;
});
