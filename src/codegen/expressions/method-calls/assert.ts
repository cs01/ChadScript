import { Expression, MethodCallNode } from "../../../ast/types.js";
import type { MethodCallGeneratorContext } from "../method-calls.js";

function emitIndentation(ctx: MethodCallGeneratorContext): void {
  const depth = ctx.emitLoad("i32", "@__describe_depth");
  const hasDepth = ctx.emitIcmp("sgt", "i32", depth, "0");
  const preLabel = ctx.nextLabel("assert_indent_pre");
  const loopLabel = ctx.nextLabel("assert_indent_loop");
  const bodyLabel = ctx.nextLabel("assert_indent_body");
  const doneLabel = ctx.nextLabel("assert_indent_done");
  ctx.emitBrCond(hasDepth, preLabel, doneLabel);

  ctx.emitLabel(preLabel);
  ctx.setCurrentLabel(preLabel);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  ctx.setCurrentLabel(loopLabel);
  const idx = `%__aindent_idx_${loopLabel}`;
  const nextIdx = `%__aindent_next_${loopLabel}`;
  ctx.emit(`${idx} = phi i32 [ 0, %${preLabel} ], [ ${nextIdx}, %${bodyLabel} ]`);
  const cmp = ctx.emitIcmp("slt", "i32", idx, depth);
  ctx.emitBrCond(cmp, bodyLabel, doneLabel);

  ctx.emitLabel(bodyLabel);
  ctx.setCurrentLabel(bodyLabel);
  const stderrPtr = ctx.emitLoad("i8*", "@stderr");
  const fmt = ctx.nextTemp();
  ctx.emit(`${fmt} = getelementptr [3 x i8], [3 x i8]* @.str.indent_unit, i32 0, i32 0`);
  const printResult = ctx.nextTemp();
  ctx.emit(`${printResult} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* ${fmt})`);
  ctx.emit(`${nextIdx} = add i32 ${idx}, 1`);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(doneLabel);
  ctx.setCurrentLabel(doneLabel);
}

function emitStderrPrint(ctx: MethodCallGeneratorContext, fmtRef: string, args: string): void {
  emitIndentation(ctx);
  const stderrPtr = ctx.emitLoad("i8*", "@stderr");
  const tmp = ctx.nextTemp();
  ctx.emit(`${tmp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, ${fmtRef}${args})`);
}

function setCurrentFailed(ctx: MethodCallGeneratorContext): void {
  ctx.emitStore("i1", "1", "@__test_current_failed");
}

export function handleAssertStrictEqual(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length < 2) {
    return ctx.emitError("assert.strictEqual() requires 2 arguments (actual, expected)", expr.loc);
  }

  const isString = ctx.isStringExpression(expr.args[0]) || ctx.isStringExpression(expr.args[1]);

  if (isString) {
    return handleStringEquality(ctx, expr, params, true);
  } else {
    return handleNumberEquality(ctx, expr, params, true);
  }
}

export function handleAssertNotStrictEqual(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length < 2) {
    return ctx.emitError(
      "assert.notStrictEqual() requires 2 arguments (actual, expected)",
      expr.loc,
    );
  }

  const isString = ctx.isStringExpression(expr.args[0]) || ctx.isStringExpression(expr.args[1]);

  if (isString) {
    return handleStringEquality(ctx, expr, params, false);
  } else {
    return handleNumberEquality(ctx, expr, params, false);
  }
}

