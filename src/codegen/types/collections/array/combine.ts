// Array combine operations: join, slice, concat, spread literals
// Extracted from array.ts to reduce file size. Uses IGeneratorContext for IR emission.

import {
  Expression,
  ArrayNode,
  MethodCallNode,
  VariableNode,
  SpreadElementNode,
} from "../../../../ast/types.js";
import { IGeneratorContext, loadArrayMeta } from "./context.js";

// ============================================
// spread literals
// ============================================

export function generateArrayLiteralWithSpread(
  gen: IGeneratorContext,
  arrExpr: ArrayNode,
  params: string[],
): string {
  let isStringArray = false;
  for (let i = 0; i < arrExpr.elements.length; i++) {
    const el = arrExpr.elements[i] as { type: string };
    if (el.type === "string") {
      isStringArray = true;
      break;
    }
    if (el.type.indexOf("spread:") === 0) {
      const varName = el.type.substr(7);
      const varType = gen.getVariableType(varName);
      if (varType === "%StringArray*") {
        isStringArray = true;
        break;
      }
    }
  }

  if (isStringArray) {
    return generateStringArrayLiteralWithSpread(gen, arrExpr, params);
  }

  let literalCount = 0;
  for (let i = 0; i < arrExpr.elements.length; i++) {
    const el = arrExpr.elements[i] as { type: string };
    if (el.type.indexOf("spread:") !== 0 && el.type !== "spread_element") {
      literalCount = literalCount + 1;
    }
  }

  // Compute total length by summing literal count + each spread array's length
  let totalLen = `${literalCount}`;
  for (let i = 0; i < arrExpr.elements.length; i++) {
    const el = arrExpr.elements[i] as { type: string };
    if (el.type.indexOf("spread:") === 0) {
      const varName = el.type.substr(7);
      const alloca = gen.getVariableAlloca(varName)!;
      const arrPtr = gen.emitLoad("%Array*", alloca);
      const meta = loadArrayMeta(gen, arrPtr);
      const newTotal = gen.nextTemp();
      gen.emit(`${newTotal} = add i32 ${totalLen}, ${meta.length}`);
      totalLen = newTotal;
    } else if (el.type === "spread_element") {
      const spreadArg = (arrExpr.elements[i] as SpreadElementNode).argument;
      const arrPtr = gen.generateExpression(spreadArg, params);
      const meta = loadArrayMeta(gen, arrPtr);
      const newTotal = gen.nextTemp();
      gen.emit(`${newTotal} = add i32 ${totalLen}, ${meta.length}`);
      totalLen = newTotal;
    }
  }

  const sizePtr = gen.nextTemp();
  gen.emit(`${sizePtr} = getelementptr %Array, %Array* null, i32 1`);
  const structSize = gen.nextTemp();
  gen.emit(`${structSize} = ptrtoint %Array* ${sizePtr} to i64`);
  const arrayMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
  const arrayPtr = gen.emitBitcast(arrayMem, "i8*", "%Array*");

  const totalLenI64 = gen.nextTemp();
  gen.emit(`${totalLenI64} = zext i32 ${totalLen} to i64`);
  const dataSize = gen.nextTemp();
  gen.emit(`${dataSize} = mul i64 ${totalLenI64}, 8`);
  const dataMem = gen.emitCall("i8*", "@GC_malloc_atomic", `i64 ${dataSize}`);
  const dataPtr = gen.emitBitcast(dataMem, "i8*", "double*");

  const offsetPtr = gen.nextTemp();
  gen.emit(`${offsetPtr} = alloca i32`);
  gen.emitStore("i32", "0", offsetPtr);

  for (let i = 0; i < arrExpr.elements.length; i++) {
    const el = arrExpr.elements[i] as { type: string };
    if (el.type.indexOf("spread:") === 0) {
      const varName = el.type.substr(7);
      const alloca = gen.getVariableAlloca(varName)!;
      const srcArrPtr = gen.emitLoad("%Array*", alloca);
      const srcMeta = loadArrayMeta(gen, srcArrPtr);

      const checkLabel = gen.nextLabel("spread_check");
      const bodyLabel = gen.nextLabel("spread_body");
      const endLabel = gen.nextLabel("spread_end");

      const counterPtr = gen.nextTemp();
      gen.emit(`${counterPtr} = alloca i32`);
      gen.emitStore("i32", "0", counterPtr);
      gen.emitBr(checkLabel);

      gen.emitLabel(checkLabel);
      const counter = gen.emitLoad("i32", counterPtr);
      const cond = gen.emitIcmp("slt", "i32", counter, srcMeta.length);
      gen.emitBrCond(cond, bodyLabel, endLabel);

      gen.emitLabel(bodyLabel);
      const srcElemPtr = gen.nextTemp();
      gen.emit(
        `${srcElemPtr} = getelementptr inbounds double, double* ${srcMeta.dataPtr}, i32 ${counter}`,
      );
      const srcElem = gen.emitLoad("double", srcElemPtr);

      const curOffset = gen.emitLoad("i32", offsetPtr);
      const dstElemPtr = gen.nextTemp();
      gen.emit(
        `${dstElemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${curOffset}`,
      );
      gen.emitStore("double", srcElem, dstElemPtr);

      const nextOffset = gen.nextTemp();
      gen.emit(`${nextOffset} = add i32 ${curOffset}, 1`);
      gen.emitStore("i32", nextOffset, offsetPtr);
      const nextCounter = gen.nextTemp();
      gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
      gen.emitStore("i32", nextCounter, counterPtr);
      gen.emitBr(checkLabel);

      gen.emitLabel(endLabel);
    } else if (el.type === "spread_element") {
      const spreadArg = (arrExpr.elements[i] as SpreadElementNode).argument;
      const srcArrPtr = gen.generateExpression(spreadArg, params);
      const srcMeta = loadArrayMeta(gen, srcArrPtr);

      const checkLabel = gen.nextLabel("spread_check");
      const bodyLabel = gen.nextLabel("spread_body");
      const endLabel = gen.nextLabel("spread_end");

      const counterPtr = gen.nextTemp();
      gen.emit(`${counterPtr} = alloca i32`);
      gen.emitStore("i32", "0", counterPtr);
      gen.emitBr(checkLabel);

      gen.emitLabel(checkLabel);
      const counter = gen.emitLoad("i32", counterPtr);
      const cond = gen.emitIcmp("slt", "i32", counter, srcMeta.length);
      gen.emitBrCond(cond, bodyLabel, endLabel);

      gen.emitLabel(bodyLabel);
      const srcElemPtr = gen.nextTemp();
      gen.emit(
        `${srcElemPtr} = getelementptr inbounds double, double* ${srcMeta.dataPtr}, i32 ${counter}`,
      );
      const srcElem = gen.emitLoad("double", srcElemPtr);

      const curOffset = gen.emitLoad("i32", offsetPtr);
      const dstElemPtr = gen.nextTemp();
      gen.emit(
        `${dstElemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${curOffset}`,
      );
      gen.emitStore("double", srcElem, dstElemPtr);

      const nextOffset = gen.nextTemp();
      gen.emit(`${nextOffset} = add i32 ${curOffset}, 1`);
      gen.emitStore("i32", nextOffset, offsetPtr);
      const nextCounter = gen.nextTemp();
      gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
      gen.emitStore("i32", nextCounter, counterPtr);
      gen.emitBr(checkLabel);

      gen.emitLabel(endLabel);
    } else {
      const value = gen.generateExpression(arrExpr.elements[i], params);
      const dblVal = gen.ensureDouble(value);
      const curOffset = gen.emitLoad("i32", offsetPtr);
      const elemPtr = gen.nextTemp();
      gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${curOffset}`);
      gen.emitStore("double", dblVal, elemPtr);
      const nextOffset = gen.nextTemp();
      gen.emit(`${nextOffset} = add i32 ${curOffset}, 1`);
      gen.emitStore("i32", nextOffset, offsetPtr);
    }
  }

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  gen.emitStore("double*", dataPtr, dataPtrField);

  const lenField = gen.nextTemp();
  gen.emit(`${lenField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  gen.emitStore("i32", totalLen, lenField);

  const capField = gen.nextTemp();
  gen.emit(`${capField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
  gen.emitStore("i32", totalLen, capField);

  gen.setVariableType(arrayPtr, "%Array*");
  return arrayPtr;
}

function generateStringArrayLiteralWithSpread(
  gen: IGeneratorContext,
  arrExpr: ArrayNode,
  params: string[],
): string {
  const spreadSources: { index: number; ptr: string }[] = [];
  const literalValues: { index: number; value: string }[] = [];

  for (let i = 0; i < arrExpr.elements.length; i++) {
    const el = arrExpr.elements[i] as { type: string };
    if (el.type.indexOf("spread:") === 0) {
      const varName = el.type.substr(7);
      const alloca = gen.getVariableAlloca(varName)!;
      const ptr = gen.emitLoad("%Array*", alloca);
      gen.setVariableType(ptr, "%Array*");
      spreadSources.push({ index: i, ptr: ptr });
    } else if (el.type === "spread_element") {
      const spreadArg = (arrExpr.elements[i] as SpreadElementNode).argument;
      const ptr = gen.generateExpression(spreadArg, params);
      spreadSources.push({ index: i, ptr });
    } else {
      const value = gen.generateExpression(arrExpr.elements[i], params);
      literalValues.push({ index: i, value });
    }
  }

  let totalLen = `${literalValues.length}`;
  for (const src of spreadSources) {
    const lenPtr = gen.nextTemp();
    gen.emit(
      `${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${src.ptr}, i32 0, i32 1`,
    );
    const srcLen = gen.emitLoad("i32", lenPtr);
    const newTotal = gen.nextTemp();
    gen.emit(`${newTotal} = add i32 ${totalLen}, ${srcLen}`);
    totalLen = newTotal;
  }

  const sizePtr = gen.nextTemp();
  gen.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
  const structSize = gen.nextTemp();
  gen.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
  const arrayMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
  const arrayPtr = gen.emitBitcast(arrayMem, "i8*", "%StringArray*");

  const totalLenI64 = gen.nextTemp();
  gen.emit(`${totalLenI64} = zext i32 ${totalLen} to i64`);
  const dataSize = gen.nextTemp();
  gen.emit(`${dataSize} = mul i64 ${totalLenI64}, 8`);
  const dataMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
  const dataPtr = gen.emitBitcast(dataMem, "i8*", "i8**");

  const offsetPtr = gen.nextTemp();
  gen.emit(`${offsetPtr} = alloca i32`);
  gen.emitStore("i32", "0", offsetPtr);

  let spreadIdx = 0;
  let litIdx = 0;
  for (let i = 0; i < arrExpr.elements.length; i++) {
    const el = arrExpr.elements[i] as { type: string };
    if (el.type === "spread_element" || el.type.indexOf("spread:") === 0) {
      const src = spreadSources[spreadIdx];
      spreadIdx++;
      const srcLenPtr = gen.nextTemp();
      gen.emit(
        `${srcLenPtr} = getelementptr inbounds %StringArray, %StringArray* ${src.ptr}, i32 0, i32 1`,
      );
      const srcLen = gen.nextTemp();
      gen.emit(`${srcLen} = load i32, i32* ${srcLenPtr}`);
      const srcDataField = gen.nextTemp();
      gen.emit(
        `${srcDataField} = getelementptr inbounds %StringArray, %StringArray* ${src.ptr}, i32 0, i32 0`,
      );
      const srcDataPtr = gen.nextTemp();
      gen.emit(`${srcDataPtr} = load i8**, i8*** ${srcDataField}`);

      const checkLabel = gen.nextLabel("spread_check");
      const bodyLabel = gen.nextLabel("spread_body");
      const endLabel = gen.nextLabel("spread_end");

      const counterPtr = gen.nextTemp();
      gen.emit(`${counterPtr} = alloca i32`);
      gen.emitStore("i32", "0", counterPtr);
      gen.emitBr(checkLabel);

      gen.emitLabel(checkLabel);
      const counter = gen.emitLoad("i32", counterPtr);
      const cond = gen.emitIcmp("slt", "i32", counter, srcLen);
      gen.emitBrCond(cond, bodyLabel, endLabel);

      gen.emitLabel(bodyLabel);
      const srcElemPtr = gen.nextTemp();
      gen.emit(`${srcElemPtr} = getelementptr inbounds i8*, i8** ${srcDataPtr}, i32 ${counter}`);
      const srcElem = gen.emitLoad("i8*", srcElemPtr);

      const curOffset = gen.emitLoad("i32", offsetPtr);
      const dstElemPtr = gen.nextTemp();
      gen.emit(`${dstElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${curOffset}`);
      gen.emitStore("i8*", srcElem, dstElemPtr);

      const nextOffset = gen.nextTemp();
      gen.emit(`${nextOffset} = add i32 ${curOffset}, 1`);
      gen.emitStore("i32", nextOffset, offsetPtr);
      const nextCounter = gen.nextTemp();
      gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
      gen.emitStore("i32", nextCounter, counterPtr);
      gen.emitBr(checkLabel);

      gen.emitLabel(endLabel);
    } else {
      const lit = literalValues[litIdx];
      litIdx++;
      const curOffset = gen.emitLoad("i32", offsetPtr);
      const elemPtr = gen.nextTemp();
      gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${curOffset}`);
      gen.emitStore("i8*", lit.value, elemPtr);
      const nextOffset = gen.nextTemp();
      gen.emit(`${nextOffset} = add i32 ${curOffset}, 1`);
      gen.emitStore("i32", nextOffset, offsetPtr);
    }
  }

  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  gen.emitStore("i8**", dataPtr, dataPtrField);

  const lenField = gen.nextTemp();
  gen.emit(
    `${lenField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
  );
  gen.emitStore("i32", totalLen, lenField);

  const capField = gen.nextTemp();
  gen.emit(
    `${capField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`,
  );
  gen.emitStore("i32", totalLen, capField);

  gen.setVariableType(arrayPtr, "%StringArray*");
  return arrayPtr;
}

// ============================================
// join
// ============================================

export function generateArrayJoin(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length > 1) {
    return gen.emitError("join() accepts 0 or 1 arguments (separator)", expr.loc);
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  let separator: string;
  if (expr.args.length === 1) {
    separator = gen.generateExpression(expr.args[0], params);
  } else {
    separator = gen.stringGen.doCreateStringConstant(",");
  }

  let isStringArray = false;
  const exprObjBase = expr.object as { type: string };
  if (exprObjBase.type === "variable") {
    const varName = (expr.object as VariableNode).name;
    const varType = gen.getVariableType(varName);
    isStringArray = varType === "%StringArray*" || varType === "%StringArray";
  } else if (exprObjBase.type === "member_access") {
    const ptrType = gen.getVariableType(arrayPtr);
    isStringArray = ptrType === "%StringArray*";
  } else {
    const ptrType = gen.getVariableType(arrayPtr);
    isStringArray = ptrType === "%StringArray*";
  }

  if (isStringArray) {
    return generateStringArrayJoin(gen, arrayPtr, separator);
  }

  return generateNumericArrayJoin(gen, arrayPtr, separator);
}

function generateNumericArrayJoin(
  gen: IGeneratorContext,
  arrayPtr: string,
  separator: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.emitLoad("i32", lenPtr);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.emitLoad("double*", dataPtrField);

  const bufferSize = 8192;
  const resultBuffer = gen.emitCall("i8*", "@GC_malloc_atomic", `i64 ${bufferSize}`);
  gen.emitStore("i8", "0", resultBuffer);

  const offsetPtr = gen.nextAllocaReg("join_off");
  gen.emit(`${offsetPtr} = alloca i64`);
  gen.emitStore("i64", "0", offsetPtr);

  const counterPtr = gen.nextAllocaReg("join_idx");
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", "0", counterPtr);

  const sepLen = gen.emitCall("i64", "@strlen", `i8* ${separator}`);

  const fmtInt = gen.createStringConstant("%.0f");
  const fmtFloat = gen.createStringConstant("%.15g");

  const checkLabel = gen.nextLabel("numjoin_check");
  const bodyLabel = gen.nextLabel("numjoin_body");
  const endLabel = gen.nextLabel("numjoin_end");

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("slt", "i32", counter, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const offset = gen.emitLoad("i64", offsetPtr);

  const addSepLabel = gen.nextLabel("numjoin_sep");
  const noSepLabel = gen.nextLabel("numjoin_nosep");
  const afterSepLabel = gen.nextLabel("numjoin_after_sep");
  const isFirst = gen.emitIcmp("eq", "i32", counter, "0");
  gen.emitBrCond(isFirst, noSepLabel, addSepLabel);

  gen.emitLabel(addSepLabel);
  const sepOffset = gen.emitLoad("i64", offsetPtr);
  const sepDest = gen.nextTemp();
  gen.emit(`${sepDest} = getelementptr inbounds i8, i8* ${resultBuffer}, i64 ${sepOffset}`);
  gen.emitCallVoid(
    "@llvm.memcpy.p0i8.p0i8.i64",
    `i8* ${sepDest}, i8* ${separator}, i64 ${sepLen}, i1 false`,
  );
  const sepNewOff = gen.nextTemp();
  gen.emit(`${sepNewOff} = add i64 ${sepOffset}, ${sepLen}`);
  gen.emitStore("i64", sepNewOff, offsetPtr);
  gen.emitBr(afterSepLabel);

  gen.emitLabel(noSepLabel);
  gen.emitBr(afterSepLabel);

  gen.emitLabel(afterSepLabel);
  const curOff = gen.emitLoad("i64", offsetPtr);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
  const elemVal = gen.emitLoad("double", elemPtr);

  const truncated = gen.nextTemp();
  gen.emit(`${truncated} = fptosi double ${elemVal} to i64`);
  const backToDouble = gen.nextTemp();
  gen.emit(`${backToDouble} = sitofp i64 ${truncated} to double`);
  const isInt = gen.nextTemp();
  gen.emit(`${isInt} = fcmp oeq double ${elemVal}, ${backToDouble}`);
  const fmt = gen.nextTemp();
  gen.emit(`${fmt} = select i1 ${isInt}, i8* ${fmtInt}, i8* ${fmtFloat}`);

  const dest = gen.nextTemp();
  gen.emit(`${dest} = getelementptr inbounds i8, i8* ${resultBuffer}, i64 ${curOff}`);
  const remaining = gen.nextTemp();
  gen.emit(`${remaining} = sub i64 ${bufferSize}, ${curOff}`);
  const written = gen.nextTemp();
  gen.emit(
    `${written} = call i32 (i8*, i64, i8*, ...) @snprintf(i8* ${dest}, i64 ${remaining}, i8* ${fmt}, double ${elemVal})`,
  );
  const writtenI64 = gen.nextTemp();
  gen.emit(`${writtenI64} = sext i32 ${written} to i64`);
  const newOff = gen.nextTemp();
  gen.emit(`${newOff} = add i64 ${curOff}, ${writtenI64}`);
  gen.emitStore("i64", newOff, offsetPtr);

  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  gen.setVariableType(resultBuffer, "i8*");
  return resultBuffer;
}

function generateStringArrayJoin(
  gen: IGeneratorContext,
  arrayPtr: string,
  separator: string,
): string {
  const lenPtr = gen.nextTemp();
  gen.emit(
    `${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
  );
  const length = gen.emitLoad("i32", lenPtr);

  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtr = gen.emitLoad("i8**", dataPtrField);

  const sepLen = gen.emitCall("i64", "@strlen", `i8* ${separator}`);

  // First pass: compute total size
  const totalSizePtr = gen.nextAllocaReg("join_total");
  gen.emit(`${totalSizePtr} = alloca i64`);
  gen.emitStore("i64", "0", totalSizePtr);

  const sizeCheckLabel = gen.nextLabel("join_size_check");
  const sizeBodyLabel = gen.nextLabel("join_size_body");
  const sizeEndLabel = gen.nextLabel("join_size_end");

  const sizeCounterPtr = gen.nextAllocaReg("join_size_idx");
  gen.emit(`${sizeCounterPtr} = alloca i32`);
  gen.emitStore("i32", "0", sizeCounterPtr);

  gen.emitBr(sizeCheckLabel);

  gen.emitLabel(sizeCheckLabel);
  const sizeCounter = gen.emitLoad("i32", sizeCounterPtr);
  const sizeCond = gen.emitIcmp("slt", "i32", sizeCounter, length);
  gen.emitBrCond(sizeCond, sizeBodyLabel, sizeEndLabel);

  gen.emitLabel(sizeBodyLabel);
  const sizeElemPtr = gen.nextTemp();
  gen.emit(`${sizeElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${sizeCounter}`);
  const sizeElem = gen.emitLoad("i8*", sizeElemPtr);
  const sizeElemNull = gen.emitIcmp("eq", "i8*", sizeElem, "null");
  const sizeSkipLabel = gen.nextLabel("join_size_skip");
  const sizeAddLabel = gen.nextLabel("join_size_add");
  gen.emitBrCond(sizeElemNull, sizeSkipLabel, sizeAddLabel);

  gen.emitLabel(sizeAddLabel);
  const elemLen = gen.emitCall("i64", "@strlen", `i8* ${sizeElem}`);
  const curTotal = gen.emitLoad("i64", totalSizePtr);
  const newTotal = gen.nextTemp();
  gen.emit(`${newTotal} = add i64 ${curTotal}, ${elemLen}`);
  gen.emitStore("i64", newTotal, totalSizePtr);
  gen.emitBr(sizeSkipLabel);

  gen.emitLabel(sizeSkipLabel);
  const sizeNextCounter = gen.nextTemp();
  gen.emit(`${sizeNextCounter} = add i32 ${sizeCounter}, 1`);
  gen.emitStore("i32", sizeNextCounter, sizeCounterPtr);
  gen.emitBr(sizeCheckLabel);

  gen.emitLabel(sizeEndLabel);
  const elemTotal = gen.emitLoad("i64", totalSizePtr);
  const lengthI64 = gen.nextTemp();
  gen.emit(`${lengthI64} = sext i32 ${length} to i64`);
  const hasElements = gen.nextTemp();
  gen.emit(`${hasElements} = icmp sgt i64 ${lengthI64}, 0`);
  const sepCountRaw = gen.nextTemp();
  gen.emit(`${sepCountRaw} = sub i64 ${lengthI64}, 1`);
  const sepCount = gen.nextTemp();
  gen.emit(`${sepCount} = select i1 ${hasElements}, i64 ${sepCountRaw}, i64 0`);
  const totalSepLen = gen.nextTemp();
  gen.emit(`${totalSepLen} = mul i64 ${sepCount}, ${sepLen}`);
  const totalWithSep = gen.nextTemp();
  gen.emit(`${totalWithSep} = add i64 ${elemTotal}, ${totalSepLen}`);
  const finalSize = gen.nextTemp();
  gen.emit(`${finalSize} = add i64 ${totalWithSep}, 1`);
  const resultBuffer = gen.emitCall("i8*", "@GC_malloc_atomic", `i64 ${finalSize}`);

  // Second pass: copy elements with separators
  const offsetPtr = gen.nextAllocaReg("join_offset");
  gen.emit(`${offsetPtr} = alloca i64`);
  gen.emitStore("i64", "0", offsetPtr);

  const checkLabel = gen.nextLabel("join_check");
  const bodyLabel = gen.nextLabel("join_body");
  const endLabel = gen.nextLabel("join_end");

  const counterPtr = gen.nextAllocaReg("join_idx");
  gen.emit(`${counterPtr} = alloca i32`);
  gen.emitStore("i32", "0", counterPtr);

  gen.emitBr(checkLabel);

  gen.emitLabel(checkLabel);
  const counter = gen.emitLoad("i32", counterPtr);
  const cond = gen.emitIcmp("slt", "i32", counter, length);
  gen.emitBrCond(cond, bodyLabel, endLabel);

  gen.emitLabel(bodyLabel);
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${counter}`);
  const elem = gen.emitLoad("i8*", elemPtr);

  const elemIsNull = gen.emitIcmp("eq", "i8*", elem, "null");
  const elemSkipLabel = gen.nextLabel("join_elem_skip");
  const elemCopyLabel = gen.nextLabel("join_elem_copy");
  gen.emitBrCond(elemIsNull, elemSkipLabel, elemCopyLabel);

  gen.emitLabel(elemCopyLabel);
  const isNotFirst = gen.emitIcmp("sgt", "i32", counter, "0");
  const addSepLabel = gen.nextLabel("join_add_sep");
  const afterSepLabel = gen.nextLabel("join_after_sep");
  gen.emitBrCond(isNotFirst, addSepLabel, afterSepLabel);

  gen.emitLabel(addSepLabel);
  const sepOffset = gen.emitLoad("i64", offsetPtr);
  const sepDst = gen.nextTemp();
  gen.emit(`${sepDst} = getelementptr inbounds i8, i8* ${resultBuffer}, i64 ${sepOffset}`);
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${sepDst}, i8* ${separator}, i64 ${sepLen}, i1 false)`,
  );
  const sepOffsetNew = gen.nextTemp();
  gen.emit(`${sepOffsetNew} = add i64 ${sepOffset}, ${sepLen}`);
  gen.emitStore("i64", sepOffsetNew, offsetPtr);
  gen.emitBr(afterSepLabel);

  gen.emitLabel(afterSepLabel);
  const curOffset = gen.emitLoad("i64", offsetPtr);
  const elemDst = gen.nextTemp();
  gen.emit(`${elemDst} = getelementptr inbounds i8, i8* ${resultBuffer}, i64 ${curOffset}`);
  const elemLength = gen.emitCall("i64", "@strlen", `i8* ${elem}`);
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${elemDst}, i8* ${elem}, i64 ${elemLength}, i1 false)`,
  );
  const newOffset = gen.nextTemp();
  gen.emit(`${newOffset} = add i64 ${curOffset}, ${elemLength}`);
  gen.emitStore("i64", newOffset, offsetPtr);
  gen.emitBr(elemSkipLabel);

  gen.emitLabel(elemSkipLabel);
  const nextCounter = gen.nextTemp();
  gen.emit(`${nextCounter} = add i32 ${counter}, 1`);
  gen.emitStore("i32", nextCounter, counterPtr);
  gen.emitBr(checkLabel);

  gen.emitLabel(endLabel);
  const finalOffset = gen.emitLoad("i64", offsetPtr);
  const nullTermPtr = gen.nextTemp();
  gen.emit(`${nullTermPtr} = getelementptr inbounds i8, i8* ${resultBuffer}, i64 ${finalOffset}`);
  gen.emitStore("i8", "0", nullTermPtr);
  gen.setVariableType(resultBuffer, "i8*");
  return resultBuffer;
}

// ============================================
// slice
// ============================================

function normalizeSliceIndex(gen: IGeneratorContext, rawI32: string, length: string): string {
  const isNeg = gen.emitIcmp("slt", "i32", rawI32, "0");
  const adjusted = gen.nextTemp();
  gen.emit(`${adjusted} = add i32 ${length}, ${rawI32}`);
  const selected = gen.nextTemp();
  gen.emit(`${selected} = select i1 ${isNeg}, i32 ${adjusted}, i32 ${rawI32}`);
  const tooSmall = gen.emitIcmp("slt", "i32", selected, "0");
  const clamped = gen.nextTemp();
  gen.emit(`${clamped} = select i1 ${tooSmall}, i32 0, i32 ${selected}`);
  const tooBig = gen.emitIcmp("sgt", "i32", clamped, length);
  const final = gen.nextTemp();
  gen.emit(`${final} = select i1 ${tooBig}, i32 ${length}, i32 ${clamped}`);
  return final;
}

export function generateArraySlice(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  const arrayPtr = gen.generateExpression(expr.object, params);

  let isStringArray = false;
  let isObjectArray = false;
  const exprObjBase = expr.object as { type: string };
  if (exprObjBase.type === "variable") {
    const varName = (expr.object as VariableNode).name;
    const varType = gen.getVariableType(varName);
    isStringArray = varType === "%StringArray*" || varType === "%StringArray";
    isObjectArray = gen.symbolTable.isObjectArray(varName);
  } else if (exprObjBase.type === "member_access") {
    const ptrType = gen.getVariableType(arrayPtr);
    isStringArray = ptrType === "%StringArray*";
    if (!isStringArray && ptrType && ptrType.indexOf("*") !== -1 && ptrType !== "%Array*") {
      isObjectArray = true;
    }
  } else {
    const ptrType = gen.getVariableType(arrayPtr);
    isStringArray = ptrType === "%StringArray*";
  }

  if (isStringArray || isObjectArray) {
    return generateStringArraySlice(gen, arrayPtr, expr, params, isObjectArray);
  }

  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.emitLoad("i32", lenPtr);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.emitLoad("double*", dataPtrField);

  let startI32 = "0";
  if (expr.args.length >= 1) {
    const startDouble = gen.generateExpression(expr.args[0], params);
    const dblStart = gen.ensureDouble(startDouble);
    const rawStart = gen.nextTemp();
    gen.emit(`${rawStart} = fptosi double ${dblStart} to i32`);
    startI32 = normalizeSliceIndex(gen, rawStart, length);
  }

  let endI32 = length;
  if (expr.args.length >= 2) {
    const endDouble = gen.generateExpression(expr.args[1], params);
    const dblEnd = gen.ensureDouble(endDouble);
    const rawEnd = gen.nextTemp();
    gen.emit(`${rawEnd} = fptosi double ${dblEnd} to i32`);
    endI32 = normalizeSliceIndex(gen, rawEnd, length);
  }

  const sliceLen = gen.nextTemp();
  gen.emit(`${sliceLen} = sub i32 ${endI32}, ${startI32}`);
  const lenIsNeg = gen.emitIcmp("slt", "i32", sliceLen, "0");
  const finalSliceLen = gen.nextTemp();
  gen.emit(`${finalSliceLen} = select i1 ${lenIsNeg}, i32 0, i32 ${sliceLen}`);

  const sizePtr = gen.nextTemp();
  gen.emit(`${sizePtr} = getelementptr %Array, %Array* null, i32 1`);
  const structSize = gen.nextTemp();
  gen.emit(`${structSize} = ptrtoint %Array* ${sizePtr} to i64`);
  const arrayMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
  const newArrayPtr = gen.emitBitcast(arrayMem, "i8*", "%Array*");

  const sliceLenI64 = gen.nextTemp();
  gen.emit(`${sliceLenI64} = zext i32 ${finalSliceLen} to i64`);
  const dataSize = gen.nextTemp();
  gen.emit(`${dataSize} = mul i64 ${sliceLenI64}, 8`);
  const dataMem = gen.emitCall("i8*", "@GC_malloc_atomic", `i64 ${dataSize}`);
  const newDataPtr = gen.emitBitcast(dataMem, "i8*", "double*");

  const srcStartPtr = gen.nextTemp();
  gen.emit(`${srcStartPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${startI32}`);
  const srcCast = gen.emitBitcast(srcStartPtr, "double*", "i8*");
  const dstCast = gen.emitBitcast(newDataPtr, "double*", "i8*");
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dstCast}, i8* ${srcCast}, i64 ${dataSize}, i1 false)`,
  );

  const newDataField = gen.nextTemp();
  gen.emit(`${newDataField} = getelementptr inbounds %Array, %Array* ${newArrayPtr}, i32 0, i32 0`);
  gen.emitStore("double*", newDataPtr, newDataField);

  const newLenField = gen.nextTemp();
  gen.emit(`${newLenField} = getelementptr inbounds %Array, %Array* ${newArrayPtr}, i32 0, i32 1`);
  gen.emitStore("i32", finalSliceLen, newLenField);

  const newCapField = gen.nextTemp();
  gen.emit(`${newCapField} = getelementptr inbounds %Array, %Array* ${newArrayPtr}, i32 0, i32 2`);
  gen.emitStore("i32", finalSliceLen, newCapField);

  gen.setVariableType(newArrayPtr, "%Array*");
  return newArrayPtr;
}

function generateStringArraySlice(
  gen: IGeneratorContext,
  arrayPtr: string,
  expr: MethodCallNode,
  params: string[],
  isObjectArray: boolean = false,
): string {
  const arrType = isObjectArray ? "%ObjectArray" : "%StringArray";
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds ${arrType}, ${arrType}* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.emitLoad("i32", lenPtr);

  const dataPtrField = gen.nextTemp();
  gen.emit(
    `${dataPtrField} = getelementptr inbounds ${arrType}, ${arrType}* ${arrayPtr}, i32 0, i32 0`,
  );
  let dataPtr: string;
  if (isObjectArray) {
    const rawDataPtr = gen.emitLoad("i8*", dataPtrField);
    dataPtr = gen.emitBitcast(rawDataPtr, "i8*", "i8**");
  } else {
    dataPtr = gen.emitLoad("i8**", dataPtrField);
  }

  let startI32 = "0";
  if (expr.args.length >= 1) {
    const startDouble = gen.generateExpression(expr.args[0], params);
    const dblStart = gen.ensureDouble(startDouble);
    const rawStart = gen.nextTemp();
    gen.emit(`${rawStart} = fptosi double ${dblStart} to i32`);
    startI32 = normalizeSliceIndex(gen, rawStart, length);
  }

  let endI32 = length;
  if (expr.args.length >= 2) {
    const endDouble = gen.generateExpression(expr.args[1], params);
    const dblEnd = gen.ensureDouble(endDouble);
    const rawEnd = gen.nextTemp();
    gen.emit(`${rawEnd} = fptosi double ${dblEnd} to i32`);
    endI32 = normalizeSliceIndex(gen, rawEnd, length);
  }

  const sliceLen = gen.nextTemp();
  gen.emit(`${sliceLen} = sub i32 ${endI32}, ${startI32}`);
  const lenIsNeg = gen.emitIcmp("slt", "i32", sliceLen, "0");
  const finalSliceLen = gen.nextTemp();
  gen.emit(`${finalSliceLen} = select i1 ${lenIsNeg}, i32 0, i32 ${sliceLen}`);

  const sizePtr = gen.nextTemp();
  gen.emit(`${sizePtr} = getelementptr ${arrType}, ${arrType}* null, i32 1`);
  const structSize = gen.nextTemp();
  gen.emit(`${structSize} = ptrtoint ${arrType}* ${sizePtr} to i64`);
  const arrayMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
  const newArrayPtr = gen.emitBitcast(arrayMem, "i8*", `${arrType}*`);

  const sliceLenI64 = gen.nextTemp();
  gen.emit(`${sliceLenI64} = zext i32 ${finalSliceLen} to i64`);
  const dataSize = gen.nextTemp();
  gen.emit(`${dataSize} = mul i64 ${sliceLenI64}, 8`);
  const dataMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
  const newDataPtr = gen.emitBitcast(dataMem, "i8*", "i8**");

  const srcStartPtr = gen.nextTemp();
  gen.emit(`${srcStartPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${startI32}`);
  const srcCast = gen.emitBitcast(srcStartPtr, "i8**", "i8*");
  const dstCast = gen.emitBitcast(newDataPtr, "i8**", "i8*");
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dstCast}, i8* ${srcCast}, i64 ${dataSize}, i1 false)`,
  );

  const newDataField = gen.nextTemp();
  gen.emit(
    `${newDataField} = getelementptr inbounds ${arrType}, ${arrType}* ${newArrayPtr}, i32 0, i32 0`,
  );
  if (isObjectArray) {
    const dataAsi8 = gen.emitBitcast(newDataPtr, "i8**", "i8*");
    gen.emitStore("i8*", dataAsi8, newDataField);
  } else {
    gen.emitStore("i8**", newDataPtr, newDataField);
  }

  const newLenField = gen.nextTemp();
  gen.emit(
    `${newLenField} = getelementptr inbounds ${arrType}, ${arrType}* ${newArrayPtr}, i32 0, i32 1`,
  );
  gen.emitStore("i32", finalSliceLen, newLenField);

  const newCapField = gen.nextTemp();
  gen.emit(
    `${newCapField} = getelementptr inbounds ${arrType}, ${arrType}* ${newArrayPtr}, i32 0, i32 2`,
  );
  gen.emitStore("i32", finalSliceLen, newCapField);

  gen.setVariableType(newArrayPtr, `${arrType}*`);
  return newArrayPtr;
}

// ============================================
// concat
// ============================================

export function generateArrayConcat(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  const arrayPtr = gen.generateExpression(expr.object, params);

  let isStringArray = false;
  let isObjectArray = false;
  const exprObjBase = expr.object as { type: string };
  if (exprObjBase.type === "variable") {
    const varName = (expr.object as VariableNode).name;
    const varType = gen.getVariableType(varName);
    isStringArray = varType === "%StringArray*" || varType === "%StringArray";
    isObjectArray = varType === "%ObjectArray*";
  } else {
    const ptrType = gen.getVariableType(arrayPtr);
    isStringArray = ptrType === "%StringArray*";
    isObjectArray = ptrType === "%ObjectArray*";
  }

  if (expr.args.length !== 1) {
    return gen.emitError("concat() requires exactly 1 argument", expr.loc);
  }

  const otherArrayPtr = gen.generateExpression(expr.args[0], params);

  if (isStringArray) {
    return generateStringArrayConcat(gen, arrayPtr, otherArrayPtr);
  }
  if (isObjectArray) {
    return generateObjectArrayConcat(gen, arrayPtr, otherArrayPtr);
  }

  // Number array concat
  const lenPtr1 = gen.nextTemp();
  gen.emit(`${lenPtr1} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const len1 = gen.emitLoad("i32", lenPtr1);

  const lenPtr2 = gen.nextTemp();
  gen.emit(`${lenPtr2} = getelementptr inbounds %Array, %Array* ${otherArrayPtr}, i32 0, i32 1`);
  const len2 = gen.emitLoad("i32", lenPtr2);

  const totalLen = gen.nextTemp();
  gen.emit(`${totalLen} = add i32 ${len1}, ${len2}`);

  const sizePtr = gen.nextTemp();
  gen.emit(`${sizePtr} = getelementptr %Array, %Array* null, i32 1`);
  const structSize = gen.nextTemp();
  gen.emit(`${structSize} = ptrtoint %Array* ${sizePtr} to i64`);
  const arrayMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
  const newArrayPtr = gen.emitBitcast(arrayMem, "i8*", "%Array*");

  const totalLenI64 = gen.nextTemp();
  gen.emit(`${totalLenI64} = zext i32 ${totalLen} to i64`);
  const dataSize = gen.nextTemp();
  gen.emit(`${dataSize} = mul i64 ${totalLenI64}, 8`);
  const dataMem = gen.emitCall("i8*", "@GC_malloc_atomic", `i64 ${dataSize}`);
  const newDataPtr = gen.emitBitcast(dataMem, "i8*", "double*");

  // Copy first array
  const dataPtrField1 = gen.nextTemp();
  gen.emit(`${dataPtrField1} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr1 = gen.emitLoad("double*", dataPtrField1);

  const len1I64 = gen.nextTemp();
  gen.emit(`${len1I64} = zext i32 ${len1} to i64`);
  const size1 = gen.nextTemp();
  gen.emit(`${size1} = mul i64 ${len1I64}, 8`);
  const src1 = gen.emitBitcast(dataPtr1, "double*", "i8*");
  const dst1 = gen.emitBitcast(newDataPtr, "double*", "i8*");
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dst1}, i8* ${src1}, i64 ${size1}, i1 false)`,
  );

  // Copy second array
  const dataPtrField2 = gen.nextTemp();
  gen.emit(
    `${dataPtrField2} = getelementptr inbounds %Array, %Array* ${otherArrayPtr}, i32 0, i32 0`,
  );
  const dataPtr2 = gen.emitLoad("double*", dataPtrField2);

  const len2I64 = gen.nextTemp();
  gen.emit(`${len2I64} = zext i32 ${len2} to i64`);
  const size2 = gen.nextTemp();
  gen.emit(`${size2} = mul i64 ${len2I64}, 8`);
  const src2 = gen.emitBitcast(dataPtr2, "double*", "i8*");
  const dstOffset = gen.nextTemp();
  gen.emit(`${dstOffset} = getelementptr inbounds double, double* ${newDataPtr}, i32 ${len1}`);
  const dst2 = gen.emitBitcast(dstOffset, "double*", "i8*");
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dst2}, i8* ${src2}, i64 ${size2}, i1 false)`,
  );

  // Set up result struct fields
  const newDataField = gen.nextTemp();
  gen.emit(`${newDataField} = getelementptr inbounds %Array, %Array* ${newArrayPtr}, i32 0, i32 0`);
  gen.emitStore("double*", newDataPtr, newDataField);

  const newLenField = gen.nextTemp();
  gen.emit(`${newLenField} = getelementptr inbounds %Array, %Array* ${newArrayPtr}, i32 0, i32 1`);
  gen.emitStore("i32", totalLen, newLenField);

  const newCapField = gen.nextTemp();
  gen.emit(`${newCapField} = getelementptr inbounds %Array, %Array* ${newArrayPtr}, i32 0, i32 2`);
  gen.emitStore("i32", totalLen, newCapField);

  gen.setVariableType(newArrayPtr, "%Array*");
  return newArrayPtr;
}

function generateStringArrayConcat(
  gen: IGeneratorContext,
  arrayPtr: string,
  otherArrayPtr: string,
): string {
  const lenPtr1 = gen.nextTemp();
  gen.emit(
    `${lenPtr1} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
  );
  const len1 = gen.emitLoad("i32", lenPtr1);

  const lenPtr2 = gen.nextTemp();
  gen.emit(
    `${lenPtr2} = getelementptr inbounds %StringArray, %StringArray* ${otherArrayPtr}, i32 0, i32 1`,
  );
  const len2 = gen.emitLoad("i32", lenPtr2);

  const totalLen = gen.nextTemp();
  gen.emit(`${totalLen} = add i32 ${len1}, ${len2}`);

  const sizePtr = gen.nextTemp();
  gen.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
  const structSize = gen.nextTemp();
  gen.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
  const arrayMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
  const newArrayPtr = gen.emitBitcast(arrayMem, "i8*", "%StringArray*");

  const totalLenI64 = gen.nextTemp();
  gen.emit(`${totalLenI64} = zext i32 ${totalLen} to i64`);
  const dataSize = gen.nextTemp();
  gen.emit(`${dataSize} = mul i64 ${totalLenI64}, 8`);
  const dataMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
  const newDataPtr = gen.emitBitcast(dataMem, "i8*", "i8**");

  const dataPtrField1 = gen.nextTemp();
  gen.emit(
    `${dataPtrField1} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataPtr1 = gen.emitLoad("i8**", dataPtrField1);

  const len1I64 = gen.nextTemp();
  gen.emit(`${len1I64} = zext i32 ${len1} to i64`);
  const size1 = gen.nextTemp();
  gen.emit(`${size1} = mul i64 ${len1I64}, 8`);
  const src1 = gen.emitBitcast(dataPtr1, "i8**", "i8*");
  const dst1 = gen.emitBitcast(newDataPtr, "i8**", "i8*");
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dst1}, i8* ${src1}, i64 ${size1}, i1 false)`,
  );

  const dataPtrField2 = gen.nextTemp();
  gen.emit(
    `${dataPtrField2} = getelementptr inbounds %StringArray, %StringArray* ${otherArrayPtr}, i32 0, i32 0`,
  );
  const dataPtr2 = gen.emitLoad("i8**", dataPtrField2);

  const len2I64 = gen.nextTemp();
  gen.emit(`${len2I64} = zext i32 ${len2} to i64`);
  const size2 = gen.nextTemp();
  gen.emit(`${size2} = mul i64 ${len2I64}, 8`);
  const src2 = gen.emitBitcast(dataPtr2, "i8**", "i8*");
  const dstOffset = gen.nextTemp();
  gen.emit(`${dstOffset} = getelementptr inbounds i8*, i8** ${newDataPtr}, i32 ${len1}`);
  const dst2 = gen.emitBitcast(dstOffset, "i8**", "i8*");
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dst2}, i8* ${src2}, i64 ${size2}, i1 false)`,
  );

  const newDataField = gen.nextTemp();
  gen.emit(
    `${newDataField} = getelementptr inbounds %StringArray, %StringArray* ${newArrayPtr}, i32 0, i32 0`,
  );
  gen.emitStore("i8**", newDataPtr, newDataField);

  const newLenField = gen.nextTemp();
  gen.emit(
    `${newLenField} = getelementptr inbounds %StringArray, %StringArray* ${newArrayPtr}, i32 0, i32 1`,
  );
  gen.emitStore("i32", totalLen, newLenField);

  const newCapField = gen.nextTemp();
  gen.emit(
    `${newCapField} = getelementptr inbounds %StringArray, %StringArray* ${newArrayPtr}, i32 0, i32 2`,
  );
  gen.emitStore("i32", totalLen, newCapField);

  gen.setVariableType(newArrayPtr, "%StringArray*");
  return newArrayPtr;
}

function generateObjectArrayConcat(
  gen: IGeneratorContext,
  arrayPtr: string,
  otherArrayPtr: string,
): string {
  const lenPtr1 = gen.nextTemp();
  gen.emit(
    `${lenPtr1} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`,
  );
  const len1 = gen.emitLoad("i32", lenPtr1);

  const lenPtr2 = gen.nextTemp();
  gen.emit(
    `${lenPtr2} = getelementptr inbounds %ObjectArray, %ObjectArray* ${otherArrayPtr}, i32 0, i32 1`,
  );
  const len2 = gen.emitLoad("i32", lenPtr2);

  const totalLen = gen.nextTemp();
  gen.emit(`${totalLen} = add i32 ${len1}, ${len2}`);

  const sizePtr = gen.nextTemp();
  gen.emit(`${sizePtr} = getelementptr %ObjectArray, %ObjectArray* null, i32 1`);
  const structSize = gen.nextTemp();
  gen.emit(`${structSize} = ptrtoint %ObjectArray* ${sizePtr} to i64`);
  const arrayMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
  const newArrayPtr = gen.emitBitcast(arrayMem, "i8*", "%ObjectArray*");

  const totalLenI64 = gen.nextTemp();
  gen.emit(`${totalLenI64} = zext i32 ${totalLen} to i64`);
  const dataSize = gen.nextTemp();
  gen.emit(`${dataSize} = mul i64 ${totalLenI64}, 8`);
  const dataMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
  const newDataPtr = gen.emitBitcast(dataMem, "i8*", "i8**");

  const dataPtrField1 = gen.nextTemp();
  gen.emit(
    `${dataPtrField1} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
  );
  const dataI8_1 = gen.emitLoad("i8*", dataPtrField1);
  const dataPtr1 = gen.emitBitcast(dataI8_1, "i8*", "i8**");

  const len1I64 = gen.nextTemp();
  gen.emit(`${len1I64} = zext i32 ${len1} to i64`);
  const size1 = gen.nextTemp();
  gen.emit(`${size1} = mul i64 ${len1I64}, 8`);
  const src1 = gen.emitBitcast(dataPtr1, "i8**", "i8*");
  const dst1 = gen.emitBitcast(newDataPtr, "i8**", "i8*");
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dst1}, i8* ${src1}, i64 ${size1}, i1 false)`,
  );

  const dataPtrField2 = gen.nextTemp();
  gen.emit(
    `${dataPtrField2} = getelementptr inbounds %ObjectArray, %ObjectArray* ${otherArrayPtr}, i32 0, i32 0`,
  );
  const dataI8_2 = gen.emitLoad("i8*", dataPtrField2);
  const dataPtr2 = gen.emitBitcast(dataI8_2, "i8*", "i8**");

  const len2I64 = gen.nextTemp();
  gen.emit(`${len2I64} = zext i32 ${len2} to i64`);
  const size2 = gen.nextTemp();
  gen.emit(`${size2} = mul i64 ${len2I64}, 8`);
  const src2 = gen.emitBitcast(dataPtr2, "i8**", "i8*");
  const dstOffset = gen.nextTemp();
  gen.emit(`${dstOffset} = getelementptr inbounds i8*, i8** ${newDataPtr}, i32 ${len1}`);
  const dst2 = gen.emitBitcast(dstOffset, "i8**", "i8*");
  gen.emit(
    `call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dst2}, i8* ${src2}, i64 ${size2}, i1 false)`,
  );

  const newDataField = gen.nextTemp();
  gen.emit(
    `${newDataField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${newArrayPtr}, i32 0, i32 0`,
  );
  const newDataI8 = gen.emitBitcast(newDataPtr, "i8**", "i8*");
  gen.emitStore("i8*", newDataI8, newDataField);

  const newLenField = gen.nextTemp();
  gen.emit(
    `${newLenField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${newArrayPtr}, i32 0, i32 1`,
  );
  gen.emitStore("i32", totalLen, newLenField);

  const newCapField = gen.nextTemp();
  gen.emit(
    `${newCapField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${newArrayPtr}, i32 0, i32 2`,
  );
  gen.emitStore("i32", totalLen, newCapField);

  gen.setVariableType(newArrayPtr, "%ObjectArray*");
  return newArrayPtr;
}
