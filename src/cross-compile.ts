// Target SDK locator for cross-compilation.
// SDKs live at ~/.chadscript/targets/<target-name>/ and contain pre-built
// vendor libraries and C bridge objects.
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execSync } from "child_process";
import { TargetInfo, targetName } from "./target.js";

export interface TargetSDK {
  /** Root of the SDK directory */
  root: string;
  /** Path to vendor libraries (libgc.a, libyyjson.a, etc.) */
  vendorPath: string;
  /** Path to pre-built C bridge .o files */
  bridgesPath: string;
  /** Path to sysroot, null if not present */
  sysrootPath: string | null;
  /** Parsed sdk.json metadata */
  meta: SDKMeta;
}

export interface SDKMeta {
  version: string;
  triple: string;
  os: string;
  arch: string;
  libc: string;
}

/** Base directory for all target SDKs */
export function getSDKBaseDir(): string {
  return path.join(os.homedir(), ".chadscript", "targets");
}

/** Directory for a specific target SDK */
export function getSDKDir(target: TargetInfo): string {
  return path.join(getSDKBaseDir(), targetName(target));
}

/** Check if a target SDK is installed */
export function hasTargetSDK(target: TargetInfo): boolean {
  const sdkDir = getSDKDir(target);
  return fs.existsSync(path.join(sdkDir, "sdk.json"));
}

/** Load and validate a target SDK, throws if not installed */
export function loadTargetSDK(target: TargetInfo): TargetSDK {
  const sdkDir = getSDKDir(target);
  const metaPath = path.join(sdkDir, "sdk.json");

  if (!fs.existsSync(metaPath)) {
    const name = targetName(target);
    throw new Error(
      `chad: error: target SDK '${name}' not installed\n` +
        `Run: chad target add ${name}\n` +
        `This downloads pre-built libraries needed to cross-compile for ${name}.`,
    );
  }

  const meta: SDKMeta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const vendorPath = path.join(sdkDir, "vendor");
  const bridgesPath = path.join(sdkDir, "bridges");
  const sysrootDir = path.join(sdkDir, "sysroot");
  const sysrootPath = fs.existsSync(sysrootDir) ? sysrootDir : null;

  // Sanity check: vendor dir must exist
  if (!fs.existsSync(vendorPath)) {
    throw new Error(
      `chad: error: target SDK '${targetName(target)}' is corrupt (missing vendor/)\n` +
        `Run: chad target remove ${targetName(target)} && chad target add ${targetName(target)}`,
    );
  }

  return { root: sdkDir, vendorPath, bridgesPath, sysrootPath, meta };
}

/** List all installed target SDKs */
export function listInstalledSDKs(): string[] {
  const baseDir = getSDKBaseDir();
  if (!fs.existsSync(baseDir)) return [];
  return fs
    .readdirSync(baseDir)
    .filter((name) => fs.existsSync(path.join(baseDir, name, "sdk.json")));
}

/** GitHub release URL for a target SDK tarball */
export function getSDKDownloadURL(name: string): string {
  return `https://github.com/cs01/ChadScript/releases/download/latest/chadscript-target-${name}.tar.gz`;
}

/** Sync y/n prompt. Auto-yes in non-interactive (CI) environments. */
function promptYesNo(question: string): boolean {
  if (!process.stdin.isTTY) return true;
  process.stderr.write(question);
  const buf = Buffer.alloc(16);
  const n = fs.readSync(0, buf, 0, 16, null);
  const answer = buf.subarray(0, n).toString().trim().toLowerCase();
  return answer !== "n" && answer !== "no";
}

/** Download and install a target SDK. */
export function installTargetSDK(name: string): void {
  const sdkDir = path.join(getSDKBaseDir(), name);
  const url = getSDKDownloadURL(name);

  fs.mkdirSync(sdkDir, { recursive: true });
  console.error(`Downloading target SDK '${name}'...`);
  try {
    execSync(`curl -fsSL "${url}" | tar xzf - -C "${sdkDir}"`, {
      stdio: ["pipe", "pipe", "inherit"],
    });
  } catch {
    try {
      fs.rmSync(sdkDir, { recursive: true });
    } catch {}
    throw new Error(`chad: error: failed to download target SDK '${name}'\nURL: ${url}`);
  }

  if (!fs.existsSync(path.join(sdkDir, "sdk.json"))) {
    throw new Error(`chad: error: downloaded SDK '${name}' is invalid (missing sdk.json)`);
  }
  console.error(`Target SDK '${name}' installed to ${sdkDir}`);
}

/**
 * Load a target SDK, prompting to download if missing.
 * Auto-yes in non-interactive environments (CI).
 */
export function ensureTargetSDK(target: TargetInfo): TargetSDK {
  if (hasTargetSDK(target)) {
    return loadTargetSDK(target);
  }

  const name = targetName(target);
  const ok = promptYesNo(`Target SDK '${name}' is not installed. Download it? [Y/n] `);
  if (!ok) {
    throw new Error(`chad: error: target SDK '${name}' required for cross-compilation`);
  }

  installTargetSDK(name);
  return loadTargetSDK(target);
}
