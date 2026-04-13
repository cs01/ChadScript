#!/usr/bin/env node
//
// Reads docs/public/benchmarks.json (output of benchmarks/run.sh)
// and updates the hardcoded data in the VitePress benchmark components.
//
// Usage: node scripts/update-benchmark-docs.js
//

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const JSON_PATH = path.join(REPO, "docs/public/benchmarks.json");
const BARS_PATH = path.join(REPO, "docs/.vitepress/theme/BenchmarkBars.vue");
const CHART_PATH = path.join(REPO, "docs/.vitepress/theme/BenchmarkChart.vue");
const RACE_PATH = path.join(REPO, "docs/.vitepress/theme/BenchmarkRace.vue");
const MD_PATH = path.join(REPO, "docs/benchmarks.md");

const langMeta = {
  c: { name: "C", color: "c" },
  chadscript: { name: "ChadScript", color: "chad", hero: true },
  go: { name: "Go", color: "go" },
  node: { name: "Node.js", color: "node" },
};

const featuredOrder = ["startup", "montecarlo", "sqlite"];

function formatVal(value, metric) {
  if (metric === "ms") {
    return value < 10 ? value.toFixed(1) + "ms" : Math.round(value) + "ms";
  }
  if (value < 0.1) return Math.round(value * 1000) + "ms";
  if (value < 1) return value.toFixed(3) + "s";
  return value.toFixed(2) + "s";
}

function buildBarsDefaults(json) {
  const lines = [];
  for (const key of featuredOrder) {
    const bench = json.benchmarks[key];
    if (!bench) continue;
    const entries = Object.entries(bench.results);
    entries.sort(([, a], [, b]) => (bench.lower_is_better ? a.value - b.value : b.value - a.value));
    const values = entries.map(([, r]) => r.value);
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const lower = bench.lower_is_better;
    const layout = key === "sqlite" ? "vertical" : "horizontal";
    const metric = lower ? "Smaller = faster." : "Taller = more throughput.";

    const items = entries.map(([lang, r], idx) => {
      const meta = langMeta[lang] || { name: lang, color: "c" };
      const w = lower ? Math.round((r.value / maxVal) * 100) : Math.round((r.value / maxVal) * 100);
      const h = lower ? Math.round((minVal / r.value) * 100) : Math.round((r.value / maxVal) * 100);
      const speed = lower ? 1.5 + (r.value / minVal) * 1.5 : 1.5 + (maxVal / r.value) * 1.5;
      const obj = {
        name: meta.name,
        val: formatVal(r.value, bench.metric),
        w,
        h,
        color: meta.color,
        d: idx * 0.12,
        speed: Math.round(speed * 10) / 10,
      };
      if (meta.hero) obj.hero = true;
      return obj;
    });

    lines.push(`  ${key}: {`);
    lines.push(`    layout: '${layout}',`);
    lines.push(`    desc: ${JSON.stringify(bench.desc)},`);
    lines.push(`    metric: '${metric}',`);
    lines.push(`    items: [`);
    for (const item of items) {
      const parts = [`name: '${item.name}'`, `val: '${item.val}'`];
      if (layout === "horizontal") parts.push(`w: ${item.w}`);
      parts.push(`h: ${item.h}`, `color: '${item.color}'`, `d: ${item.d}`, `speed: ${item.speed}`);
      if (item.hero) parts.push(`hero: true`);
      lines.push(`      { ${parts.join(", ")} },`);
    }
    lines.push(`    ],`);
    lines.push(`    note: featuredNotes.${key} || '',`);
    lines.push(`  },`);
  }
  return lines.join("\n");
}

function buildRaceData(json) {
  const raceOrder = ["startup", "matmul", "fibonacci", "sqlite", "mandelbrot"];
  const lines = [];
  for (const key of raceOrder) {
    const bench = json.benchmarks[key];
    if (!bench) continue;
    const entries = Object.entries(bench.results);
    entries.sort(([, a], [, b]) => (bench.lower_is_better ? a.value - b.value : b.value - a.value));
    const values = entries.map(([, r]) => r.value);
    const minVal = Math.min(...values);
    const lower = bench.lower_is_better;

    const items = entries.map(([lang, r]) => {
      const meta = langMeta[lang] || { name: lang, color: "c" };
      const speed = lower ? 0.5 + (r.value / minVal) * 0.3 : 0.5 + (minVal / r.value) * 0.3;
      const obj = {
        name: meta.name,
        val: formatVal(r.value, bench.metric),
        speed: Math.round(speed * 100) / 100,
        color: meta.color,
      };
      if (meta.hero) obj.hero = true;
      return obj;
    });

    lines.push(`  ${key}: {`);
    lines.push(`    desc: ${JSON.stringify(bench.desc)},`);
    lines.push(`    metric: 'Faster bounce = ${lower ? "faster runtime" : "higher throughput"}.',`);
    lines.push(`    items: [`);
    for (const item of items) {
      const parts = [
        `name: '${item.name}'`,
        `val: '${item.val}'`,
        `speed: ${item.speed}`,
        `color: '${item.color}'`,
      ];
      if (item.hero) parts.push(`hero: true`);
      lines.push(`      { ${parts.join(", ")} },`);
    }
    lines.push(`    ],`);
    lines.push(`    note: ${JSON.stringify(bench.desc)}`);
    lines.push(`  },`);
  }
  return lines.join("\n");
}

