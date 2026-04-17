import {
  Expression,
  MethodCallNode,
  StringNode,
  VariableNode,
  BinaryNode,
  UnaryNode,
} from "../../../ast/types.js";
import type { MethodCallGeneratorContext } from "../method-calls.js";
import { SymbolKind, SymbolKind_Boolean } from "../../infrastructure/symbol-table.js";

function emitPrint(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  fmtRef: string,
  args: string,
): void {
  if (useStderr) {
    const stderrPtr = ctx.emitLoad("i8*", "@stderr");
    const temp = ctx.nextTemp();
    ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, ${fmtRef}${args})`);
    const flushTemp = ctx.emitCall("i32", "@fflush", `i8* ${stderrPtr}`);
  } else {
    const temp = ctx.nextTemp();
    ctx.emit(`${temp} = call i32 (i8*, ...) @printf(${fmtRef}${args})`);
  }
}

function emitPrintStrNoNl(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  value: string,
): void {
  emitPrint(
    ctx,
    useStderr,
    `i8* getelementptr([3 x i8], [3 x i8]* @.str.strfmt_no_nl, i32 0, i32 0)`,
    `, i8* ${value}`,
  );
}

function emitPrintNumNoNl(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  value: string,
): void {
  const dbl = ctx.ensureDouble(value);
  emitPrint(
    ctx,
    useStderr,
    `i8* getelementptr([6 x i8], [6 x i8]* @.str.numfmt_no_nl, i32 0, i32 0)`,
    `, double ${dbl}`,
  );
}

function emitPrintSpace(ctx: MethodCallGeneratorContext, useStderr: boolean): void {
  const spaceRef = `i8* getelementptr([2 x i8], [2 x i8]* @.str.space, i32 0, i32 0)`;
  emitPrint(ctx, useStderr, spaceRef, "");
}

function emitPrintNewline(ctx: MethodCallGeneratorContext, useStderr: boolean): void {
  const nlRef = `i8* getelementptr([2 x i8], [2 x i8]* @.str.newline, i32 0, i32 0)`;
  emitPrint(ctx, useStderr, nlRef, "");
}

function emitArrayPrint(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  arrayPtr: string,
  arrayType: "Array" | "StringArray" | "ObjectArray",
): void {
  const arrCast = ctx.nextTemp();
  ctx.emit(`${arrCast} = ptrtoint %${arrayType}* ${arrayPtr} to i64`);
  const arrIsNull = ctx.emitIcmp("eq", "i64", arrCast, "0");
  const arrNullLabel = ctx.nextLabel("arr_null");
  const arrNonNullLabel = ctx.nextLabel("arr_nonnull");
  ctx.emitBrCond(arrIsNull, arrNullLabel, arrNonNullLabel);
  ctx.emitLabel(arrNullLabel);
  const undefStr = ctx.stringGen.doCreateStringConstant("undefined");
  emitPrintStrNoNl(ctx, useStderr, undefStr);
  const arrDoneNullLabel = ctx.nextLabel("arr_done_null");
  ctx.emitBr(arrDoneNullLabel);
  ctx.emitLabel(arrNonNullLabel);

  const lenPtr = ctx.nextTemp();
  ctx.emit(
    `${lenPtr} = getelementptr inbounds %${arrayType}, %${arrayType}* ${arrayPtr}, i32 0, i32 1`,
  );
  const len = ctx.emitLoad("i32", lenPtr);

  const openBracket = ctx.stringGen.doCreateStringConstant("[ ");
  const closeBracket = ctx.stringGen.doCreateStringConstant(" ]");
  const separator = ctx.stringGen.doCreateStringConstant(", ");
  const emptyArray = ctx.stringGen.doCreateStringConstant("[]");

  const isEmpty = ctx.emitIcmp("eq", "i32", len, "0");

  const iAlloca = ctx.nextTemp();
  ctx.emit(`${iAlloca} = alloca i32`);

  const emptyLabel = ctx.nextLabel("arr_empty");
  const nonEmptyLabel = ctx.nextLabel("arr_nonempty");
  const loopLabel = ctx.nextLabel("arr_loop");
  const loopBodyLabel = ctx.nextLabel("arr_body");
  const sepLabel = ctx.nextLabel("arr_sep");
  const loopLatchLabel = ctx.nextLabel("arr_latch");
  const endLabel = ctx.nextLabel("arr_end");
  const doneLabel = ctx.nextLabel("arr_done");

  ctx.emitBrCond(isEmpty, emptyLabel, nonEmptyLabel);

  ctx.emitLabel(emptyLabel);
  emitPrintStrNoNl(ctx, useStderr, emptyArray);
  ctx.emitBr(doneLabel);

  ctx.emitLabel(nonEmptyLabel);
  let dataPtr: string;
  if (arrayType === "Array") {
    const dataPtrField = ctx.nextTemp();
    ctx.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    dataPtr = ctx.emitLoad("double*", dataPtrField);
  } else if (arrayType === "StringArray") {
    const dataPtrField = ctx.nextTemp();
    ctx.emit(
      `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
    );
    dataPtr = ctx.emitLoad("i8**", dataPtrField);
  } else {
    const dataPtrField = ctx.nextTemp();
    ctx.emit(
      `${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
    );
    const rawData = ctx.emitLoad("i8*", dataPtrField);
    dataPtr = ctx.emitBitcast(rawData, "i8*", "i8**");
  }
  emitPrintStrNoNl(ctx, useStderr, openBracket);
  ctx.emitStore("i32", "0", iAlloca);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const i = ctx.emitLoad("i32", iAlloca);
  const isFirst = ctx.emitIcmp("eq", "i32", i, "0");
  ctx.emitBrCond(isFirst, loopBodyLabel, sepLabel);

  ctx.emitLabel(sepLabel);
  emitPrintStrNoNl(ctx, useStderr, separator);
  ctx.emitBr(loopBodyLabel);

  ctx.emitLabel(loopBodyLabel);
  if (arrayType === "Array") {
    const elemPtr = ctx.nextTemp();
    ctx.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${i}`);
    const elem = ctx.emitLoad("double", elemPtr);
    emitPrintNumNoNl(ctx, useStderr, elem);
  } else if (arrayType === "StringArray") {
    const elemPtr = ctx.nextTemp();
    ctx.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
    const elem = ctx.emitLoad("i8*", elemPtr);
    emitPrintStrNoNl(ctx, useStderr, elem);
  } else {
    const objStr = ctx.stringGen.doCreateStringConstant("[object Object]");
    emitPrintStrNoNl(ctx, useStderr, objStr);
  }

  ctx.emitBr(loopLatchLabel);

  ctx.emitLabel(loopLatchLabel);
  const iCurrent = ctx.emitLoad("i32", iAlloca);
  const iNext = ctx.nextTemp();
  ctx.emit(`${iNext} = add i32 ${iCurrent}, 1`);
  ctx.emitStore("i32", iNext, iAlloca);
  const done = ctx.emitIcmp("eq", "i32", iNext, len);
  ctx.emitBrCond(done, endLabel, loopLabel);

  ctx.emitLabel(endLabel);
  emitPrintStrNoNl(ctx, useStderr, closeBracket);
  ctx.emitBr(doneLabel);

  ctx.emitLabel(doneLabel);
  ctx.emitBr(arrDoneNullLabel);
  ctx.emitLabel(arrDoneNullLabel);
}

