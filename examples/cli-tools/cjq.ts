import { ArgumentParser } from "chadscript/argparse";

const parser = new ArgumentParser(
  "cjq",
  "A fast JSON query tool — like jq, written in TypeScript, compiled to native",
);
parser.addFlag("raw", "r", "Output raw strings without quotes");
parser.addFlag("compact", "c", "Compact output (no pretty-printing)");
parser.addPositional("filter", "jq-style filter expression (e.g. '.name', '.items[].id')");
parser.addPositional("file", "JSON file to process");
parser.parse(process.argv);

const filter = parser.getPositional(0);
const filePath = parser.getPositional(1);

if (filter.length === 0) {
  console.error("cjq: missing filter expression");
  console.error("Try 'cjq --help' for more information");
  process.exit(2);
}

const rawMode = parser.getFlag("raw");
const compact = parser.getFlag("compact");

let content = "";
if (filePath.length === 0) {
  content = process.stdin.read();
} else {
  content = fs.readFileSync(filePath);
}
if (content.length === 0) {
  console.error("cjq: empty input");
  process.exit(1);
}

const input = content.trim();

function isDigit(ch: string): boolean {
  return (
    ch === "0" ||
    ch === "1" ||
    ch === "2" ||
    ch === "3" ||
    ch === "4" ||
    ch === "5" ||
    ch === "6" ||
    ch === "7" ||
    ch === "8" ||
    ch === "9"
  );
}

function skipWhitespace(s: string, pos: number): number {
  while (pos < s.length) {
    const ch = s.charAt(pos);
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
      pos = pos + 1;
    } else {
      return pos;
    }
  }
  return pos;
}

function findMatchingBrace(s: string, start: number): number {
  const open = s.charAt(start);
  let close = "}";
  if (open === "[") close = "]";
  let depth = 1;
  let pos = start + 1;
  let inString = false;
  while (pos < s.length && depth > 0) {
    const ch = s.charAt(pos);
    if (inString) {
      if (ch === "\\") {
        pos = pos + 1;
      } else if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
      } else if (ch === open) {
        depth = depth + 1;
      } else if (ch === close) {
        depth = depth - 1;
      }
    }
    pos = pos + 1;
  }
  return pos;
}

function extractStringValue(s: string, pos: number): string {
  pos = pos + 1;
  let result = "";
  while (pos < s.length) {
    const ch = s.charAt(pos);
    if (ch === "\\") {
      pos = pos + 1;
      if (pos < s.length) {
        const esc = s.charAt(pos);
        if (esc === "n") {
          result = result + "\n";
        } else if (esc === "t") {
          result = result + "\t";
        } else if (esc === "r") {
          result = result + "\r";
        } else {
          result = result + esc;
        }
      }
    } else if (ch === '"') {
      return result;
    } else {
      result = result + ch;
    }
    pos = pos + 1;
  }
  return result;
}

function extractRawValue(s: string, pos: number): string {
  pos = skipWhitespace(s, pos);
  if (pos >= s.length) return "";
  const ch = s.charAt(pos);
  if (ch === '"') {
    const strVal = extractStringValue(s, pos);
    return '"' + strVal + '"';
  }
  if (ch === "{" || ch === "[") {
    const end = findMatchingBrace(s, pos);
    return s.substring(pos, end);
  }
  let end = pos;
  while (end < s.length) {
    const eCh = s.charAt(end);
    if (
      eCh === "," ||
      eCh === "}" ||
      eCh === "]" ||
      eCh === " " ||
      eCh === "\n" ||
      eCh === "\r" ||
      eCh === "\t"
    ) {
      break;
    }
    end = end + 1;
  }
  return s.substring(pos, end);
}

function findField(json: string, fieldName: string): string {
  let pos = skipWhitespace(json, 0);
  if (pos >= json.length || json.charAt(pos) !== "{") {
    console.error("cjq: expected object for field access '." + fieldName + "'");
    process.exit(1);
  }
  pos = pos + 1;
  while (pos < json.length) {
    pos = skipWhitespace(json, pos);
    if (pos >= json.length || json.charAt(pos) === "}") break;
    if (json.charAt(pos) !== '"') {
      pos = pos + 1;
      continue;
    }
    const key = extractStringValue(json, pos);
    pos = pos + key.length + 2;
    pos = skipWhitespace(json, pos);
    if (pos < json.length && json.charAt(pos) === ":") {
      pos = pos + 1;
    }
    pos = skipWhitespace(json, pos);
    if (key === fieldName) {
      return extractRawValue(json, pos);
    }
    const ch = json.charAt(pos);
    if (ch === '"') {
      pos = pos + 1;
      while (pos < json.length) {
        const sCh = json.charAt(pos);
        if (sCh === "\\") {
          pos = pos + 2;
        } else if (sCh === '"') {
          pos = pos + 1;
          break;
        } else {
          pos = pos + 1;
        }
      }
    } else if (ch === "{" || ch === "[") {
      pos = findMatchingBrace(json, pos);
    } else {
      while (pos < json.length) {
        const vCh = json.charAt(pos);
        if (vCh === "," || vCh === "}") break;
        pos = pos + 1;
      }
    }
    pos = skipWhitespace(json, pos);
    if (pos < json.length && json.charAt(pos) === ",") {
      pos = pos + 1;
    }
  }
  return "null";
}

