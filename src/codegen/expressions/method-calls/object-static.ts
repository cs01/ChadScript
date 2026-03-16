import { MethodCallNode, VariableNode, InterfaceDeclaration } from "../../../ast/types.js";
import type { MethodCallGeneratorContext } from "../method-calls.js";
import { getInterfaceFromAST, type InterfaceDefInfo } from "./class-dispatch.js";

function getObjectFieldInfo(
  ctx: MethodCallGeneratorContext,
  name: string,
): { keys: string[]; types: string[]; ptr: string } | null {
  let fieldNames: string[] = [];
  let fieldTypes: string[] = [];

  const interfaceType = ctx.symbolTable.getInterfaceType(name);
  if (interfaceType) {
    const ifaceDef = getInterfaceFromAST(ctx, interfaceType);
    if (ifaceDef) {
      for (let i = 0; i < ifaceDef.properties.length; i++) {
        fieldNames.push(ifaceDef.properties[i].name);
        const propType = ifaceDef.properties[i].type;
        if (propType === "number") {
          fieldTypes.push("double");
        } else if (propType === "string") {
          fieldTypes.push("i8*");
        } else if (propType === "boolean") {
          fieldTypes.push("double");
        } else {
          fieldTypes.push("i8*");
        }
      }
    }
  }

  if (fieldNames.length === 0) {
    const objInfo = ctx.symbolTable.getObjectInfo(name);
    if (objInfo) {
      fieldNames = objInfo.keys;
      fieldTypes = objInfo.types;
    }
  }

  if (fieldNames.length === 0) return null;

  const alloca = ctx.symbolTable.getAlloca(name);
  if (!alloca) return null;

  return { keys: fieldNames, types: fieldTypes, ptr: alloca };
}

