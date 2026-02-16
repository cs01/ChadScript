import { Expression, MethodCallNode, MemberAccessNode, VariableNode, RegexNode } from '../../../ast/types.js';
import type { MethodCallGeneratorContext } from '../method-calls.js';

interface ExprBase { type: string; }

function convertToI32(ctx: MethodCallGeneratorContext, value: string): string {
  const vt = ctx.getVariableType(value);
  if (vt === 'i64') {
    const temp = ctx.nextTemp();
    ctx.emit(`${temp} = trunc i64 ${value} to i32`);
    return temp;
  }
  const dbl = ctx.ensureDouble(value);
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = fptosi double ${dbl} to i32`);
  return temp;
}

export function handleSubstr(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length < 1 || expr.args.length > 2) {
    return ctx.emitError(`substr() expects 1 or 2 arguments, got ${expr.args.length}`, expr.loc);
  }

  const startIndexDouble = ctx.generateExpression(expr.args[0], params);
  const startIndex = convertToI32(ctx, startIndexDouble);
  const length = expr.args.length === 2 ? convertToI32(ctx, ctx.generateExpression(expr.args[1], params)) : null;

  return ctx.stringGen.doGenerateSubstr(strPtr, startIndex, length);
}

export function handleSubstring(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length < 1 || expr.args.length > 2) {
    return ctx.emitError(`substring() expects 1 or 2 arguments, got ${expr.args.length}`, expr.loc);
  }

  const startIndexDouble = ctx.generateExpression(expr.args[0], params);
  const startIndex = convertToI32(ctx, startIndexDouble);

  let length: string | null = null;
  if (expr.args.length === 2) {
    const endIndexDouble = ctx.generateExpression(expr.args[1], params);
    const endIndex = convertToI32(ctx, endIndexDouble);
    length = ctx.nextTemp();
    ctx.emit(`${length} = sub i32 ${endIndex}, ${startIndex}`);
  }

  return ctx.stringGen.doGenerateSubstr(strPtr, startIndex, length);
}

export function handleConcat(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  const ptrType = ctx.getVariableType(strPtr);
  if (ptrType && (ptrType === '%Array*' || ptrType === '%StringArray*' || ptrType === '%ObjectArray*' || ptrType.endsWith('Array*'))) {
    const exprObjBase = expr.object as ExprBase;
    let details = `Expression type: ${exprObjBase.type}`;
    if (exprObjBase.type === 'member_access') {
      const memberExpr = expr.object as MemberAccessNode;
      const objBase = memberExpr.object as ExprBase;
      details += `, property: ${memberExpr.property}`;
      details += `, object base type: ${objBase.type}`;
      if (objBase.type === 'variable') {
        const varName = (memberExpr.object as VariableNode).name;
        const isClass = ctx.symbolTable.isClass(varName);
        const symbolType = ctx.symbolTable.getType(varName);
        const interfaceType = ctx.symbolTable.getInterfaceType(varName);
        details += `, variable: ${varName}, isClass: ${isClass}`;
        details += `, symbolType: ${symbolType}, interfaceType: ${interfaceType}`;
        if (isClass) {
          const className = ctx.symbolTable.getClassName(varName);
          details += `, className: ${className}`;
        }
      }
    }
    throw new Error(
      `concat() was dispatched to string handler but received an array type '${ptrType}'.\n` +
      `  This indicates isArrayExpression/isStringArrayExpression/isObjectArrayExpression failed to detect the array.\n` +
      `  ${details}\n` +
      `  Check type tracking for this expression.`
    );
  }

  if (expr.args.length < 1) {
    return ctx.emitError(`concat() expects at least 1 argument, got ${expr.args.length}`, expr.loc);
  }

  let result = strPtr;
  for (let _mci = 0; _mci < expr.args.length; _mci++) {
    const arg = expr.args[_mci];
    const argStr = ctx.generateExpression(arg, params);
    result = ctx.stringGen.doGenerateStringConcatDirect(result, argStr);
  }

  return result;
}

export function handleRepeat(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length !== 1) {
    return ctx.emitError(`repeat() expects 1 argument, got ${expr.args.length}`, expr.loc);
  }

  const countDouble = ctx.generateExpression(expr.args[0], params);
  const count = convertToI32(ctx, countDouble);
  return ctx.stringGen.doGenerateRepeat(strPtr, count);
}

export function handlePadStart(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length < 1 || expr.args.length > 2) {
    return ctx.emitError(`padStart() expects 1 or 2 arguments, got ${expr.args.length}`, expr.loc);
  }

  const targetLengthDouble = ctx.generateExpression(expr.args[0], params);
  const targetLength = convertToI32(ctx, targetLengthDouble);
  const padString = expr.args.length === 2
    ? ctx.generateExpression(expr.args[1], params)
    : ctx.stringGen.doCreateStringConstant(' ');

  return ctx.stringGen.doGeneratePadStart(strPtr, targetLength, padString);
}

export function handleSplit(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length !== 1) {
    return ctx.emitError(`split() expects 1 argument, got ${expr.args.length}`, expr.loc);
  }

  const delimiter = ctx.generateExpression(expr.args[0], params);
  return ctx.stringGen.doGenerateSplit(strPtr, delimiter);
}

export function handleStartsWith(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  let strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length < 1 || expr.args.length > 2) {
    return ctx.emitError(`startsWith() expects 1-2 arguments, got ${expr.args.length}`, expr.loc);
  }

  if (expr.args.length === 2) {
    const position = ctx.generateExpression(expr.args[1], params);
    const posI32 = convertToI32(ctx, position);
    const posI64 = ctx.nextTemp();
    ctx.emit(`${posI64} = sext i32 ${posI32} to i64`);
    const offsetPtr = ctx.nextTemp();
    ctx.emit(`${offsetPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${posI64}`);
    strPtr = offsetPtr;
  }

  const prefix = ctx.generateExpression(expr.args[0], params);
  return ctx.stringGen.doGenerateStartsWith(strPtr, prefix);
}

export function handleEndsWith(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length !== 1) {
    return ctx.emitError(`endsWith() expects 1 argument, got ${expr.args.length}`, expr.loc);
  }

  const suffix = ctx.generateExpression(expr.args[0], params);
  return ctx.stringGen.doGenerateEndsWith(strPtr, suffix);
}

export function handleTrim(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length !== 0) {
    return ctx.emitError(`trim() expects 0 arguments, got ${expr.args.length}`, expr.loc);
  }

  return ctx.stringGen.doGenerateTrim(strPtr);
}

export function handleTrimStart(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length !== 0) {
    return ctx.emitError(`trimStart() expects 0 arguments, got ${expr.args.length}`, expr.loc);
  }

  return ctx.stringGen.doGenerateTrimStart(strPtr);
}

export function handleTrimEnd(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length !== 0) {
    return ctx.emitError(`trimEnd() expects 0 arguments, got ${expr.args.length}`, expr.loc);
  }

  return ctx.stringGen.doGenerateTrimEnd(strPtr);
}

export function handleIndexOf(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length !== 1) {
    return ctx.emitError(`indexOf() expects 1 argument, got ${expr.args.length}`, expr.loc);
  }

  const substring = ctx.generateExpression(expr.args[0], params);
  return ctx.stringGen.doGenerateIndexOf(strPtr, substring);
}

export function handleLastIndexOf(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length !== 1) {
    return ctx.emitError(`lastIndexOf() expects 1 argument, got ${expr.args.length}`, expr.loc);
  }

  const substring = ctx.generateExpression(expr.args[0], params);
  return ctx.stringGen.doGenerateLastIndexOf(strPtr, substring);
}

export function handleStringArrayIndexOf(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const arrayPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length !== 1) {
    return ctx.emitError(`indexOf() expects 1 argument, got ${expr.args.length}`, expr.loc);
  }

  const searchValue = ctx.generateExpression(expr.args[0], params);

  const checkLabel = ctx.nextLabel('indexof_check');
  const bodyLabel = ctx.nextLabel('indexof_body');
  const foundLabel = ctx.nextLabel('indexof_found');
  const notfoundLabel = ctx.nextLabel('indexof_notfound');
  const endLabel = ctx.nextLabel('indexof_end');

  const arrIsNull = ctx.nextTemp();
  ctx.emit(`${arrIsNull} = icmp eq %StringArray* ${arrayPtr}, null`);
  ctx.emit(`br i1 ${arrIsNull}, label %${notfoundLabel}, label %${checkLabel}_arrvalid`);

  ctx.emit(`${checkLabel}_arrvalid:`);
  const lenPtr = ctx.nextTemp();
  ctx.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
  const length = ctx.nextTemp();
  ctx.emit(`${length} = load i32, i32* ${lenPtr}`);

  const dataPtrField = ctx.nextTemp();
  ctx.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = ctx.nextTemp();
  ctx.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

  const dataPtrIsNull = ctx.nextTemp();
  ctx.emit(`${dataPtrIsNull} = icmp eq i8** ${dataPtr}, null`);
  ctx.emit(`br i1 ${dataPtrIsNull}, label %${notfoundLabel}, label %${checkLabel}_start`);

  ctx.emit(`${checkLabel}_start:`);
  const counterPtr = ctx.nextTemp();
  ctx.emit(`${counterPtr} = alloca i32`);
  ctx.emit(`store i32 0, i32* ${counterPtr}`);

  ctx.emit(`br label %${checkLabel}`);

  ctx.emit(`${checkLabel}:`);
  const counter = ctx.nextTemp();
  ctx.emit(`${counter} = load i32, i32* ${counterPtr}`);
  const cond = ctx.nextTemp();
  ctx.emit(`${cond} = icmp slt i32 ${counter}, ${length}`);
  ctx.emit(`br i1 ${cond}, label %${bodyLabel}, label %${notfoundLabel}`);

  ctx.emit(`${bodyLabel}:`);
  const counter64 = ctx.nextTemp();
  ctx.emit(`${counter64} = sext i32 ${counter} to i64`);
  const elemPtr = ctx.nextTemp();
  ctx.emit(`${elemPtr} = getelementptr i8*, i8** ${dataPtr}, i64 ${counter64}`);
  const elem = ctx.nextTemp();
  ctx.emit(`${elem} = load i8*, i8** ${elemPtr}`);

  const elemIsNull = ctx.nextTemp();
  ctx.emit(`${elemIsNull} = icmp eq i8* ${elem}, null`);
  ctx.emit(`br i1 ${elemIsNull}, label %${checkLabel}_next, label %${checkLabel}_cmp`);

  ctx.emit(`${checkLabel}_cmp:`);
  const cmpResult = ctx.nextTemp();
  ctx.emit(`${cmpResult} = call i32 @strcmp(i8* ${elem}, i8* ${searchValue})`);
  const isMatch = ctx.nextTemp();
  ctx.emit(`${isMatch} = icmp eq i32 ${cmpResult}, 0`);
  ctx.emit(`br i1 ${isMatch}, label %${foundLabel}, label %${checkLabel}_next`);

  ctx.emit(`${checkLabel}_next:`);
  const nextCounter = ctx.nextTemp();
  ctx.emit(`${nextCounter} = add i32 ${counter}, 1`);
  ctx.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
  ctx.emit(`br label %${checkLabel}`);

  ctx.emit(`${foundLabel}:`);
  const foundIndex = ctx.nextTemp();
  ctx.emit(`${foundIndex} = load i32, i32* ${counterPtr}`);
  ctx.emit(`br label %${endLabel}`);

  ctx.emit(`${notfoundLabel}:`);
  ctx.emit(`br label %${endLabel}`);

  ctx.emit(`${endLabel}:`);
  const resultI32 = ctx.nextTemp();
  ctx.emit(`${resultI32} = phi i32 [ ${foundIndex}, %${foundLabel} ], [ -1, %${notfoundLabel} ]`);

  const result = ctx.nextTemp();
  ctx.emit(`${result} = sitofp i32 ${resultI32} to double`);
  ctx.setVariableType(result, 'double');
  return result;
}

export function handleStringArrayIncludes(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const indexResult = handleStringArrayIndexOf(ctx, expr, params);
  const cmp = ctx.nextTemp();
  ctx.emit(`${cmp} = fcmp oge double ${indexResult}, 0.0`);
  const cmpI32 = ctx.nextTemp();
  ctx.emit(`${cmpI32} = zext i1 ${cmp} to i32`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = sitofp i32 ${cmpI32} to double`);
  ctx.setVariableType(result, 'double');
  return result;
}

