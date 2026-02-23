// Target triple resolution and host detection for cross-compilation.
// The libc field controls whether we link against musl (static, portable)
// or glibc/system libc. Cross-compiled Linux targets default to musl.
import * as os from "os";
import { existsSync, readFileSync } from "fs";

export type LibC = "musl" | "gnu" | "system";

export interface TargetInfo {
  triple: string;
  os: string;
  arch: string;
  cpu: string;
  platformString: string;
  archString: string;
  dataLayout: string;
  libc: LibC;
}

const DATA_LAYOUT_X86_64_LINUX =
  "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128";
const DATA_LAYOUT_AARCH64_LINUX = "e-m:e-i8:8:32-i16:16:32-i64:64-i128:128-n32:64-S128-Fn32";
const DATA_LAYOUT_X86_64_MACOS =
  "e-m:o-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128";
const DATA_LAYOUT_AARCH64_MACOS = "e-m:o-i64:64-i128:128-n32:64-S128-Fn32";

export function resolveTarget(target: string): TargetInfo {
  // Short aliases: linux-x64 uses musl triple for cross-compile portability.
  // The gnu variants are kept for explicit full-triple usage.
  if (target === "linux-x64" || target === "x86_64-unknown-linux-musl") {
    return {
      triple: "x86_64-unknown-linux-musl",
      os: "linux",
      arch: "x86_64",
      cpu: "generic",
      platformString: "linux",
      archString: "x64",
      dataLayout: DATA_LAYOUT_X86_64_LINUX,
      libc: "musl",
    };
  }
  if (target === "x86_64-unknown-linux-gnu") {
    return {
      triple: "x86_64-unknown-linux-gnu",
      os: "linux",
      arch: "x86_64",
      cpu: "generic",
      platformString: "linux",
      archString: "x64",
      dataLayout: DATA_LAYOUT_X86_64_LINUX,
      libc: "gnu",
    };
  }
  if (target === "linux-arm64" || target === "aarch64-unknown-linux-musl") {
    return {
      triple: "aarch64-unknown-linux-musl",
      os: "linux",
      arch: "aarch64",
      cpu: "generic",
      platformString: "linux",
      archString: "arm64",
      dataLayout: DATA_LAYOUT_AARCH64_LINUX,
      libc: "musl",
    };
  }
  if (target === "aarch64-unknown-linux-gnu") {
    return {
      triple: "aarch64-unknown-linux-gnu",
      os: "linux",
      arch: "aarch64",
      cpu: "generic",
      platformString: "linux",
      archString: "arm64",
      dataLayout: DATA_LAYOUT_AARCH64_LINUX,
      libc: "gnu",
    };
  }
  if (target === "macos-arm64" || target === "aarch64-apple-darwin") {
    return {
      triple: "aarch64-apple-darwin",
      os: "darwin",
      arch: "aarch64",
      cpu: "generic",
      platformString: "darwin",
      archString: "arm64",
      dataLayout: DATA_LAYOUT_AARCH64_MACOS,
      libc: "system",
    };
  }
  if (target === "macos-x64" || target === "x86_64-apple-darwin") {
    return {
      triple: "x86_64-apple-darwin",
      os: "darwin",
      arch: "x86_64",
      cpu: "generic",
      platformString: "darwin",
      archString: "x64",
      dataLayout: DATA_LAYOUT_X86_64_MACOS,
      libc: "system",
    };
  }

  if (target.includes("-")) {
    const parts = target.split("-");
    const arch = parts[0];
    let targetOs = "linux";
    if (target.includes("darwin") || target.includes("apple")) {
      targetOs = "darwin";
    }
    const isAarch64 = arch === "aarch64" || arch === "arm64";
    const isX86 = arch === "x86_64";
    let dataLayout = DATA_LAYOUT_X86_64_LINUX;
    if (targetOs === "darwin") {
      dataLayout = isAarch64 ? DATA_LAYOUT_AARCH64_MACOS : DATA_LAYOUT_X86_64_MACOS;
    } else {
      dataLayout = isAarch64 ? DATA_LAYOUT_AARCH64_LINUX : DATA_LAYOUT_X86_64_LINUX;
    }
    const libc: LibC = targetOs === "darwin" ? "system" : target.includes("musl") ? "musl" : "gnu";
    return {
      triple: target,
      os: targetOs,
      arch: isAarch64 ? "aarch64" : isX86 ? "x86_64" : arch,
      cpu: "generic",
      platformString: targetOs,
      archString: isAarch64 ? "arm64" : isX86 ? "x64" : arch,
      dataLayout,
      libc,
    };
  }

  throw new Error(
    "chad: error: unknown target '" +
      target +
      "'\n" +
      "Supported targets: linux-x64, linux-arm64, macos-x64, macos-arm64\n" +
      "Or use a full LLVM triple (e.g., x86_64-unknown-linux-musl)",
  );
}

// Detect whether the host Linux uses musl or glibc by checking if
// the dynamic linker path mentions "musl" (Alpine, Void, etc.)
export function detectHostLibc(): LibC {
  try {
    const ldso = readFileSync("/proc/self/maps", "utf8");
    if (ldso.includes("musl")) return "musl";
  } catch {
    // /proc may not exist (macOS) — fall through
  }
  // Check if ldd itself is musl-based
  try {
    const lddPath = "/usr/bin/ldd";
    if (existsSync(lddPath)) {
      const content = readFileSync(lddPath, "utf8");
      if (content.includes("musl")) return "musl";
    }
  } catch {
    // ignore
  }
  return "gnu";
}

export function getHostTarget(): TargetInfo {
  const platform = process.platform;
  const arch = os.arch();

  if (platform === "darwin") {
    if (arch === "arm64") {
      return resolveTarget("macos-arm64");
    }
    return resolveTarget("macos-x64");
  }

  // For native Linux, detect the actual host libc and use matching triple
  const hostLibc = detectHostLibc();
  const triple =
    arch === "arm64" || arch === "aarch64"
      ? `aarch64-unknown-linux-${hostLibc}`
      : `x86_64-unknown-linux-${hostLibc}`;
  return resolveTarget(triple);
}

export function isCrossCompiling(target: TargetInfo): boolean {
  const host = getHostTarget();
  // Compare os+arch, not the full triple — a musl host compiling for musl
  // is native even though the triple string differs from gnu
  return host.os !== target.os || host.arch !== target.arch;
}

// Short name used for SDK directory names: "linux-x64", "macos-arm64", etc.
export function targetName(target: TargetInfo): string {
  return `${target.platformString}-${target.archString}`;
}
