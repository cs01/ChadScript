import { recordEvent } from "./sink.js";
import { CAT_TYPE_TRACE, CAT_TYPE_DIVERGENCE } from "./categories.js";

let diagTypeTraceEnabled = false;
let diagTypeDivergenceEnabled = false;
let diagSeq = 0;

export function enableTypeTrace(): void {
  diagTypeTraceEnabled = true;
}

export function isTypeTraceEnabled(): boolean {
  return diagTypeTraceEnabled;
}

export function enableTypeDivergence(): void {
  diagTypeDivergenceEnabled = true;
}

export function isTypeDivergenceEnabled(): boolean {
  return diagTypeDivergenceEnabled;
}

// JSON-string-escape a value. Used instead of JSON.stringify on record types
// (the native compiler cannot stringify `Record<string, unknown>`).
function jsonEscapeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c < 0x20) {
      const hex = c.toString(16);
      let padded = hex;
      while (padded.length < 4) padded = "0" + padded;
      out += "\\u" + padded;
    } else {
      out += s.charAt(i);
    }
  }
  out += '"';
  return out;
}

function sitesToJsonArray(sites: string[]): string {
  let out = "[";
  for (let i = 0; i < sites.length; i++) {
    if (i > 0) out += ",";
    out += jsonEscapeString(sites[i]);
  }
  out += "]";
  return out;
}

// Extract compact callsites from a V8 stack trace string. Skips the top few
// frames (the Error constructor + this tracer + the immediate wrapper that
// invoked us), then returns up to 6 frames formatted as short paths relative
// to /dist/. This runs under Node only — chad-native never enables the
// tracer, so the body is unreachable there.
function captureSites(skip: number): string[] {
  let stack = "";
  try {
    throw new Error("diag-stack");
  } catch (e) {
    const s = (e as { stack?: string }).stack;
    if (s) stack = s;
  }
  if (!stack) return [];
  const lines = stack.split("\n");
  const out: string[] = [];
  let idx = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("at ")) continue;
    if (idx < skip) {
      idx++;
      continue;
    }
    idx++;
    // Extract "file:line:col" portion, dropping any surrounding parens.
    let loc = line;
    const lp = line.lastIndexOf("(");
    const rp = line.lastIndexOf(")");
    if (lp >= 0 && rp > lp) loc = line.substring(lp + 1, rp);
    else {
      // "at path:line:col" — strip leading "at "
      loc = line.substring(3);
    }
    // Trim to portion starting at /dist/ if present.
    const distIdx = loc.indexOf("/dist/");
    if (distIdx >= 0) loc = loc.substring(distIdx + 6);
    out.push(loc);
    if (out.length >= 6) break;
  }
  return out;
}

export function traceTypeSet(name: string, type: string): void {
  if (!diagTypeTraceEnabled) return;
  const sites = captureSites(2);
  const i = diagSeq;
  diagSeq = diagSeq + 1;
  const line =
    '{"cat":' +
    jsonEscapeString(CAT_TYPE_TRACE) +
    ',"k":"set","i":' +
    i.toString() +
    ',"name":' +
    jsonEscapeString(name) +
    ',"type":' +
    jsonEscapeString(type) +
    ',"sites":' +
    sitesToJsonArray(sites) +
    "}";
  recordEvent(line);
}

export function traceTypeGet(name: string, result: string | undefined): void {
  if (!diagTypeTraceEnabled) return;
  const sites = captureSites(2);
  const i = diagSeq;
  diagSeq = diagSeq + 1;
  const resultJson = result === undefined ? "null" : jsonEscapeString(result);
  const line =
    '{"cat":' +
    jsonEscapeString(CAT_TYPE_TRACE) +
    ',"k":"get","i":' +
    i.toString() +
    ',"name":' +
    jsonEscapeString(name) +
    ',"result":' +
    resultJson +
    ',"sites":' +
    sitesToJsonArray(sites) +
    "}";
  recordEvent(line);
}

export function traceTypeRich(exprType: string, result: string | null): void {
  if (!diagTypeTraceEnabled) return;
  const sites = captureSites(2);
  const i = diagSeq;
  diagSeq = diagSeq + 1;
  const resultJson = result === null ? "null" : jsonEscapeString(result);
  const line =
    '{"cat":' +
    jsonEscapeString(CAT_TYPE_TRACE) +
    ',"k":"rich","i":' +
    i.toString() +
    ',"exprType":' +
    jsonEscapeString(exprType) +
    ',"result":' +
    resultJson +
    ',"sites":' +
    sitesToJsonArray(sites) +
    "}";
  recordEvent(line);
}

export function traceTypeDivergence(
  kind: string,
  cacheType: string | null,
  liveType: string | null,
): void {
  if (!diagTypeDivergenceEnabled) return;
  const sites = captureSites(2);
  const i = diagSeq;
  diagSeq = diagSeq + 1;
  const cacheJson = cacheType === null ? "null" : jsonEscapeString(cacheType);
  const liveJson = liveType === null ? "null" : jsonEscapeString(liveType);
  const line =
    '{"cat":' +
    jsonEscapeString(CAT_TYPE_DIVERGENCE) +
    ',"i":' +
    i.toString() +
    ',"kind":' +
    jsonEscapeString(kind) +
    ',"cacheType":' +
    cacheJson +
    ',"liveType":' +
    liveJson +
    ',"sites":' +
    sitesToJsonArray(sites) +
    "}";
  recordEvent(line);
}
