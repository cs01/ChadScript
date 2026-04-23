import { Expression, MethodCallNode, VariableNode, ArrowFunctionNode } from "../../../ast/types.js";
import type { MethodCallGeneratorContext } from "../method-calls.js";

interface ExprBase {
  type: string;
}

interface ScopeVarsArrays {
  names: string[];
  types: string[];
  interfaceTypes: string[];
}

export function handlePromiseStaticMethods(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  const method = expr.method;
  ctx.setUsesPromises(true);

  if (method === "deferred") {
    // Promise.deferred<T>() — return a fresh unresolved %Promise* that can
    // be stashed (class field, Map value, etc.) and settled later via
    // Promise.resolvePending(p, v) / Promise.rejectPending(p, e). Closure-
    // free alternative to 'new Promise((r,j) => stash(r,j))' which requires
    // capturing resolve/reject as first-class callables.
    const result = ctx.nextTemp();
    ctx.emit(`${result} = call %Promise* @__Promise_new()`);
    ctx.setVariableType(result, "%Promise*");
    return result;
  }

  if (method === "resolvePending" || method === "rejectPending") {
    if (expr.args.length < 1) {
      return ctx.emitError(`Promise.${method}() requires a Promise handle argument`, expr.loc);
    }
    const isResolve = method === "resolvePending";
    const bridgeFn = isResolve ? "@__Promise_resolve" : "@__Promise_reject";
    const promisePtr = ctx.generateExpression(expr.args[0], params);
    let valuePtr = "null";
    if (expr.args.length > 1) {
      const raw = ctx.generateExpression(expr.args[1], params);
      const lt = ctx.getVariableType(raw) || "double";
      if (lt === "i8*") {
        valuePtr = raw;
      } else if (lt === "double" || lt === "i64" || lt === "i32" || lt === "i8") {
        // Box scalar into pointer-sized GC slot so the bridge's i8* param
        // can round-trip back out via the promise's value slot.
        const allocMem = ctx.nextTemp();
        ctx.emit(`${allocMem} = call i8* @GC_malloc(i64 8)`);
        const doublePtr = ctx.nextTemp();
        ctx.emit(`${doublePtr} = bitcast i8* ${allocMem} to double*`);
        ctx.emit(`store double ${ctx.ensureDouble(raw)}, double* ${doublePtr}`);
        valuePtr = allocMem;
      } else {
        valuePtr = raw;
      }
    }
    ctx.emit(`call void ${bridgeFn}(%Promise* ${promisePtr}, i8* ${valuePtr})`);
    return "0.0";
  }

  if (method === "resolve") {
    let valuePtr: string;
    if (expr.args.length > 0) {
      const value = ctx.generateExpression(expr.args[0], params);
      valuePtr = ctx.nextTemp();
      ctx.emit(`${valuePtr} = bitcast i8* null to i8*`);
      const valueType = ctx.getVariableType(value) || "double";
      if (valueType === "i8*") {
        valuePtr = value;
      } else {
        const allocMem = ctx.nextTemp();
        ctx.emit(`${allocMem} = call i8* @GC_malloc(i64 8)`);
        const doublePtr = ctx.nextTemp();
        ctx.emit(`${doublePtr} = bitcast i8* ${allocMem} to double*`);
        ctx.emit(`store double ${ctx.ensureDouble(value)}, double* ${doublePtr}`);
        valuePtr = allocMem;
      }
    } else {
      valuePtr = "null";
    }
    const result = ctx.nextTemp();
    ctx.emit(`${result} = call %Promise* @__Promise_resolve_static(i8* ${valuePtr})`);
    ctx.setVariableType(result, "%Promise*");
    return result;
  }

  if (method === "reject") {
    let reasonPtr: string;
    if (expr.args.length > 0) {
      const reason = ctx.generateExpression(expr.args[0], params);
      const reasonType = ctx.getVariableType(reason) || "double";
      if (reasonType === "i8*") {
        reasonPtr = reason;
      } else {
        const allocMem = ctx.nextTemp();
        ctx.emit(`${allocMem} = call i8* @GC_malloc(i64 8)`);
        const doublePtr = ctx.nextTemp();
        ctx.emit(`${doublePtr} = bitcast i8* ${allocMem} to double*`);
        ctx.emit(`store double ${ctx.ensureDouble(reason)}, double* ${doublePtr}`);
        reasonPtr = allocMem;
      }
    } else {
      reasonPtr = "null";
    }
    const result = ctx.nextTemp();
    ctx.emit(`${result} = call %Promise* @__Promise_reject_static(i8* ${reasonPtr})`);
    ctx.setVariableType(result, "%Promise*");
    return result;
  }

  if (method === "all") {
    if (expr.args.length < 1) {
      return ctx.emitError("Promise.all() requires 1 argument (array of promises)", expr.loc);
    }
    const promisesArray = ctx.generateExpression(expr.args[0], params);
    const result = ctx.nextTemp();
    ctx.emit(`${result} = call %Promise* @__Promise_all(%ObjectArray* ${promisesArray})`);
    ctx.setVariableType(result, "%Promise*");
    return result;
  }

  if (method === "race") {
    if (expr.args.length < 1) {
      return ctx.emitError("Promise.race() requires 1 argument (array of promises)", expr.loc);
    }
    const promisesArray = ctx.generateExpression(expr.args[0], params);
    const result = ctx.nextTemp();
    ctx.emit(`${result} = call %Promise* @__Promise_race(%ObjectArray* ${promisesArray})`);
    ctx.setVariableType(result, "%Promise*");
    return result;
  }

  if (method === "allSettled") {
    if (expr.args.length < 1) {
      return ctx.emitError(
        "Promise.allSettled() requires 1 argument (array of promises)",
        expr.loc,
      );
    }
    const promisesArray = ctx.generateExpression(expr.args[0], params);
    const result = ctx.nextTemp();
    ctx.emit(`${result} = call %Promise* @__Promise_allSettled(%ObjectArray* ${promisesArray})`);
    ctx.setVariableType(result, "%Promise*");
    return result;
  }

  if (method === "any") {
    if (expr.args.length < 1) {
      return ctx.emitError("Promise.any() requires 1 argument (array of promises)", expr.loc);
    }
    const promisesArray = ctx.generateExpression(expr.args[0], params);
    const result = ctx.nextTemp();
    ctx.emit(`${result} = call %Promise* @__Promise_any(%ObjectArray* ${promisesArray})`);
    ctx.setVariableType(result, "%Promise*");
    return result;
  }

  return ctx.emitError(`Unsupported Promise static method: ${method}`, expr.loc);
}

