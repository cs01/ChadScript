import type { Expression, MethodCallNode, ArrowFunctionNode, VariableNode } from '../../../ast/types.js';
import type { MethodCallGeneratorContext } from '../method-calls.js';

interface ExprBase { type: string; }

export function handlePromiseStaticMethods(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
    const method = expr.method;
    ctx.setUsesPromises(true);

    if (method === 'resolve') {
      let valuePtr: string;
      if (expr.args.length > 0) {
        const value = ctx.generateExpression(expr.args[0], params);
        valuePtr = ctx.nextTemp();
        ctx.emit(`${valuePtr} = bitcast i8* null to i8*`);
        const valueType = ctx.getVariableType(value) || 'double';
        if (valueType === 'i8*') {
          valuePtr = value;
        } else {
          const allocMem = ctx.nextTemp();
          ctx.emit(`${allocMem} = call i8* @GC_malloc(i64 8)`);
          const doublePtr = ctx.nextTemp();
          ctx.emit(`${doublePtr} = bitcast i8* ${allocMem} to double*`);
          ctx.emit(`store double ${value}, double* ${doublePtr}`);
          valuePtr = allocMem;
        }
      } else {
        valuePtr = 'null';
      }
      const result = ctx.nextTemp();
      ctx.emit(`${result} = call %Promise* @__Promise_resolve_static(i8* ${valuePtr})`);
      ctx.setVariableType(result, '%Promise*');
      return result;
    }

    if (method === 'reject') {
      let reasonPtr: string;
      if (expr.args.length > 0) {
        const reason = ctx.generateExpression(expr.args[0], params);
        const reasonType = ctx.getVariableType(reason) || 'double';
        if (reasonType === 'i8*') {
          reasonPtr = reason;
        } else {
          const allocMem = ctx.nextTemp();
          ctx.emit(`${allocMem} = call i8* @GC_malloc(i64 8)`);
          const doublePtr = ctx.nextTemp();
          ctx.emit(`${doublePtr} = bitcast i8* ${allocMem} to double*`);
          ctx.emit(`store double ${reason}, double* ${doublePtr}`);
          reasonPtr = allocMem;
        }
      } else {
        reasonPtr = 'null';
      }
      const result = ctx.nextTemp();
      ctx.emit(`${result} = call %Promise* @__Promise_reject_static(i8* ${reasonPtr})`);
      ctx.setVariableType(result, '%Promise*');
      return result;
    }

    if (method === 'all') {
      if (expr.args.length < 1) {
        throw new Error('Promise.all() requires 1 argument (array of promises)');
      }
      const promisesArray = ctx.generateExpression(expr.args[0], params);
      const result = ctx.nextTemp();
      ctx.emit(`${result} = call %Promise* @__Promise_all(%ObjectArray* ${promisesArray})`);
      ctx.setVariableType(result, '%Promise*');
      return result;
    }

    if (method === 'race') {
      if (expr.args.length < 1) {
        throw new Error('Promise.race() requires 1 argument (array of promises)');
      }
      const promisesArray = ctx.generateExpression(expr.args[0], params);
      const result = ctx.nextTemp();
      ctx.emit(`${result} = call %Promise* @__Promise_race(%ObjectArray* ${promisesArray})`);
      ctx.setVariableType(result, '%Promise*');
      return result;
    }

    throw new Error(`Unsupported Promise static method: ${method}`);
}

export function handlePromiseThen(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[], isCatch: boolean): string {
    ctx.setUsesPromises(true);
    const promisePtr = ctx.generateExpression(expr.object, params);

    let onFulfilled = 'null';
    let onRejected = 'null';

    const promiseCallbackTypes = { paramTypes: ['string', 'any'], returnType: 'void' };
    const scopeVarsResult = ctx.symbolTableGetScopeVarsArraysForClosure();
    const scopeVarsTyped = scopeVarsResult as { names: string[]; types: string[] };

    if (isCatch) {
      if (expr.args.length > 0) {
        const callback = expr.args[0] as Expression;
        const callbackBase = callback as ExprBase;
        if (callbackBase.type === 'arrow_function') {
          const callbackName = ctx.arrowFunctionGenGenerate(callback as ArrowFunctionNode, params, promiseCallbackTypes, scopeVarsTyped.names, scopeVarsTyped.types);
          onRejected = `@${callbackName}`;
        } else if (callbackBase.type === 'variable') {
          onRejected = `@${(callback as VariableNode).name}`;
        }
      }
    } else {
      if (expr.args.length > 0) {
        const callback = expr.args[0] as Expression;
        const callbackBase = callback as ExprBase;
        if (callbackBase.type === 'arrow_function') {
          const callbackName = ctx.arrowFunctionGenGenerate(callback as ArrowFunctionNode, params, promiseCallbackTypes, scopeVarsTyped.names, scopeVarsTyped.types);
          onFulfilled = `@${callbackName}`;
        } else if (callbackBase.type === 'variable') {
          onFulfilled = `@${(callback as VariableNode).name}`;
        }
      }
      if (expr.args.length > 1) {
        const callback = expr.args[1] as Expression;
        const callbackBase = callback as ExprBase;
        if (callbackBase.type === 'arrow_function') {
          const callbackName = ctx.arrowFunctionGenGenerate(callback as ArrowFunctionNode, params, promiseCallbackTypes, scopeVarsTyped.names, scopeVarsTyped.types);
          onRejected = `@${callbackName}`;
        } else if (callbackBase.type === 'variable') {
          onRejected = `@${(callback as VariableNode).name}`;
        }
      }
    }

    const onFulfilledPtr = ctx.nextTemp();
    if (onFulfilled === 'null') {
      ctx.emit(`${onFulfilledPtr} = bitcast i8* null to void (i8*, i8*)*`);
    } else {
      ctx.emit(`${onFulfilledPtr} = bitcast void (i8*, i8*)* ${onFulfilled} to void (i8*, i8*)*`);
    }

    const onRejectedPtr = ctx.nextTemp();
    if (onRejected === 'null') {
      ctx.emit(`${onRejectedPtr} = bitcast i8* null to void (i8*, i8*)*`);
    } else {
      ctx.emit(`${onRejectedPtr} = bitcast void (i8*, i8*)* ${onRejected} to void (i8*, i8*)*`);
    }

    const result = ctx.nextTemp();
    ctx.emit(`${result} = call %Promise* @__Promise_then(%Promise* ${promisePtr}, void (i8*, i8*)* ${onFulfilledPtr}, void (i8*, i8*)* ${onRejectedPtr})`);
    ctx.setVariableType(result, '%Promise*');
    return result;
}
