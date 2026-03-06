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
const missingVendor = vendorLibs.some((p) => !fs.existsSync(path.join(projectRoot, p)));
if (missingVendor) {
  console.warn("Warning: some vendor/bridge artifacts missing — run: bash scripts/build-vendor.sh");
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

const args = process.argv.slice(2);

const testPattern =
  args.length === 0
    ? [
        "tests/compiler.test.ts",
        "tests/unit/symbol-table.test.ts",
        "tests/unit/type-system.test.ts",
        "tests/network.test.ts",
        "tests/http-routes.test.ts",
      ]
    : args;

const nodeArgs = ["--import", "tsx", "--test", ...testPattern];

const child = spawn("node", nodeArgs, {
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => {
  if (code !== 0 || args.length > 0) {
    process.exit(code);
    return;
  }

  console.log("\nRe-running compiler tests with Node.js compiler...");
  const child2 = spawn("node", ["--import", "tsx", "--test", "tests/compiler.test.ts"], {
    stdio: "inherit",
    shell: false,
    env: { ...process.env, CHADC_COMPILER: "node dist/chad-node.js" },
  });
  child2.on("exit", (code2) => {
    process.exit(code2);
  });
});