function buildMarkdownSummary(json) {
  const b = json.benchmarks;
  const lines = [];
  const fmt = (bench, lang) => formatVal(bench.results[lang].value, bench.metric);

  if (b.matmul) {
    const cs = b.matmul.results.chadscript;
    const c = b.matmul.results.c;
    const node = b.matmul.results.node;
    if (cs && c) {
      const ratio = (node.value / cs.value).toFixed(1);
      lines.push(
        `- **Matches C on matrix multiply** \u2014 ${fmt(b.matmul, "chadscript")} vs C\u2019s ${fmt(b.matmul, "c")} on 512\u00d7512 dense matmul, ${ratio}x faster than Node`,
      );
    }
  }

  if (b.fibonacci) {
    const cs = b.fibonacci.results.chadscript;
    const go = b.fibonacci.results.go;
    const node = b.fibonacci.results.node;
    if (cs && go) {
      const nodeRatio = node ? (node.value / cs.value).toFixed(0) : "?";
      lines.push(
        `- **Faster than Go on recursion** \u2014 fib(42) in ${fmt(b.fibonacci, "chadscript")} vs Go\u2019s ${fmt(b.fibonacci, "go")}, ${nodeRatio}x faster than Node`,
      );
    }
  }

  if (b.startup) {
    const cs = b.startup.results.chadscript;
    const c = b.startup.results.c;
    const go = b.startup.results.go;
    const node = b.startup.results.node;
    if (cs && c) {
      const goRatio = go ? Math.round(go.value / cs.value) : "?";
      const nodeRatio = node ? Math.round(node.value / cs.value) : "?";
      lines.push(
        `- **${fmt(b.startup, "chadscript")} cold start** \u2014 within ${Math.round((cs.value / c.value - 1) * 100)}% of C, ${goRatio}x faster than Go, ${nodeRatio}x faster than Node`,
      );
    }
  }

  if (b.json) {
    const cs = b.json.results.chadscript;
    const node = b.json.results.node;
    const go = b.json.results.go;
    if (cs && node && go) {
      const nodeRatio = Math.round(node.value / cs.value);
      const goRatio = Math.round(go.value / cs.value);
      lines.push(
        `- **Near-C JSON** \u2014 ${fmt(b.json, "chadscript")} to parse+stringify 10K objects via yyjson, ${nodeRatio}x faster than Node, ${goRatio}x faster than Go`,
      );
    }
  }

  if (b.sqlite) {
    const cs = b.sqlite.results.chadscript;
    const c = b.sqlite.results.c;
    const node = b.sqlite.results.node;
    if (cs && c) {
      const pct = Math.round((c.value / cs.value) * 100);
      const nodeRatio = node ? (node.value / cs.value).toFixed(1) : "?";
      lines.push(
        `- **Zero-overhead FFI** \u2014 calls C libraries directly, ${pct}% of C\u2019s SQLite throughput, ${nodeRatio}x faster than Node`,
      );
    }
  }

  return lines.join("\n");
}

// ---- Main ----
if (!fs.existsSync(JSON_PATH)) {
  console.error("Error: " + JSON_PATH + " not found.");
  console.error("Run benchmarks/run.sh first to generate benchmark data.");
  process.exit(1);
}

const json = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
console.log("Read " + JSON_PATH);

// Update BenchmarkBars.vue defaults
if (fs.existsSync(BARS_PATH)) {
  let content = fs.readFileSync(BARS_PATH, "utf-8");
  const startMarker = "const defaultBenchmarks = {";
  const endMarker = "\n}\n\nfunction transformJson";
  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx !== -1 && endIdx !== -1) {
    const newDefaults = startMarker + "\n" + buildBarsDefaults(json) + "\n}";
    content = content.substring(0, startIdx) + newDefaults + content.substring(endIdx + 2);
    fs.writeFileSync(BARS_PATH, content);
    console.log("Updated " + BARS_PATH);
  } else {
    console.warn("Could not find defaultBenchmarks markers in BenchmarkBars.vue");
  }
}

// Update benchmarks.md summary
if (fs.existsSync(MD_PATH)) {
  let content = fs.readFileSync(MD_PATH, "utf-8");
  const startMarker =
    "**ChadScript delivers compiled-language performance with TypeScript syntax:**\n\n";
  const endMarker = "\n\nReproduce:";
  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx !== -1 && endIdx !== -1) {
    const newSummary = startMarker + buildMarkdownSummary(json);
    content = content.substring(0, startIdx) + newSummary + content.substring(endIdx);
    fs.writeFileSync(MD_PATH, content);
    console.log("Updated " + MD_PATH);
  } else {
    console.warn("Could not find summary markers in benchmarks.md");
  }
}

console.log("Done. Review changes with: git diff docs/");
