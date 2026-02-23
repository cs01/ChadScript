/**
 * Array codegen facade — delegates to submodule files under array/.
 * New array methods should go in the appropriate submodule, NOT this file.
 */

import { Expression, MethodCallNode, VariableNode } from "../../../ast/types.js";
import { IGeneratorContext } from "../../infrastructure/generator-context.js";
import { detectArrayType } from "./array/context.js";

// Array sub-modules
// No alias — ChadScript doesn't resolve import aliases in self-hosting
import { generateArrayLiteral } from "./array/literal.js";
import { generateArrayPush, generateArrayPop } from "./array/mutators.js";
import { generateArrayReverse, generateArrayShift, generateArrayUnshift } from "./array/reorder.js";
import { generateArrayIndexOf, generateArrayFindIndex } from "./array/search.js";
import { generateArraySplice } from "./array/splice.js";
import {
  generateDefaultNumericSort,
  generateDefaultStringSort,
  generateNumericSortWithFn,
} from "./array/sort.js";
import {
  generateArrayFind,
  generateArraySome,
  generateArrayEvery,
  generateArrayIncludes,
} from "./array/search-predicate.js";
import {
  generateArrayFilter,
  generateArrayForEach,
  generateArrayReduce,
  generateArrayMap,
  generateStringArrayMap,
} from "./array/iteration.js";
import {
  generateArrayLiteralWithSpread,
  generateArrayJoin,
  generateArraySlice,
  generateArrayConcat,
} from "./array/combine.js";

interface ExprBase {
  type: string;
}

export class ArrayGenerator {
  constructor(private ctx: IGeneratorContext) {}

  generateArrayLiteral(expr: Expression, params: string[]): string {
    // Check for spread elements — spread goes to combine.ts, regular to literal.ts
    const arrExpr = expr as { type: string; elements: Expression[] };
    if (arrExpr.elements) {
      for (let i = 0; i < arrExpr.elements.length; i++) {
        const el = arrExpr.elements[i] as ExprBase;
        if (el.type === "spread_element" || el.type.indexOf("spread:") === 0) {
          return generateArrayLiteralWithSpread(this.ctx, arrExpr, params);
        }
      }
    }
    return generateArrayLiteral(this.ctx, expr, params);
  }

  generateArrayPush(expr: MethodCallNode, params: string[]): string {
    return generateArrayPush(this.ctx, expr, params);
  }

  generateArrayPop(expr: MethodCallNode, params: string[]): string {
    return generateArrayPop(this.ctx, expr, params);
  }

  // Predicate/callback resolution must happen here (class method) not in standalone
  // functions, because ChadScript can't access expr.args[0].type in standalone functions.
  generateArrayFind(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error("find() requires exactly 1 argument (predicate function)");
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const { isStringArray, isObjectArray } = detectArrayType(this.ctx, expr, arrayPtr);

    const predicateArg = expr.args[0];
    let predicateFn: string;
    if (predicateArg.type === "variable") {
      predicateFn = this.ctx.mangleUserName((predicateArg as VariableNode).name);
    } else if (predicateArg.type === "arrow_function") {
      if (isStringArray || isObjectArray) {
        this.ctx.setExpectedCallbackParamType("string");
      }
      predicateFn = this.ctx.generateExpression(predicateArg, params);
      this.ctx.setExpectedCallbackParamType(null);
    } else {
      throw new Error("find() argument must be a function name or inline function");
    }

    return generateArrayFind(this.ctx, arrayPtr, predicateFn, isStringArray, isObjectArray);
  }

  generateArraySome(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error("some() requires exactly 1 argument (predicate function)");
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const { isStringArray, isObjectArray } = detectArrayType(this.ctx, expr, arrayPtr);

    const predicateArg = expr.args[0];
    let predicateFn: string;
    if (predicateArg.type === "variable") {
      predicateFn = this.ctx.mangleUserName((predicateArg as VariableNode).name);
    } else if (predicateArg.type === "arrow_function") {
      if (isStringArray || isObjectArray) {
        this.ctx.setExpectedCallbackParamType("string");
      }
      predicateFn = this.ctx.generateExpression(predicateArg, params);
      this.ctx.setExpectedCallbackParamType(null);
    } else {
      throw new Error("some() argument must be a function name or inline function");
    }

    return generateArraySome(this.ctx, arrayPtr, predicateFn, isStringArray, isObjectArray);
  }

