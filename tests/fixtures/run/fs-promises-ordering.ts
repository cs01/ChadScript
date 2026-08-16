// Sequencing that must be deterministic: awaits resume in issue order, a rejection is caught by the
// try around its own await, and Promise.all preserves array order regardless of completion order.
import { readFile, writeFile, unlink } from "node:fs/promises";

async function main(): Promise<void> {
  const base: string = "/tmp/chad-fsp-ord-" + process.pid;
  const a: string = base + "-a.txt";
  const b: string = base + "-b.txt";
  await writeFile(a, "first");
  await writeFile(b, "second");

  const both: string[] = await Promise.all([readFile(a, "utf8"), readFile(b, "utf8")]);
  console.log(both.join("|"));

  // Interleave with plain microtasks: a resolved promise's continuation runs before the read.
  const pending: Promise<string> = readFile(a, "utf8");
  console.log("issued");
  const marker: number = await Promise.resolve(1);
  console.log("microtask", marker);
  const late: string = await pending;
  console.log("read", late);

  await unlink(a);
  await unlink(b);
  console.log("cleaned");
}

main();
