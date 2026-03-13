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

export function isStringArrayType(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  arrayPtr: string,
): boolean {
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type === "variable") {
    const varName = (expr.object as VariableNode).name;
    const varType = gen.getVariableType(varName);
    if (varType === "%StringArray*" || varType === "%StringArray") return true;
    const ptrType = gen.getVariableType(arrayPtr);
    if (ptrType === "%StringArray*") return true;
    return false;
  } else if (exprObjBase.type === "member_access") {
    const ptrType = gen.getVariableType(arrayPtr);
    return ptrType === "%StringArray*";
  } else {
    const ptrType = gen.getVariableType(arrayPtr);
    if (ptrType === "%StringArray*") return true;
    return false;
  }
}

export function isObjectArrayType(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  arrayPtr: string,
): boolean {
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type === "variable") {
    const varName = (expr.object as VariableNode).name;
    const varType = gen.getVariableType(varName);
    if (varType === "%ObjectArray*" || varType === "%ObjectArray") return true;
    const ptrType = gen.getVariableType(arrayPtr);
    if (ptrType === "%ObjectArray*") return true;
    return false;
  } else if (exprObjBase.type === "member_access") {
    const ptrType = gen.getVariableType(arrayPtr);
    if (ptrType === "%StringArray*") return false;
    if (ptrType && ptrType.indexOf("*") !== -1 && ptrType !== "%Array*") return true;
    return false;
  } else {
    const ptrType = gen.getVariableType(arrayPtr);
    if (ptrType === "%ObjectArray*") return true;
    return false;
  }
}

/**
 * @deprecated Use isStringArrayType and isObjectArrayType instead.
 * Object destructuring of return values is miscompiled by the native compiler:
 * it calls the function twice and reads field 0 both times, ignoring field 1.
 */
export function detectArrayType(
  gen: IGeneratorContext,
  expr: MethodCallNode,
  arrayPtr: string,
): { isStringArray: boolean; isObjectArray: boolean } {
  const isStringArray = isStringArrayType(gen, expr, arrayPtr);
  const isObjectArray = isObjectArrayType(gen, expr, arrayPtr);
  return { isStringArray, isObjectArray };
}