export function handlePromiseThen(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
  isCatch: boolean,
): string {
  ctx.setUsesPromises(true);
  const promisePtr = ctx.generateExpression(expr.object, params);

  let onFulfilled = "null";
  let onRejected = "null";

  const promiseCallbackTypes = { paramTypes: ["string", "any"], returnType: "void" };
  const scopeVarsResult = ctx.symbolTable.getScopeVarsArraysForClosure();
  const scopeVarsTyped = scopeVarsResult as ScopeVarsArrays;

  if (isCatch) {
    if (expr.args.length > 0) {
      const callback = expr.args[0] as Expression;
      const callbackBase = callback as ExprBase;
      if (callbackBase.type === "arrow_function") {
        const callbackName = ctx.arrowFunctionGen.generateArrowFunction(
          callback as ArrowFunctionNode,
          params,
          promiseCallbackTypes,
          scopeVarsTyped.names,
          scopeVarsTyped.types,
        );
        onRejected = `@${ctx.mangleUserName(callbackName)}`;
      } else if (callbackBase.type === "variable") {
        onRejected = `@${ctx.mangleUserName((callback as VariableNode).name)}`;
      }
    }
  } else {
    if (expr.args.length > 0) {
      const callback = expr.args[0] as Expression;
      const callbackBase = callback as ExprBase;
      if (callbackBase.type === "arrow_function") {
        const callbackName = ctx.arrowFunctionGen.generateArrowFunction(
          callback as ArrowFunctionNode,
          params,
          promiseCallbackTypes,
          scopeVarsTyped.names,
          scopeVarsTyped.types,
        );
        onFulfilled = `@${ctx.mangleUserName(callbackName)}`;
      } else if (callbackBase.type === "variable") {
        onFulfilled = `@${ctx.mangleUserName((callback as VariableNode).name)}`;
      }
    }
    if (expr.args.length > 1) {
      const callback = expr.args[1] as Expression;
      const callbackBase = callback as ExprBase;
      if (callbackBase.type === "arrow_function") {
        const callbackName = ctx.arrowFunctionGen.generateArrowFunction(
          callback as ArrowFunctionNode,
          params,
          promiseCallbackTypes,
          scopeVarsTyped.names,
          scopeVarsTyped.types,
        );
        onRejected = `@${ctx.mangleUserName(callbackName)}`;
      } else if (callbackBase.type === "variable") {
        onRejected = `@${ctx.mangleUserName((callback as VariableNode).name)}`;
      }
    }
  }

  const onFulfilledPtr = ctx.nextTemp();
  if (onFulfilled === "null") {
    ctx.emit(`${onFulfilledPtr} = bitcast i8* null to void (i8*, i8*)*`);
  } else {
    ctx.emit(`${onFulfilledPtr} = bitcast void (i8*, i8*)* ${onFulfilled} to void (i8*, i8*)*`);
  }

  const onRejectedPtr = ctx.nextTemp();
  if (onRejected === "null") {
    ctx.emit(`${onRejectedPtr} = bitcast i8* null to void (i8*, i8*)*`);
  } else {
    ctx.emit(`${onRejectedPtr} = bitcast void (i8*, i8*)* ${onRejected} to void (i8*, i8*)*`);
  }

  const result = ctx.nextTemp();
  ctx.emit(
    `${result} = call %Promise* @__Promise_then(%Promise* ${promisePtr}, void (i8*, i8*)* ${onFulfilledPtr}, void (i8*, i8*)* ${onRejectedPtr})`,
  );
  ctx.setVariableType(result, "%Promise*");
  return result;
}

