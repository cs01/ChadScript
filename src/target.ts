// Target triple resolution and host detection for cross-compilation.
// Cross-compilation currently only supports linux-x64 as a target.
import * as os from "os";

export type LibC = "gnu" | "system";

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
  if (target === "linux-x64" || target === "x86_64-unknown-linux-gnu") {
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
  if (target === "linux-arm64" || target === "aarch64-unknown-linux-gnu") {
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

  throw new Error(
    "chad: error: unknown target '" +
      target +
      "'\n" +
      "Supported targets: linux-x64, linux-arm64, macos-x64, macos-arm64",
  );
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

  const triple =
    arch === "arm64" || arch === "aarch64"
      ? "aarch64-unknown-linux-gnu"
      : "x86_64-unknown-linux-gnu";
  return resolveTarget(triple);
}

export function isCrossCompiling(target: TargetInfo): boolean {
  const host = getHostTarget();
  return host.os !== target.os || host.arch !== target.arch;
}

// Short name used for SDK directory names: "linux-x64", "macos-arm64", etc.
export function targetName(target: TargetInfo): string {
  return `${target.platformString}-${target.archString}`;
}