export function handleStringIncludes(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  const ptrType = ctx.getVariableType(strPtr);
  if (ptrType && (ptrType === '%Array*' || ptrType === '%StringArray*' || ptrType === '%ObjectArray*' || ptrType.endsWith('Array*'))) {
    throw new Error(
      `includes() was dispatched to string handler but received an array type '${ptrType}'.\n` +
      `  This indicates isArrayExpression/isStringArrayExpression failed to detect the array.\n` +
      `  Expression type: ${expr.object.type}\n` +
      `  Check type tracking for this expression.`
    );
  }

  if (!ptrType || ptrType === 'unknown') {
    const exprObjBase = expr.object as ExprBase;
    let details = `Expression type: ${exprObjBase.type}`;
    if (exprObjBase.type === 'variable') {
      details += `, variable: ${(expr.object as VariableNode).name}`;
    } else if (exprObjBase.type === 'method_call') {
      const mc = expr.object as MethodCallNode;
      details += `, method: ${mc.method}`;
    }
    throw new Error(
      `includes() called on expression with unknown type.\n` +
      `  Result register: ${strPtr}, type: ${ptrType || 'undefined'}\n` +
      `  ${details}\n` +
      `  If this is an array, isArrayExpression/isStringArrayExpression is not detecting it.\n` +
      `  Fix type tracking to ensure proper dispatch.`
    );
  }

  if (expr.args.length !== 1) {
    return ctx.emitError(`includes() expects 1 argument, got ${expr.args.length}`, expr.loc);
  }

  const substring = ctx.generateExpression(expr.args[0], params);
  return ctx.stringGen.doGenerateIncludes(strPtr, substring);
}