function iterateArray(json: string): string[] {
  const results: string[] = [];
  let pos = skipWhitespace(json, 0);
  if (pos >= json.length || json.charAt(pos) !== "[") {
    console.error("cjq: expected array for '[]' iteration");
    process.exit(1);
  }
  pos = pos + 1;
  while (pos < json.length) {
    pos = skipWhitespace(json, pos);
    if (pos >= json.length || json.charAt(pos) === "]") break;
    const val = extractRawValue(json, pos);
    results.push(val);
    const ch = json.charAt(pos);
    if (ch === '"') {
      pos = pos + 1;
      while (pos < json.length) {
        const sCh = json.charAt(pos);
        if (sCh === "\\") {
          pos = pos + 2;
        } else if (sCh === '"') {
          pos = pos + 1;
          break;
        } else {
          pos = pos + 1;
        }
      }
    } else if (ch === "{" || ch === "[") {
      pos = findMatchingBrace(json, pos);
    } else {
      while (pos < json.length) {
        const vCh = json.charAt(pos);
        if (vCh === "," || vCh === "]") break;
        pos = pos + 1;
      }
    }
    pos = skipWhitespace(json, pos);
    if (pos < json.length && json.charAt(pos) === ",") {
      pos = pos + 1;
    }
  }
  return results;
}

function parseFilterSteps(f: string): string[] {
  const steps: string[] = [];
  let pos = 0;
  if (pos < f.length && f.charAt(pos) === ".") {
    pos = pos + 1;
  }
  while (pos < f.length) {
    if (f.charAt(pos) === "[" && pos + 1 < f.length && f.charAt(pos + 1) === "]") {
      steps.push("[]");
      pos = pos + 2;
      if (pos < f.length && f.charAt(pos) === ".") {
        pos = pos + 1;
      }
    } else if (f.charAt(pos) === "[") {
      pos = pos + 1;
      let idx = "";
      while (pos < f.length && f.charAt(pos) !== "]") {
        idx = idx + f.charAt(pos);
        pos = pos + 1;
      }
      if (pos < f.length) pos = pos + 1;
      steps.push("[" + idx + "]");
      if (pos < f.length && f.charAt(pos) === ".") {
        pos = pos + 1;
      }
    } else {
      let name = "";
      while (pos < f.length && f.charAt(pos) !== "." && f.charAt(pos) !== "[") {
        name = name + f.charAt(pos);
        pos = pos + 1;
      }
      if (name.length > 0) {
        steps.push(name);
      }
      if (pos < f.length && f.charAt(pos) === ".") {
        pos = pos + 1;
      }
    }
  }
  return steps;
}

function applySteps(values: string[], steps: string[], stepIdx: number): string[] {
  if (stepIdx >= steps.length) return values;
  const step = steps[stepIdx];
  const nextValues: string[] = [];
  if (step === "[]") {
    for (let i = 0; i < values.length; i++) {
      const items = iterateArray(values[i]);
      for (let j = 0; j < items.length; j++) {
        nextValues.push(items[j]);
      }
    }
  } else if (step.charAt(0) === "[") {
    const idxStr = step.substring(1, step.length - 1);
    const idx = parseInt(idxStr);
    for (let i = 0; i < values.length; i++) {
      const items = iterateArray(values[i]);
      if (idx >= 0 && idx < items.length) {
        nextValues.push(items[idx]);
      } else {
        nextValues.push("null");
      }
    }
  } else {
    for (let i = 0; i < values.length; i++) {
      nextValues.push(findField(values[i], step));
    }
  }
  return applySteps(nextValues, steps, stepIdx + 1);
}

function outputValue(val: string): void {
  if (rawMode && val.length >= 2 && val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') {
    console.log(val.substring(1, val.length - 1));
  } else {
    console.log(val);
  }
}

if (filter === ".") {
  console.log(input);
  process.exit(0);
}

const steps = parseFilterSteps(filter);
const initial: string[] = [input];
const results = applySteps(initial, steps, 0);

for (let i = 0; i < results.length; i++) {
  outputValue(results[i]);
}
