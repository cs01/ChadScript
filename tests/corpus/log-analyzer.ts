// @category: parsing
// Parses an Apache combined access log: status histogram, top paths, bytes per client, error
// rate, and writes a plain-text report.
import { readFileSync, writeFileSync } from "node:fs";

interface Entry {
  ip: string;
  method: string;
  path: string;
  status: number;
  bytes: number;
  agent: string;
}

const LINE_RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\w+) (\S+) [^"]*" (\d{3}) (\d+) "[^"]*" "([^"]*)"$/;

function parseLine(line: string): Entry | null {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  return {
    ip: m[1]!,
    method: m[3]!,
    path: m[4]!.split("?")[0]!,
    status: parseInt(m[5]!, 10),
    bytes: parseInt(m[6]!, 10),
    agent: m[7]!,
  };
}

function increment<K>(map: Map<K, number>, key: K, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function topN<K>(map: Map<K, number>, n: number): [K, number][] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, n);
}

const lines = readFileSync("fixtures/access.log", "utf8").split("\n").filter(Boolean);
const entries: Entry[] = [];
let malformed = 0;
for (const line of lines) {
  const e = parseLine(line);
  if (e) entries.push(e);
  else malformed++;
}

const statusClasses = new Map<string, number>();
const paths = new Map<string, number>();
const bytesByIp = new Map<string, number>();
const bots = new Set<string>();
for (const e of entries) {
  increment(statusClasses, `${Math.floor(e.status / 100)}xx`);
  increment(paths, e.path);
  increment(bytesByIp, e.ip, e.bytes);
  if (/bot/i.test(e.agent)) bots.add(e.ip);
}

const errors = entries.filter((e) => e.status >= 400).length;
const report: string[] = [];
report.push(`entries: ${entries.length} (malformed: ${malformed})`);
report.push(`error rate: ${((errors / entries.length) * 100).toFixed(1)}%`);
report.push("status classes:");
for (const [cls, n] of [...statusClasses].sort()) report.push(`  ${cls}: ${"#".repeat(n)} ${n}`);
report.push("top paths:");
for (const [p, n] of topN(paths, 3)) report.push(`  ${n}  ${p}`);
report.push("bytes by client:");
for (const [ip, b] of topN(bytesByIp, 10))
  report.push(`  ${ip.padEnd(15)} ${(b / 1024).toFixed(2)} KiB`);
report.push(`bots: ${[...bots].join(", ") || "none"}`);
const methods = [...new Set(entries.map((e) => e.method))].sort();
report.push(`methods: ${methods.join("/")}`);

writeFileSync("report.txt", report.join("\n") + "\n");
console.log(report.slice(0, 2).join("\n"));
console.log("report written to report.txt");