export function handleSlice(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  const ptrType = ctx.getVariableType(strPtr);
  if (ptrType && (ptrType === '%Array*' || ptrType === '%StringArray*' || ptrType === '%ObjectArray*' || ptrType.endsWith('Array*'))) {
    throw new Error(
      `slice() was dispatched to string handler but received an array type '${ptrType}'.\n` +
      `  This indicates isArrayExpression/isStringArrayExpression/isObjectArrayExpression failed to detect the array.\n` +
      `  Expression type: ${expr.object.type}\n` +
      `  Check type tracking for this expression.`
    );
  }

  if (!ptrType || ptrType === 'unknown') {
    const exprObjBase = expr.object as ExprBase;
    let details = `Expression type: ${exprObjBase.type}`;
    if (exprObjBase.type === 'variable') {
      details += `, variable: ${(expr.object as VariableNode).name}`;
    } else if (exprObjBase.type === 'method_call') {
      const mc = expr.object as MethodCallNode;
      details += `, method: ${mc.method}`;
    }
    throw new Error(
      `slice() called on expression with unknown type.\n` +
      `  Result register: ${strPtr}, type: ${ptrType || 'undefined'}\n` +
      `  ${details}\n` +
      `  If this is an array, isArrayExpression/isStringArrayExpression/isObjectArrayExpression is not detecting it.\n` +
      `  Fix type tracking to ensure proper dispatch.`
    );
  }

  if (expr.args.length > 2) {
    return ctx.emitError(`slice() expects 0-2 arguments, got ${expr.args.length}`, expr.loc);
  }

  let startDouble: string;
  if (expr.args.length >= 1) {
    startDouble = ctx.generateExpression(expr.args[0], params);
  } else {
    startDouble = '0.0';
  }
  const startI32 = convertToI32(ctx, startDouble);

  let endI32: string | null = null;
  if (expr.args.length === 2) {
    const endDouble = ctx.generateExpression(expr.args[1], params);
    endI32 = convertToI32(ctx, endDouble);
  }

  return ctx.stringGen.doGenerateSlice(strPtr, startI32, endI32);
}

