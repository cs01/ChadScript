import { Expression, MethodCallNode } from "../../../ast/types.js";
import type { MethodCallGeneratorContext } from "../method-calls.js";
import {
  handleSubstr,
  handleSubstring,
  handleConcat,
  handleRepeat,
  handlePadStart,
  handlePadEnd,
  handleSplit,
  handleStartsWith,
  handleEndsWith,
  handleTrim,
  handleTrimStart,
  handleTrimEnd,
  handleIndexOf,
  handleLastIndexOf,
  handleStringArrayIndexOf,
  handleStringArrayIncludes,
  handleStringIncludes,
  handleSlice,
  handleReplace,
  handleReplaceAll,
  handleNumberToString,
  handleNumberToFixed,
  handleCharAt,
  handleCharCodeAt,
  handleToUpperCase,
  handleToLowerCase,
  handleMatch,
} from "./string-methods.js";

function rejectNonString(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
): string | null {
  if (
    ctx.isArrayExpression(expr.object) ||
    ctx.isStringArrayExpression(expr.object) ||
    ctx.isObjectArrayExpression(expr.object) ||
    ctx.isBooleanExpression(expr.object)
  ) {
    return ctx.emitError(
      `.${method}() is only available on strings`,
      expr.loc,
    );
  }
  if (expr.object.type === "number") {
    return ctx.emitError(
      `.${method}() is only available on strings`,
      expr.loc,
    );
  }
  return null;
}

function dispatchStringBasicOps(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  if (method === "substr") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handleSubstr(ctx, expr, params);
  }
  if (method === "substring") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handleSubstring(ctx, expr, params);
  }
  if (
    method === "concat" &&
    !ctx.isArrayExpression(expr.object) &&
    !ctx.isStringArrayExpression(expr.object) &&
    !ctx.isObjectArrayExpression(expr.object)
  )
    return handleConcat(ctx, expr, params);
  if (method === "repeat") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handleRepeat(ctx, expr, params);
  }
  return null;
}

function dispatchStringPadSplit(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  if (method === "padStart") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handlePadStart(ctx, expr, params);
  }
  if (method === "padEnd") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handlePadEnd(ctx, expr, params);
  }
  if (method === "split") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handleSplit(ctx, expr, params);
  }
  if (method === "startsWith") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handleStartsWith(ctx, expr, params);
  }
  return null;
}

function dispatchStringTrimOps(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  if (method === "endsWith") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handleEndsWith(ctx, expr, params);
  }
  if (method === "trim") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handleTrim(ctx, expr, params);
  }
  if (method === "trimStart") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handleTrimStart(ctx, expr, params);
  }
  if (method === "trimEnd") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handleTrimEnd(ctx, expr, params);
  }
  return null;
}

function dispatchStringReplaceCase(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  if (method === "replace") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handleReplace(ctx, expr, params);
  }
  if (method === "replaceAll") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handleReplaceAll(ctx, expr, params);
  }
  if (method === "charAt") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handleCharAt(ctx, expr, params);
  }
  if (method === "charCodeAt") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handleCharCodeAt(ctx, expr, params);
  }
  return null;
}

export function dispatchStringMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  const basic = dispatchStringBasicOps(ctx, method, expr, params);
  if (basic) return basic;
  const padSplit = dispatchStringPadSplit(ctx, method, expr, params);
  if (padSplit) return padSplit;
  const trim = dispatchStringTrimOps(ctx, method, expr, params);
  if (trim) return trim;
  if (method === "indexOf") {
    if (ctx.isStringArrayExpression(expr.object))
      return handleStringArrayIndexOf(ctx, expr, params);
    if (ctx.isArrayExpression(expr.object)) return ctx.arrayGen.generateArrayIndexOf(expr, params);
    return handleIndexOf(ctx, expr, params);
  }
  if (method === "lastIndexOf") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    return handleLastIndexOf(ctx, expr, params);
  }
  if (method === "includes") {
    if (ctx.isStringArrayExpression(expr.object))
      return handleStringArrayIncludes(ctx, expr, params);
    if (!ctx.isArrayExpression(expr.object)) return handleStringIncludes(ctx, expr, params);
    return null;
  }
  if (
    method === "slice" &&
    !ctx.isArrayExpression(expr.object) &&
    !ctx.isStringArrayExpression(expr.object) &&
    !ctx.isObjectArrayExpression(expr.object)
  )
    return handleSlice(ctx, expr, params);
  const replaceCase = dispatchStringReplaceCase(ctx, method, expr, params);
  if (replaceCase) return replaceCase;
  if (method === "toUpperCase" || method === "toLowerCase") {
    const err = rejectNonString(ctx, method, expr);
    if (err) return err;
    if (method === "toUpperCase") return handleToUpperCase(ctx, expr, params);
    return handleToLowerCase(ctx, expr, params);
  }
  if (method === "toString") {
    if (
      !ctx.isStringExpression(expr.object) &&
      !ctx.isArrayExpression(expr.object) &&
      !ctx.isStringArrayExpression(expr.object)
    )
      return handleNumberToString(ctx, expr, params);
    return null;
  }
  if (method === "toFixed") return handleNumberToFixed(ctx, expr, params);
  if (method === "match") {
    if (ctx.isStringExpression(expr.object)) return handleMatch(ctx, expr, params);
    return null;
  }
  return null;
}

