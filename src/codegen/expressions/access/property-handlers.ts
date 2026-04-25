import { Expression, MemberAccessNode, VariableNode } from "../../../ast/types.js";
import type { MemberAccessGeneratorContext } from "./member.js";
import type { FieldInfo } from "../../infrastructure/type-resolver/types.js";
import { isAnyArrayTsType } from "../../infrastructure/type-system.js";

export function handleUrlProperty(
  ctx: MemberAccessGeneratorContext,
  expr: MemberAccessNode,
): string | null {
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type !== "variable") return null;
  const varName = (expr.object as VariableNode).name;
  if (!ctx.symbolTable.isUrl(varName)) return null;
  const prop = expr.property;
  const varAlloca = ctx.symbolTable.getAlloca(varName);
  if (!varAlloca) return null;
  const urlPtr = ctx.emitLoad("i8*", varAlloca);
  if (prop === "href") {
    ctx.setVariableType(urlPtr, "i8*");
    return urlPtr;
  }
  let urlFn = "";
  if (prop === "protocol") {
    urlFn = "@cs_url_parse_protocol";
  } else if (prop === "hostname") {
    urlFn = "@cs_url_parse_hostname";
  } else if (prop === "port") {
    urlFn = "@cs_url_parse_port";
  } else if (prop === "host") {
    urlFn = "@cs_url_parse_host";
  } else if (prop === "pathname") {
    urlFn = "@cs_url_parse_pathname";
  } else if (prop === "search" || prop === "searchParams") {
    urlFn = "@cs_url_parse_search";
  } else if (prop === "hash") {
    urlFn = "@cs_url_parse_hash";
  } else if (prop === "origin") {
    urlFn = "@cs_url_parse_origin";
  } else {
    return null;
  }
  const result = ctx.emitCall("i8*", urlFn, `i8* ${urlPtr}`);
  ctx.setVariableType(result, "i8*");
  return result;
}

interface ExprBase {
  type: string;
}

function hasObjectInfo(ctx: MemberAccessGeneratorContext, name: string): boolean {
  if (!ctx.symbolTable.isObject(name) && !ctx.symbolTable.isJSON(name)) return false;
  return ctx.symbolTable.getObjectMetadataKeys(name) !== undefined;
}

export function getArrayLength(
  ctx: MemberAccessGeneratorContext,
  obj: Expression,
  params: string[],
  arrayType: string,
): string {
  const arrayPtr = ctx.generateExpression(obj, params);
  const lenPtr = ctx.nextTemp();
  ctx.emit(
    `${lenPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${arrayPtr}, i32 0, i32 1`,
  );
  const lenI32 = ctx.nextTemp();
  ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
  const len = ctx.nextTemp();
  ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
  ctx.setVariableType(len, "double");
  return len;
}

export function getStringArrayLength(
  ctx: MemberAccessGeneratorContext,
  stringArrayPtr: string,
): string {
  const lenPtr = ctx.nextTemp();
  ctx.emit(
    `${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${stringArrayPtr}, i32 0, i32 1`,
  );
  const lenI32 = ctx.nextTemp();
  ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
  const len = ctx.nextTemp();
  ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
  ctx.setVariableType(len, "double");
  return len;
}

export function getStringArrayLengthFromPtr(
  ctx: MemberAccessGeneratorContext,
  ptr: string,
): string {
  const ptrType = ctx.getVariableType(ptr);
  let typedPtr = ptr;
  if (ptrType !== "%StringArray*") {
    typedPtr = ctx.nextTemp();
    ctx.emit(`${typedPtr} = bitcast i8* ${ptr} to %StringArray*`);
  }
  return getStringArrayLength(ctx, typedPtr);
}

export function getArrayLengthFromPtr(
  ctx: MemberAccessGeneratorContext,
  arrayPtr: string,
  arrayType: string,
): string {
  const lenPtr = ctx.nextTemp();
  ctx.emit(
    `${lenPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${arrayPtr}, i32 0, i32 1`,
  );
  const lenI32 = ctx.nextTemp();
  ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
  const len = ctx.nextTemp();
  ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
  ctx.setVariableType(len, "double");
  return len;
}

export function getStringLength(
  ctx: MemberAccessGeneratorContext,
  obj: Expression,
  params: string[],
): string {
  const objPtr = ctx.generateExpression(obj, params);
  const lenI64 = ctx.nextTemp();
  ctx.emit(`${lenI64} = call i64 @strlen(i8* ${objPtr})`);
  const lenI32 = ctx.nextTemp();
  ctx.emit(`${lenI32} = trunc i64 ${lenI64} to i32`);
  const len = ctx.nextTemp();
  ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
  ctx.setVariableType(len, "double");
  return len;
}

