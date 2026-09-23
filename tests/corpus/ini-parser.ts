// @category: parsing
// Parses an INI file into typed sections (numbers, booleans, lists), validates a few keys, and
// writes the result as JSON.
import { readFileSync, writeFileSync } from "node:fs";

type IniValue = string | number | boolean | string[];
type Section = Map<string, IniValue>;

class IniError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(`line ${line}: ${message}`);
    this.name = "IniError";
  }
}

function coerce(raw: string): IniValue {
  const v = raw.trim();
  if (/^(true|yes|on)$/i.test(v)) return true;
  if (/^(false|no|off)$/i.test(v)) return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.includes(",")) return v.split(",").map((s) => s.trim());
  return v;
}

function parseIni(text: string): Map<string, Section> {
  const sections = new Map<string, Section>();
  let current: Section = new Map();
  sections.set("", current);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith(";") || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      if (!line.endsWith("]")) throw new IniError("unterminated section header", i + 1);
      const name = line.slice(1, -1).trim();
      current = sections.get(name) ?? new Map();
      sections.set(name, current);
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) throw new IniError(`expected key = value, got "${line}"`, i + 1);
    current.set(line.slice(0, eq).trim(), coerce(line.slice(eq + 1)));
  }
  return sections;
}

function toObject(sections: Map<string, Section>): Record<string, Record<string, IniValue>> {
  const out: Record<string, Record<string, IniValue>> = {};
  for (const [name, section] of sections) {
    const obj: Record<string, IniValue> = {};
    for (const [k, v] of section) obj[k] = v;
    out[name === "" ? "global" : name] = obj;
  }
  return out;
}

const config = parseIni(readFileSync("fixtures/config.ini", "utf8"));
for (const [name, section] of config) {
  console.log(`[${name || "global"}] ${section.size} keys`);
  for (const [k, v] of section) {
    const kind = Array.isArray(v) ? `list(${v.length})` : typeof v;
    console.log(`  ${k} = ${JSON.stringify(v)} (${kind})`);
  }
}

const port = config.get("server")?.get("port");
if (typeof port !== "number" || port < 1 || port > 65535) {
  throw new Error("server.port must be a valid port");
}
console.log(`server listens on ${config.get("server")?.get("host")}:${port}`);

writeFileSync("config.json", JSON.stringify(toObject(config), null, 2) + "\n");

try {
  parseIni("[ok]\na = 1\n[broken\n");
} catch (e) {
  if (e instanceof IniError) console.log(`rejected bad input: ${e.message} (line ${e.line})`);
  else throw e;
}
