import { MethodCallNode } from "../../../ast/types.js";
import type { MethodCallGeneratorContext } from "../method-calls.js";
import {
  generateProcessExitInline,
  generateProcessCwdInline,
  handleProcessChdir,
  handleProcessKill,
  handleProcessUptime,
  handleProcessSyscallI32,
} from "./process.js";
import {
  generateConsoleCallInline,
  generateConsoleTime,
  generateConsoleTimeEnd,
} from "./console.js";
import {
  handleAssertStrictEqual,
  handleAssertNotStrictEqual,
  handleAssertOk,
  handleAssertDeepEqual,
  handleAssertFail,
} from "./assert.js";
import {
  handleOsHostname,
  handleOsHomedir,
  handleOsTmpdir,
  handleOsCpus,
  handleOsTotalmem,
  handleOsFreemem,
  handleOsUptime,
} from "./os.js";

export function handleFsMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  if (method === "readFileSync") {
    if (ctx.getWantsBinaryReturn()) return ctx.fsGen.generateReadFileSyncBinary(expr, params);
    return ctx.fsGen.generateReadFileSync(expr, params);
  }
  if (method === "writeFileSync") {
    if (expr.args.length >= 2 && ctx.isUint8ArrayExpression(expr.args[1]))
      return ctx.fsGen.generateWriteFileSyncBinary(expr, params);
    return ctx.fsGen.generateWriteFileSync(expr, params);
  }
  if (method === "appendFileSync") return ctx.fsGen.generateAppendFileSync(expr, params);
  if (method === "existsSync") return ctx.fsGen.generateExistsSync(expr, params);
  if (method === "unlinkSync") return ctx.fsGen.generateUnlinkSync(expr, params);
  if (method === "readdirSync") return ctx.fsGen.generateReaddirSync(expr, params);
  if (method === "statSync") return ctx.fsGen.generateStatSync(expr, params);
  if (method === "mkdirSync") return ctx.fsGen.generateMkdirSync(expr, params);
  if (method === "renameSync") return ctx.fsGen.generateRenameSync(expr, params);
  if (method === "copyFileSync") return ctx.fsGen.generateCopyFileSync(expr, params);
  if (method === "readFile") return ctx.fsGen.generateReadFile(expr, params);
  if (method === "writeFile") return ctx.fsGen.generateWriteFile(expr, params);
  if (method === "appendFile") return ctx.fsGen.generateAppendFile(expr, params);
  if (method === "readdir") return ctx.fsGen.generateReaddir(expr, params);
  if (method === "stat") return ctx.fsGen.generateStat(expr, params);
  if (method === "unlink") return ctx.fsGen.generateUnlink(expr, params);
  if (method === "mkdir") return ctx.fsGen.generateMkdir(expr, params);
  if (method === "rename") return ctx.fsGen.generateRename(expr, params);
  if (method === "copyFile") return ctx.fsGen.generateCopyFile(expr, params);
  return null;
}

export function handlePathMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  if (method === "resolve") return ctx.pathGen.generateResolve(expr, params);
  if (method === "dirname") return ctx.pathGen.generateDirname(expr, params);
  if (method === "basename") return ctx.pathGen.generateBasename(expr, params);
  if (method === "join") return ctx.pathGen.generateJoin(expr, params);
  if (method === "extname") return ctx.pathGen.generateExtname(expr, params);
  if (method === "isAbsolute") return ctx.pathGen.generateIsAbsolute(expr, params);
  if (method === "normalize") return ctx.pathGen.generateNormalize(expr, params);
  if (method === "relative") return ctx.pathGen.generateRelative(expr, params);
  if (method === "parse") return ctx.pathGen.generateParse(expr, params);
  return null;
}

export function handleChildProcessMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  if (method === "execSync") return ctx.childProcessGen.generateExecSync(expr, params);
  if (method === "exec") return ctx.childProcessGen.generateExec(expr, params);
  if (method === "spawn") return ctx.childProcessGen.generateSpawn(expr, params);
  if (method === "spawnSync") return ctx.childProcessGen.generateSpawnSync(expr, params);
  return null;
}