export function isProcessArgvLength(expr: MemberAccessNode): boolean {
  const exprObjBase = expr.object as ExprBase;
  const exprObjType = exprObjBase.type;
  if (exprObjType === null || exprObjType === undefined) return false;
  if (exprObjType !== "member_access") return false;
  const innerAccess = expr.object as MemberAccessNode;
  const innerAccessObjBase = innerAccess.object as ExprBase;
  return (
    innerAccessObjBase.type === "variable" &&
    (innerAccess.object as VariableNode).name === "process" &&
    innerAccess.property === "argv"
  );
}

export function handleMemberAccessLength(
  ctx: MemberAccessGeneratorContext,
  expr: MemberAccessNode,
  params: string[],
): string | null {
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type !== "member_access") return null;
  const innerAccess = expr.object as MemberAccessNode;

  const innerAccessObjBase = innerAccess.object as ExprBase;
  if (
    innerAccessObjBase.type === "variable" &&
    ctx.symbolTable.isClass((innerAccess.object as VariableNode).name)
  ) {
    const classMeta = ctx.symbolTable.getClassInfo((innerAccess.object as VariableNode).name);
    if (classMeta) {
      const fieldInfoResult = ctx.classGenGetFieldInfo(classMeta.className, innerAccess.property);
      const fieldInfo = fieldInfoResult as FieldInfo;
      if (fieldInfoResult && fieldInfo.type === "string[]") {
        const stringArrayPtr = ctx.generateExpression(expr.object, params);
        return getStringArrayLength(ctx, stringArrayPtr);
      } else if (
        fieldInfoResult &&
        (fieldInfo.type === "number[]" || fieldInfo.type === "boolean[]")
      ) {
        const arrayPtr = ctx.generateExpression(expr.object, params);
        return getArrayLengthFromPtr(ctx, arrayPtr, "%Array");
      } else if (fieldInfoResult && fieldInfo.tsType && isAnyArrayTsType(fieldInfo.tsType)) {
        const arrayPtr = ctx.generateExpression(expr.object, params);
        return getArrayLengthFromPtr(ctx, arrayPtr, "%Array");
      }
    }
  } else if (innerAccessObjBase.type === "variable") {
    const varName = (innerAccess.object as VariableNode).name;
    if (params.indexOf(varName) !== -1) {
      const paramInterfaceType = ctx.getParameterTypeFromAST(varName);
      if (paramInterfaceType && paramInterfaceType.length > 0) {
        const fieldType = ctx.getInterfaceFieldType(paramInterfaceType, innerAccess.property);
        if (fieldType) {
          if (fieldType === "string") {
            return getStringLength(ctx, expr.object, params);
          } else if (fieldType === "string[]") {
            const stringArrayPtr = ctx.generateExpression(expr.object, params);
            return getStringArrayLength(ctx, stringArrayPtr);
          } else if (isAnyArrayTsType(fieldType)) {
            const arrayPtr = ctx.generateExpression(expr.object, params);
            return getArrayLengthFromPtr(ctx, arrayPtr, "%ObjectArray");
          }
        }
      }
    }
    const symbolIfaceType = ctx.symbolTable.getInterfaceType(varName);
    if (symbolIfaceType && symbolIfaceType.length > 0) {
      const fieldType = ctx.getInterfaceFieldType(symbolIfaceType, innerAccess.property);
      if (fieldType) {
        if (fieldType === "string") {
          return getStringLength(ctx, expr.object, params);
        } else if (fieldType === "string[]") {
          const stringArrayPtr = ctx.generateExpression(expr.object, params);
          return getStringArrayLength(ctx, stringArrayPtr);
        } else if (isAnyArrayTsType(fieldType)) {
          const arrayPtr = ctx.generateExpression(expr.object, params);
          return getArrayLengthFromPtr(ctx, arrayPtr, "%ObjectArray");
        }
      }
    }
    const arrayPtr = ctx.generateExpression(expr.object, params);
    const arrayType = ctx.getVariableType(arrayPtr);
    if (arrayType === "%StringArray*") {
      return getStringArrayLength(ctx, arrayPtr);
    } else if (arrayType === "%Array*") {
      return getArrayLengthFromPtr(ctx, arrayPtr, "%Array");
    } else if (arrayType === "%ObjectArray*") {
      return getArrayLengthFromPtr(ctx, arrayPtr, "%ObjectArray");
    }
    if (ctx.symbolTable.isJSON(varName)) {
      ctx.setUsesJson(true);
      const arraySize = ctx.nextTemp();
      ctx.emit(`${arraySize} = call i32 @csyyjson_arr_size(i8* ${arrayPtr})`);
      const sizeDouble = ctx.nextTemp();
      ctx.emit(`${sizeDouble} = sitofp i32 ${arraySize} to double`);
      ctx.setVariableType(sizeDouble, "double");
      return sizeDouble;
    }
    if (ctx.symbolTable.isObject(varName)) {
      const objArrayPtr = ctx.nextTemp();
      ctx.emit(`${objArrayPtr} = bitcast i8* ${arrayPtr} to %ObjectArray*`);
      return getArrayLengthFromPtr(ctx, objArrayPtr, "%ObjectArray");
    }
  } else if (innerAccessObjBase.type === "this") {
    const className = ctx.getCurrentClassName();
    if (className) {
      const fieldInfoResult = ctx.classGenGetFieldInfo(className, innerAccess.property);
      const fieldInfo = fieldInfoResult as FieldInfo;
      if (fieldInfoResult && fieldInfo.type === "string[]") {
        const stringArrayPtr = ctx.generateExpression(expr.object, params);
        return getStringArrayLength(ctx, stringArrayPtr);
      } else if (
        fieldInfoResult &&
        (fieldInfo.type === "number[]" || fieldInfo.type === "boolean[]")
      ) {
        const arrayPtr = ctx.generateExpression(expr.object, params);
        return getArrayLengthFromPtr(ctx, arrayPtr, "%Array");
      } else if (fieldInfoResult && fieldInfo.tsType && isAnyArrayTsType(fieldInfo.tsType)) {
        const arrayPtr = ctx.generateExpression(expr.object, params);
        return getArrayLengthFromPtr(ctx, arrayPtr, "%Array");
      }
    }
  } else if (innerAccessObjBase.type === "member_access") {
    const arrayPtr = ctx.generateExpression(expr.object, params);
    const arrayType = ctx.getVariableType(arrayPtr);
    if (arrayType === "%StringArray*") {
      return getStringArrayLength(ctx, arrayPtr);
    } else if (arrayType === "%Array*") {
      return getArrayLengthFromPtr(ctx, arrayPtr, "%Array");
    } else if (arrayType === "%ObjectArray*") {
      return getArrayLengthFromPtr(ctx, arrayPtr, "%ObjectArray");
    }
  }
  return null;
}