export function handleReplace(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length !== 2) {
    return ctx.emitError(`replace() expects 2 arguments, got ${expr.args.length}`, expr.loc);
  }

  const searchArg = expr.args[0];
  const replaceArg = expr.args[1];

  if (searchArg.type === 'regex') {
    const regexNode = searchArg as { pattern: string; flags: string };
    const isGlobal = regexNode.flags.indexOf('g') !== -1;
    const searchStr = ctx.stringGen.doGenerateGlobalString(regexNode.pattern);
    const replaceStr = ctx.generateExpression(replaceArg, params);
    if (isGlobal) {
      return ctx.stringGen.doGenerateReplaceAll(strPtr, searchStr, replaceStr);
    } else {
      return ctx.stringGen.doGenerateReplace(strPtr, searchStr, replaceStr);
    }
  }

  const searchStr = ctx.generateExpression(searchArg, params);
  const replaceStr = ctx.generateExpression(replaceArg, params);
  return ctx.stringGen.doGenerateReplace(strPtr, searchStr, replaceStr);
}

export function handleReplaceAll(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length !== 2) {
    return ctx.emitError(`replaceAll() expects 2 arguments, got ${expr.args.length}`, expr.loc);
  }

  const searchStr = ctx.generateExpression(expr.args[0], params);
  const replaceStr = ctx.generateExpression(expr.args[1], params);
  return ctx.stringGen.doGenerateReplaceAll(strPtr, searchStr, replaceStr);
}

