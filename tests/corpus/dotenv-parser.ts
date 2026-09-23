// @category: parsing
// A .env parser in the dotenv style: comments, `export`, quoted values (double quotes process
// escapes and ${VAR} interpolation, single quotes are literal), ${VAR:-default}, and warnings for
// malformed lines. Writes the resolved environment as JSON.
import { readFileSync, writeFileSync } from "node:fs";

interface ParseResult {
  vars: Map<string, string>;
  warnings: string[];
}

function interpolate(value: string, vars: Map<string, string>): string {
  let out = "";
  let i = 0;
  while (i < value.length) {
    if (value[i] === "$" && value[i + 1] === "{") {
      const end = value.indexOf("}", i);
      if (end === -1) {
        out += value.slice(i);
        break;
      }
      const expr = value.slice(i + 2, end);
      const [name, fallback] = expr.split(":-");
      out += vars.get(name ?? "") ?? fallback ?? "";
      i = end + 1;
    } else {
      out += value[i];
      i++;
    }
  }
  return out;
}

function parseEnv(text: string): ParseResult {
  const vars = new Map<string, string>();
  const warnings: string[] = [];
  text.split("\n").forEach((raw, idx) => {
    let line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) {
      warnings.push(`line ${idx + 1}: ignored "${line}"`);
      return;
    }
    const key = line.slice(0, eq).trim();
    let rest = line.slice(eq + 1).trim();
    let value: string;
    if (rest.startsWith('"')) {
      const close = rest.indexOf('"', 1);
      value = rest.slice(1, close === -1 ? undefined : close);
      value = value.split("\\n").join("\n").split("\\t").join("\t");
      value = interpolate(value, vars);
    } else if (rest.startsWith("'")) {
      const close = rest.indexOf("'", 1);
      value = rest.slice(1, close === -1 ? undefined : close);
    } else {
      const hash = rest.indexOf(" #");
      if (hash >= 0) rest = rest.slice(0, hash);
      value = interpolate(rest.trim(), vars);
    }
    if (vars.has(key)) warnings.push(`line ${idx + 1}: ${key} redefined`);
    vars.set(key, value);
  });
  return { vars, warnings };
}

const { vars, warnings } = parseEnv(readFileSync("fixtures/app.env", "utf8"));
for (const [k, v] of vars) console.log(`${k.padEnd(12)} = ${JSON.stringify(v)}`);
for (const w of warnings) console.log(`warning: ${w}`);
const typed = {
  port: Number(vars.get("PORT")),
  debug: vars.get("DEBUG") === "true",
  url: vars.get("BASE_URL"),
};
console.log(typed);
writeFileSync("env.json", JSON.stringify(Object.fromEntries(vars), null, 2) + "\n");