export function handleLengthProperty(
  ctx: MemberAccessGeneratorContext,
  expr: MemberAccessNode,
  params: string[],
): string {
  const exprObjBase = expr.object as ExprBase;
  const exprObjType = exprObjBase.type;
  if (exprObjType === null || exprObjType === undefined) {
    return ctx.emitError(`cannot access .length on expression with unknown type`, expr.loc);
  }
  if (
    exprObjType === "variable" &&
    ctx.symbolTable.isNumberArray((expr.object as VariableNode).name)
  ) {
    return getArrayLength(ctx, expr.object, params, "%Array");
  }

  if (
    exprObjType === "variable" &&
    ctx.symbolTable.isObjectArray((expr.object as VariableNode).name)
  ) {
    return getArrayLength(ctx, expr.object, params, "%ObjectArray");
  }

  if (
    exprObjType === "variable" &&
    ctx.symbolTable.isUint8Array((expr.object as VariableNode).name)
  ) {
    return getArrayLength(ctx, expr.object, params, "%Uint8Array");
  }

  if (isProcessArgvLength(expr)) {
    const stringArrayPtr = ctx.generateExpression(expr.object, params);
    return getStringArrayLength(ctx, stringArrayPtr);
  }

  if (
    exprObjType === "variable" &&
    ctx.symbolTable.isStringArray((expr.object as VariableNode).name)
  ) {
    const stringArrayPtr = ctx.generateExpression(expr.object, params);
    return getStringArrayLength(ctx, stringArrayPtr);
  }

  if (exprObjType === "member_access") {
    const result = handleMemberAccessLength(ctx, expr, params);
    if (result !== null) return result;
    const arrayPtr = ctx.generateExpression(expr.object, params);
    const arrayType = ctx.getVariableType(arrayPtr);
    if (arrayType === "i8*") {
      const innerAccess = expr.object as MemberAccessNode;
      const innerObjBase = innerAccess.object as ExprBase;
      if (innerObjBase.type === "variable") {
        const innerVarName = (innerAccess.object as VariableNode).name;
        if (ctx.symbolTable.isObject(innerVarName) && !ctx.symbolTable.isJSON(innerVarName)) {
          const objArrayPtr = ctx.nextTemp();
          ctx.emit(`${objArrayPtr} = bitcast i8* ${arrayPtr} to %ObjectArray*`);
          return getArrayLengthFromPtr(ctx, objArrayPtr, "%ObjectArray");
        }
      }
      return getStringLength(ctx, expr.object, params);
    }
    if (arrayType === "%StringArray*") {
      return getStringArrayLengthFromPtr(ctx, arrayPtr);
    }
    if (arrayType === "%Array*") {
      return getArrayLengthFromPtr(ctx, arrayPtr, "%Array");
    }
    return getArrayLengthFromPtr(ctx, arrayPtr, "%ObjectArray");
  }

  if (exprObjType === "variable") {
    const varName = (expr.object as VariableNode).name;
    if (ctx.symbolTable.isNumber(varName) || ctx.symbolTable.isBoolean(varName)) {
      return ctx.emitError(
        `.length is not available on type '${ctx.symbolTable.isNumber(varName) ? "number" : "boolean"}'`,
        expr.loc,
      );
    }
    const objPtr = ctx.generateExpression(expr.object, params);
    const ptrType = ctx.getVariableType(objPtr);
    if (ptrType === "%StringArray*") {
      return getStringArrayLengthFromPtr(ctx, objPtr);
    }
    if (ptrType === "%Array*") {
      return getArrayLengthFromPtr(ctx, objPtr, "%Array");
    }
    if (ptrType === "%ObjectArray*") {
      return getArrayLengthFromPtr(ctx, objPtr, "%ObjectArray");
    }
  }

  if (exprObjType === "number") {
    return ctx.emitError(`.length is not available on type 'number'`, expr.loc);
  }

  if (exprObjType === "method_call" || exprObjType === "call") {
    const resultPtr = ctx.generateExpression(expr.object, params);
    const resultType = ctx.getVariableType(resultPtr);
    if (resultType === "%StringArray*") {
      return getStringArrayLengthFromPtr(ctx, resultPtr);
    }
    if (resultType === "%Array*") {
      return getArrayLengthFromPtr(ctx, resultPtr, "%Array");
    }
    if (resultType === "%ObjectArray*") {
      return getArrayLengthFromPtr(ctx, resultPtr, "%ObjectArray");
    }
    if (resultType === "%Uint8Array*") {
      return getArrayLengthFromPtr(ctx, resultPtr, "%Uint8Array");
    }
    const lenI64 = ctx.nextTemp();
    ctx.emit(`${lenI64} = call i64 @strlen(i8* ${resultPtr})`);
    const lenI32 = ctx.nextTemp();
    ctx.emit(`${lenI32} = trunc i64 ${lenI64} to i32`);
    const len = ctx.nextTemp();
    ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
    ctx.setVariableType(len, "double");
    return len;
  }

  return getStringLength(ctx, expr.object, params);
}

