import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

let gitCommit = "unknown";
try {
  gitCommit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch {
  // not a git checkout (e.g., building from a release tarball)
}

const buildDate = new Date().toISOString().slice(0, 10);
const fullVersion = `${pkg.version}-${gitCommit}-${buildDate}`;

writeFileSync("src/version.ts", `export const VERSION = "${fullVersion}";\n`);
