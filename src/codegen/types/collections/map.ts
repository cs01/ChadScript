// Map codegen facade — delegates to map/ submodules.
// Do not add new methods here; add them to the appropriate submodule instead.

import { Expression, MethodCallNode } from "../../../ast/types.js";
import { IGeneratorContext } from "../../infrastructure/generator-context.js";

import {
  generateMapLiteral,
  generateMapSet,
  generateMapGet,
  generateMapHas,
  generateMapSize,
  generateMapClear,
  generateMapDelete,
  generateMapKeys,
  generateMapValues,
} from "./map/numeric.js";

import {
  generateEmptyStringMap,
  generateStringMapSet,
  generateStringMapGet,
  generateStringMapHas,
  generateStringMapSize,
  generateStringMapClear,
  generateStringMapDelete,
  generateStringMapEntries,
  generateStringMapValues,
  generateStringMapKeys,
} from "./map/string-map.js";

import {
  generatePointerMapGet,
  generatePointerMapSet,
  generatePointerMapClear,
  generatePointerMapHas,
  generatePointerMapDelete,
  generatePointerMapSize,
  generatePointerMapEntries,
  generatePointerMapKeys,
  generatePointerMapValues,
} from "./map/pointer-map.js";

export class MapGenerator {
  private ctx: IGeneratorContext;
  constructor(ctx: IGeneratorContext) {
    this.ctx = ctx;
  }

  generateMapLiteral(expr: Expression, params: string[]): string {
    return generateMapLiteral(this.ctx, expr, params);
  }

  generateMapSet(expr: MethodCallNode, params: string[]): string {
    return generateMapSet(this.ctx, expr, params);
  }

  generateMapGet(expr: MethodCallNode, params: string[]): string {
    return generateMapGet(this.ctx, expr, params);
  }

  generateMapHas(expr: MethodCallNode, params: string[]): string {
    return generateMapHas(this.ctx, expr, params);
  }

  generateMapSize(mapPtr: string): string {
    return generateMapSize(this.ctx, mapPtr);
  }

  generateMapClear(expr: MethodCallNode, params: string[]): string {
    return generateMapClear(this.ctx, expr, params);
  }

  generateMapDelete(expr: MethodCallNode, params: string[]): string {
    return generateMapDelete(this.ctx, expr, params);
  }

  generateMapKeys(mapPtr: string): string {
    return generateMapKeys(this.ctx, mapPtr);
  }

  generateMapValues(mapPtr: string): string {
    return generateMapValues(this.ctx, mapPtr);
  }
}

export class StringMapGenerator {
  private ctx: IGeneratorContext;
  constructor(ctx: IGeneratorContext) {
    this.ctx = ctx;
  }

  generateEmptyStringMap(): string {
    return generateEmptyStringMap(this.ctx);
  }

  generateStringMapSet(
    mapPtr: string,
    keyValue: string,
    valueValue: string,
    declaredValueType?: string,
  ): string {
    return generateStringMapSet(this.ctx, mapPtr, keyValue, valueValue, declaredValueType);
  }

  generateStringMapGet(mapPtr: string, keyToFind: string): string {
    return generateStringMapGet(this.ctx, mapPtr, keyToFind);
  }

  generateStringMapHas(mapPtr: string, keyToFind: string): string {
    return generateStringMapHas(this.ctx, mapPtr, keyToFind);
  }

  generateStringMapSize(mapPtr: string): string {
    return generateStringMapSize(this.ctx, mapPtr);
  }

  generateStringMapClear(mapPtr: string): string {
    return generateStringMapClear(this.ctx, mapPtr);
  }

  generateStringMapDelete(mapPtr: string, keyToFind: string): string {
    return generateStringMapDelete(this.ctx, mapPtr, keyToFind);
  }

  generateStringMapEntries(mapPtr: string): string {
    return generateStringMapEntries(this.ctx, mapPtr);
  }

  generateStringMapValues(mapPtr: string): string {
    return generateStringMapValues(this.ctx, mapPtr);
  }

  generateStringMapKeys(mapPtr: string): string {
    return generateStringMapKeys(this.ctx, mapPtr);
  }
}

export class PointerMapGenerator {
  private ctx: IGeneratorContext;
  constructor(ctx: IGeneratorContext) {
    this.ctx = ctx;
  }

  generatePointerMapGet(mapPtr: string, keyToFind: string, valueType: string): string {
    return generatePointerMapGet(this.ctx, mapPtr, keyToFind, valueType);
  }

  generatePointerMapSet(mapPtr: string, keyValue: string, valueValue: string): string {
    return generatePointerMapSet(this.ctx, mapPtr, keyValue, valueValue);
  }

  generatePointerMapClear(mapPtr: string): string {
    return generatePointerMapClear(this.ctx, mapPtr);
  }

  generatePointerMapHas(mapPtr: string, keyToFind: string): string {
    return generatePointerMapHas(this.ctx, mapPtr, keyToFind);
  }

  generatePointerMapDelete(mapPtr: string, keyToFind: string): string {
    return generatePointerMapDelete(this.ctx, mapPtr, keyToFind);
  }

  generatePointerMapSize(mapPtr: string): string {
    return generatePointerMapSize(this.ctx, mapPtr);
  }

  generatePointerMapEntries(mapPtr: string): string {
    return generatePointerMapEntries(this.ctx, mapPtr);
  }

  generatePointerMapKeys(mapPtr: string): string {
    return generatePointerMapKeys(this.ctx, mapPtr);
  }

  generatePointerMapValues(mapPtr: string): string {
    return generatePointerMapValues(this.ctx, mapPtr);
  }
}
