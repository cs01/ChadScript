import { resolveModules } from "./resolver.js";
import { emitModule } from "./codegen/emitter.js";
import { deadCodePass } from "./transforms/dead-code.js";
import { constFoldPass } from "./transforms/const-fold.js";
import { narrowFpPass } from "./transforms/narrow-fp.js";
import { narrowFnsPass } from "./transforms/narrow-fns.js";
import { concatBuilderPass } from "./transforms/concat-builder.js";
import { narrowLocalsPass } from "./transforms/narrow-locals.js";
import { narrowGlobalsPass } from "./transforms/narrow-globals.js";
import { unlinkSync, existsSync, readFileSync, mkdirSync, copyFileSync } from "fs";
import { createHash } from "crypto";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join, dirname } from "path";

export interface CompileOptions {
  input: string;
  output: string;
  emitIR?: boolean;
  llvm?: boolean;
  swc?: boolean;
  substitutions?: Map<string, string>;
}

function findRoot(): string {
  const argv0 = process.argv[0];
  if (argv0 && !argv0.endsWith("node") && !argv0.includes("tsx")) {
    return dirname(argv0);
  }
  return join(dirname(new URL(import.meta.url).pathname), "..");
}

const ROOT = findRoot();
const BRIDGE_SRCS = [
  join(ROOT, "c_bridges", "v2-string-bridge.c"),
  join(ROOT, "c_bridges", "v2-array-bridge.c"),
  join(ROOT, "c_bridges", "v2-error-bridge.c"),
  join(ROOT, "c_bridges", "v2-nanbox-bridge.c"),
  join(ROOT, "c_bridges", "v2-promise-bridge.c"),
  join(ROOT, "c_bridges", "v2-process-bridge.c"),
  join(ROOT, "c_bridges", "v2-console-bridge.c"),
  join(ROOT, "c_bridges", "v2-path-bridge.c"),
  join(ROOT, "c_bridges", "v2-fs-bridge.c"),
  join(ROOT, "c_bridges", "v2-child-process-bridge.c"),
  join(ROOT, "c_bridges", "v2-map-bridge.c"),
  join(ROOT, "c_bridges", "v2-set-bridge.c"),
  join(ROOT, "c_bridges", "v2-crypto-bridge.c"),
  join(ROOT, "c_bridges", "v2-buffer-bridge.c"),
  join(ROOT, "c_bridges", "v2-regex-bridge.c"),
  join(ROOT, "c_bridges", "v2-typed-array-bridge.c"),
  join(ROOT, "c_bridges", "v2-date-bridge.c"),
  join(ROOT, "c_bridges", "v2-os-bridge.c"),
  join(ROOT, "c_bridges", "v2-dynobj-bridge.c"),
  join(ROOT, "c_bridges", "v2-json-dynobj-bridge.c"),
  join(ROOT, "c_bridges", "v2-runtime.c"),
  join(ROOT, "c_bridges", "v2-arena-bridge.c"),
];

function findLibuv(): { include: string; lib: string } {
  const dir = join(ROOT, "vendor", "libuv");
  const lib = join(dir, "build", "libuv.a");
  const inc = join(dir, "include");
  if (existsSync(lib) && existsSync(inc)) {
    return { include: inc, lib: join(dir, "build") };
  }
  throw new Error("libuv not found — expected vendor/libuv with build/libuv.a and include/");
}

function findYyjson(): string {
  const dir = join(ROOT, "vendor", "yyjson");
  if (existsSync(join(dir, "yyjson.c")) && existsSync(join(dir, "yyjson.h"))) {
    return dir;
  }
  throw new Error("yyjson not found — expected vendor/yyjson with yyjson.c and yyjson.h");
}

function findBdwgc(): { include: string; lib: string } {
  const dir = join(ROOT, "vendor", "bdwgc");
  const lib = join(dir, "build", "libgc.a");
  const inc = join(dir, "include");
  if (existsSync(lib) && existsSync(inc)) return { include: inc, lib: dir + "/build" };
  throw new Error("bdwgc not found — expected vendor/bdwgc/build/libgc.a and vendor/bdwgc/include");
}

function findRure(): string {
  const dir = join(ROOT, "vendor", "rure");
  if (existsSync(join(dir, "librure.a"))) {
    return dir;
  }
  throw new Error("rure not found — expected vendor/rure with librure.a");
}

const LLVM_BRIDGE = join(ROOT, "c_bridges", "v2-llvm-bridge.c");
const LLVM_INCLUDE = "/opt/homebrew/opt/llvm/include";
const LLVM_LIB = "/opt/homebrew/opt/llvm/lib";
const SWC_BRIDGE_DIR = join(ROOT, "swc-bridge", "target", "release");