function dispatchArrayMutators(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
  isClassInstance: boolean,
): string | null {
  if (method === "push" && !isClassInstance) return ctx.arrayGen.generateArrayPush(expr, params);
  if (method === "pop" && !isClassInstance) return ctx.arrayGen.generateArrayPop(expr, params);
  if (method === "includes" && ctx.isArrayExpression(expr.object))
    return ctx.arrayGen.generateArrayIncludes(expr, params);
  if (method === "map") {
    if (ctx.isStringArrayExpression(expr.object))
      return ctx.arrayGen.generateStringArrayMap(expr, params);
    return ctx.arrayGen.generateArrayMap(expr, params);
  }
  return null;
}

function dispatchArrayIterators(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  if (method === "find") return ctx.arrayGen.generateArrayFind(expr, params);
  if (method === "some") return ctx.arrayGen.generateArraySome(expr, params);
  if (method === "every") return ctx.arrayGen.generateArrayEvery(expr, params);
  if (method === "filter") return ctx.arrayGen.generateArrayFilter(expr, params);
  return null;
}

function dispatchArrayTransforms(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  if (method === "forEach") return ctx.arrayGen.generateArrayForEach(expr, params);
  if (method === "reduce") return ctx.arrayGen.generateArrayReduce(expr, params);
  if (method === "reverse") return ctx.arrayGen.generateArrayReverse(expr, params);
  if (method === "shift") return ctx.arrayGen.generateArrayShift(expr, params);
  return null;
}

function dispatchArrayReorder(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  if (method === "unshift") return ctx.arrayGen.generateArrayUnshift(expr, params);
  if (method === "findIndex") return ctx.arrayGen.generateArrayFindIndex(expr, params);
  if (method === "sort") return ctx.arrayGen.generateArraySort(expr, params);
  if (method === "splice") return ctx.arrayGen.generateArraySplice(expr, params);
  return null;
}

export function dispatchArrayMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
  isClassInstance: boolean,
): string | null {
  const mutator = dispatchArrayMutators(ctx, method, expr, params, isClassInstance);
  if (mutator) return mutator;
  if (
    method === "join" &&
    (ctx.isStringArrayExpression(expr.object) ||
      ctx.isArrayExpression(expr.object) ||
      ctx.isObjectArrayExpression(expr.object))
  )
    return ctx.arrayGen.generateArrayJoin(expr, params);
  const iterator = dispatchArrayIterators(ctx, method, expr, params);
  if (iterator) return iterator;
  const transform = dispatchArrayTransforms(ctx, method, expr, params);
  if (transform) return transform;
  if (
    method === "slice" &&
    (ctx.isArrayExpression(expr.object) ||
      ctx.isStringArrayExpression(expr.object) ||
      ctx.isObjectArrayExpression(expr.object))
  )
    return ctx.arrayGen.generateArraySlice(expr, params);
  if (
    method === "concat" &&
    (ctx.isArrayExpression(expr.object) ||
      ctx.isStringArrayExpression(expr.object) ||
      ctx.isObjectArrayExpression(expr.object))
  )
    return ctx.arrayGen.generateArrayConcat(expr, params);
  const reorder = dispatchArrayReorder(ctx, method, expr, params);
  if (reorder) return reorder;
  return null;
}