function emitMapPrint(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  mapPtr: string,
  mapType: string,
  valueType: string = "string",
): void {
  const isString = mapType === "%StringMap*";
  const structType = isString ? "%StringMap" : "%Map";

  const sizePtr = ctx.nextTemp();
  ctx.emit(
    `${sizePtr} = getelementptr inbounds ${structType}, ${structType}* ${mapPtr}, i32 0, i32 2`,
  );
  const size = ctx.emitLoad("i32", sizePtr);
  const capPtr = ctx.nextTemp();
  ctx.emit(
    `${capPtr} = getelementptr inbounds ${structType}, ${structType}* ${mapPtr}, i32 0, i32 3`,
  );
  const capacity = ctx.emitLoad("i32", capPtr);

  const headerStr = ctx.stringGen.doCreateStringConstant("Map(");
  emitPrintStrNoNl(ctx, useStderr, headerStr);
  const sizeDouble = ctx.nextTemp();
  ctx.emit(`${sizeDouble} = sitofp i32 ${size} to double`);
  emitPrintNumNoNl(ctx, useStderr, sizeDouble);
  const openStr = ctx.stringGen.doCreateStringConstant(") { ");
  const closeStr = ctx.stringGen.doCreateStringConstant(" }");
  const emptyCloseStr = ctx.stringGen.doCreateStringConstant(") {}");
  const separator = ctx.stringGen.doCreateStringConstant(", ");
  const arrow = ctx.stringGen.doCreateStringConstant(" => ");

  const isEmpty = ctx.emitIcmp("eq", "i32", size, "0");

  const iAlloca = ctx.nextTemp();
  ctx.emit(`${iAlloca} = alloca i32`);
  const printedAlloca = ctx.nextTemp();
  ctx.emit(`${printedAlloca} = alloca i32`);

  const emptyLabel = ctx.nextLabel("map_empty");
  const nonEmptyLabel = ctx.nextLabel("map_nonempty");
  const doneLabel = ctx.nextLabel("map_done");

  ctx.emitBrCond(isEmpty, emptyLabel, nonEmptyLabel);

  ctx.emitLabel(emptyLabel);
  emitPrintStrNoNl(ctx, useStderr, emptyCloseStr);
  ctx.emitBr(doneLabel);

  ctx.emitLabel(nonEmptyLabel);
  emitPrintStrNoNl(ctx, useStderr, openStr);

  const keysFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${keysFieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${mapPtr}, i32 0, i32 0`,
  );
  const valsFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${valsFieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${mapPtr}, i32 0, i32 1`,
  );
  const keys = ctx.emitLoad(isString ? "i8**" : "double*", keysFieldPtr);
  const vals = ctx.emitLoad(isString ? "i8**" : "double*", valsFieldPtr);

  ctx.emitStore("i32", "0", iAlloca);
  ctx.emitStore("i32", "0", printedAlloca);

  const loopLabel = ctx.nextLabel("map_loop");
  const checkSlotLabel = ctx.nextLabel("map_check");
  const bodyLabel = ctx.nextLabel("map_body");
  const sepLabel = ctx.nextLabel("map_sep");
  const skipLabel = ctx.nextLabel("map_skip");
  const latchLabel = ctx.nextLabel("map_latch");
  const endLabel = ctx.nextLabel("map_end");

  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const i = ctx.emitLoad("i32", iAlloca);
  const reachedCap = ctx.emitIcmp("sge", "i32", i, capacity);
  ctx.emitBrCond(reachedCap, endLabel, checkSlotLabel);

  ctx.emitLabel(checkSlotLabel);
  if (isString) {
    const keyElemPtr = ctx.nextTemp();
    ctx.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${keys}, i32 ${i}`);
    const keyAtSlot = ctx.emitLoad("i8*", keyElemPtr);
    const isNull = ctx.emitIcmp("eq", "i8*", keyAtSlot, "null");
    ctx.emitBrCond(isNull, latchLabel, bodyLabel);
  } else {
    ctx.emitBr(bodyLabel);
  }

  ctx.emitLabel(bodyLabel);
  const printed = ctx.emitLoad("i32", printedAlloca);
  const isFirstPrint = ctx.emitIcmp("eq", "i32", printed, "0");
  ctx.emitBrCond(isFirstPrint, skipLabel, sepLabel);

  ctx.emitLabel(sepLabel);
  emitPrintStrNoNl(ctx, useStderr, separator);
  ctx.emitBr(skipLabel);

  ctx.emitLabel(skipLabel);
  if (isString) {
    const keyElemPtr2 = ctx.nextTemp();
    ctx.emit(`${keyElemPtr2} = getelementptr inbounds i8*, i8** ${keys}, i32 ${i}`);
    const key = ctx.emitLoad("i8*", keyElemPtr2);
    emitPrintStrNoNl(ctx, useStderr, key);
  } else {
    const keyElemPtr2 = ctx.nextTemp();
    ctx.emit(`${keyElemPtr2} = getelementptr inbounds double, double* ${keys}, i32 ${i}`);
    const key = ctx.emitLoad("double", keyElemPtr2);
    emitPrintNumNoNl(ctx, useStderr, key);
  }
  emitPrintStrNoNl(ctx, useStderr, arrow);
  if (isString) {
    const valElemPtr = ctx.nextTemp();
    ctx.emit(`${valElemPtr} = getelementptr inbounds i8*, i8** ${vals}, i32 ${i}`);
    const val = ctx.emitLoad("i8*", valElemPtr);
    if (valueType === "number") {
      const asI64 = ctx.nextTemp();
      ctx.emit(`${asI64} = ptrtoint i8* ${val} to i64`);
      const asDouble = ctx.nextTemp();
      ctx.emit(`${asDouble} = bitcast i64 ${asI64} to double`);
      emitPrintNumNoNl(ctx, useStderr, asDouble);
    } else {
      emitPrintStrNoNl(ctx, useStderr, val);
    }
  } else {
    const valElemPtr = ctx.nextTemp();
    ctx.emit(`${valElemPtr} = getelementptr inbounds double, double* ${vals}, i32 ${i}`);
    const val = ctx.emitLoad("double", valElemPtr);
    emitPrintNumNoNl(ctx, useStderr, val);
  }

  const printedCurrent = ctx.emitLoad("i32", printedAlloca);
  const printedNext = ctx.nextTemp();
  ctx.emit(`${printedNext} = add i32 ${printedCurrent}, 1`);
  ctx.emitStore("i32", printedNext, printedAlloca);

  ctx.emitBr(latchLabel);

  ctx.emitLabel(latchLabel);
  const iCurrent = ctx.emitLoad("i32", iAlloca);
  const iNext = ctx.nextTemp();
  ctx.emit(`${iNext} = add i32 ${iCurrent}, 1`);
  ctx.emitStore("i32", iNext, iAlloca);
  ctx.emitBr(loopLabel);

  ctx.emitLabel(endLabel);
  emitPrintStrNoNl(ctx, useStderr, closeStr);
  ctx.emitBr(doneLabel);

  ctx.emitLabel(doneLabel);
}

function emitSetPrint(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  setPtr: string,
  setType: string,
): void {
  const isString = setType === "%StringSet*";
  const structType = isString ? "%StringSet" : "%Set";

  const sizePtr = ctx.nextTemp();
  ctx.emit(
    `${sizePtr} = getelementptr inbounds ${structType}, ${structType}* ${setPtr}, i32 0, i32 1`,
  );
  const size = ctx.emitLoad("i32", sizePtr);

  const headerStr = ctx.stringGen.doCreateStringConstant("Set(");
  emitPrintStrNoNl(ctx, useStderr, headerStr);
  const sizeDouble = ctx.nextTemp();
  ctx.emit(`${sizeDouble} = sitofp i32 ${size} to double`);
  emitPrintNumNoNl(ctx, useStderr, sizeDouble);
  const openStr = ctx.stringGen.doCreateStringConstant(") { ");
  const closeStr = ctx.stringGen.doCreateStringConstant(" }");
  const emptyCloseStr = ctx.stringGen.doCreateStringConstant(") {}");
  const separator = ctx.stringGen.doCreateStringConstant(", ");

  const isEmpty = ctx.emitIcmp("eq", "i32", size, "0");

  const iAlloca = ctx.nextTemp();
  ctx.emit(`${iAlloca} = alloca i32`);

  const emptyLabel = ctx.nextLabel("set_empty");
  const nonEmptyLabel = ctx.nextLabel("set_nonempty");
  const doneLabel = ctx.nextLabel("set_done");

  ctx.emitBrCond(isEmpty, emptyLabel, nonEmptyLabel);

  ctx.emitLabel(emptyLabel);
  emitPrintStrNoNl(ctx, useStderr, emptyCloseStr);
  ctx.emitBr(doneLabel);

  ctx.emitLabel(nonEmptyLabel);
  emitPrintStrNoNl(ctx, useStderr, openStr);

  const dataFieldPtr = ctx.nextTemp();
  ctx.emit(
    `${dataFieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${setPtr}, i32 0, i32 0`,
  );
  const data = ctx.emitLoad(isString ? "i8**" : "double*", dataFieldPtr);

  ctx.emitStore("i32", "0", iAlloca);

  const loopLabel = ctx.nextLabel("set_loop");
  const bodyLabel = ctx.nextLabel("set_body");
  const sepLabel = ctx.nextLabel("set_sep");
  const latchLabel = ctx.nextLabel("set_latch");
  const endLabel = ctx.nextLabel("set_end");

  ctx.emitBr(loopLabel);

  ctx.emitLabel(loopLabel);
  const i = ctx.emitLoad("i32", iAlloca);
  const isFirst = ctx.emitIcmp("eq", "i32", i, "0");
  ctx.emitBrCond(isFirst, bodyLabel, sepLabel);

  ctx.emitLabel(sepLabel);
  emitPrintStrNoNl(ctx, useStderr, separator);
  ctx.emitBr(bodyLabel);

  ctx.emitLabel(bodyLabel);
  if (isString) {
    const elemPtr = ctx.nextTemp();
    ctx.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${data}, i32 ${i}`);
    const elem = ctx.emitLoad("i8*", elemPtr);
    emitPrintStrNoNl(ctx, useStderr, elem);
  } else {
    const elemPtr = ctx.nextTemp();
    ctx.emit(`${elemPtr} = getelementptr inbounds double, double* ${data}, i32 ${i}`);
    const elem = ctx.emitLoad("double", elemPtr);
    emitPrintNumNoNl(ctx, useStderr, elem);
  }

  ctx.emitBr(latchLabel);

  ctx.emitLabel(latchLabel);
  const iCurrent = ctx.emitLoad("i32", iAlloca);
  const iNext = ctx.nextTemp();
  ctx.emit(`${iNext} = add i32 ${iCurrent}, 1`);
  ctx.emitStore("i32", iNext, iAlloca);
  const done = ctx.emitIcmp("eq", "i32", iNext, size);
  ctx.emitBrCond(done, endLabel, loopLabel);

  ctx.emitLabel(endLabel);
  emitPrintStrNoNl(ctx, useStderr, closeStr);
  ctx.emitBr(doneLabel);

  ctx.emitLabel(doneLabel);
}