function handleNumberEquality(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
  expectEqual: boolean,
): string {
  const actual = ctx.generateExpression(expr.args[0], params);
  const expected = ctx.generateExpression(expr.args[1], params);
  const dblActual = ctx.ensureDouble(actual);
  const dblExpected = ctx.ensureDouble(expected);

  const cmp = ctx.nextTemp();
  if (expectEqual) {
    ctx.emit(`${cmp} = fcmp oeq double ${dblActual}, ${dblExpected}`);
  } else {
    ctx.emit(`${cmp} = fcmp one double ${dblActual}, ${dblExpected}`);
  }

  const passLabel = ctx.nextLabel("assert_pass");
  const failLabel = ctx.nextLabel("assert_fail");
  const mergeLabel = ctx.nextLabel("assert_merge");

  ctx.emitBrCond(cmp, passLabel, failLabel);

  ctx.emitLabel(failLabel);
  ctx.setCurrentLabel(failLabel);
  setCurrentFailed(ctx);
  emitStderrPrint(
    ctx,
    "i8* getelementptr([31 x i8], [31 x i8]* @.str.assert_eq_num, i32 0, i32 0)",
    `, double ${dblExpected}, double ${dblActual}`,
  );
  ctx.emitBr(mergeLabel);

  ctx.emitLabel(passLabel);
  ctx.setCurrentLabel(passLabel);
  ctx.emitBr(mergeLabel);

  ctx.emitLabel(mergeLabel);
  ctx.setCurrentLabel(mergeLabel);

  return "0";
}

function handleStringEquality(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
  expectEqual: boolean,
): string {
  const actual = ctx.generateExpression(expr.args[0], params);
  const expected = ctx.generateExpression(expr.args[1], params);

  const leftNull = ctx.emitIcmp("eq", "i8*", actual, "null");
  const rightNull = ctx.emitIcmp("eq", "i8*", expected, "null");
  const eitherNull = ctx.nextTemp();
  ctx.emit(`${eitherNull} = or i1 ${leftNull}, ${rightNull}`);

  const nullCheckLabel = ctx.nextLabel("assert_null_check");
  const strcmpLabel = ctx.nextLabel("assert_strcmp");
  const cmpDoneLabel = ctx.nextLabel("assert_cmp_done");

  ctx.emitBrCond(eitherNull, nullCheckLabel, strcmpLabel);

  ctx.emitLabel(nullCheckLabel);
  ctx.setCurrentLabel(nullCheckLabel);
  const bothNull = ctx.nextTemp();
  ctx.emit(`${bothNull} = and i1 ${leftNull}, ${rightNull}`);
  const nullCmp = expectEqual ? bothNull : ctx.nextTemp();
  if (!expectEqual) {
    ctx.emit(`${nullCmp} = xor i1 ${bothNull}, 1`);
  }
  ctx.emitBr(cmpDoneLabel);

  ctx.emitLabel(strcmpLabel);
  ctx.setCurrentLabel(strcmpLabel);
  const strcmpResult = ctx.emitCall("i32", "@strcmp", `i8* ${actual}, i8* ${expected}`);
  const strCmp = expectEqual
    ? ctx.emitIcmp("eq", "i32", strcmpResult, "0")
    : ctx.emitIcmp("ne", "i32", strcmpResult, "0");
  ctx.emitBr(cmpDoneLabel);

  ctx.emitLabel(cmpDoneLabel);
  ctx.setCurrentLabel(cmpDoneLabel);
  const cmpResult = ctx.nextTemp();
  ctx.emit(
    `${cmpResult} = phi i1 [ ${nullCmp}, %${nullCheckLabel} ], [ ${strCmp}, %${strcmpLabel} ]`,
  );

  const passLabel = ctx.nextLabel("assert_pass");
  const failLabel = ctx.nextLabel("assert_fail");
  const mergeLabel = ctx.nextLabel("assert_merge");

  ctx.emitBrCond(cmpResult, passLabel, failLabel);

  ctx.emitLabel(failLabel);
  ctx.setCurrentLabel(failLabel);
  setCurrentFailed(ctx);
  const safeActual = ctx.emitCall("i8*", "@__safe_string", `i8* ${actual}`);
  const safeExpected = ctx.emitCall("i8*", "@__safe_string", `i8* ${expected}`);
  emitStderrPrint(
    ctx,
    "i8* getelementptr([25 x i8], [25 x i8]* @.str.assert_eq_str, i32 0, i32 0)",
    `, i8* ${safeExpected}, i8* ${safeActual}`,
  );
  ctx.emitBr(mergeLabel);

  ctx.emitLabel(passLabel);
  ctx.setCurrentLabel(passLabel);
  ctx.emitBr(mergeLabel);

  ctx.emitLabel(mergeLabel);
  ctx.setCurrentLabel(mergeLabel);

  return "0";
}