export function handleBufferFrom(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length === 0)
    return ctx.emitError("Buffer.from() requires at least 1 argument", expr.loc);
  const strPtr = ctx.generateExpression(expr.args[0], params);
  const rawPtr = ctx.emitCall("i8*", "@cs_base64_decode", `i8* ${strPtr}`);
  const arrPtr = ctx.emitBitcast(rawPtr, "i8*", "%Uint8Array*");
  ctx.setVariableType(arrPtr, "%Uint8Array*");
  return arrPtr;
}

export function handleStringFromCharCode(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length === 0)
    return ctx.emitError("String.fromCharCode() requires 1 argument", expr.loc);
  const codeVal = ctx.generateExpression(expr.args[0], params);
  const dblVal = ctx.ensureDouble(codeVal);
  const intVal = ctx.nextTemp();
  ctx.emit(`${intVal} = fptosi double ${dblVal} to i32`);
  const byteVal = ctx.nextTemp();
  ctx.emit(`${byteVal} = trunc i32 ${intVal} to i8`);
  const buf = ctx.emitCall("i8*", "@GC_malloc_atomic", "i64 2");
  ctx.emitStore("i8", byteVal, buf);
  const nullPtr = ctx.emitGep("i8", buf, "i64 1");
  ctx.emitStore("i8", "0", nullPtr);
  ctx.setVariableType(buf, "i8*");
  return buf;
}

export function handleUint8ArrayFromRawBytes(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length < 2)
    return ctx.emitError(
      "Uint8Array.fromRawBytes() requires 2 arguments (data: string, len: number)",
      expr.loc,
    );
  const dataPtr = ctx.generateExpression(expr.args[0], params);
  const lenDbl = ctx.generateExpression(expr.args[1], params);
  const lenI64 = ctx.nextTemp();
  ctx.emit(`${lenI64} = fptosi double ${lenDbl} to i64`);
  const lenI32 = ctx.nextTemp();
  ctx.emit(`${lenI32} = trunc i64 ${lenI64} to i32`);
  const rawPtr = ctx.emitCall("i8*", "@GC_malloc", "i64 16");
  const arrPtr = ctx.emitBitcast(rawPtr, "i8*", "%Uint8Array*");
  const f0 = ctx.nextTemp();
  ctx.emit(`${f0} = getelementptr inbounds %Uint8Array, %Uint8Array* ${arrPtr}, i32 0, i32 0`);
  ctx.emit(`store i8* ${dataPtr}, i8** ${f0}`);
  const f1 = ctx.nextTemp();
  ctx.emit(`${f1} = getelementptr inbounds %Uint8Array, %Uint8Array* ${arrPtr}, i32 0, i32 1`);
  ctx.emit(`store i32 ${lenI32}, i32* ${f1}`);
  const f2 = ctx.nextTemp();
  ctx.emit(`${f2} = getelementptr inbounds %Uint8Array, %Uint8Array* ${arrPtr}, i32 0, i32 2`);
  ctx.emit(`store i32 ${lenI32}, i32* ${f2}`);
  ctx.setVariableType(arrPtr, "%Uint8Array*");
  return arrPtr;
}

export function handleCryptoMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  ctx.setUsesCrypto(true);
  if (method === "randomUUID") return ctx.cryptoGen.generateRandomUUID(expr, params);
  if (method === "sha256") return ctx.cryptoGen.generateSha256(expr, params);
  if (method === "md5") return ctx.cryptoGen.generateMd5(expr, params);
  if (method === "sha512") return ctx.cryptoGen.generateSha512(expr, params);
  if (method === "randomBytes") return ctx.cryptoGen.generateRandomBytes(expr, params);
  if (method === "hmacSha256") return ctx.cryptoGen.generateHmacSha256(expr, params);
  if (method === "pbkdf2") return ctx.cryptoGen.generatePbkdf2(expr, params);
  return null;
}

