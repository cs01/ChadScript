import { parsePythonFile } from "./parser-py.js";
import { lowerPythonModule } from "./hir/lower-py.js";
import { emitModule } from "./codegen/emitter.js";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join, dirname, resolve } from "path";

export interface CompileOptions {
  input: string;
  output: string;
  emitIR?: boolean;
}

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const BRIDGE_SRCS = [
  join(ROOT, "c_bridges", "v2-string-bridge.c"),
  join(ROOT, "c_bridges", "v2-array-bridge.c"),
  join(ROOT, "c_bridges", "v2-map-bridge.c"),
  join(ROOT, "c_bridges", "v2-set-bridge.c"),
  join(ROOT, "c_bridges", "v2-error-bridge.c"),
  join(ROOT, "c_bridges", "v2-nanbox-bridge.c"),
  join(ROOT, "c_bridges", "v2-promise-bridge.c"),
  join(ROOT, "c_bridges", "v2-process-bridge.c"),
  join(ROOT, "c_bridges", "v2-console-bridge.c"),
  join(ROOT, "c_bridges", "v2-path-bridge.c"),
  join(ROOT, "c_bridges", "py-sys-bridge.c"),
  join(ROOT, "c_bridges", "py-random-bridge.c"),
  join(ROOT, "c_bridges", "py-os-bridge.c"),
  join(ROOT, "c_bridges", "py-io-bridge.c"),
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

function findPcre2(): { include: string; lib: string } {
  try {
    const cflags = execSync("pcre2-config --cflags", { encoding: "utf-8" }).trim();
    const libs = execSync("pcre2-config --libs8", { encoding: "utf-8" }).trim();
    const incMatch = cflags.match(/-I(\S+)/);
    const libMatch = libs.match(/-L(\S+)/);
    return {
      include: incMatch ? incMatch[1] : "/usr/include",
      lib: libMatch ? libMatch[1] : "/usr/lib",
    };
  } catch {
    return { include: "/usr/include", lib: "/usr/lib" };
  }
}

const TIMER_BRIDGE = join(ROOT, "c_bridges", "v2-timer-bridge.c");
const JSON_BRIDGE = join(ROOT, "c_bridges", "v2-json-bridge.c");
const PY_JSON_BRIDGE = join(ROOT, "c_bridges", "py-json-bridge.c");
const PY_RE_BRIDGE = join(ROOT, "c_bridges", "py-re-bridge.c");

export async function compilePython(opts: CompileOptions): Promise<void> {
  const absPath = resolve(opts.input);
  const source = readFileSync(absPath, "utf-8");
  const root = await parsePythonFile(absPath);
  const hir = lowerPythonModule(root, source, absPath);

  const tmpObj = join(tmpdir(), `chad2py-${process.pid}.o`);
  const bridgeObjs = BRIDGE_SRCS.map((_, i) =>
    join(tmpdir(), `chad2py-bridge-${process.pid}-${i}.o`),
  );
  const timerObj = join(tmpdir(), `chad2py-timer-${process.pid}.o`);
  const jsonObj = join(tmpdir(), `chad2py-json-${process.pid}.o`);
  const pyJsonObj = join(tmpdir(), `chad2py-pyjson-${process.pid}.o`);
  const pyReObj = join(tmpdir(), `chad2py-pyre-${process.pid}.o`);
  const yyjsonObj = join(tmpdir(), `chad2py-yyjson-${process.pid}.o`);
  const allObjs = [...bridgeObjs, timerObj, jsonObj, pyJsonObj, pyReObj, yyjsonObj];
  const irPath = opts.emitIR ? opts.output + ".ll" : undefined;

  try {
    emitModule(hir, tmpObj, irPath);

    if (opts.emitIR) return;

    const libuv = findLibuv();
    const yyjsonDir = findYyjson();
    const pcre2 = findPcre2();

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
    execSync(`clang -c -O2 -I${yyjsonDir} -o ${pyJsonObj} ${PY_JSON_BRIDGE}`, {
      stdio: "inherit",
    });
    execSync(`clang -c -O2 -I${pcre2.include} -o ${pyReObj} ${PY_RE_BRIDGE}`, {
      stdio: "inherit",
    });
    execSync(`clang -g -O2 -o ${opts.output} ${tmpObj} ${allObjs.join(" ")} -L${libuv.lib} -luv -L${pcre2.lib} -lpcre2-8`, {
      stdio: "inherit",
    });
    if (process.platform === "darwin") {
      execSync(`dsymutil -q ${opts.output}`, { stdio: "inherit" });
    }
  } finally {
    try { unlinkSync(tmpObj); } catch {}
    for (const o of allObjs) {
      try { unlinkSync(o); } catch {}
    }
  }
}