export function handleAssertOk(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length < 1) {
    return ctx.emitError("assert.ok() requires 1 argument (value)", expr.loc);
  }

  const isString = ctx.isStringExpression(expr.args[0]);
  const value = ctx.generateExpression(expr.args[0], params);

  let cmp: string;
  if (isString) {
    const isNull = ctx.emitIcmp("eq", "i8*", value, "null");
    const notNullLabel = ctx.nextLabel("assert_ok_notnull");
    const isNullLabel = ctx.nextLabel("assert_ok_null");
    const checkDoneLabel = ctx.nextLabel("assert_ok_checkdone");

    ctx.emitBrCond(isNull, isNullLabel, notNullLabel);

    ctx.emitLabel(isNullLabel);
    ctx.setCurrentLabel(isNullLabel);
    ctx.emitBr(checkDoneLabel);

    ctx.emitLabel(notNullLabel);
    ctx.setCurrentLabel(notNullLabel);
    const firstBytePtr = ctx.emitGep("i8", `${value}`, "i64 0");
    const firstByte = ctx.emitLoad("i8", firstBytePtr);
    const notEmpty = ctx.emitIcmp("ne", "i8", firstByte, "0");
    ctx.emitBr(checkDoneLabel);

    ctx.emitLabel(checkDoneLabel);
    ctx.setCurrentLabel(checkDoneLabel);
    cmp = ctx.nextTemp();
    ctx.emit(`${cmp} = phi i1 [ 0, %${isNullLabel} ], [ ${notEmpty}, %${notNullLabel} ]`);
  } else {
    const dblValue = ctx.ensureDouble(value);
    cmp = ctx.nextTemp();
    ctx.emit(`${cmp} = fcmp one double ${dblValue}, 0.0`);
  }

  const passLabel = ctx.nextLabel("assert_pass");
  const failLabel = ctx.nextLabel("assert_fail");
  const mergeLabel = ctx.nextLabel("assert_merge");

  ctx.emitBrCond(cmp, passLabel, failLabel);

  ctx.emitLabel(failLabel);
  ctx.setCurrentLabel(failLabel);
  setCurrentFailed(ctx);
  emitStderrPrint(
    ctx,
    "i8* getelementptr([20 x i8], [20 x i8]* @.str.assert_falsy, i32 0, i32 0)",
    "",
  );
  ctx.emitBr(mergeLabel);

  ctx.emitLabel(passLabel);
  ctx.setCurrentLabel(passLabel);
  ctx.emitBr(mergeLabel);

  ctx.emitLabel(mergeLabel);
  ctx.setCurrentLabel(mergeLabel);

  return "0";
}

export function handleAssertDeepEqual(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length < 2) {
    return ctx.emitError("assert.deepEqual() requires 2 arguments (actual, expected)", expr.loc);
  }

  if (ctx.isStringArrayExpression(expr.args[0]) || ctx.isStringArrayExpression(expr.args[1])) {
    return emitArrayDeepEqualString(ctx, expr, params);
  } else if (ctx.isArrayExpression(expr.args[0]) || ctx.isArrayExpression(expr.args[1])) {
    return emitArrayDeepEqualNumber(ctx, expr, params);
  }

  return ctx.emitError("assert.deepEqual() currently only supports arrays", expr.loc);
}

