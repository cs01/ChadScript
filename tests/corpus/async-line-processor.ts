// @category: async-io
// An async script in the everyday style: read a file with await, process it line by line in a
// for...of loop, write one output file per section, then read them back to build an index.
import { readFile, writeFile } from "node:fs/promises";

interface Section {
  name: string;
  lines: string[];
}

async function loadSections(path: string): Promise<Section[]> {
  const text = await readFile(path, "utf8");
  const sections: Section[] = [];
  let current: Section = { name: "global", lines: [] };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      sections.push(current);
      current = { name: line.slice(1, -1), lines: [] };
    } else if (line !== "" && !line.startsWith(";") && !line.startsWith("#")) {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections;
}

async function writeSection(section: Section): Promise<string> {
  const file = `section-${section.name}.txt`;
  const body = section.lines.map((l, i) => `${i + 1}: ${l}`).join("\n");
  await writeFile(file, body + "\n");
  return file;
}

async function main(): Promise<void> {
  const sections = await loadSections("fixtures/config.ini");
  console.log(`found ${sections.length} sections`);
  const files: string[] = [];
  for (const s of sections) {
    const f = await writeSection(s);
    files.push(f);
    console.log(`wrote ${f} (${s.lines.length} lines)`);
  }
  let index = "";
  for (const f of files) {
    const content = await readFile(f, "utf8");
    const keys = content
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => l.split(":")[1]!.split("=")[0]!.trim());
    index += `${f}: ${keys.join(", ")}\n`;
  }
  await writeFile("index.txt", index);
  console.log(index.trimEnd());
  try {
    await readFile("fixtures/missing.ini", "utf8");
  } catch (err) {
    console.log("could not read missing.ini:", (err as Error).message.split(",")[0]);
  }
}

await main();
console.log("all done");
