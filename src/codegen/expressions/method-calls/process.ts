import { Expression, MethodCallNode, MemberAccessNode, VariableNode } from '../../../ast/types.js';
import type { MethodCallGeneratorContext } from '../method-calls.js';

interface ExprBase { type: string; }

export function generateProcessExitInline(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  if (expr.args.length > 0) {
    const arg = expr.args[0];
    const exprResult = ctx.generateExpression(arg as Expression, params);
    const intTemp = ctx.nextTemp();
    ctx.emit(`${intTemp} = fptosi double ${exprResult} to i32`);
    ctx.emit(`call void @exit(i32 ${intTemp})`);
  } else {
    ctx.emit(`call void @exit(i32 0)`);
  }
  return '0';
}

export function generateProcessCwdInline(ctx: MethodCallGeneratorContext): string {
  const bufSize = ctx.nextTemp();
  ctx.emit(`${bufSize} = add i64 0, 4096`);
  const buf = ctx.nextTemp();
  ctx.emit(`${buf} = call i8* @GC_malloc_atomic(i64 ${bufSize})`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = call i8* @getcwd(i8* ${buf}, i64 4096)`);
  ctx.setVariableType(result, 'i8*');
  return result;
}

export function handleProcessChdir(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  if (expr.args.length === 0) {
    throw new Error('process.chdir() requires 1 argument');
  }
  const dirValue = ctx.generateExpression(expr.args[0], params);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = call i32 @chdir(i8* ${dirValue})`);
  return '0';
}

export function handleProcessKill(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  if (expr.args.length < 1) {
    throw new Error('process.kill() requires at least 1 argument');
  }
  const pidValue = ctx.generateExpression(expr.args[0], params);
  const pidI32 = ctx.nextTemp();
  ctx.emit(`${pidI32} = fptosi double ${pidValue} to i32`);

  let sigI32 = '15';
  if (expr.args.length >= 2) {
    const sigValue = ctx.generateExpression(expr.args[1], params);
    const sigTemp = ctx.nextTemp();
    ctx.emit(`${sigTemp} = fptosi double ${sigValue} to i32`);
    sigI32 = sigTemp;
  }

  const result = ctx.nextTemp();
  ctx.emit(`${result} = call i32 @kill(i32 ${pidI32}, i32 ${sigI32})`);
  return '0';
}

export function handleProcessUptime(ctx: MethodCallGeneratorContext): string {
  const tsPtr = ctx.nextTemp();
  ctx.emit(`${tsPtr} = alloca %struct.timespec`);
  const callResult = ctx.nextTemp();
  ctx.emit(`${callResult} = call i32 @clock_gettime(i32 1, %struct.timespec* ${tsPtr})`);
  const secPtr = ctx.nextTemp();
  ctx.emit(`${secPtr} = getelementptr inbounds %struct.timespec, %struct.timespec* ${tsPtr}, i32 0, i32 0`);
  const sec = ctx.nextTemp();
  ctx.emit(`${sec} = load i64, i64* ${secPtr}`);
  const nsecPtr = ctx.nextTemp();
  ctx.emit(`${nsecPtr} = getelementptr inbounds %struct.timespec, %struct.timespec* ${tsPtr}, i32 0, i32 1`);
  const nsec = ctx.nextTemp();
  ctx.emit(`${nsec} = load i64, i64* ${nsecPtr}`);
  const secDouble = ctx.nextTemp();
  ctx.emit(`${secDouble} = sitofp i64 ${sec} to double`);
  const nsecDouble = ctx.nextTemp();
  ctx.emit(`${nsecDouble} = sitofp i64 ${nsec} to double`);
  const nsecSec = ctx.nextTemp();
  ctx.emit(`${nsecSec} = fdiv fast double ${nsecDouble}, 1000000000.0`);
  const total = ctx.nextTemp();
  ctx.emit(`${total} = fadd fast double ${secDouble}, ${nsecSec}`);
  return total;
}

export function handleProcessSyscallI32(ctx: MethodCallGeneratorContext, funcName: string): string {
  const rawResult = ctx.nextTemp();
  ctx.emit(`${rawResult} = call i32 ${funcName}()`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = sitofp i32 ${rawResult} to double`);
  return result;
}

export function isProcessStdoutOrStderr(expr: MethodCallNode): boolean {
  const objBase = expr.object as ExprBase;
  if (objBase.type !== 'member_access') return false;
  const memberAccess = expr.object as MemberAccessNode;
  const innerBase = memberAccess.object as ExprBase;
  if (innerBase.type !== 'variable') return false;
  const varNode = memberAccess.object as VariableNode;
  return varNode.name === 'process' &&
         (memberAccess.property === 'stdout' || memberAccess.property === 'stderr');
}

export function handleProcessWrite(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  if (expr.args.length === 0) {
    return '0';
  }

  const memberAccess = expr.object as MemberAccessNode;
  const isStderr = memberAccess.property === 'stderr';

  const arg = expr.args[0];
  const argValue = ctx.generateExpression(arg as Expression, params);
  const isString = ctx.isStringExpression(arg as Expression);

  if (isStderr) {
    const stderrPtr = ctx.nextTemp();
    ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
    if (isString || (arg as ExprBase).type === 'string') {
      const temp = ctx.nextTemp();
      ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* getelementptr([3 x i8], [3 x i8]* @.str.strfmt_no_nl, i32 0, i32 0), i8* ${argValue})`);
    } else {
      const temp = ctx.nextTemp();
      ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* getelementptr([6 x i8], [6 x i8]* @.str.numfmt_no_nl, i32 0, i32 0), double ${argValue})`);
    }
    const flushTemp = ctx.nextTemp();
    ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
  } else {
    if (isString || (arg as ExprBase).type === 'string') {
      const temp = ctx.nextTemp();
      ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* getelementptr([3 x i8], [3 x i8]* @.str.strfmt_no_nl, i32 0, i32 0), i8* ${argValue})`);
    } else {
      const temp = ctx.nextTemp();
      ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* getelementptr([6 x i8], [6 x i8]* @.str.numfmt_no_nl, i32 0, i32 0), double ${argValue})`);
    }
    const flushTemp = ctx.nextTemp();
    ctx.emit(`${flushTemp} = call i32 @fflush(i8* null)`);
  }

  return '1.0';
}
