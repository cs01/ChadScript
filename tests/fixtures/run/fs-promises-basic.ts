import { readFile, writeFile, appendFile, unlink } from "node:fs/promises";

async function main(): Promise<void> {
  const p: string = "/tmp/chad-fsp-" + process.pid + ".txt";
  await writeFile(p, "hello");
  await appendFile(p, " world");
  const body: string = await readFile(p, "utf8");
  console.log(body);
  await unlink(p);
  try {
    const gone: string = await readFile(p, "utf8");
    console.log("unreachable " + gone);
  } catch (e) {
    console.log("read after unlink rejected");
  }
  console.log("done");
}

main();