export function handleNumberIsFinite(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const value = ctx.generateExpression(expr.args[0], params);
  const dblValue = ctx.ensureDouble(value);
  const isOrdered = ctx.nextTemp();
  ctx.emit(`${isOrdered} = fcmp ord double ${dblValue}, 0.0`);
  const posInf = ctx.nextTemp();
  ctx.emit(`${posInf} = fcmp one double ${dblValue}, 0x7FF0000000000000`);
  const negInf = ctx.nextTemp();
  ctx.emit(`${negInf} = fcmp one double ${dblValue}, 0xFFF0000000000000`);
  const notInf = ctx.nextTemp();
  ctx.emit(`${notInf} = and i1 ${posInf}, ${negInf}`);
  const isFinite = ctx.nextTemp();
  ctx.emit(`${isFinite} = and i1 ${isOrdered}, ${notInf}`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = uitofp i1 ${isFinite} to double`);
  return result;
}

export function handleNumberIsNaN(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const value = ctx.generateExpression(expr.args[0], params);
  const dblValue = ctx.ensureDouble(value);
  const isNaN = ctx.nextTemp();
  ctx.emit(`${isNaN} = fcmp uno double ${dblValue}, ${dblValue}`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = uitofp i1 ${isNaN} to double`);
  return result;
}

export function handleNumberIsInteger(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const value = ctx.generateExpression(expr.args[0], params);
  const dblValue = ctx.ensureDouble(value);
  const truncated = ctx.nextTemp();
  ctx.emit(`${truncated} = call double @llvm.trunc.f64(double ${dblValue})`);
  const isInt = ctx.nextTemp();
  ctx.emit(`${isInt} = fcmp oeq double ${dblValue}, ${truncated}`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = uitofp i1 ${isInt} to double`);
  return result;
}

export function handleNumberToString(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const numValue = ctx.generateExpression(expr.object, params);
  return ctx.stringGen.doConvertNumberToString(numValue);
}

export function handleNumberToFixed(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  if (expr.args.length < 1) {
    return ctx.emitError('toFixed() requires 1 argument (digits)', expr.loc);
  }
  const numValue = ctx.generateExpression(expr.object, params);
  const precisionValue = ctx.generateExpression(expr.args[0], params);
  return ctx.stringGen.doConvertNumberToFixed(numValue, precisionValue);
}

export function handleCharAt(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length !== 1) {
    return ctx.emitError('charAt() expects 1 argument, got ' + expr.args.length, expr.loc);
  }

  const indexDouble = ctx.generateExpression(expr.args[0], params);
  const indexI32 = convertToI32(ctx, indexDouble);
  return ctx.stringGen.doGenerateCharAt(strPtr, indexI32);
}

export function handleCharCodeAt(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length !== 1) {
    return ctx.emitError('charCodeAt() expects 1 argument, got ' + expr.args.length, expr.loc);
  }

  const indexDouble = ctx.generateExpression(expr.args[0], params);
  const indexI32 = convertToI32(ctx, indexDouble);
  return ctx.stringGen.doGenerateCharCodeAt(strPtr, indexI32);
}

export function handleToUpperCase(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);
  return ctx.stringGen.doGenerateToUpperCase(strPtr);
}

export function handleToLowerCase(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);
  return ctx.stringGen.doGenerateToLowerCase(strPtr);
}

export function handleMatch(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const strPtr = ctx.generateExpression(expr.object, params);

  if (expr.args.length !== 1) {
    return ctx.emitError('match() expects 1 argument (a regex), got ' + expr.args.length, expr.loc);
  }

  const regexArg = expr.args[0];

  if (regexArg.type === 'regex') {
    const regexNode = regexArg as RegexNode;
    const pattern = regexNode.pattern;
    const flags = regexNode.flags || '';

    let numGroups = 0;
    for (let gi = 0; gi < pattern.length; gi++) {
      if (pattern[gi] === '(') {
        numGroups = numGroups + 1;
      }
    }

    const regexPtr = ctx.regexGen.generateRegexCompile(pattern, flags);
    return ctx.regexGen.generateRegexMatch(regexPtr, strPtr, numGroups);
  }

  const regexPtr = ctx.generateExpression(regexArg, params);
  return ctx.regexGen.generateRegexMatch(regexPtr, strPtr, 9);
}
