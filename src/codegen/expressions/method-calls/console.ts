import { Expression, MethodCallNode } from '../../../ast/types.js';
import type { MethodCallGeneratorContext } from '../method-calls.js';

function emitPrint(ctx: MethodCallGeneratorContext, useStderr: boolean, fmtRef: string, args: string): string {
  if (useStderr) {
    const stderrPtr = ctx.nextTemp();
    ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
    const temp = ctx.nextTemp();
    ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, ${fmtRef}${args})`);
    const flushTemp = ctx.nextTemp();
    ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
    return temp;
  } else {
    const temp = ctx.nextTemp();
    ctx.emit(`${temp} = call i32 (i8*, ...) @printf(${fmtRef}${args})`);
    return temp;
  }
}

function emitPrintStr(ctx: MethodCallGeneratorContext, useStderr: boolean, value: string): string {
  return emitPrint(ctx, useStderr, `i8* getelementptr([4 x i8], [4 x i8]* @.str.strfmt, i32 0, i32 0)`, `, i8* ${value}`);
}

function emitPrintStrNoNl(ctx: MethodCallGeneratorContext, useStderr: boolean, value: string): string {
  return emitPrint(ctx, useStderr, `i8* getelementptr([3 x i8], [3 x i8]* @.str.strfmt_no_nl, i32 0, i32 0)`, `, i8* ${value}`);
}

function emitPrintNumNoNl(ctx: MethodCallGeneratorContext, useStderr: boolean, value: string): string {
  return emitPrint(ctx, useStderr, `i8* getelementptr([6 x i8], [6 x i8]* @.str.numfmt_no_nl, i32 0, i32 0)`, `, double ${value}`);
}

function emitArrayPrint(ctx: MethodCallGeneratorContext, useStderr: boolean, arrayPtr: string, arrayType: 'Array' | 'StringArray' | 'ObjectArray'): string {
  const lenPtr = ctx.nextTemp();
  ctx.emit(`${lenPtr} = getelementptr inbounds %${arrayType}, %${arrayType}* ${arrayPtr}, i32 0, i32 1`);
  const len = ctx.nextTemp();
  ctx.emit(`${len} = load i32, i32* ${lenPtr}`);

  const openBracket = ctx.stringGenCreateStringConstant('[ ');
  const closeBracket = ctx.stringGenCreateStringConstant(' ]\n');
  const separator = ctx.stringGenCreateStringConstant(', ');
  const emptyArray = ctx.stringGenCreateStringConstant('[]\n');

  const isEmpty = ctx.nextTemp();
  ctx.emit(`${isEmpty} = icmp eq i32 ${len}, 0`);

  const emptyLabel = ctx.nextLabel('arr_empty');
  const nonEmptyLabel = ctx.nextLabel('arr_nonempty');
  const loopLabel = ctx.nextLabel('arr_loop');
  const loopBodyLabel = ctx.nextLabel('arr_body');
  const sepLabel = ctx.nextLabel('arr_sep');
  const loopLatchLabel = ctx.nextLabel('arr_latch');
  const endLabel = ctx.nextLabel('arr_end');
  const doneLabel = ctx.nextLabel('arr_done');

  ctx.emit(`br i1 ${isEmpty}, label %${emptyLabel}, label %${nonEmptyLabel}`);

  ctx.emit(`${emptyLabel}:`);
  emitPrintStrNoNl(ctx, useStderr, emptyArray);
  ctx.emit(`br label %${doneLabel}`);

  ctx.emit(`${nonEmptyLabel}:`);
  let dataPtr: string;
  if (arrayType === 'Array') {
    const dataPtrField = ctx.nextTemp();
    ctx.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    dataPtr = ctx.nextTemp();
    ctx.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);
  } else if (arrayType === 'StringArray') {
    const dataPtrField = ctx.nextTemp();
    ctx.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    dataPtr = ctx.nextTemp();
    ctx.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);
  } else {
    const dataPtrField = ctx.nextTemp();
    ctx.emit(`${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`);
    const rawData = ctx.nextTemp();
    ctx.emit(`${rawData} = load i8*, i8** ${dataPtrField}`);
    dataPtr = ctx.nextTemp();
    ctx.emit(`${dataPtr} = bitcast i8* ${rawData} to i8**`);
  }
  emitPrintStrNoNl(ctx, useStderr, openBracket);
  const iAlloca = ctx.nextTemp();
  ctx.emit(`${iAlloca} = alloca i32`);
  ctx.emit(`store i32 0, i32* ${iAlloca}`);
  ctx.emit(`br label %${loopLabel}`);

  ctx.emit(`${loopLabel}:`);
  const i = ctx.nextTemp();
  ctx.emit(`${i} = load i32, i32* ${iAlloca}`);
  const isFirst = ctx.nextTemp();
  ctx.emit(`${isFirst} = icmp eq i32 ${i}, 0`);
  ctx.emit(`br i1 ${isFirst}, label %${loopBodyLabel}, label %${sepLabel}`);

  ctx.emit(`${sepLabel}:`);
  emitPrintStrNoNl(ctx, useStderr, separator);
  ctx.emit(`br label %${loopBodyLabel}`);

  ctx.emit(`${loopBodyLabel}:`);
  if (arrayType === 'Array') {
    const elemPtr = ctx.nextTemp();
    ctx.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${i}`);
    const elem = ctx.nextTemp();
    ctx.emit(`${elem} = load double, double* ${elemPtr}`);
    emitPrintNumNoNl(ctx, useStderr, elem);
  } else if (arrayType === 'StringArray') {
    const elemPtr = ctx.nextTemp();
    ctx.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
    const elem = ctx.nextTemp();
    ctx.emit(`${elem} = load i8*, i8** ${elemPtr}`);
    emitPrintStrNoNl(ctx, useStderr, elem);
  } else {
    const objStr = ctx.stringGenCreateStringConstant('[object Object]');
    emitPrintStrNoNl(ctx, useStderr, objStr);
  }

  ctx.emit(`br label %${loopLatchLabel}`);

  ctx.emit(`${loopLatchLabel}:`);
  const iCurrent = ctx.nextTemp();
  ctx.emit(`${iCurrent} = load i32, i32* ${iAlloca}`);
  const iNext = ctx.nextTemp();
  ctx.emit(`${iNext} = add i32 ${iCurrent}, 1`);
  ctx.emit(`store i32 ${iNext}, i32* ${iAlloca}`);
  const done = ctx.nextTemp();
  ctx.emit(`${done} = icmp eq i32 ${iNext}, ${len}`);
  ctx.emit(`br i1 ${done}, label %${endLabel}, label %${loopLabel}`);

  ctx.emit(`${endLabel}:`);
  emitPrintStrNoNl(ctx, useStderr, closeBracket);
  ctx.emit(`br label %${doneLabel}`);

  ctx.emit(`${doneLabel}:`);

  return '0';
}

