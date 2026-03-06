#!/usr/bin/env node
import { spawn, execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function newestMtime(dir, ext) {
  let newest = 0;
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") walk(full);
      else if (entry.isFile() && full.endsWith(ext)) {
        const mt = fs.statSync(full).mtimeMs;
        if (mt > newest) newest = mt;
      }
    }
  }
  walk(dir);
  return newest;
}

const distEntry = path.join(projectRoot, "dist", "chad-node.js");
const srcMtime = newestMtime(path.join(projectRoot, "src"), ".ts");
const distMtime = fs.existsSync(distEntry) ? fs.statSync(distEntry).mtimeMs : 0;

if (srcMtime > distMtime) {
  console.log("dist/ is stale, rebuilding...");
  try {
    execSync("npm run build", { cwd: projectRoot, stdio: "inherit" });
  } catch {
    console.error("Build failed");
    process.exit(1);
  }
}

const vendorLibs = [
  "vendor/bdwgc/libgc.a",
  "vendor/libuv/build/libuv.a",
  "c_bridges/regex-bridge.o",
];
const missingVendor = vendorLibs.filter((p) => !fs.existsSync(path.join(projectRoot, p)));
if (missingVendor.length > 0) {
  console.error(`Missing vendor artifacts:\n  ${missingVendor.join("\n  ")}`);
  console.error("Run: bash scripts/build-vendor.sh");
  process.exit(1);
}

const chad = path.join(projectRoot, ".build", "chad");
if (!fs.existsSync(chad)) {
  console.log("Native compiler missing, building .build/chad...");
  try {
    execSync("node dist/chad-node.js build src/chad-native.ts -o .build/chad", {
      cwd: projectRoot,
      stdio: "inherit",
    });
  } catch {
    console.error("Native compiler build failed");
    process.exit(1);
  }
}

const flag = process.argv[2];
if (flag !== "--node" && flag !== "--native") {
  console.error("Usage: node scripts/test.js --node | --native");
  console.error("  or via npm: npm run test:node | npm run test:native");
  process.exit(1);
}

const testFiles = [
  "tests/compiler.test.ts",
  "tests/unit/symbol-table.test.ts",
  "tests/unit/type-system.test.ts",
  "tests/network.test.ts",
  "tests/http-routes.test.ts",
];

const env =
  flag === "--node"
    ? { ...process.env, CHADC_COMPILER: "node dist/chad-node.js" }
    : { ...process.env };

console.log(`\nRunning tests with ${flag === "--node" ? "node compiler" : "native compiler"}...`);

const child = spawn("node", ["--import", "tsx", "--test", ...testFiles], {
  stdio: "inherit",
  shell: false,
  env,
});

child.on("exit", (code) => process.exit(code));