function emitClassInstancePrint(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  arg: Expression,
  params: string[],
  className: string,
): void {
  const headerStr = ctx.stringGen.doCreateStringConstant(className + " ");
  emitPrintStrNoNl(ctx, useStderr, headerStr);
  const jsonStr = ctx.jsonGen.generateStringifyExpr(arg, params);
  emitPrintStrNoNl(ctx, useStderr, jsonStr);
}

function ensureI1(ctx: MethodCallGeneratorContext, value: string): string {
  const varType = ctx.getVariableType(value);
  if (varType === "i1") return value;
  if (varType === "double") {
    const cmp = ctx.nextTemp();
    ctx.emit(`${cmp} = fcmp one double ${value}, 0.0`);
    return cmp;
  }
  if (varType === "i64") {
    const trunc = ctx.nextTemp();
    ctx.emit(`${trunc} = trunc i64 ${value} to i1`);
    return trunc;
  }
  const dbl = ctx.ensureDouble(value);
  const cmp = ctx.nextTemp();
  ctx.emit(`${cmp} = fcmp one double ${dbl}, 0.0`);
  return cmp;
}

function emitBooleanPrint(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  value: string,
): void {
  const trueStr = ctx.stringGen.doCreateStringConstant("true");
  const falseStr = ctx.stringGen.doCreateStringConstant("false");
  const boolVal = ensureI1(ctx, value);
  const sel = ctx.nextTemp();
  ctx.emit(`${sel} = select i1 ${boolVal}, i8* ${trueStr}, i8* ${falseStr}`);
  emitPrintStrNoNl(ctx, useStderr, sel);
}