export function generateConsoleCallInline(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
  const method = expr.method;
  const useStderr = method === 'error' || method === 'warn';

  if (expr.args.length === 0) {
    if (useStderr) {
      const stderrPtr = ctx.nextTemp();
      ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
      const temp = ctx.nextTemp();
      ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* getelementptr([2 x i8], [2 x i8]* @.str.newline, i32 0, i32 0))`);
      const flushTemp = ctx.nextTemp();
      ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
      return temp;
    } else {
      const temp = ctx.nextTemp();
      ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* getelementptr([2 x i8], [2 x i8]* @.str.newline, i32 0, i32 0))`);
      return temp;
    }
  }

  const arg = expr.args[0];
  const argTyped = arg as { type: string; value: string | number };

  if (argTyped.type === 'string') {
    const strValue = argTyped.value as string;
    const strConstPtr = ctx.stringGenCreateStringConstant(strValue + '\n');
    if (useStderr) {
      const stderrPtr = ctx.nextTemp();
      ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
      const temp = ctx.nextTemp();
      ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* ${strConstPtr})`);
      const flushTemp = ctx.nextTemp();
      ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
      return temp;
    } else {
      const temp = ctx.nextTemp();
      ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* ${strConstPtr})`);
      return temp;
    }
  } else if (argTyped.type === 'number') {
    const argValue = ctx.generateExpression(arg as Expression, params);
    if (useStderr) {
      const stderrPtr = ctx.nextTemp();
      ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
      const temp = ctx.nextTemp();
      ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* getelementptr([7 x i8], [7 x i8]* @.str.numfmt, i32 0, i32 0), double ${argValue})`);
      const flushTemp = ctx.nextTemp();
      ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
      return temp;
    } else {
      const temp = ctx.nextTemp();
      ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* getelementptr([7 x i8], [7 x i8]* @.str.numfmt, i32 0, i32 0), double ${argValue})`);
      return temp;
    }
  } else {
    const argValue = ctx.generateExpression(arg as Expression, params);
    const isString = ctx.isStringExpression(arg as Expression);
    if (isString) {
      return emitPrintStr(ctx, useStderr, argValue);
    }

    const isArray = ctx.isArrayExpression(arg as Expression);
    if (isArray) {
      return emitArrayPrint(ctx, useStderr, argValue, 'Array');
    }

    const isStringArray = ctx.isStringArrayExpression(arg as Expression);
    if (isStringArray) {
      return emitArrayPrint(ctx, useStderr, argValue, 'StringArray');
    }

    const isObjectArray = ctx.isObjectArrayExpression(arg as Expression);
    if (isObjectArray) {
      return emitArrayPrint(ctx, useStderr, argValue, 'ObjectArray');
    }

    const varType = ctx.getVariableType(argValue);
    if (varType && varType.endsWith('*') && varType !== 'i8*') {
      const objStr = ctx.stringGenCreateStringConstant('[object Object]\n');
      return emitPrintStrNoNl(ctx, useStderr, objStr);
    }

    if (useStderr) {
      const stderrPtr = ctx.nextTemp();
      ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
      const temp = ctx.nextTemp();
      ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* getelementptr([7 x i8], [7 x i8]* @.str.numfmt, i32 0, i32 0), double ${argValue})`);
      const flushTemp = ctx.nextTemp();
      ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
      return temp;
    } else {
      const temp = ctx.nextTemp();
      ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* getelementptr([7 x i8], [7 x i8]* @.str.numfmt, i32 0, i32 0), double ${argValue})`);
      return temp;
    }
  }
}
