/**
 * Array codegen facade — delegates to submodule files under array/.
 * New array methods should go in the appropriate submodule, NOT this file.
 */

import { Expression, MethodCallNode, ArrayNode } from "../../../ast/types.js";
import { IGeneratorContext } from "../../infrastructure/generator-context.js";

// Array sub-modules
// No alias — ChadScript doesn't resolve import aliases in self-hosting
import { generateArrayLiteral } from "./array/literal.js";
import { generateArrayPush, generateArrayPop } from "./array/mutators.js";
import { generateArrayReverse, generateArrayShift, generateArrayUnshift } from "./array/reorder.js";
import {
  generateArrayIndexOf,
  generateArrayLastIndexOf,
  generateArrayFindIndex,
  generateArrayAt,
} from "./array/search.js";
import { generateArraySplice } from "./array/splice.js";
import { generateArraySort } from "./array/sort.js";
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

export class ArrayGenerator {
  constructor(private ctx: IGeneratorContext) {}

  generateArrayLiteral(expr: Expression, params: string[]): string {
    // Check for spread elements — spread goes to combine.ts, regular to literal.ts
    const arrExpr = expr as ArrayNode;
    if (arrExpr.elements) {
      for (let i = 0; i < arrExpr.elements.length; i++) {
        const el = arrExpr.elements[i] as { type: string };
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

  generateArrayFind(expr: MethodCallNode, params: string[]): string {
    return generateArrayFind(this.ctx, expr, params);
  }

  generateArraySome(expr: MethodCallNode, params: string[]): string {
    return generateArraySome(this.ctx, expr, params);
  }

  generateArrayEvery(expr: MethodCallNode, params: string[]): string {
    return generateArrayEvery(this.ctx, expr, params);
  }

  generateArrayFilter(expr: MethodCallNode, params: string[]): string {
    return generateArrayFilter(this.ctx, expr, params);
  }

  generateArrayForEach(expr: MethodCallNode, params: string[]): string {
    return generateArrayForEach(this.ctx, expr, params);
  }

  generateArrayReduce(expr: MethodCallNode, params: string[]): string {
    return generateArrayReduce(this.ctx, expr, params);
  }

  generateArrayMap(expr: MethodCallNode, params: string[]): string {
    return generateArrayMap(this.ctx, expr, params);
  }

  generateStringArrayMap(expr: MethodCallNode, params: string[]): string {
    return generateStringArrayMap(this.ctx, expr, params);
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

  generateArrayLastIndexOf(expr: MethodCallNode, params: string[]): string {
    return generateArrayLastIndexOf(this.ctx, expr, params);
  }

  generateArrayAt(expr: MethodCallNode, params: string[]): string {
    return generateArrayAt(this.ctx, expr, params);
  }

  generateArrayFindIndex(expr: MethodCallNode, params: string[]): string {
    return generateArrayFindIndex(this.ctx, expr, params);
  }

  generateArraySort(expr: MethodCallNode, params: string[]): string {
    return generateArraySort(this.ctx, expr, params);
  }

  generateArraySplice(expr: MethodCallNode, params: string[]): string {
    return generateArraySplice(this.ctx, expr, params);
  }
}
