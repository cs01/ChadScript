import type {
  Expression,
  MethodCallNode,
  VariableNode,
  MemberAccessNode,
} from "../../../ast/types.js";
import { parseMapTypeString } from "../../infrastructure/type-system.js";
import type { MethodCallGeneratorContext } from "../method-calls.js";

interface ExprBase {
  type: string;
}

function mapGetVariableName(expr: Expression): string | null {
  const e = expr as ExprBase;
  if (e.type === "variable") {
    return (expr as VariableNode).name;
  }
  return null;
}

function getParameterMapInfo(
  ctx: MethodCallGeneratorContext,
  varName: string,
): { keyType: string; valueType: string } | null {
  const currentFunc = ctx.getCurrentFunction();
  if (!currentFunc) return null;

  let funcParams: { name: string; type?: string }[] | null = null;
  const funcLen = ctx.getAstFunctionsLength();
  for (let i = 0; i < funcLen; i++) {
    const fName = ctx.getAstFunctionNameAt(i);
    if (fName === currentFunc) {
      const f = ctx.getAstFunctionAt(i);
      if (f && f.parameters) {
        funcParams = f.parameters as { name: string; type?: string }[];
      }
      break;
    }
  }
  if (!funcParams && ctx.getCurrentClassName()) {
    const classLen = ctx.getAstClassesLength();
    for (let i = 0; i < classLen; i++) {
      const cName = ctx.getAstClassNameAt(i);
      if (cName === ctx.getCurrentClassName()) {
        const c = ctx.getAstClassAt(i);
        if (!c) break;
        for (let j = 0; j < c.methods.length; j++) {
          const m = c.methods[j];
          if (m.name === currentFunc && m.params) {
            funcParams = [];
            for (let k = 0; k < m.params.length; k++) {
              const paramType = m.paramTypes ? m.paramTypes[k] : undefined;
              funcParams.push({ name: m.params[k], type: paramType });
            }
            break;
          }
        }
        break;
      }
    }
  }
  if (!funcParams) return null;

  for (let i = 0; i < funcParams.length; i++) {
    const p = funcParams[i] as { name: string; type?: string };
    if (p.name === varName && p.type) {
      return parseMapTypeString(p.type);
    }
  }
  return null;
}

function getThisFieldMapInfo(
  ctx: MethodCallGeneratorContext,
  expr: Expression,
): { keyType: string; valueType: string } | null {
  const e2 = expr as ExprBase;
  if (e2.type !== "member_access") return null;
  const memberExpr = expr as MemberAccessNode;

  const objBase = memberExpr.object as ExprBase;
  if (objBase.type === "this") {
    const classNameForLookup = ctx.getCurrentClassName();
    if (!classNameForLookup) return null;
    const fieldInfoResult = ctx.classGenGetFieldInfo(classNameForLookup, memberExpr.property);
    if (!fieldInfoResult || !fieldInfoResult.tsType) return null;

    return parseMapTypeString(fieldInfoResult.tsType);
  }

  // Also handle <variable>.<field> where <variable> is a class instance.
  // Unblocks Map fields accessed through a named instance:
  //   const s = new S();
  //   s.pending.set(...);
  if (objBase.type === "variable") {
    const varName = (memberExpr.object as VariableNode).name;
    const classInfo = ctx.symbolTable.getClassInfo(varName);
    if (!classInfo) return null;
    const fieldInfoResult = ctx.classGenGetFieldInfo(classInfo.className, memberExpr.property);
    if (!fieldInfoResult || !fieldInfoResult.tsType) return null;
    return parseMapTypeString(fieldInfoResult.tsType);
  }

  return null;
}