export function generateObjectKeys(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  if (expr.args.length === 0) {
    return ctx.emitError("Object.keys() requires 1 argument", expr.loc);
  }

  const arg = expr.args[0];
  const argBase = arg as { type: string };
  if (argBase.type !== "variable") {
    return ctx.emitError("Object.keys() argument must be a variable", expr.loc);
  }
  const name = (arg as VariableNode).name;

  let fieldNames: string[] = [];

  const interfaceType = ctx.symbolTable.getInterfaceType(name);
  if (interfaceType) {
    const ifaceDef = getInterfaceFromAST(ctx, interfaceType);
    if (ifaceDef) {
      for (let i = 0; i < ifaceDef.properties.length; i++) {
        fieldNames.push(ifaceDef.properties[i].name);
      }
    }
  }

  if (fieldNames.length === 0) {
    const objInfo = ctx.symbolTable.getObjectInfo(name);
    if (objInfo) {
      fieldNames = objInfo.keys;
    }
  }

  if (fieldNames.length === 0) {
    return ctx.emitError(`Object.keys(): cannot determine fields for '${name}'`, expr.loc);
  }

  const length = fieldNames.length;

  const sizePtr = ctx.nextTemp();
  ctx.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
  const structSize = ctx.nextTemp();
  ctx.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
  const arrayMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
  const arrayPtr = ctx.emitBitcast(arrayMem, "i8*", "%StringArray*");

  const dataSize = ctx.nextTemp();
  ctx.emit(`${dataSize} = mul i64 ${length}, 8`);
  const dataMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
  const dataPtr = ctx.emitBitcast(dataMem, "i8*", "i8**");

  for (let i = 0; i < fieldNames.length; i++) {
    const strConst = ctx.stringGen.doCreateStringConstant(fieldNames[i]);
    const elemPtr = ctx.nextTemp();
    ctx.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
    ctx.emitStore("i8*", strConst, elemPtr);
  }

  const dataPtrField = ctx.nextTemp();
  ctx.emit(
    `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  ctx.emitStore("i8**", dataPtr, dataPtrField);

  const lenField = ctx.nextTemp();
  ctx.emit(
    `${lenField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
  );
  ctx.emitStore("i32", `${length}`, lenField);

  const capField = ctx.nextTemp();
  ctx.emit(
    `${capField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`,
  );
  ctx.emitStore("i32", `${length}`, capField);

  ctx.setVariableType(arrayPtr, "%StringArray*");
  return arrayPtr;
}

export function generateObjectValues(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  _params: string[],
): string {
  if (expr.args.length === 0) {
    return ctx.emitError("Object.values() requires 1 argument", expr.loc);
  }

  const arg = expr.args[0];
  const argBase = arg as { type: string };
  if (argBase.type !== "variable") {
    return ctx.emitError("Object.values() argument must be a variable", expr.loc);
  }
  const name = (arg as VariableNode).name;

  const info = getObjectFieldInfo(ctx, name);
  if (!info) {
    return ctx.emitError(`Object.values(): cannot determine fields for '${name}'`, expr.loc);
  }

  const keys = info.keys;
  const types = info.types;
  const ptr = info.ptr;
  const length = keys.length;
  const structType = `{ ${types.join(", ")} }`;

  const allStrings = types.every((t) => t === "i8*");
  const allNumbers = types.every((t) => t === "double");

  const objPtr = ctx.emitLoad("i8*", ptr);
  const typedPtr = ctx.emitBitcast(objPtr, "i8*", `${structType}*`);

  if (allStrings) {
    const sizePtr = ctx.nextTemp();
    ctx.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
    const structSize = ctx.nextTemp();
    ctx.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
    const arrayMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
    const arrayPtr = ctx.emitBitcast(arrayMem, "i8*", "%StringArray*");

    const dataSize = ctx.nextTemp();
    ctx.emit(`${dataSize} = mul i64 ${length}, 8`);
    const dataMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
    const dataPtr = ctx.emitBitcast(dataMem, "i8*", "i8**");

    for (let i = 0; i < length; i++) {
      const fieldPtr = ctx.nextTemp();
      ctx.emit(
        `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${i}`,
      );
      const fieldVal = ctx.emitLoad("i8*", fieldPtr);
      const elemPtr = ctx.nextTemp();
      ctx.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
      ctx.emitStore("i8*", fieldVal, elemPtr);
    }

    const dataPtrField = ctx.nextTemp();
    ctx.emit(
      `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
    );
    ctx.emitStore("i8**", dataPtr, dataPtrField);

    const lenField = ctx.nextTemp();
    ctx.emit(
      `${lenField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
    );
    ctx.emitStore("i32", `${length}`, lenField);

    const capField = ctx.nextTemp();
    ctx.emit(
      `${capField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`,
    );
    ctx.emitStore("i32", `${length}`, capField);

    ctx.setVariableType(arrayPtr, "%StringArray*");
    return arrayPtr;
  } else if (allNumbers) {
    const sizePtr = ctx.nextTemp();
    ctx.emit(`${sizePtr} = getelementptr %Array, %Array* null, i32 1`);
    const structSize = ctx.nextTemp();
    ctx.emit(`${structSize} = ptrtoint %Array* ${sizePtr} to i64`);
    const arrayMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
    const arrayPtr = ctx.emitBitcast(arrayMem, "i8*", "%Array*");

    const dataSize = ctx.nextTemp();
    ctx.emit(`${dataSize} = mul i64 ${length}, 8`);
    const dataMem = ctx.emitCall("i8*", "@cs_arena_alloc", `i64 ${dataSize}`);
    const dataPtr = ctx.emitBitcast(dataMem, "i8*", "double*");

    for (let i = 0; i < length; i++) {
      const fieldPtr = ctx.nextTemp();
      ctx.emit(
        `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${i}`,
      );
      const fieldVal = ctx.emitLoad("double", fieldPtr);
      const elemPtr = ctx.nextTemp();
      ctx.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${i}`);
      ctx.emitStore("double", fieldVal, elemPtr);
    }

    const dataPtrField = ctx.nextTemp();
    ctx.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    ctx.emitStore("double*", dataPtr, dataPtrField);

    const lenField = ctx.nextTemp();
    ctx.emit(`${lenField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    ctx.emitStore("i32", `${length}`, lenField);

    const capField = ctx.nextTemp();
    ctx.emit(`${capField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    ctx.emitStore("i32", `${length}`, capField);

    ctx.setVariableType(arrayPtr, "%Array*");
    return arrayPtr;
  } else {
    const sizePtr = ctx.nextTemp();
    ctx.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
    const structSize = ctx.nextTemp();
    ctx.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
    const arrayMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
    const arrayPtr = ctx.emitBitcast(arrayMem, "i8*", "%StringArray*");

    const dataSize = ctx.nextTemp();
    ctx.emit(`${dataSize} = mul i64 ${length}, 8`);
    const dataMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
    const dataPtr = ctx.emitBitcast(dataMem, "i8*", "i8**");

    for (let i = 0; i < length; i++) {
      const fieldPtr = ctx.nextTemp();
      ctx.emit(
        `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${i}`,
      );
      if (types[i] === "i8*") {
        const fieldVal = ctx.emitLoad("i8*", fieldPtr);
        const elemPtr = ctx.nextTemp();
        ctx.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
        ctx.emitStore("i8*", fieldVal, elemPtr);
      } else {
        const fieldVal = ctx.emitLoad("double", fieldPtr);
        const strVal = ctx.stringGen.doConvertNumberToString(fieldVal);
        const elemPtr = ctx.nextTemp();
        ctx.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
        ctx.emitStore("i8*", strVal, elemPtr);
      }
    }

    const dataPtrField = ctx.nextTemp();
    ctx.emit(
      `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
    );
    ctx.emitStore("i8**", dataPtr, dataPtrField);

    const lenField = ctx.nextTemp();
    ctx.emit(
      `${lenField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
    );
    ctx.emitStore("i32", `${length}`, lenField);

    const capField = ctx.nextTemp();
    ctx.emit(
      `${capField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`,
    );
    ctx.emitStore("i32", `${length}`, capField);

    ctx.setVariableType(arrayPtr, "%StringArray*");
    return arrayPtr;
  }
}

export function generateObjectEntries(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  _params: string[],
): string {
  if (expr.args.length === 0) {
    return ctx.emitError("Object.entries() requires 1 argument", expr.loc);
  }

  const arg = expr.args[0];
  const argBase = arg as { type: string };
  if (argBase.type !== "variable") {
    return ctx.emitError("Object.entries() argument must be a variable", expr.loc);
  }
  const name = (arg as VariableNode).name;

  const info = getObjectFieldInfo(ctx, name);
  if (!info) {
    return ctx.emitError(`Object.entries(): cannot determine fields for '${name}'`, expr.loc);
  }

  const keys = info.keys;
  const types = info.types;
  const ptr = info.ptr;
  const length = keys.length;
  const structType = `{ ${types.join(", ")} }`;

  const objPtr = ctx.emitLoad("i8*", ptr);
  const typedPtr = ctx.emitBitcast(objPtr, "i8*", `${structType}*`);

  const flatLength = length * 2;

  const sizePtr = ctx.nextTemp();
  ctx.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
  const structSize = ctx.nextTemp();
  ctx.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
  const arrayMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
  const arrayPtr = ctx.emitBitcast(arrayMem, "i8*", "%StringArray*");

  const dataSize = ctx.nextTemp();
  ctx.emit(`${dataSize} = mul i64 ${flatLength}, 8`);
  const dataMem = ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
  const dataPtr = ctx.emitBitcast(dataMem, "i8*", "i8**");

  for (let i = 0; i < length; i++) {
    const keyConst = ctx.stringGen.doCreateStringConstant(keys[i]);
    const keyElemPtr = ctx.nextTemp();
    ctx.emit(`${keyElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i * 2}`);
    ctx.emitStore("i8*", keyConst, keyElemPtr);

    const fieldPtr = ctx.nextTemp();
    ctx.emit(
      `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${i}`,
    );

    let valueStr: string;
    if (types[i] === "i8*") {
      valueStr = ctx.emitLoad("i8*", fieldPtr);
    } else {
      const fieldVal = ctx.emitLoad("double", fieldPtr);
      valueStr = ctx.stringGen.doConvertNumberToString(fieldVal);
    }

    const valElemPtr = ctx.nextTemp();
    ctx.emit(`${valElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i * 2 + 1}`);
    ctx.emitStore("i8*", valueStr, valElemPtr);
  }

  const dataPtrField = ctx.nextTemp();
  ctx.emit(
    `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
  );
  ctx.emitStore("i8**", dataPtr, dataPtrField);

  const lenField = ctx.nextTemp();
  ctx.emit(
    `${lenField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
  );
  ctx.emitStore("i32", `${flatLength}`, lenField);

  const capField = ctx.nextTemp();
  ctx.emit(
    `${capField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`,
  );
  ctx.emitStore("i32", `${flatLength}`, capField);

  ctx.setVariableType(arrayPtr, "%StringArray*");
  return arrayPtr;
}