export function handleTtyIsatty(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length === 0)
    return ctx.emitError("tty.isatty() requires 1 argument (fd)", expr.loc);
  const fdValue = ctx.generateExpression(expr.args[0], params);
  const dblFd = ctx.ensureDouble(fdValue);
  const fdInt = ctx.nextTemp();
  ctx.emit(`${fdInt} = fptosi double ${dblFd} to i32`);
  const rawResult = ctx.nextTemp();
  ctx.emit(`${rawResult} = call i32 @isatty(i32 ${fdInt})`);
  const boolResult = ctx.nextTemp();
  ctx.emit(`${boolResult} = icmp ne i32 ${rawResult}, 0`);
  const doubleResult = ctx.nextTemp();
  ctx.emit(`${doubleResult} = uitofp i1 ${boolResult} to double`);
  return doubleResult;
}

export function handleProcessMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  if (method === "exit") return generateProcessExitInline(ctx, expr, params);
  if (method === "cwd") return generateProcessCwdInline(ctx);
  if (method === "chdir") return handleProcessChdir(ctx, expr, params);
  if (method === "abort") {
    ctx.emit(`call void @abort()`);
    return "0";
  }
  if (method === "kill") return handleProcessKill(ctx, expr, params);
  if (method === "uptime") return handleProcessUptime(ctx);
  if (method === "getuid") return handleProcessSyscallI32(ctx, "@getuid");
  if (method === "getgid") return handleProcessSyscallI32(ctx, "@getgid");
  if (method === "geteuid") return handleProcessSyscallI32(ctx, "@geteuid");
  if (method === "getegid") return handleProcessSyscallI32(ctx, "@getegid");
  return null;
}

export function handleAssertMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  ctx.setUsesTestRunner(true);
  if (method === "strictEqual") return handleAssertStrictEqual(ctx, expr, params);
  if (method === "notStrictEqual") return handleAssertNotStrictEqual(ctx, expr, params);
  if (method === "ok") return handleAssertOk(ctx, expr, params);
  if (method === "deepEqual") return handleAssertDeepEqual(ctx, expr, params);
  if (method === "fail") return handleAssertFail(ctx, expr, params);
  return null;
}

export function handleOsMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  if (method === "hostname") return handleOsHostname(ctx);
  if (method === "homedir") return handleOsHomedir(ctx);
  if (method === "tmpdir") return handleOsTmpdir(ctx);
  if (method === "cpus") return handleOsCpus(ctx);
  if (method === "totalmem") return handleOsTotalmem(ctx);
  if (method === "freemem") {
    ctx.setUsesOs(true);
    return handleOsFreemem(ctx);
  }
  if (method === "uptime") {
    ctx.setUsesOs(true);
    return handleOsUptime(ctx);
  }
  return null;
}

export function handleConsoleMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  if (method === "log" || method === "error" || method === "warn" || method === "debug")
    return generateConsoleCallInline(ctx, expr, params);
  if (method === "time") return generateConsoleTime(ctx, expr, params);
  if (method === "timeEnd") return generateConsoleTimeEnd(ctx, expr, params);
  return null;
}

export function handleChadScriptMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  if (method === "embedFile") return ctx.embedGen.generateEmbedFile(expr, params);
  if (method === "embedDir") return ctx.embedGen.generateEmbedDir(expr, params);
  if (method === "getEmbeddedFile") return ctx.embedGen.generateGetEmbeddedFile(expr, params);
  if (method === "getEmbeddedFileAsUint8Array")
    return ctx.embedGen.generateGetEmbeddedFileAsUint8Array(expr, params);
  if (method === "serveEmbedded") return ctx.embedGen.generateServeEmbedded(expr, params);
  return ctx.emitError(`ChadScript.${method}() is not a supported method`, expr.loc);
}

export function handleSqliteMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  ctx.setUsesSqlite(true);
  if (method === "open") return ctx.sqliteGen.generateOpen(expr, params);
  if (method === "exec") return ctx.sqliteGen.generateExec(expr, params);
  if (method === "get") return ctx.sqliteGen.generateGet(expr, params);
  if (method === "getRow") return ctx.sqliteGen.generateGetRow(expr, params);
  if (method === "all") return ctx.sqliteGen.generateAll(expr, params);
  if (method === "query") return ctx.sqliteGen.generateQuery(expr, params);
  if (method === "close") return ctx.sqliteGen.generateClose(expr, params);
  return null;
}