  generateArrayEvery(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error("every() requires exactly 1 argument (predicate function)");
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const { isStringArray, isObjectArray } = detectArrayType(this.ctx, expr, arrayPtr);

    const predicateArg = expr.args[0];
    let predicateFn: string;
    if (predicateArg.type === "variable") {
      predicateFn = this.ctx.mangleUserName((predicateArg as VariableNode).name);
    } else if (predicateArg.type === "arrow_function") {
      if (isStringArray || isObjectArray) {
        this.ctx.setExpectedCallbackParamType("string");
      }
      predicateFn = this.ctx.generateExpression(predicateArg, params);
      this.ctx.setExpectedCallbackParamType(null);
    } else {
      throw new Error("every() argument must be a function name or inline function");
    }

    return generateArrayEvery(this.ctx, arrayPtr, predicateFn, isStringArray, isObjectArray);
  }

  generateArrayFilter(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error("filter() requires exactly 1 argument (predicate function)");
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const { isStringArray, isObjectArray } = detectArrayType(this.ctx, expr, arrayPtr);

    const predicateArg = expr.args[0];
    let predicateFn: string;
    if (predicateArg.type === "variable") {
      predicateFn = this.ctx.mangleUserName((predicateArg as VariableNode).name);
    } else if (predicateArg.type === "arrow_function") {
      if (isStringArray || isObjectArray) {
        this.ctx.setExpectedCallbackParamType("string");
      }
      predicateFn = this.ctx.generateExpression(predicateArg, params);
      this.ctx.setExpectedCallbackParamType(null);
    } else {
      throw new Error("filter() argument must be a function name or inline function");
    }

    return generateArrayFilter(this.ctx, arrayPtr, predicateFn, isStringArray, isObjectArray);
  }

  generateArrayForEach(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error("forEach() requires exactly 1 argument (callback function)");
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const { isStringArray, isObjectArray } = detectArrayType(this.ctx, expr, arrayPtr);

    const callbackArg = expr.args[0];
    let callbackFn: string;
    if (callbackArg.type === "variable") {
      callbackFn = this.ctx.mangleUserName((callbackArg as VariableNode).name);
    } else if (callbackArg.type === "arrow_function") {
      if (isStringArray || isObjectArray) {
        this.ctx.setExpectedCallbackParamType("string");
      }
      callbackFn = this.ctx.generateExpression(callbackArg, params);
      this.ctx.setExpectedCallbackParamType(null);
    } else {
      throw new Error("forEach() argument must be a function name or inline function");
    }

    return generateArrayForEach(this.ctx, arrayPtr, callbackFn, isStringArray, isObjectArray);
  }

  generateArrayReduce(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1 || expr.args.length > 2) {
      throw new Error("reduce() requires 1-2 arguments (callback, optional initialValue)");
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    let isStringArray = false;
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === "variable") {
      const varName = (expr.object as VariableNode).name;
      const varType = this.ctx.getVariableType(varName);
      isStringArray = varType === "%StringArray*" || varType === "%StringArray";
    } else {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === "%StringArray*";
    }

    const callbackArg = expr.args[0];
    let callbackFn: string;
    if (callbackArg.type === "variable") {
      callbackFn = this.ctx.mangleUserName((callbackArg as VariableNode).name);
    } else if (callbackArg.type === "arrow_function") {
      if (isStringArray) {
        this.ctx.setExpectedCallbackParamType("string");
      }
      callbackFn = this.ctx.generateExpression(callbackArg, params);
      this.ctx.setExpectedCallbackParamType(null);
    } else {
      throw new Error("reduce() argument must be a function name or inline function");
    }

    let initialValue: string | null = null;
    if (expr.args.length === 2) {
      initialValue = this.ctx.generateExpression(expr.args[1], params);
    }

