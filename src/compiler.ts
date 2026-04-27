import { resolveModules } from "./resolver.js";
import { emitModule } from "./codegen/emitter.js";
import { unlinkSync, existsSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join, dirname } from "path";

export interface CompileOptions {
  input: string;
  output: string;
  emitIR?: boolean;
}

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const BRIDGE_SRCS = [
  join(ROOT, "c_bridges", "v2-string-bridge.c"),
  join(ROOT, "c_bridges", "v2-array-bridge.c"),
  join(ROOT, "c_bridges", "v2-error-bridge.c"),
  join(ROOT, "c_bridges", "v2-nanbox-bridge.c"),
  join(ROOT, "c_bridges", "v2-promise-bridge.c"),
];

function findLibuv(): { include: string; lib: string } {
  const candidates = [join(ROOT, "vendor", "libuv"), join(ROOT, "..", "..", "vendor", "libuv")];
  for (const dir of candidates) {
    const lib = join(dir, "build", "libuv.a");
    const inc = join(dir, "include");
    if (existsSync(lib) && existsSync(inc)) {
      return { include: inc, lib: join(dir, "build") };
    }
  }
  throw new Error("libuv not found — expected vendor/libuv with build/libuv.a and include/");
}

function findYyjson(): string {
  const candidates = [join(ROOT, "vendor", "yyjson"), join(ROOT, "..", "..", "vendor", "yyjson")];
  for (const dir of candidates) {
    if (existsSync(join(dir, "yyjson.c")) && existsSync(join(dir, "yyjson.h"))) {
      return dir;
    }
  }
  throw new Error("yyjson not found — expected vendor/yyjson with yyjson.c and yyjson.h");
}

const TIMER_BRIDGE = join(ROOT, "c_bridges", "v2-timer-bridge.c");
const JSON_BRIDGE = join(ROOT, "c_bridges", "v2-json-bridge.c");

export function compile(opts: CompileOptions): void {
  const hir = resolveModules(opts.input);

  const tmpObj = join(tmpdir(), `chad2-${process.pid}.o`);
  const bridgeObjs = BRIDGE_SRCS.map((_, i) =>
    join(tmpdir(), `chad2-bridge-${process.pid}-${i}.o`),
  );
  const timerObj = join(tmpdir(), `chad2-timer-${process.pid}.o`);
  const jsonObj = join(tmpdir(), `chad2-json-${process.pid}.o`);
  const yyjsonObj = join(tmpdir(), `chad2-yyjson-${process.pid}.o`);
  const allObjs = [...bridgeObjs, timerObj, jsonObj, yyjsonObj];
  const irPath = opts.emitIR ? opts.output + ".ll" : undefined;

  try {
    emitModule(hir, tmpObj, irPath);

    if (opts.emitIR) return;

    const libuv = findLibuv();
    const yyjsonDir = findYyjson();

    for (let i = 0; i < BRIDGE_SRCS.length; i++) {
      execSync(`clang -c -O2 -o ${bridgeObjs[i]} ${BRIDGE_SRCS[i]}`, { stdio: "inherit" });
    }
    execSync(`clang -c -O2 -I${libuv.include} -o ${timerObj} ${TIMER_BRIDGE}`, {
      stdio: "inherit",
    });
    execSync(`clang -c -O2 -o ${yyjsonObj} ${join(yyjsonDir, "yyjson.c")}`, {
      stdio: "inherit",
    });
    execSync(`clang -c -O2 -I${yyjsonDir} -o ${jsonObj} ${JSON_BRIDGE}`, {
      stdio: "inherit",
    });
    execSync(`clang -g -O2 -o ${opts.output} ${tmpObj} ${allObjs.join(" ")} -L${libuv.lib} -luv`, {
      stdio: "inherit",
    });
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
