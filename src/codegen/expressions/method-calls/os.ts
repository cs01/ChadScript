// os.ts — Method call handlers for the os module.
// Runtime POSIX wrappers: hostname, homedir, tmpdir, cpus, totalmem, freemem, uptime

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
  // process.platform is the host platform — matches compilation target
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

// os.freemem() — sysconf(_SC_AVPHYS_PAGES) * sysconf(_SC_PAGESIZE)
// _SC_AVPHYS_PAGES: 86 on Linux (not available on macOS, returns -1)
// _SC_PAGESIZE: 30 on both
export function handleOsFreemem(ctx: MethodCallGeneratorContext): string {
  const availPages = ctx.nextTemp();
  ctx.emit(`${availPages} = call i64 @sysconf(i32 86)`);
  const pageSize = ctx.nextTemp();
  ctx.emit(`${pageSize} = call i64 @sysconf(i32 30)`);
  const bytes = ctx.nextTemp();
  ctx.emit(`${bytes} = mul i64 ${availPages}, ${pageSize}`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = uitofp i64 ${bytes} to double`);
  return result;
}

// os.uptime() — reuse uv_hrtime pattern (seconds since process start, not system uptime)
// For true system uptime we'd need to read /proc/uptime on Linux or sysctl on macOS.
// This follows Node.js behavior of returning a double in seconds.
export function handleOsUptime(ctx: MethodCallGeneratorContext): string {
  // Read /proc/uptime on Linux — first number is system uptime in seconds
  const path = ctx.stringGen.doCreateStringConstant("/proc/uptime");
  const mode = ctx.stringGen.doCreateStringConstant("r");
  const fp = ctx.nextTemp();
  ctx.emit(`${fp} = call i8* @fopen(i8* ${path}, i8* ${mode})`);

  // Read into a buffer
  const buf = ctx.nextTemp();
  ctx.emit(`${buf} = call i8* @GC_malloc_atomic(i64 64)`);
  const nread = ctx.nextTemp();
  ctx.emit(`${nread} = call i64 @fread(i8* ${buf}, i64 1, i64 63, i8* ${fp})`);
  // Null-terminate
  const nullPos = ctx.nextTemp();
  ctx.emit(`${nullPos} = getelementptr i8, i8* ${buf}, i64 ${nread}`);
  ctx.emit(`store i8 0, i8* ${nullPos}`);
  const closeRc = ctx.nextTemp();
  ctx.emit(`${closeRc} = call i32 @fclose(i8* ${fp})`);

  // Parse the first double from the string (atof stops at whitespace)
  const result = ctx.nextTemp();
  ctx.emit(`${result} = call double @atof(i8* ${buf})`);
  return result;
}
