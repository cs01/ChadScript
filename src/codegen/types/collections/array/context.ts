// Shared context interface and helpers for array submodules.
// All array codegen functions accept IGeneratorContext directly (same as string/ submodules).
// Shared helpers live here to avoid ChadScript name collisions across submodule files.

export type { IGeneratorContext } from "../../../infrastructure/generator-context.js";
import type { IGeneratorContext } from "../../../infrastructure/generator-context.js";
import { MethodCallNode, VariableNode } from "../../../../ast/types.js";

interface ExprBase {
  type: string;
}

/** Loads %Array (numeric) length and data pointer. */
export function loadArrayMeta(
  gen: IGeneratorContext,
  arrayPtr: string,
): { length: string; dataPtr: string } {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const length = gen.nextTemp();
  gen.emit(`${length} = load i32, i32* ${lenPtr}`);
  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);
  return { length, dataPtr };
}

/**
 * Detects whether the array expression is a string or object array.
 * Shared by find/some/every/filter/forEach/reduce/map.
 */
export function detectArrayType(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  arrayPtr: string,
): { isStringArray: boolean; isObjectArray: boolean } {
  let isStringArray = false;
  let isObjectArray = false;
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type === "variable") {
    const varName = (expr.object as VariableNode).name;
    const varType = gen.getVariableType(varName);
    isStringArray = varType === "%StringArray*" || varType === "%StringArray";
    isObjectArray = varType === "%ObjectArray*" || varType === "%ObjectArray";
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
  return { isStringArray, isObjectArray };
}