function getThisFieldMapKeyType(ctx: MethodCallGeneratorContext, expr: Expression): string | null {
  const result = ctx.typeResolver?.getThisFieldMapKeyType(expr);
  if (result) {
    return result;
  }

  const e2 = expr as ExprBase;
  if (e2.type !== "member_access") return null;
  const memberExpr = expr as MemberAccessNode;

  const objBase = memberExpr.object as ExprBase;
  if (objBase.type === "this") {
    const classNameForLookup = ctx.getCurrentClassName();
    if (!classNameForLookup) return null;
    const fieldInfoResult = ctx.classGenGetFieldInfo(classNameForLookup, memberExpr.property);
    if (!fieldInfoResult || !fieldInfoResult.tsType) return null;

    const mapParsed = parseMapTypeString(fieldInfoResult.tsType);
    if (!mapParsed) return null;
    return mapParsed.keyType;
  }

  return null;
}

function unboxStringMapGet(
  ctx: MethodCallGeneratorContext,
  rawResult: string,
  valueType: string,
): string {
  if (valueType === "number") {
    const asI64 = ctx.nextTemp();
    ctx.emit(`${asI64} = ptrtoint i8* ${rawResult} to i64`);
    const asDouble = ctx.nextTemp();
    ctx.emit(`${asDouble} = bitcast i64 ${asI64} to double`);
    ctx.setVariableType(asDouble, "double");
    return asDouble;
  }
  return rawResult;
}

function dispatchStringMapMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  mapAlloca: string,
  expr: MethodCallNode,
  params: string[],
  valueType: string,
): string {
  if (method === "set") {
    const keyValue = ctx.generateExpression(expr.args[0], params);
    const valueValue = ctx.generateExpression(expr.args[1], params);
    return ctx.stringMapGen.generateStringMapSet(mapAlloca, keyValue, valueValue, valueType);
  } else if (method === "get") {
    const keyValue = ctx.generateExpression(expr.args[0], params);
    const rawResult = ctx.stringMapGen.generateStringMapGet(mapAlloca, keyValue);
    return unboxStringMapGet(ctx, rawResult, valueType);
  } else if (method === "has") {
    const keyValue = ctx.generateExpression(expr.args[0], params);
    return ctx.stringMapGen.generateStringMapHas(mapAlloca, keyValue);
  } else if (method === "delete") {
    const keyValue = ctx.generateExpression(expr.args[0], params);
    return ctx.stringMapGen.generateStringMapDelete(mapAlloca, keyValue);
  } else if (method === "entries") {
    return ctx.stringMapGen.generateStringMapEntries(mapAlloca);
  } else if (method === "values") {
    return ctx.stringMapGen.generateStringMapValues(mapAlloca);
  } else if (method === "keys") {
    return ctx.stringMapGen.generateStringMapKeys(mapAlloca);
  } else if (method === "clear") {
    return ctx.stringMapGen.generateStringMapClear(mapAlloca);
  } else {
    return ctx.emitError(`Map<string, *>.${method}() is not supported`, expr.loc);
  }
}

function dispatchPointerMapMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  mapPtr: string,
  expr: MethodCallNode,
  params: string[],
  keyType: string,
): string {
  if (method === "set") {
    const keyValue = ctx.generateExpression(expr.args[0], params);
    const valueValue = ctx.generateExpression(expr.args[1], params);
    return ctx.pointerMapGen.generatePointerMapSet(mapPtr, keyValue, valueValue);
  } else if (method === "get") {
    const keyValue = ctx.generateExpression(expr.args[0], params);
    return ctx.pointerMapGen.generatePointerMapGet(mapPtr, keyValue, "i8*");
  } else if (method === "has") {
    const keyValue = ctx.generateExpression(expr.args[0], params);
    return ctx.pointerMapGen.generatePointerMapHas(mapPtr, keyValue);
  } else if (method === "delete") {
    const keyValue = ctx.generateExpression(expr.args[0], params);
    return ctx.pointerMapGen.generatePointerMapDelete(mapPtr, keyValue);
  } else if (method === "entries") {
    return ctx.pointerMapGen.generatePointerMapEntries(mapPtr);
  } else if (method === "keys") {
    return ctx.pointerMapGen.generatePointerMapKeys(mapPtr);
  } else if (method === "values") {
    return ctx.pointerMapGen.generatePointerMapValues(mapPtr);
  } else if (method === "clear") {
    return ctx.pointerMapGen.generatePointerMapClear(mapPtr);
  } else {
    return ctx.emitError(`Map<${keyType}, *>.${method}() is not supported`, expr.loc);
  }
}

function dispatchNumericMapMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string {
  if (method === "set") {
    return ctx.mapGen.generateMapSet(expr, params);
  } else if (method === "get") {
    return ctx.mapGen.generateMapGet(expr, params);
  } else if (method === "has") {
    return ctx.mapGen.generateMapHas(expr, params);
  } else if (method === "delete") {
    return ctx.mapGen.generateMapDelete(expr, params);
  } else if (method === "keys") {
    const mapPtr = ctx.generateExpression(expr.object, params);
    return ctx.mapGen.generateMapKeys(mapPtr);
  } else if (method === "values") {
    const mapPtr = ctx.generateExpression(expr.object, params);
    return ctx.mapGen.generateMapValues(mapPtr);
  } else if (method === "entries") {
    return ctx.emitError(
      `Map.entries() not yet supported for Map<number, *> types — use .keys() and .get()`,
      expr.loc,
    );
  } else if (method === "clear") {
    return ctx.mapGen.generateMapClear(expr, params);
  } else {
    return ctx.emitError(`Map.${method}() is not supported`, expr.loc);
  }
}

export function dispatchMapMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  const varName = mapGetVariableName(expr.object);
  if (varName && ctx.symbolTable.isMap(varName)) {
    const mapMeta = ctx.symbolTable.getMapMetadata(varName);

    if (mapMeta && mapMeta.keyType === "string") {
      let mapAlloca = ctx.symbolTable.getAlloca(varName);
      if (mapAlloca) {
        if (mapAlloca.startsWith("@")) {
          mapAlloca = ctx.emitLoad("%StringMap*", mapAlloca);
        }
        return dispatchStringMapMethod(
          ctx,
          method,
          mapAlloca,
          expr,
          params,
          mapMeta.valueType || "string",
        );
      }
      return ctx.emitError(
        `Map<string, *>.${method}() failed: no alloca found for '${varName}'`,
        expr.loc,
      );
    }

    if (mapMeta && mapMeta.keyType !== "number") {
      let mapAlloca = ctx.symbolTable.getAlloca(varName);
      if (mapAlloca) {
        if (mapAlloca.startsWith("@")) {
          mapAlloca = ctx.emitLoad("%StringMap*", mapAlloca);
        }
        return dispatchPointerMapMethod(ctx, method, mapAlloca, expr, params, mapMeta.keyType);
      }
    }

    return dispatchNumericMapMethod(ctx, method, expr, params);
  }

  if (varName) {
    const paramMapInfo = getParameterMapInfo(ctx, varName);
    if (paramMapInfo) {
      const mapPtr = ctx.generateExpression(expr.object, params);
      if (paramMapInfo.keyType === "string") {
        return dispatchStringMapMethod(ctx, method, mapPtr, expr, params, paramMapInfo.valueType);
      } else {
        return dispatchPointerMapMethod(ctx, method, mapPtr, expr, params, paramMapInfo.keyType);
      }
    }
  }

  const thisFieldMapInfo = getThisFieldMapInfo(ctx, expr.object);
  const thisFieldMapKeyType = thisFieldMapInfo
    ? thisFieldMapInfo.keyType
    : getThisFieldMapKeyType(ctx, expr.object);
  if (thisFieldMapKeyType) {
    const mapPtr = ctx.generateExpression(expr.object, params);
    if (thisFieldMapKeyType === "string") {
      return dispatchStringMapMethod(
        ctx,
        method,
        mapPtr,
        expr,
        params,
        thisFieldMapInfo ? thisFieldMapInfo.valueType : "string",
      );
    } else {
      const mapPtr2 = ctx.generateExpression(expr.object, params);
      return dispatchPointerMapMethod(ctx, method, mapPtr2, expr, params, thisFieldMapKeyType);
    }
  }

  return null;
}