const TIMER_BRIDGE = join(ROOT, "c_bridges", "v2-timer-bridge.c");
const JSON_BRIDGE = join(ROOT, "c_bridges", "v2-json-bridge.c");
const HTTP_BRIDGE = join(ROOT, "c_bridges", "v2-http-bridge.c");

const BRIDGE_CACHE_DIR = join(ROOT, ".cache", "bridges");

function hashFile(path: string): string {
  return createHash("md5").update(readFileSync(path)).digest("hex").slice(0, 12);
}

function cachedCompile(src: string, outObj: string, flags: string): void {
  mkdirSync(BRIDGE_CACHE_DIR, { recursive: true });
  const hash = hashFile(src);
  const cached = join(BRIDGE_CACHE_DIR, `${hash}-${src.split("/").pop()!.replace(".c", ".o")}`);
  if (existsSync(cached)) {
    copyFileSync(cached, outObj);
  } else {
    execSync(`clang -c ${flags} -o ${outObj} ${src}`, { stdio: "inherit" });
    copyFileSync(outObj, cached);
  }
}

export function compile(opts: CompileOptions): void {
  const hir = resolveModules(opts.input, opts.substitutions);
  constFoldPass(hir);
  narrowLocalsPass(hir);
  narrowFnsPass(hir);
  narrowGlobalsPass(hir);
  narrowFpPass(hir);
  concatBuilderPass(hir);
  deadCodePass(hir);

  const tmpObj = join(tmpdir(), `chad2-${process.pid}.o`);
  const bridgeObjs = BRIDGE_SRCS.map((_: string, i: number): string =>
    join(tmpdir(), `chad2-bridge-${process.pid}-${i}.o`),
  );
  const timerObj = join(tmpdir(), `chad2-timer-${process.pid}.o`);
  const jsonObj = join(tmpdir(), `chad2-json-${process.pid}.o`);
  const yyjsonObj = join(tmpdir(), `chad2-yyjson-${process.pid}.o`);
  const httpObj = join(tmpdir(), `chad2-http-${process.pid}.o`);
  const llvmObj = join(tmpdir(), `chad2-llvm-${process.pid}.o`);
  const allObjs: string[] = [];
  for (const b of bridgeObjs) {
    allObjs.push(b);
  }
  allObjs.push(timerObj);
  allObjs.push(jsonObj);
  allObjs.push(yyjsonObj);
  allObjs.push(httpObj);
  if (opts.llvm) allObjs.push(llvmObj);
  const irPath = opts.emitIR ? opts.output + ".ll" : "";

  try {
    emitModule(hir, tmpObj, irPath);

    if (opts.emitIR) return;

    const libuv = findLibuv();
    const yyjsonDir = findYyjson();
    const rureDir = findRure();
    const bdwgc = findBdwgc();

    for (let i = 0; i < BRIDGE_SRCS.length; i++) {
      cachedCompile(BRIDGE_SRCS[i], bridgeObjs[i], `-O2 -I${bdwgc.include}`);
    }
    cachedCompile(TIMER_BRIDGE, timerObj, `-O2 -I${libuv.include}`);
    cachedCompile(HTTP_BRIDGE, httpObj, `-O2 -I${libuv.include}`);
    cachedCompile(join(yyjsonDir, "yyjson.c"), yyjsonObj, "-O2");
    cachedCompile(JSON_BRIDGE, jsonObj, `-O2 -I${yyjsonDir}`);
    if (opts.llvm) {
      cachedCompile(LLVM_BRIDGE, llvmObj, `-O2 -I${LLVM_INCLUDE}`);
    }
    const llvmFlags = opts.llvm ? ` -L${LLVM_LIB} -lLLVM-22` : "";
    const swcFlags = opts.swc ? ` -L${SWC_BRIDGE_DIR} -lswc_bridge -Wl,-rpath,${SWC_BRIDGE_DIR}` : "";
    execSync(
      `clang -g -O2 -o ${opts.output} ${tmpObj} ${allObjs.join(" ")} -L${libuv.lib} -luv -L${rureDir} -lrure -L${bdwgc.lib} -lgc${llvmFlags}${swcFlags}`,
      { stdio: "inherit" },
    );
    if (process.platform === "darwin") {
      execSync(`dsymutil -q ${opts.output}`, { stdio: "inherit" });
    }
  } finally {
    try {
      unlinkSync(tmpObj);
    } catch {}
    for (const o of allObjs) {
      try {
        unlinkSync(o);
      } catch {}
    }
  }
}