function emitSingleArg(
  ctx: MethodCallGeneratorContext,
  useStderr: boolean,
  arg: Expression,
  params: string[],
): void {
  if (arg.type === "string") {
    const strNode = arg as StringNode;
    const strValue = strNode.value;
    const strConstPtr = ctx.stringGen.doCreateStringConstant(strValue);
    emitPrintStrNoNl(ctx, useStderr, strConstPtr);
    return;
  }

  if (arg.type === "number") {
    const argValue = ctx.generateExpression(arg, params);
    emitPrintNumNoNl(ctx, useStderr, argValue);
    return;
  }

  if (arg.type === "boolean") {
    const argValue = ctx.generateExpression(arg, params);
    emitBooleanPrint(ctx, useStderr, argValue);
    return;
  }

  if (arg.type === "null") {
    const nullStr = ctx.stringGen.doCreateStringConstant("null");
    emitPrintStrNoNl(ctx, useStderr, nullStr);
    return;
  }

  if (arg.type === "undefined") {
    const undefStr = ctx.stringGen.doCreateStringConstant("undefined");
    emitPrintStrNoNl(ctx, useStderr, undefStr);
    return;
  }

  if (arg.type === "variable") {
    const varName = (arg as VariableNode).name;
    const varKind = ctx.symbolTable.getKind(varName);
    if (varKind === SymbolKind_Boolean) {
      const argValue = ctx.generateExpression(arg, params);
      emitBooleanPrint(ctx, useStderr, argValue);
      return;
    }
    const ifaceType =
      ctx.symbolTable.getInterfaceType(varName) || ctx.symbolTable.getRawInterfaceType(varName);
    if (ifaceType) {
      const ptrVal = ctx.generateExpression(arg, params);
      const isNull = ctx.emitIcmp("eq", "i8*", ptrVal, "null");
      const nullLabel = ctx.nextLabel("console_null");
      const nonNullLabel = ctx.nextLabel("console_nonnull");
      const doneLabel = ctx.nextLabel("console_done");
      ctx.emitBrCond(isNull, nullLabel, nonNullLabel);
      ctx.emitLabel(nullLabel);
      const nullStr = ctx.stringGen.doCreateStringConstant("null");
      emitPrintStrNoNl(ctx, useStderr, nullStr);
      ctx.emitBr(doneLabel);
      ctx.emitLabel(nonNullLabel);
      const jsonStr = ctx.jsonGen.generateStringifyExpr(arg, params);
      emitPrintStrNoNl(ctx, useStderr, jsonStr);
      ctx.emitBr(doneLabel);
      ctx.emitLabel(doneLabel);
      return;
    }
    const cn = ctx.symbolTable.getClassName(varName);
    if (cn) {
      const clsPtr = ctx.generateExpression(arg, params);
      const clsIsNull = ctx.emitIcmp("eq", "i8*", clsPtr, "null");
      const clsNullLabel = ctx.nextLabel("console_cls_null");
      const clsNonNullLabel = ctx.nextLabel("console_cls_nonnull");
      const clsDoneLabel = ctx.nextLabel("console_cls_done");
      ctx.emitBrCond(clsIsNull, clsNullLabel, clsNonNullLabel);
      ctx.emitLabel(clsNullLabel);
      const clsNullStr = ctx.stringGen.doCreateStringConstant("null");
      emitPrintStrNoNl(ctx, useStderr, clsNullStr);
      ctx.emitBr(clsDoneLabel);
      ctx.emitLabel(clsNonNullLabel);
      emitClassInstancePrint(ctx, useStderr, arg, params, cn);
      ctx.emitBr(clsDoneLabel);
      ctx.emitLabel(clsDoneLabel);
      return;
    }
  }

  const argValue = ctx.generateExpression(arg, params);

  if (ctx.isBooleanExpression(arg)) {
    emitBooleanPrint(ctx, useStderr, argValue);
    return;
  }

  if (arg.type === "binary") {
    const binArg = arg as BinaryNode;
    const binOp = binArg.op;
    if (
      binOp === "===" ||
      binOp === "!==" ||
      binOp === "==" ||
      binOp === "!=" ||
      binOp === "<" ||
      binOp === ">" ||
      binOp === "<=" ||
      binOp === ">=" ||
      binOp === "instanceof"
    ) {
      emitBooleanPrint(ctx, useStderr, argValue);
      return;
    }
  }

  if (arg.type === "unary") {
    const unaryArg = arg as UnaryNode;
    if (unaryArg.op === "!") {
      emitBooleanPrint(ctx, useStderr, argValue);
      return;
    }
  }

  if (arg.type === "method_call") {
    const mc = arg as MethodCallNode;
    const m = mc.method;
    if (
      m === "includes" ||
      m === "startsWith" ||
      m === "endsWith" ||
      m === "has" ||
      m === "some" ||
      m === "every"
    ) {
      emitBooleanPrint(ctx, useStderr, argValue);
      return;
    }
  }

  const isString = ctx.isStringExpression(arg);
  if (isString) {
    emitPrintStrNoNl(ctx, useStderr, argValue);
    return;
  }

  const isArray = ctx.isArrayExpression(arg);
  if (isArray) {
    emitArrayPrint(ctx, useStderr, argValue, "Array");
    return;
  }

  const isStringArray = ctx.isStringArrayExpression(arg);
  if (isStringArray) {
    emitArrayPrint(ctx, useStderr, argValue, "StringArray");
    return;
  }

  const isObjectArray = ctx.isObjectArrayExpression(arg);
  if (isObjectArray) {
    emitArrayPrint(ctx, useStderr, argValue, "ObjectArray");
    return;
  }

  const varType = ctx.getVariableType(argValue);
  if (varType === "i8*") {
    emitPrintStrNoNl(ctx, useStderr, argValue);
    return;
  }
  if (varType === "%StringMap*" || varType === "%Map*") {
    let valueType = "string";
    if (arg.type === "variable") {
      const mapMeta = ctx.symbolTable.getMapMetadata((arg as VariableNode).name);
      if (mapMeta) valueType = mapMeta.valueType || "string";
    }
    emitMapPrint(ctx, useStderr, argValue, varType, valueType);
    return;
  }
  if (varType === "%StringSet*" || varType === "%Set*") {
    emitSetPrint(ctx, useStderr, argValue, varType);
    return;
  }
  if (varType === "i1") {
    emitBooleanPrint(ctx, useStderr, argValue);
    return;
  }
  if (varType && varType.endsWith("_struct*") && varType.startsWith("%")) {
    const className = varType.slice(1, -8);
    emitClassInstancePrint(ctx, useStderr, arg, params, className);
    return;
  }
  if (varType && varType.endsWith("*")) {
    if (arg.type === "variable") {
      const varName = (arg as VariableNode).name;
      const cn = ctx.symbolTable.getClassName(varName);
      if (cn) {
        emitClassInstancePrint(ctx, useStderr, arg, params, cn);
        return;
      }
    }
    const objStr = ctx.stringGen.doCreateStringConstant("[object Object]");
    emitPrintStrNoNl(ctx, useStderr, objStr);
    return;
  }

  emitPrintNumNoNl(ctx, useStderr, argValue);
}