    return generateArrayReduce(this.ctx, arrayPtr, callbackFn, isStringArray, initialValue);
  }

  generateArrayMap(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error("map() requires exactly 1 argument (callback function)");
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const { isStringArray, isObjectArray } = detectArrayType(this.ctx, expr, arrayPtr);

    const callbackArg = expr.args[0];
    let callbackFn: string;
    if (callbackArg.type === "variable") {
      callbackFn = this.ctx.mangleUserName((callbackArg as VariableNode).name);
    } else if (callbackArg.type === "arrow_function") {
      if (isStringArray || isObjectArray) {
        this.ctx.setExpectedCallbackParamType("string");
        this.ctx.setExpectedCallbackReturnType("string");
      } else {
        this.ctx.setExpectedCallbackReturnType("number");
      }
      callbackFn = this.ctx.generateExpression(callbackArg, params);
      this.ctx.setExpectedCallbackParamType(null);
      this.ctx.setExpectedCallbackReturnType(null);
    } else {
      throw new Error("map() argument must be a function name or inline function");
    }

    return generateArrayMap(this.ctx, arrayPtr, callbackFn, isStringArray, isObjectArray);
  }

  generateStringArrayMap(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error("map() requires exactly 1 argument (callback function)");
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    const callbackArg = expr.args[0];
    let callbackFn: string;
    if (callbackArg.type === "variable") {
      callbackFn = this.ctx.mangleUserName((callbackArg as VariableNode).name);
    } else if (callbackArg.type === "arrow_function") {
      this.ctx.setExpectedCallbackParamType("string");
      this.ctx.setExpectedCallbackReturnType("string");
      callbackFn = this.ctx.generateExpression(callbackArg, params);
      this.ctx.setExpectedCallbackParamType(null);
      this.ctx.setExpectedCallbackReturnType(null);
    } else {
      throw new Error("map() argument must be a function name or inline function");
    }

    return generateStringArrayMap(this.ctx, arrayPtr, callbackFn);
  }

  generateArrayIncludes(expr: MethodCallNode, params: string[]): string {
    return generateArrayIncludes(this.ctx, expr, params);
  }

  generateArrayJoin(expr: MethodCallNode, params: string[]): string {
    return generateArrayJoin(this.ctx, expr, params);
  }

  generateArraySlice(expr: MethodCallNode, params: string[]): string {
    return generateArraySlice(this.ctx, expr, params);
  }

  generateArrayConcat(expr: MethodCallNode, params: string[]): string {
    return generateArrayConcat(this.ctx, expr, params);
  }

  generateArrayReverse(expr: MethodCallNode, params: string[]): string {
    return generateArrayReverse(this.ctx, expr, params);
  }

  generateArrayShift(expr: MethodCallNode, params: string[]): string {
    return generateArrayShift(this.ctx, expr, params);
  }

  generateArrayUnshift(expr: MethodCallNode, params: string[]): string {
    return generateArrayUnshift(this.ctx, expr, params);
  }

  generateArrayIndexOf(expr: MethodCallNode, params: string[]): string {
    return generateArrayIndexOf(this.ctx, expr, params);
  }

  // findIndex needs facade-level predicate resolution before delegating to search.ts
  generateArrayFindIndex(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error("findIndex() requires exactly 1 argument (predicate function)");
    }

    const exprObjBase = expr.object as ExprBase;
    let isStringArray = false;
    if (exprObjBase.type === "variable") {
      const varName = (expr.object as VariableNode).name;
      const varType = this.ctx.getVariableType(varName);
      isStringArray = varType === "%StringArray*" || varType === "%StringArray";
    }

    const predicateArg = expr.args[0];
    let predicateFn: string;

    if (predicateArg.type === "variable") {
      predicateFn = this.ctx.mangleUserName((predicateArg as VariableNode).name);
    } else if (predicateArg.type === "arrow_function") {
      if (isStringArray) {
        this.ctx.setExpectedCallbackParamType("string");
      }
      predicateFn = this.ctx.generateExpression(predicateArg, params);
      this.ctx.setExpectedCallbackParamType(null);
    } else {
      throw new Error("findIndex() argument must be a function name or inline function");
    }

    return generateArrayFindIndex(this.ctx, expr, params, predicateFn, isStringArray);
  }

  // sort needs facade-level type detection and comparator resolution
  generateArraySort(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length > 1) {
      throw new Error("sort() expects 0 or 1 arguments");
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    this.ctx.setUsesArraySort(true);

    let isStringArray = false;
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === "variable") {
      const varName = (expr.object as VariableNode).name;
      const varType = this.ctx.getVariableType(varName);
      isStringArray = varType === "%StringArray*" || varType === "%StringArray";
    }
    if (!isStringArray) {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      if (ptrType === "%StringArray*" || ptrType === "%StringArray") isStringArray = true;
    }

    if (expr.args.length === 0) {
      if (isStringArray) {
        return generateDefaultStringSort(this.ctx, arrayPtr);
      }
      return generateDefaultNumericSort(this.ctx, arrayPtr);
    }

    const predicateArg = expr.args[0];
    let compareFn: string;

    if (predicateArg.type === "variable") {
      compareFn = this.ctx.mangleUserName((predicateArg as VariableNode).name);
    } else if (predicateArg.type === "arrow_function") {
      compareFn = this.ctx.generateExpression(predicateArg, params);
    } else {
      throw new Error("sort() comparator must be a function name or inline function");
    }

    return generateNumericSortWithFn(this.ctx, arrayPtr, compareFn);
  }

  generateArraySplice(expr: MethodCallNode, params: string[]): string {
    return generateArraySplice(this.ctx, expr, params);
  }
}
