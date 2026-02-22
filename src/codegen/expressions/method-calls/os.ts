// os.ts — Method call handlers for the os module.
// hostname, homedir, tmpdir use standard POSIX (works on both Linux and macOS).
// cpus, totalmem use sysconf with platform-aware constants.
// freemem, uptime delegate to os-bridge.c for cross-platform support.

import type { MethodCallGeneratorContext } from "../method-calls.js";

// os.hostname() — gethostname into a GC buffer
export function handleOsHostname(ctx: MethodCallGeneratorContext): string {
  const buf = ctx.nextTemp();
  ctx.emit(`${buf} = call i8* @GC_malloc_atomic(i64 256)`);
  const rc = ctx.nextTemp();
  ctx.emit(`${rc} = call i32 @gethostname(i8* ${buf}, i64 256)`);
  ctx.setVariableType(buf, "i8*");
  return buf;
}

// os.homedir() — getenv("HOME")
export function handleOsHomedir(ctx: MethodCallGeneratorContext): string {
  const nameConst = ctx.stringGen.doCreateStringConstant("HOME");
  const result = ctx.nextTemp();
  ctx.emit(`${result} = call i8* @getenv(i8* ${nameConst})`);
  ctx.setVariableType(result, "i8*");
  return result;
}

// os.tmpdir() — getenv("TMPDIR") with "/tmp" fallback
export function handleOsTmpdir(ctx: MethodCallGeneratorContext): string {
  const envName = ctx.stringGen.doCreateStringConstant("TMPDIR");
  const envResult = ctx.nextTemp();
  ctx.emit(`${envResult} = call i8* @getenv(i8* ${envName})`);
  const isNull = ctx.nextTemp();
  ctx.emit(`${isNull} = icmp eq i8* ${envResult}, null`);
  const fallback = ctx.stringGen.doCreateStringConstant("/tmp");
  const result = ctx.nextTemp();
  ctx.emit(`${result} = select i1 ${isNull}, i8* ${fallback}, i8* ${envResult}`);
  ctx.setVariableType(result, "i8*");
  return result;
}

// os.cpus() — sysconf(_SC_NPROCESSORS_ONLN)
// _SC_NPROCESSORS_ONLN is 84 on Linux, 58 on macOS
export function handleOsCpus(ctx: MethodCallGeneratorContext): string {
  const scVal = process.platform === "darwin" ? "58" : "84";
  const raw = ctx.nextTemp();
  ctx.emit(`${raw} = call i64 @sysconf(i32 ${scVal})`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = sitofp i64 ${raw} to double`);
  return result;
}

// os.totalmem() — sysconf(_SC_PHYS_PAGES) * sysconf(_SC_PAGESIZE)
// _SC_PHYS_PAGES: 85 on Linux, 200 on macOS
// _SC_PAGESIZE: 30 on both
export function handleOsTotalmem(ctx: MethodCallGeneratorContext): string {
  const pagesVal = process.platform === "darwin" ? "200" : "85";
  const pages = ctx.nextTemp();
  ctx.emit(`${pages} = call i64 @sysconf(i32 ${pagesVal})`);
  const pageSize = ctx.nextTemp();
  ctx.emit(`${pageSize} = call i64 @sysconf(i32 30)`);
  const bytes = ctx.nextTemp();
  ctx.emit(`${bytes} = mul i64 ${pages}, ${pageSize}`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = uitofp i64 ${bytes} to double`);
  return result;
}

// os.freemem() — delegates to C bridge for cross-platform support.
// Linux uses sysconf(_SC_AVPHYS_PAGES), macOS uses vm_statistics64.
export function handleOsFreemem(ctx: MethodCallGeneratorContext): string {
  const raw = ctx.nextTemp();
  ctx.emit(`${raw} = call i64 @chad_os_freemem()`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = uitofp i64 ${raw} to double`);
  return result;
}

// os.uptime() — delegates to C bridge for cross-platform support.
// Linux reads /proc/uptime, macOS uses sysctl(KERN_BOOTTIME).
export function handleOsUptime(ctx: MethodCallGeneratorContext): string {
  const result = ctx.nextTemp();
  ctx.emit(`${result} = call double @chad_os_uptime()`);
  return result;
}