export function handlePromiseFinally(
  ctx: MethodCallGeneratorContext,
  expr: MethodCallNode,
  params: string[],
): string {
  ctx.setUsesPromises(true);
  const promisePtr = ctx.generateExpression(expr.object, params);

  let userCallback = "null";
  // finally callbacks take no meaningful args but need void(i8*,i8*)* signature
  const finallyCallbackTypes = { paramTypes: ["string", "string"], returnType: "void" };
  const scopeVarsResult = ctx.symbolTable.getScopeVarsArraysForClosure();
  const scopeVarsTyped = scopeVarsResult as ScopeVarsArrays;

  if (expr.args.length > 0) {
    const callback = expr.args[0] as Expression;
    const callbackBase = callback as ExprBase;
    if (callbackBase.type === "arrow_function") {
      const callbackName = ctx.arrowFunctionGen.generateArrowFunction(
        callback as ArrowFunctionNode,
        params,
        finallyCallbackTypes,
        scopeVarsTyped.names,
        scopeVarsTyped.types,
      );
      userCallback = `@${ctx.mangleUserName(callbackName)}`;
    } else if (callbackBase.type === "variable") {
      userCallback = `@${ctx.mangleUserName((callback as VariableNode).name)}`;
    }
  }

  // Bitcast callback to i8* for storage (avoids function-pointer-type store validation issue)
  const userCbI8 = ctx.nextTemp();
  if (userCallback === "null") {
    ctx.emit(`${userCbI8} = bitcast i8* null to i8*`);
  } else {
    ctx.emit(`${userCbI8} = bitcast void (i8*, i8*)* ${userCallback} to i8*`);
  }

  // Allocate PromiseFinallyContext = { i8* callback, %Promise* childPromise }
  const childPromise = ctx.nextTemp();
  ctx.emit(`${childPromise} = call %Promise* @__Promise_new()`);
  const ctxMem = ctx.nextTemp();
  ctx.emit(`${ctxMem} = call i8* @GC_malloc(i64 16)`);
  const ctxPtr = ctx.nextTemp();
  ctx.emit(`${ctxPtr} = bitcast i8* ${ctxMem} to %PromiseFinallyContext*`);
  const cbField = ctx.nextTemp();
  ctx.emit(
    `${cbField} = getelementptr inbounds %PromiseFinallyContext, %PromiseFinallyContext* ${ctxPtr}, i32 0, i32 0`,
  );
  ctx.emit(`store i8* ${userCbI8}, i8** ${cbField}`);
  const childField = ctx.nextTemp();
  ctx.emit(
    `${childField} = getelementptr inbounds %PromiseFinallyContext, %PromiseFinallyContext* ${ctxPtr}, i32 0, i32 1`,
  );
  ctx.emit(`store %Promise* ${childPromise}, %Promise** ${childField}`);

  // Register via then_with_context — the child promise from then is discarded
  const discarded = ctx.nextTemp();
  ctx.emit(
    `${discarded} = call %Promise* @__Promise_then_with_context(%Promise* ${promisePtr}, void (i8*, i8*)* @__Promise_finally_onFulfilled, void (i8*, i8*)* @__Promise_finally_onRejected, i8* ${ctxMem})`,
  );

  ctx.setVariableType(childPromise, "%Promise*");
  return childPromise;
}
