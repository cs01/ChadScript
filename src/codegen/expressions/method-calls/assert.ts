import { Expression, MethodCallNode } from '../../../ast/types.js';
import type { MethodCallGeneratorContext } from '../method-calls.js';

function emitStderrPrint(ctx: MethodCallGeneratorContext, fmtRef: string, args: string): void {
  const stderrPtr = ctx.nextTemp();
  ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
  const tmp = ctx.nextTemp();
  ctx.emit(`${tmp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, ${fmtRef}${args})`);
}

function setCurrentFailed(ctx: MethodCallGeneratorContext): void {
  ctx.emit('store i1 1, i1* @__test_current_failed');
}

export function handleAssertStrictEqual(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  if (expr.args.length < 2) {
    return ctx.emitError('assert.strictEqual() requires 2 arguments (actual, expected)', expr.loc);
  }

  const isString = ctx.isStringExpression(expr.args[0]) || ctx.isStringExpression(expr.args[1]);

  if (isString) {
    return handleStringEquality(ctx, expr, params, true);
  } else {
    return handleNumberEquality(ctx, expr, params, true);
  }
}

export function handleAssertNotStrictEqual(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  if (expr.args.length < 2) {
    return ctx.emitError('assert.notStrictEqual() requires 2 arguments (actual, expected)', expr.loc);
  }

  const isString = ctx.isStringExpression(expr.args[0]) || ctx.isStringExpression(expr.args[1]);

  if (isString) {
    return handleStringEquality(ctx, expr, params, false);
  } else {
    return handleNumberEquality(ctx, expr, params, false);
  }
}

function handleNumberEquality(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[], expectEqual: boolean): string {
  const actual = ctx.generateExpression(expr.args[0], params);
  const expected = ctx.generateExpression(expr.args[1], params);

  const cmp = ctx.nextTemp();
  if (expectEqual) {
    ctx.emit(`${cmp} = fcmp oeq double ${actual}, ${expected}`);
  } else {
    ctx.emit(`${cmp} = fcmp one double ${actual}, ${expected}`);
  }

  const passLabel = ctx.nextLabel('assert_pass');
  const failLabel = ctx.nextLabel('assert_fail');
  const mergeLabel = ctx.nextLabel('assert_merge');

  ctx.emit(`br i1 ${cmp}, label %${passLabel}, label %${failLabel}`);

  ctx.emit(`${failLabel}:`);
  ctx.setCurrentLabel(failLabel);
  setCurrentFailed(ctx);
  emitStderrPrint(ctx, 'i8* getelementptr([31 x i8], [31 x i8]* @.str.assert_eq_num, i32 0, i32 0)', `, double ${expected}, double ${actual}`);
  ctx.emit(`br label %${mergeLabel}`);

  ctx.emit(`${passLabel}:`);
  ctx.setCurrentLabel(passLabel);
  ctx.emit(`br label %${mergeLabel}`);

  ctx.emit(`${mergeLabel}:`);
  ctx.setCurrentLabel(mergeLabel);

  return '0';
}

function handleStringEquality(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[], expectEqual: boolean): string {
  const actual = ctx.generateExpression(expr.args[0], params);
  const expected = ctx.generateExpression(expr.args[1], params);

  const leftNull = ctx.nextTemp();
  ctx.emit(`${leftNull} = icmp eq i8* ${actual}, null`);
  const rightNull = ctx.nextTemp();
  ctx.emit(`${rightNull} = icmp eq i8* ${expected}, null`);
  const eitherNull = ctx.nextTemp();
  ctx.emit(`${eitherNull} = or i1 ${leftNull}, ${rightNull}`);

  const nullCheckLabel = ctx.nextLabel('assert_null_check');
  const strcmpLabel = ctx.nextLabel('assert_strcmp');
  const cmpDoneLabel = ctx.nextLabel('assert_cmp_done');

  ctx.emit(`br i1 ${eitherNull}, label %${nullCheckLabel}, label %${strcmpLabel}`);

  ctx.emit(`${nullCheckLabel}:`);
  ctx.setCurrentLabel(nullCheckLabel);
  const bothNull = ctx.nextTemp();
  ctx.emit(`${bothNull} = and i1 ${leftNull}, ${rightNull}`);
  const nullCmp = expectEqual ? bothNull : ctx.nextTemp();
  if (!expectEqual) {
    ctx.emit(`${nullCmp} = xor i1 ${bothNull}, 1`);
  }
  ctx.emit(`br label %${cmpDoneLabel}`);

  ctx.emit(`${strcmpLabel}:`);
  ctx.setCurrentLabel(strcmpLabel);
  const strcmpResult = ctx.nextTemp();
  ctx.emit(`${strcmpResult} = call i32 @strcmp(i8* ${actual}, i8* ${expected})`);
  const strCmp = ctx.nextTemp();
  if (expectEqual) {
    ctx.emit(`${strCmp} = icmp eq i32 ${strcmpResult}, 0`);
  } else {
    ctx.emit(`${strCmp} = icmp ne i32 ${strcmpResult}, 0`);
  }
  ctx.emit(`br label %${cmpDoneLabel}`);

  ctx.emit(`${cmpDoneLabel}:`);
  ctx.setCurrentLabel(cmpDoneLabel);
  const cmpResult = ctx.nextTemp();
  ctx.emit(`${cmpResult} = phi i1 [ ${nullCmp}, %${nullCheckLabel} ], [ ${strCmp}, %${strcmpLabel} ]`);

  const passLabel = ctx.nextLabel('assert_pass');
  const failLabel = ctx.nextLabel('assert_fail');
  const mergeLabel = ctx.nextLabel('assert_merge');

  ctx.emit(`br i1 ${cmpResult}, label %${passLabel}, label %${failLabel}`);

  ctx.emit(`${failLabel}:`);
  ctx.setCurrentLabel(failLabel);
  setCurrentFailed(ctx);
  const safeActual = ctx.nextTemp();
  ctx.emit(`${safeActual} = call i8* @__safe_string(i8* ${actual})`);
  const safeExpected = ctx.nextTemp();
  ctx.emit(`${safeExpected} = call i8* @__safe_string(i8* ${expected})`);
  emitStderrPrint(ctx, 'i8* getelementptr([25 x i8], [25 x i8]* @.str.assert_eq_str, i32 0, i32 0)', `, i8* ${safeExpected}, i8* ${safeActual}`);
  ctx.emit(`br label %${mergeLabel}`);

  ctx.emit(`${passLabel}:`);
  ctx.setCurrentLabel(passLabel);
  ctx.emit(`br label %${mergeLabel}`);

  ctx.emit(`${mergeLabel}:`);
  ctx.setCurrentLabel(mergeLabel);

  return '0';
}