export function handleSizeProperty(
  ctx: MemberAccessGeneratorContext,
  expr: MemberAccessNode,
  params: string[],
): string | null {
  const exprObjBase = expr.object as ExprBase;
  const exprObjType = exprObjBase.type;
  if (exprObjType === null || exprObjType === undefined) {
    return null;
  }
  if (exprObjType === "variable" && ctx.symbolTable.isMap((expr.object as VariableNode).name)) {
    const varName = (expr.object as VariableNode).name;
    const mapMeta = ctx.symbolTable.getMapMetadata(varName);
    const mapPtr = ctx.generateExpression(expr.object, params);
    if (mapMeta && mapMeta.keyType === "string") {
      return ctx.stringMapGen.generateStringMapSize(mapPtr);
    }
    if (mapMeta && mapMeta.keyType !== "number") {
      return ctx.pointerMapGen.generatePointerMapSize(mapPtr);
    }
    return ctx.mapGen.generateMapSize(mapPtr);
  }
  if (exprObjType === "variable" && ctx.symbolTable.isSet((expr.object as VariableNode).name)) {
    const varName = (expr.object as VariableNode).name;
    const setValueType = ctx.symbolTable.getSetValueType(varName);
    const setPtr = ctx.generateExpression(expr.object, params);
    if (setValueType === "string") {
      return ctx.stringSetGen.generateStringSetSize(setPtr);
    }
    return ctx.setGen.generateSetSize(setPtr);
  }
  if (exprObjType === "member_access") {
    const innerAccess = expr.object as MemberAccessNode;
    const innerObjBase = innerAccess.object as ExprBase;
    // Resolve the class that owns the field: either `this.X` (own class) or
    // `<var>.X` where var is a class instance. Both share the same sizing
    // logic below — previously only `this.X` worked.
    let classNameForLookup: string | null = null;
    if (innerObjBase.type === "this") {
      classNameForLookup = ctx.getCurrentClassName();
    } else if (innerObjBase.type === "variable") {
      const varName = (innerAccess.object as VariableNode).name;
      const classInfo = ctx.symbolTable.getClassInfo(varName);
      if (classInfo) classNameForLookup = classInfo.className;
    }
    if (classNameForLookup) {
      const fieldInfo = ctx.classGenGetFieldInfo(classNameForLookup, innerAccess.property);
      if (fieldInfo && fieldInfo.tsType) {
        const isMap =
          fieldInfo.tsType.startsWith("Map<") || fieldInfo.tsType.indexOf("Map<") !== -1;
        const isSet =
          fieldInfo.tsType.startsWith("Set<") || fieldInfo.tsType.indexOf("Set<") !== -1;
        if (isMap || isSet) {
          const ptr = ctx.generateExpression(expr.object, params);
          if (isSet && fieldInfo.tsType.indexOf("Set<string") !== -1) {
            return ctx.stringSetGen.generateStringSetSize(ptr);
          } else if (isSet) {
            return ctx.setGen.generateSetSize(ptr);
          } else if (fieldInfo.tsType.indexOf("Map<string") !== -1) {
            return ctx.stringMapGen.generateStringMapSize(ptr);
          } else if (fieldInfo.tsType.indexOf("Map<number") !== -1) {
            return ctx.mapGen.generateMapSize(ptr);
          } else {
            return ctx.pointerMapGen.generatePointerMapSize(ptr);
          }
        }
      }
    }
  }
  return null;
}