function emitArrayDeepEqualNumber(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  const actual = ctx.generateExpression(expr.args[0], params);
  const expected = ctx.generateExpression(expr.args[1], params);

  const actualLenPtr = ctx.emitGep("%Array", `${actual}`, "i32 0, i32 1");
  const actualLen = ctx.emitLoad("i32", actualLenPtr);

  const expectedLenPtr = ctx.emitGep("%Array", `${expected}`, "i32 0, i32 1");
  const expectedLen = ctx.emitLoad("i32", expectedLenPtr);

  const lenCmp = ctx.emitIcmp("eq", "i32", actualLen, expectedLen);

  const lenMatchLabel = ctx.nextLabel("deep_len_match");
  const lenFailLabel = ctx.nextLabel("deep_len_fail");
  const doneLabel = ctx.nextLabel("deep_done");

  ctx.emitBrCond(lenCmp, lenMatchLabel, lenFailLabel);

  ctx.emitLabel(lenFailLabel);
  ctx.setCurrentLabel(lenFailLabel);
  setCurrentFailed(ctx);
  emitStderrPrint(
    ctx,
    "i8* getelementptr([39 x i8], [39 x i8]* @.str.assert_deep_len, i32 0, i32 0)",
    `, i32 ${expectedLen}, i32 ${actualLen}`,
  );
  ctx.emitBr(doneLabel);

  ctx.emitLabel(lenMatchLabel);
  ctx.setCurrentLabel(lenMatchLabel);

  const actualDataPtr = ctx.emitGep("%Array", `${actual}`, "i32 0, i32 0");
  const actualData = ctx.emitLoad("double*", actualDataPtr);

  const expectedDataPtr = ctx.emitGep("%Array", `${expected}`, "i32 0, i32 0");
  const expectedData = ctx.emitLoad("double*", expectedDataPtr);

  const loopHeader = ctx.nextLabel("deep_loop");
  const loopBody = ctx.nextLabel("deep_body");
  const loopMatch = ctx.nextLabel("deep_match");
  const loopMismatch = ctx.nextLabel("deep_mismatch");
  const loopEnd = ctx.nextLabel("deep_loop_end");

  ctx.emitBr(loopHeader);

  ctx.emitLabel(loopHeader);
  ctx.setCurrentLabel(loopHeader);
  const idx = `%__deep_idx_${loopHeader}`;
  const nextIdx = `%__deep_next_${loopHeader}`;
  ctx.emit(`${idx} = phi i32 [ 0, %${lenMatchLabel} ], [ ${nextIdx}, %${loopMatch} ]`);
  const idxCmp = ctx.emitIcmp("slt", "i32", idx, actualLen);
  ctx.emitBrCond(idxCmp, loopBody, loopEnd);

  ctx.emitLabel(loopBody);
  ctx.setCurrentLabel(loopBody);
  const actualElemPtr = ctx.emitGep("double", `${actualData}`, `i32 ${idx}`);
  const actualElem = ctx.emitLoad("double", actualElemPtr);
  const expectedElemPtr = ctx.emitGep("double", `${expectedData}`, `i32 ${idx}`);
  const expectedElem = ctx.emitLoad("double", expectedElemPtr);
  const elemCmp = ctx.nextTemp();
  ctx.emit(`${elemCmp} = fcmp oeq double ${actualElem}, ${expectedElem}`);
  ctx.emitBrCond(elemCmp, loopMatch, loopMismatch);

  ctx.emitLabel(loopMatch);
  ctx.setCurrentLabel(loopMatch);
  ctx.emit(`${nextIdx} = add i32 ${idx}, 1`);
  ctx.emitBr(loopHeader);

  ctx.emitLabel(loopMismatch);
  ctx.setCurrentLabel(loopMismatch);
  setCurrentFailed(ctx);
  emitStderrPrint(
    ctx,
    "i8* getelementptr([31 x i8], [31 x i8]* @.str.assert_deep_idx, i32 0, i32 0)",
    `, i32 ${idx}`,
  );
  ctx.emitBr(doneLabel);

  ctx.emitLabel(loopEnd);
  ctx.setCurrentLabel(loopEnd);
  ctx.emitBr(doneLabel);

  ctx.emitLabel(doneLabel);
  ctx.setCurrentLabel(doneLabel);

  return "0";
}