export function handleAssertOk(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  if (expr.args.length < 1) {
    return ctx.emitError('assert.ok() requires 1 argument (value)', expr.loc);
  }

  const isString = ctx.isStringExpression(expr.args[0]);
  const value = ctx.generateExpression(expr.args[0], params);

  let cmp: string;
  if (isString) {
    const isNull = ctx.nextTemp();
    ctx.emit(`${isNull} = icmp eq i8* ${value}, null`);
    const notNullLabel = ctx.nextLabel('assert_ok_notnull');
    const isNullLabel = ctx.nextLabel('assert_ok_null');
    const checkDoneLabel = ctx.nextLabel('assert_ok_checkdone');

    ctx.emit(`br i1 ${isNull}, label %${isNullLabel}, label %${notNullLabel}`);

    ctx.emit(`${isNullLabel}:`);
    ctx.setCurrentLabel(isNullLabel);
    ctx.emit(`br label %${checkDoneLabel}`);

    ctx.emit(`${notNullLabel}:`);
    ctx.setCurrentLabel(notNullLabel);
    const firstBytePtr = ctx.nextTemp();
    ctx.emit(`${firstBytePtr} = getelementptr i8, i8* ${value}, i64 0`);
    const firstByte = ctx.nextTemp();
    ctx.emit(`${firstByte} = load i8, i8* ${firstBytePtr}`);
    const notEmpty = ctx.nextTemp();
    ctx.emit(`${notEmpty} = icmp ne i8 ${firstByte}, 0`);
    ctx.emit(`br label %${checkDoneLabel}`);

    ctx.emit(`${checkDoneLabel}:`);
    ctx.setCurrentLabel(checkDoneLabel);
    cmp = ctx.nextTemp();
    ctx.emit(`${cmp} = phi i1 [ 0, %${isNullLabel} ], [ ${notEmpty}, %${notNullLabel} ]`);
  } else {
    cmp = ctx.nextTemp();
    ctx.emit(`${cmp} = fcmp one double ${value}, 0.0`);
  }

  const passLabel = ctx.nextLabel('assert_pass');
  const failLabel = ctx.nextLabel('assert_fail');
  const mergeLabel = ctx.nextLabel('assert_merge');

  ctx.emit(`br i1 ${cmp}, label %${passLabel}, label %${failLabel}`);

  ctx.emit(`${failLabel}:`);
  ctx.setCurrentLabel(failLabel);
  setCurrentFailed(ctx);
  emitStderrPrint(ctx, 'i8* getelementptr([20 x i8], [20 x i8]* @.str.assert_falsy, i32 0, i32 0)', '');
  ctx.emit(`br label %${mergeLabel}`);

  ctx.emit(`${passLabel}:`);
  ctx.setCurrentLabel(passLabel);
  ctx.emit(`br label %${mergeLabel}`);

  ctx.emit(`${mergeLabel}:`);
  ctx.setCurrentLabel(mergeLabel);

  return '0';
}

export function handleAssertFail(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  setCurrentFailed(ctx);

  if (expr.args.length > 0) {
    const msg = ctx.generateExpression(expr.args[0], params);
    emitStderrPrint(ctx, 'i8* getelementptr([8 x i8], [8 x i8]* @.str.assert_fail_msg, i32 0, i32 0)', `, i8* ${msg}`);
  }

  return '0';
}