export function handleResponseProperty(
  ctx: MemberAccessGeneratorContext,
  expr: MemberAccessNode,
): string | null {
  if (
    expr.property !== "status" &&
    expr.property !== "ok" &&
    expr.property !== "url" &&
    expr.property !== "statusText" &&
    expr.property !== "redirected" &&
    expr.property !== "headers"
  )
    return null;
  const exprObjBase = expr.object as ExprBase;
  const exprObjType = exprObjBase.type;
  if (exprObjType === null || exprObjType === undefined) return null;
  if (exprObjType !== "variable") return null;

  const varName = (expr.object as VariableNode).name;
  const ifaceType = ctx.symbolTable.getInterfaceType(varName);
  if (ifaceType) return null;
  if (hasObjectInfo(ctx, varName)) return null;
  const varType = ctx.getVariableType(varName);
  if (varType !== "%__FetchResponse*" && varType !== "i8*") return null;

  const varPtr = ctx.getVariableAlloca(varName);
  let responsePtr: string;

  if (varType === "i8*") {
    const i8Ptr = ctx.nextTemp();
    ctx.emit(`${i8Ptr} = load i8*, i8** ${varPtr}`);
    responsePtr = ctx.nextTemp();
    ctx.emit(`${responsePtr} = bitcast i8* ${i8Ptr} to %__FetchResponse*`);
  } else {
    responsePtr = ctx.nextTemp();
    ctx.emit(`${responsePtr} = load %__FetchResponse*, %__FetchResponse** ${varPtr}`);
  }

  if (expr.property === "status") {
    return ctx.responseGen.generateStatus(responsePtr);
  } else if (expr.property === "ok") {
    return ctx.responseGen.generateOk(responsePtr);
  } else if (expr.property === "url") {
    return ctx.responseGen.generateUrl(responsePtr);
  } else if (expr.property === "headers") {
    return ctx.responseGen.generateHeaders(responsePtr);
  } else if (expr.property === "redirected") {
    return ctx.responseGen.generateRedirected(responsePtr);
  } else if (expr.property === "statusText") {
    return ctx.responseGen.generateStatusText(responsePtr);
  }
  return null;
}