export function generateConsoleTime(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  ctx.setUsesConsoleTime(true);
  ctx.setUsesUvHrtime(true);

  let labelPtr: string;
  if (expr.args.length > 0) {
    labelPtr = ctx.generateExpression(expr.args[0], params);
  } else {
    labelPtr = ctx.stringGen.doCreateStringConstant("default");
  }

  const ns = ctx.emitCall("i64", "@uv_hrtime", "");
  const storeResult = ctx.emitCall("i32", "@__console_timer_store", `i8* ${labelPtr}, i64 ${ns}`);

  return "0.0";
}

export function generateConsoleTimeEnd(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  ctx.setUsesConsoleTime(true);
  ctx.setUsesUvHrtime(true);

  let labelPtr: string;
  if (expr.args.length > 0) {
    labelPtr = ctx.generateExpression(expr.args[0], params);
  } else {
    labelPtr = ctx.stringGen.doCreateStringConstant("default");
  }

  const endNs = ctx.emitCall("i64", "@uv_hrtime", "");
  const startNs = ctx.emitCall("i64", "@__console_timer_load", `i8* ${labelPtr}`);

  const diffNs = ctx.nextTemp();
  ctx.emit(`${diffNs} = sub i64 ${endNs}, ${startNs}`);
  const diffDbl = ctx.nextTemp();
  ctx.emit(`${diffDbl} = uitofp i64 ${diffNs} to double`);
  const diffMs = ctx.nextTemp();
  ctx.emit(`${diffMs} = fdiv double ${diffDbl}, 1000000.0`);
  ctx.setVariableType(diffMs, "double");

  const fmtStr = ctx.stringGen.doCreateStringConstant("%s: %.3fms\n");
  const printResult = ctx.nextTemp();
  ctx.emit(
    `${printResult} = call i32 (i8*, ...) @printf(i8* ${fmtStr}, i8* ${labelPtr}, double ${diffMs})`,
  );

  return "0.0";
}

export function generateConsoleCallInline(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  const method = expr.method;
  const useStderr = method === "error" || method === "warn";

  if (expr.args.length === 0) {
    emitPrintNewline(ctx, useStderr);
    return "0.0";
  }

  for (let i = 0; i < expr.args.length; i++) {
    if (i > 0) {
      emitPrintSpace(ctx, useStderr);
    }
    emitSingleArg(ctx, useStderr, expr.args[i] as Expression, params);
  }
  emitPrintNewline(ctx, useStderr);

  return "0.0";
}
