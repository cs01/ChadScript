import * as fs from "fs";

let diagSinkEnabled = false;
let diagSinkPath = "";
let diagSinkBuffer: string[] = [];
let diagSinkFlushed = false;

export function enableSink(path: string): void {
  diagSinkEnabled = true;
  diagSinkPath = path;
  diagSinkBuffer = [];
  diagSinkFlushed = false;
}

export function isSinkEnabled(): boolean {
  return diagSinkEnabled;
}

// Push a pre-serialized JSON event line. Callers build the JSON string
// themselves — we keep the sink dumb so the native compiler doesn't need
// to marshal arbitrary record types through JSON.stringify.
export function recordEvent(line: string): void {
  if (!diagSinkEnabled) return;
  diagSinkBuffer.push(line);
}

export function flushDiagnostics(): void {
  if (!diagSinkEnabled) return;
  if (diagSinkFlushed) return;
  diagSinkFlushed = true;
  const out = diagSinkBuffer.length > 0 ? diagSinkBuffer.join("\n") + "\n" : "";
  fs.writeFileSync(diagSinkPath, out);
}