export function handleStatProperty(
  ctx: MemberAccessGeneratorContext,
  expr: MemberAccessNode,
): string | null {
  if (expr.property !== "size") return null;
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type !== "variable") return null;
  const varName = (expr.object as VariableNode).name;
  const varType = ctx.getVariableType(varName);
  if (varType !== "%StatResult*" && varType !== "i8*") return null;
  const ifaceType = ctx.symbolTable.getInterfaceType(varName);
  if (ifaceType) return null;
  if (hasObjectInfo(ctx, varName)) return null;
  const varPtr = ctx.getVariableAlloca(varName);
  const raw = ctx.nextTemp();
  ctx.emit(`${raw} = load i8*, i8** ${varPtr}`);
  const statPtr = ctx.nextTemp();
  ctx.emit(`${statPtr} = bitcast i8* ${raw} to double*`);
  const fieldPtr = ctx.nextTemp();
  ctx.emit(`${fieldPtr} = getelementptr inbounds double, double* ${statPtr}, i64 0`);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = load double, double* ${fieldPtr}`);
  ctx.setVariableType(result, "double");
  return result;
}

// %PathParseResult = { root(0), dir(1), base(2), name(3), ext(4) } — all i8*
export function handlePathParseProperty(
  ctx: MemberAccessGeneratorContext,
  expr: MemberAccessNode,
): string | null {
  const fieldMap: Record<string, number> = { root: 0, dir: 1, base: 2, name: 3, ext: 4 };
  const fieldIndex = fieldMap[expr.property];
  if (fieldIndex === undefined) return null;
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type !== "variable") return null;
  const varName = (expr.object as VariableNode).name;
  const varType = ctx.getVariableType(varName);
  if (varType !== "%PathParseResult*") return null;
  const varPtr = ctx.getVariableAlloca(varName);
  const raw = ctx.nextTemp();
  ctx.emit(`${raw} = load i8*, i8** ${varPtr}`);
  const typed = ctx.nextTemp();
  ctx.emit(`${typed} = bitcast i8* ${raw} to %PathParseResult*`);
  const fieldPtr = ctx.nextTemp();
  ctx.emit(
    `${fieldPtr} = getelementptr inbounds %PathParseResult, %PathParseResult* ${typed}, i32 0, i32 ${fieldIndex}`,
  );
  const result = ctx.nextTemp();
  ctx.emit(`${result} = load i8*, i8** ${fieldPtr}`);
  ctx.setVariableType(result, "i8*");
  return result;
}

// %SpawnSyncResult = { stdout(0): i8*, stderr(1): i8*, status(2): double }
export function handleSpawnSyncResultProperty(
  ctx: MemberAccessGeneratorContext,
  expr: MemberAccessNode,
): string | null {
  // %SpawnSyncResult = { i8* stdout, i8* stderr, double status }
  // Use simple if/else — native compiler can't handle Record<string, {object}> field access
  let fieldIndex: number;
  let fieldType: string;
  if (expr.property === "stdout") {
    fieldIndex = 0;
    fieldType = "i8*";
  } else if (expr.property === "stderr") {
    fieldIndex = 1;
    fieldType = "i8*";
  } else if (expr.property === "status") {
    fieldIndex = 2;
    fieldType = "double";
  } else {
    return null;
  }
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type !== "variable") return null;
  const varName = (expr.object as VariableNode).name;
  const varType = ctx.getVariableType(varName);
  if (varType !== "%SpawnSyncResult*") return null;
  const varPtr = ctx.getVariableAlloca(varName);
  // Load the SpawnSyncResult pointer from the variable's alloca
  const raw = ctx.nextTemp();
  ctx.emit(`${raw} = load %SpawnSyncResult*, %SpawnSyncResult** ${varPtr}`);
  // GEP into the struct field
  const fieldPtr = ctx.nextTemp();
  ctx.emit(
    `${fieldPtr} = getelementptr inbounds %SpawnSyncResult, %SpawnSyncResult* ${raw}, i32 0, i32 ${fieldIndex}`,
  );
  // Load the field value
  const loadType = fieldType === "double" ? "double" : "i8*";
  const loadPtrType = fieldType === "double" ? "double*" : "i8**";
  const result = ctx.nextTemp();
  ctx.emit(`${result} = load ${loadType}, ${loadPtrType} ${fieldPtr}`);
  ctx.setVariableType(result, fieldType);
  return result;
}