function emitArrayDeepEqualString(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  const actual = ctx.generateExpression(expr.args[0], params);
  const expected = ctx.generateExpression(expr.args[1], params);

  const actualLenPtr = ctx.emitGep("%StringArray", `${actual}`, "i32 0, i32 1");
  const actualLen = ctx.emitLoad("i32", actualLenPtr);

  const expectedLenPtr = ctx.emitGep("%StringArray", `${expected}`, "i32 0, i32 1");
  const expectedLen = ctx.emitLoad("i32", expectedLenPtr);

  const lenCmp = ctx.emitIcmp("eq", "i32", actualLen, expectedLen);

  const lenMatchLabel = ctx.nextLabel("deep_len_match");
  const lenFailLabel = ctx.nextLabel("deep_len_fail");
  const doneLabel = ctx.nextLabel("deep_done");

  ctx.emitBrCond(lenCmp, lenMatchLabel, lenFailLabel);

  ctx.emitLabel(lenFailLabel);
  ctx.setCurrentLabel(lenFailLabel);
  setCurrentFailed(ctx);
  emitStderrPrint(
    ctx,
    "i8* getelementptr([39 x i8], [39 x i8]* @.str.assert_deep_len, i32 0, i32 0)",
    `, i32 ${expectedLen}, i32 ${actualLen}`,
  );
  ctx.emitBr(doneLabel);

  ctx.emitLabel(lenMatchLabel);
  ctx.setCurrentLabel(lenMatchLabel);

  const actualDataPtr = ctx.emitGep("%StringArray", `${actual}`, "i32 0, i32 0");
  const actualData = ctx.emitLoad("i8**", actualDataPtr);

  const expectedDataPtr = ctx.emitGep("%StringArray", `${expected}`, "i32 0, i32 0");
  const expectedData = ctx.emitLoad("i8**", expectedDataPtr);

  const loopHeader = ctx.nextLabel("deep_loop");
  const loopBody = ctx.nextLabel("deep_body");
  const loopMatch = ctx.nextLabel("deep_match");
  const loopMismatch = ctx.nextLabel("deep_mismatch");
  const loopEnd = ctx.nextLabel("deep_loop_end");

  ctx.emitBr(loopHeader);

  ctx.emitLabel(loopHeader);
  ctx.setCurrentLabel(loopHeader);
  const idx = `%__deep_idx_${loopHeader}`;
  const nextIdx = `%__deep_next_${loopHeader}`;
  ctx.emit(`${idx} = phi i32 [ 0, %${lenMatchLabel} ], [ ${nextIdx}, %${loopMatch} ]`);
  const idxCmp = ctx.emitIcmp("slt", "i32", idx, actualLen);
  ctx.emitBrCond(idxCmp, loopBody, loopEnd);

  ctx.emitLabel(loopBody);
  ctx.setCurrentLabel(loopBody);
  const actualElemPtr = ctx.emitGep("i8*", `${actualData}`, `i32 ${idx}`);
  const actualElem = ctx.emitLoad("i8*", actualElemPtr);
  const expectedElemPtr = ctx.emitGep("i8*", `${expectedData}`, `i32 ${idx}`);
  const expectedElem = ctx.emitLoad("i8*", expectedElemPtr);
  const strcmpResult = ctx.emitCall("i32", "@strcmp", `i8* ${actualElem}, i8* ${expectedElem}`);
  const elemCmp = ctx.emitIcmp("eq", "i32", strcmpResult, "0");
  ctx.emitBrCond(elemCmp, loopMatch, loopMismatch);

  ctx.emitLabel(loopMatch);
  ctx.setCurrentLabel(loopMatch);
  ctx.emit(`${nextIdx} = add i32 ${idx}, 1`);
  ctx.emitBr(loopHeader);

  ctx.emitLabel(loopMismatch);
  ctx.setCurrentLabel(loopMismatch);
  setCurrentFailed(ctx);
  emitStderrPrint(
    ctx,
    "i8* getelementptr([31 x i8], [31 x i8]* @.str.assert_deep_idx, i32 0, i32 0)",
    `, i32 ${idx}`,
  );
  ctx.emitBr(doneLabel);

  ctx.emitLabel(loopEnd);
  ctx.setCurrentLabel(loopEnd);
  ctx.emitBr(doneLabel);

  ctx.emitLabel(doneLabel);
  ctx.setCurrentLabel(doneLabel);

  return "0";
}

export function handleAssertFail(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  setCurrentFailed(ctx);

  if (expr.args.length > 0) {
    const msg = ctx.generateExpression(expr.args[0], params);
    emitStderrPrint(
      ctx,
      "i8* getelementptr([8 x i8], [8 x i8]* @.str.assert_fail_msg, i32 0, i32 0)",
      `, i8* ${msg}`,
    );
  }

  return "0";
}
