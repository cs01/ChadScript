#!/usr/bin/env node
// Analyze type-trace JSONL produced by --diag-trace=type-trace.
// Usage: node scripts/analyze-diagnostics.cjs [path]
const fs = require("fs");
const path = process.argv[2] || "chad-diagnostics.jsonl";

const lines = fs.readFileSync(path, "utf8").split("\n").filter(Boolean);
console.error(`Loaded ${lines.length} events from ${path}`);
const events = lines.map((l) => JSON.parse(l));

function pickRealSite(sites) {
  if (!Array.isArray(sites)) return sites || "?";
  const skip = [
    /codegen\/infrastructure\/base-generator\.js/,
    /codegen\/infrastructure\/generator-context\.js/,
    /codegen\/infrastructure\/type-inference\.js/,
    /codegen\/infrastructure\/ir-builders\.js/,
    /diagnostics\/tracers\.js/,
  ];
  for (const s of sites) {
    if (skip.some((r) => r.test(s))) continue;
    return s;
  }
  return sites[0] || "?";
}
for (const e of events) e.site = pickRealSite(e.sites);

const typeTrace = events.filter((e) => e.cat === "type-trace");
const sets = typeTrace.filter((e) => e.k === "set");
const gets = typeTrace.filter((e) => e.k === "get");
const riches = typeTrace.filter((e) => e.k === "rich");

function countBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

const setSiteCount = countBy(sets, (s) => s.site);
const getSiteCount = countBy(gets, (g) => g.site);
const richSiteCount = countBy(riches, (r) => r.site);
const richSiteNull = countBy(
  riches.filter((r) => r.result === null),
  (r) => r.site,
);

// Orphan analysis: sets whose name is not read before being re-set.
const lastSetIdByName = new Map();
const setReadCount = new Map();
const orphanGets = [];
for (const e of typeTrace) {
  if (e.k === "set") {
    lastSetIdByName.set(e.name, e.i);
    setReadCount.set(e.i, 0);
  } else if (e.k === "get") {
    const setId = lastSetIdByName.get(e.name);
    if (setId !== undefined) {
      setReadCount.set(setId, (setReadCount.get(setId) || 0) + 1);
    } else if (e.result !== null) {
      orphanGets.push(e);
    }
  }
}
const orphanSets = sets.filter((s) => (setReadCount.get(s.i) || 0) === 0);
const orphanSetSite = countBy(orphanSets, (s) => s.site);
const orphanGetSite = countBy(orphanGets, (g) => g.site);

// Per-site orphan ratio (for sets that happen N times at site X, how many are orphans?)
const orphanRatioBySite = [];
for (const [site, count] of setSiteCount.entries()) {
  if (count < 50) continue;
  const orphans = orphanSetSite.get(site) || 0;
  orphanRatioBySite.push({ site, count, orphans, ratio: orphans / count });
}
orphanRatioBySite.sort((a, b) => b.ratio - a.ratio);

const fmt = (m, n = 30) =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `  ${String(v).padStart(7)}  ${k}`)
    .join("\n");

const pct = (p, w) => (w ? ((100 * p) / w).toFixed(1) : "0.0") + "%";

console.log(`# Diagnostics type-trace analysis

Total type-trace events: ${typeTrace.length}
  setVariableType:  ${sets.length}
  getVariableType:  ${gets.length}  (${gets.filter((g) => g.result !== null).length} hits, ${gets.filter((g) => g.result === null).length} misses)
  resolveRich:      ${riches.length}  (${riches.filter((r) => r.result === null).length} null results)

## Top setVariableType call sites
${fmt(setSiteCount)}

## Top getVariableType call sites (consumers)
${fmt(getSiteCount)}

## Top resolveExpressionTypeRich call sites (consumers)
${fmt(richSiteCount)}

## Orphan SETs (no subsequent read before next set of same name) — DROP CANDIDATES
Total orphan sets: ${orphanSets.length} (${pct(orphanSets.length, sets.length)} of all sets)

${fmt(orphanSetSite)}

## Orphan-set ratio per site (set-count >= 50)
${orphanRatioBySite
  .slice(0, 30)
  .map(
    (r) =>
      `  ${String(r.orphans).padStart(7)}/${String(r.count).padStart(7)} (${pct(r.orphans, r.count)})  ${r.site}`,
  )
  .join("\n")}

## Orphan GETs (read returns non-null but never set in trace — comes from symbolTable)
Total: ${orphanGets.length}

${fmt(orphanGetSite)}

## resolveRich sites with highest null-result rate (count >= 10)
${[...richSiteCount.entries()]
  .filter(([, c]) => c >= 10)
  .map(([site, c]) => [site, c, richSiteNull.get(site) || 0])
  .sort((a, b) => b[2] / b[1] - a[2] / a[1])
  .slice(0, 20)
  .map(([site, c, n]) => `  ${n}/${c} (${pct(n, c)})  ${site}`)
  .join("\n")}
`);
