// NOTE: This file uses raw ctx.emit() extensively. Prefer structured IR builders
// (emitStore, emitLoad, emitCall, etc.) when modifying — see .claude/rules.md.

import {
  Expression,
  IndexAccessNode,
  IndexAccessAssignmentNode,
  MemberAccessNode,
  VariableNode,
} from "../../../ast/types.js";

interface ExprBase {
  type: string;
}
interface ObjectMetaBasic {
  keys: string[];
  types: string[];
}
import type { SymbolTable } from "../../infrastructure/symbol-table.js";
import type { IStringGenerator } from "../../infrastructure/generator-context.js";
import type { SourceLocation } from "../../../ast/types.js";

export interface IndexAccessGeneratorContext {
  nextTemp(): string;
  nextLabel(prefix: string): string;
  emit(instruction: string): void;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  readonly symbolTable: SymbolTable;
  isStringArrayExpression(expr: Expression): boolean;
  isArrayExpression(expr: Expression): boolean;
  isObjectArrayExpression(expr: Expression): boolean;
  isUint8ArrayExpression(expr: Expression): boolean;
  getVariableAlloca(name: string): string | undefined;
  generateExpression(expr: Expression, params: string[]): string;
  isStringExpression(expr: Expression): boolean;
  readonly stringGen: IStringGenerator;
  ensureDouble(value: string): string;
  setUsesJson(value: boolean): void;
  emitError(message: string, loc?: SourceLocation, suggestion?: string): never;
  isSafeIndex(indexName: string, arrayName: string): boolean;
}

/**
 * IndexAccessGenerator
 *
 * Handles index access expressions:
 * - process.argv[i] (special case for command-line arguments)
 * - String arrays (string[])
 * - Numeric arrays (number[])
 * - String character access (string[i])
 */
export class IndexAccessGenerator {
  constructor(private ctx: IndexAccessGeneratorContext) {}

  /**
   * Generate index access expression
   * @param expr - Index access expression node
   * @param params - Function parameter names
   */
  generate(expr: IndexAccessNode, params: string[]): string {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === "member_access") {
      const memberAccess = expr.object as MemberAccessNode;
      const memberAccessObjBase = memberAccess.object as ExprBase;
      if (
        memberAccessObjBase.type === "variable" &&
        (memberAccess.object as VariableNode).name === "process" &&
        memberAccess.property === "argv"
      ) {
        return this.generateProcessArgvIndex(expr, params);
      }
      if (memberAccessObjBase.type === "variable") {
        const baseVarName = (memberAccess.object as VariableNode).name;
        const baseIfaceType = this.ctx.symbolTable.getInterfaceType(baseVarName);
        if (baseIfaceType || this.ctx.symbolTable.isObject(baseVarName)) {
          const isStringArray = this.ctx.isStringArrayExpression(expr.object);
          const isObjectArray = !isStringArray && this.ctx.isObjectArrayExpression(expr.object);
          if (isStringArray) {
            return this.generateStringArrayIndex(expr, params);
          } else if (isObjectArray) {
            return this.generateObjectArrayIndex(expr, params);
          }
        }
        if (
          this.ctx.symbolTable.isJSON(baseVarName) ||
          this.ctx.symbolTable.isObject(baseVarName)
        ) {
          return this.generateJSONMemberArrayIndex(expr, params);
        }
      }
    }

    // Check if it's a JSON array (from JSON.parse<number[]> or similar)
    if (
      exprObjBase.type === "variable" &&
      this.ctx.symbolTable.isJSON((expr.object as VariableNode).name)
    ) {
      this.ctx.setUsesJson(true);
      return this.generateJSONArrayIndex(expr, params);
    }

    const isStringArray = this.ctx.isStringArrayExpression(expr.object);
    const isObjectArray = !isStringArray && this.ctx.isObjectArrayExpression(expr.object);
    const isUint8Array =
      !isStringArray && !isObjectArray && this.ctx.isUint8ArrayExpression(expr.object);
    const isNumericArray =
      !isStringArray && !isObjectArray && !isUint8Array && this.ctx.isArrayExpression(expr.object);
    if (isStringArray) {
      return this.generateStringArrayIndex(expr, params);
    } else if (isObjectArray) {
      return this.generateObjectArrayIndex(expr, params);
    } else if (isUint8Array) {
      return this.generateUint8ArrayIndex(expr, params);
    } else if (isNumericArray) {
      return this.generateNumericArrayIndex(expr, params);
    }

    // Check if it's an object variable with dynamic property access
    if (exprObjBase.type === "variable") {
      const varName = (expr.object as VariableNode).name;
      if (this.ctx.symbolTable.isObject(varName)) {
        const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
        if (objMeta && objMeta.keys.length > 0) {
          return this.generateDynamicObjectAccess(expr, params, objMeta);
        }
      }
    }

    // Handle string[index] - returns character code as i32, then convert to double
    return this.generateStringCharIndex(expr, params);
  }

  private generateProcessArgvIndex(expr: IndexAccessNode, params: string[]): string {
    // Index into argv: process.argv[i]
    const argvStruct = this.ctx.generateExpression(expr.object, params);
    const indexDouble = this.ctx.generateExpression(expr.index, params);

    const dblIndex = this.ctx.ensureDouble(indexDouble);
    const index = this.ctx.nextTemp();
    this.ctx.emit(`${index} = fptosi double ${dblIndex} to i32`);

    // Extract data pointer from StringArray struct (field 0)
    const dataField = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 0`,
    );
    const argvPtr = this.ctx.nextTemp();
    this.ctx.emit(`${argvPtr} = load i8**, i8*** ${dataField}`);

    // Get pointer to i-th argument
    const indexI64 = this.ctx.nextTemp();
    this.ctx.emit(`${indexI64} = sext i32 ${index} to i64`);

    const argPtr = this.ctx.nextTemp();
    this.ctx.emit(`${argPtr} = getelementptr inbounds i8*, i8** ${argvPtr}, i64 ${indexI64}`);

    const argRaw = this.ctx.nextTemp();
    this.ctx.emit(`${argRaw} = load i8*, i8** ${argPtr}`);

    // Safely handle NULL pointers (out of bounds argv access)
    const arg = this.ctx.nextTemp();
    this.ctx.emit(`${arg} = call i8* @__safe_string(i8* ${argRaw})`);

    // Track this temporary register as string type
    this.ctx.setVariableType(arg, "i8*");

    return arg;
  }

  private toI32Index(indexValue: string): string {
    const indexType = this.ctx.getVariableType(indexValue);
    if (indexType === "double") {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = fptosi double ${indexValue} to i32`);
      return temp;
    } else if (indexType === "i64") {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = trunc i64 ${indexValue} to i32`);
      return temp;
    }
    return indexValue;
  }

  // Returns true when the given index access is a direct `arr[i]` pattern where
  // the (i, arr) pair has been proven safe by loop analysis, so we can skip the
  // runtime bounds check entirely.
  private isProvenSafeAccess(expr: IndexAccessNode | IndexAccessAssignmentNode): boolean {
    const obj = expr.object as ExprBase;
    const idx = expr.index as ExprBase;
    if (obj.type !== "variable") return false;
    if (idx.type !== "variable") return false;
    const arrName = (expr.object as VariableNode).name;
    const idxName = (expr.index as VariableNode).name;
    return this.ctx.isSafeIndex(idxName, arrName);
  }

  private emitBoundsCheck(arrayPtr: string, arrayType: string, index: string): void {
    const lenPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${lenPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${arrayPtr}, i32 0, i32 1`,
    );
    const len = this.ctx.nextTemp();
    this.ctx.emit(`${len} = load i32, i32* ${lenPtr}`);
    this.emitInlineBoundsCheck(index, len);
  }

  private emitInlineBoundsCheck(index: string, len: string): void {
    const oob = this.ctx.nextTemp();
    this.ctx.emit(`${oob} = icmp uge i32 ${index}, ${len}`);
    const failLabel = this.ctx.nextLabel("bounds_fail");
    const okLabel = this.ctx.nextLabel("bounds_ok");
    this.ctx.emit(`br i1 ${oob}, label %${failLabel}, label %${okLabel}`);
    this.ctx.emit(`${failLabel}:`);
    this.ctx.emit(`call void @__cs_bounds_fail(i32 ${index}, i32 ${len})`);
    this.ctx.emit(`unreachable`);
    this.ctx.emit(`${okLabel}:`);
    const inBounds = this.ctx.nextTemp();
    this.ctx.emit(`${inBounds} = icmp ult i32 ${index}, ${len}`);
    this.ctx.emit(`call void @llvm.assume(i1 ${inBounds})`);
  }

  private generateStringArrayIndex(expr: IndexAccessNode, params: string[]): string {
    let stringArrayPtr = this.ctx.generateExpression(expr.object, params);
    const indexDouble = this.ctx.generateExpression(expr.index, params);
    const index = this.toI32Index(indexDouble);

    const ptrType = this.ctx.getVariableType(stringArrayPtr);
    if (ptrType === "i8*") {
      const cast = this.ctx.nextTemp();
      this.ctx.emit(`${cast} = bitcast i8* ${stringArrayPtr} to %StringArray*`);
      stringArrayPtr = cast;
    }

    if (!this.isProvenSafeAccess(expr)) {
      this.emitBoundsCheck(stringArrayPtr, "%StringArray", index);
    }

    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataPtr} = getelementptr inbounds %StringArray, %StringArray* ${stringArrayPtr}, i32 0, i32 0`,
    );

    const data = this.ctx.nextTemp();
    this.ctx.emit(`${data} = load i8**, i8*** ${dataPtr}`);

    const elemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${data}, i32 ${index}`);

    const elem = this.ctx.nextTemp();
    this.ctx.emit(`${elem} = load i8*, i8** ${elemPtr}`);
    this.ctx.setVariableType(elem, "i8*");
    return elem;
  }

  private generateNumericArrayIndex(expr: IndexAccessNode, params: string[]): string {
    let arrayPtr = this.ctx.generateExpression(expr.object, params);
    const indexDouble = this.ctx.generateExpression(expr.index, params);
    const index = this.toI32Index(indexDouble);

    const ptrType = this.ctx.getVariableType(arrayPtr);
    if (ptrType === "i8*") {
      const cast = this.ctx.nextTemp();
      this.ctx.emit(`${cast} = bitcast i8* ${arrayPtr} to %Array*`);
      arrayPtr = cast;
    }

    if (!this.isProvenSafeAccess(expr)) {
      this.emitBoundsCheck(arrayPtr, "%Array", index);
    }

    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);

    const data = this.ctx.nextTemp();
    this.ctx.emit(`${data} = load double*, double** ${dataPtr}`);

    const elemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elemPtr} = getelementptr inbounds double, double* ${data}, i32 ${index}`);

    const elem = this.ctx.nextTemp();
    this.ctx.emit(`${elem} = load double, double* ${elemPtr}`);
    this.ctx.setVariableType(elem, "double");
    return elem;
  }

  private getContiguousStride(expr: IndexAccessNode): number {
    const objExpr = expr.object as { type: string };
    if (objExpr.type === "variable") {
      const varName = (expr.object as VariableNode).name;
      const numFields = this.ctx.symbolTable.getContiguousFieldCount(varName);
      if (numFields > 0) return numFields * 8;
    }
    return 0;
  }

  private emitContiguousElementPtr(
    arrayPtr: string,
    arrayTypeStr: string,
    index: string,
    stride: number,
  ): string {
    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataPtr} = getelementptr inbounds ${arrayTypeStr}, ${arrayTypeStr}* ${arrayPtr}, i32 0, i32 0`,
    );
    const data = this.ctx.nextTemp();
    this.ctx.emit(`${data} = load i8*, i8** ${dataPtr}`);
    const indexI64 = this.ctx.nextTemp();
    this.ctx.emit(`${indexI64} = sext i32 ${index} to i64`);
    const offset = this.ctx.nextTemp();
    this.ctx.emit(`${offset} = mul i64 ${indexI64}, ${stride}`);
    const elem = this.ctx.nextTemp();
    this.ctx.emit(`${elem} = getelementptr inbounds i8, i8* ${data}, i64 ${offset}`);
    this.ctx.setVariableType(elem, "i8*");
    return elem;
  }

  private emitPointerArrayElementPtr(dataRaw: string, index: string): string {
    const dataAsPtrs = this.ctx.nextTemp();
    this.ctx.emit(`${dataAsPtrs} = bitcast i8* ${dataRaw} to i8**`);
    const elemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataAsPtrs}, i32 ${index}`);
    const elem = this.ctx.nextTemp();
    this.ctx.emit(`${elem} = load i8*, i8** ${elemPtr}`);
    this.ctx.setVariableType(elem, "i8*");
    return elem;
  }

  private generateObjectArrayIndex(expr: IndexAccessNode, params: string[]): string {
    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const indexDouble = this.ctx.generateExpression(expr.index, params);

    const index = this.toI32Index(indexDouble);
    const contiguousStride = this.getContiguousStride(expr);

    const safeAccess = this.isProvenSafeAccess(expr);
    const arrayType = this.ctx.getVariableType(arrayPtr);
    if (arrayType === "%ObjectArray*") {
      if (!safeAccess) this.emitBoundsCheck(arrayPtr, "%ObjectArray", index);
      if (contiguousStride > 0) {
        return this.emitContiguousElementPtr(arrayPtr, "%ObjectArray", index, contiguousStride);
      }
      const dataPtr = this.ctx.nextTemp();
      this.ctx.emit(
        `${dataPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
      );
      const data = this.ctx.nextTemp();
      this.ctx.emit(`${data} = load i8*, i8** ${dataPtr}`);
      return this.emitPointerArrayElementPtr(data, index);
    }

    if (arrayType === "i8*") {
      const arrayCast = this.ctx.nextTemp();
      this.ctx.emit(`${arrayCast} = bitcast i8* ${arrayPtr} to %ObjectArray*`);
      if (!safeAccess) this.emitBoundsCheck(arrayCast, "%ObjectArray", index);
      if (contiguousStride > 0) {
        return this.emitContiguousElementPtr(arrayCast, "%ObjectArray", index, contiguousStride);
      }
      const dataPtr = this.ctx.nextTemp();
      this.ctx.emit(
        `${dataPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayCast}, i32 0, i32 0`,
      );
      const data = this.ctx.nextTemp();
      this.ctx.emit(`${data} = load i8*, i8** ${dataPtr}`);
      return this.emitPointerArrayElementPtr(data, index);
    }

    if (!safeAccess) this.emitBoundsCheck(arrayPtr, "%ObjectArray", index);
    if (contiguousStride > 0) {
      return this.emitContiguousElementPtr(arrayPtr, "%ObjectArray", index, contiguousStride);
    }
    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
    );
    const data = this.ctx.nextTemp();
    this.ctx.emit(`${data} = load i8*, i8** ${dataPtr}`);
    return this.emitPointerArrayElementPtr(data, index);
  }

  private generateUint8ArrayIndex(expr: IndexAccessNode, params: string[]): string {
    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const indexDouble = this.ctx.generateExpression(expr.index, params);

    const index = this.toI32Index(indexDouble);

    if (!this.isProvenSafeAccess(expr)) {
      this.emitBoundsCheck(arrayPtr, "%Uint8Array", index);
    }

    const dataFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataFieldPtr} = getelementptr inbounds %Uint8Array, %Uint8Array* ${arrayPtr}, i32 0, i32 0`,
    );
    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = load i8*, i8** ${dataFieldPtr}`);

    const elemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elemPtr} = getelementptr inbounds i8, i8* ${dataPtr}, i32 ${index}`);
    const byteVal = this.ctx.nextTemp();
    this.ctx.emit(`${byteVal} = load i8, i8* ${elemPtr}`);
    const intVal = this.ctx.nextTemp();
    this.ctx.emit(`${intVal} = zext i8 ${byteVal} to i32`);
    const dblVal = this.ctx.nextTemp();
    this.ctx.emit(`${dblVal} = sitofp i32 ${intVal} to double`);
    this.ctx.setVariableType(dblVal, "double");
    return dblVal;
  }

  private generateUint8ArrayAssignment(
    expr: IndexAccessAssignmentNode,
    value: string,
    params: string[],
  ): string {
    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    const indexDouble = this.ctx.generateExpression(expr.index, params);
    const index = this.toI32Index(indexDouble);

    this.emitBoundsCheck(arrayPtr, "%Uint8Array", index);

    const dataFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataFieldPtr} = getelementptr inbounds %Uint8Array, %Uint8Array* ${arrayPtr}, i32 0, i32 0`,
    );
    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = load i8*, i8** ${dataFieldPtr}`);

    const dblValue = this.ctx.ensureDouble(value);
    const intValue = this.ctx.nextTemp();
    this.ctx.emit(`${intValue} = fptosi double ${dblValue} to i32`);
    const byteValue = this.ctx.nextTemp();
    this.ctx.emit(`${byteValue} = trunc i32 ${intValue} to i8`);

    const elemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elemPtr} = getelementptr inbounds i8, i8* ${dataPtr}, i32 ${index}`);
    this.ctx.emit(`store i8 ${byteValue}, i8* ${elemPtr}`);

    return value;
  }

  private generateStringCharIndex(expr: IndexAccessNode, params: string[]): string {
    const objPtr = this.ctx.generateExpression(expr.object, params);
    const indexDouble = this.ctx.generateExpression(expr.index, params);

    // Convert double index to i32 (assume double if not explicitly i32)
    const indexType = this.ctx.getVariableType(indexDouble);
    let index = indexDouble;
    if (indexType === "double" || !indexType) {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
    } else if (indexType === "i64") {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = trunc i64 ${indexDouble} to i32`);
    } else if (indexType !== "i32" && indexType !== "i64") {
      return this.ctx.emitError(
        `String character index must be a number, got type: ${indexType}. Dynamic object property access with string keys is not yet supported.`,
        expr.loc,
      );
    }

    const strLen64 = this.ctx.nextTemp();
    this.ctx.emit(`${strLen64} = call i64 @strlen(i8* ${objPtr})`);
    const strLen = this.ctx.nextTemp();
    this.ctx.emit(`${strLen} = trunc i64 ${strLen64} to i32`);
    this.emitInlineBoundsCheck(index, strLen);

    const indexI64 = this.ctx.nextTemp();
    this.ctx.emit(`${indexI64} = sext i32 ${index} to i64`);

    const charPtr = this.ctx.nextTemp();
    this.ctx.emit(`${charPtr} = getelementptr inbounds i8, i8* ${objPtr}, i64 ${indexI64}`);

    const charI8 = this.ctx.nextTemp();
    this.ctx.emit(`${charI8} = load i8, i8* ${charPtr}`);

    // TypeScript str[i] returns a single-character string, not a number
    // Allocate 2 bytes for the character + null terminator
    const strBuf = this.ctx.nextTemp();
    this.ctx.emit(`${strBuf} = call i8* @cs_arena_alloc(i64 2)`);

    // Store the character at position 0
    this.ctx.emit(`store i8 ${charI8}, i8* ${strBuf}`);

    // Store null terminator at position 1
    const nullPos = this.ctx.nextTemp();
    this.ctx.emit(`${nullPos} = getelementptr inbounds i8, i8* ${strBuf}, i64 1`);
    this.ctx.emit(`store i8 0, i8* ${nullPos}`);

    this.ctx.setVariableType(strBuf, "i8*");

    return strBuf;
  }

  private generateJSONArrayIndex(expr: IndexAccessNode, params: string[]): string {
    this.ctx.setUsesJson(true);
    const varName = (expr.object as VariableNode).name;
    const jsonPtrPtr = this.ctx.getVariableAlloca(varName)!;
    const jsonPtr = this.ctx.nextTemp();
    this.ctx.emit(`${jsonPtr} = load i8*, i8** ${jsonPtrPtr}`);

    // Generate index and convert to i32
    const indexDouble = this.ctx.generateExpression(expr.index, params);
    const indexType = this.ctx.getVariableType(indexDouble);
    let index = indexDouble;
    if (indexType === "i64") {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = trunc i64 ${indexDouble} to i32`);
    } else if (indexType === "double" || indexType === undefined) {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
    }

    const itemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${itemPtr} = call i8* @csyyjson_arr_get(i8* ${jsonPtr}, i32 ${index})`);

    const isNull = this.ctx.nextTemp();
    this.ctx.emit(`${isNull} = icmp eq i8* ${itemPtr}, null`);
    const nullLabel = this.ctx.nextLabel("json_arr_null");
    const validLabel = this.ctx.nextLabel("json_arr_valid");
    const objEndLabel = this.ctx.nextLabel("json_arr_obj_end");
    this.ctx.emit(`br i1 ${isNull}, label %${nullLabel}, label %${validLabel}`);

    this.ctx.emit(`${nullLabel}:`);
    this.ctx.emit(`br label %${objEndLabel}`);

    this.ctx.emit(`${validLabel}:`);
    const isObject = this.ctx.nextTemp();
    this.ctx.emit(`${isObject} = call i32 @csyyjson_is_obj(i8* ${itemPtr})`);
    const isObjBool = this.ctx.nextTemp();
    this.ctx.emit(`${isObjBool} = icmp ne i32 ${isObject}, 0`);

    const objectLabel = this.ctx.nextLabel("json_arr_object");
    const primitiveLabel = this.ctx.nextLabel("json_arr_primitive");

    this.ctx.emit(`br i1 ${isObjBool}, label %${objectLabel}, label %${primitiveLabel}`);

    // Object case - return item pointer as-is
    this.ctx.emit(`${objectLabel}:`);
    this.ctx.emit(`br label %${objEndLabel}`);

    // Primitive case - check if number or string
    this.ctx.emit(`${primitiveLabel}:`);
    const isNumber = this.ctx.nextTemp();
    this.ctx.emit(`${isNumber} = call i32 @csyyjson_is_num(i8* ${itemPtr})`);
    const isNumBool = this.ctx.nextTemp();
    this.ctx.emit(`${isNumBool} = icmp ne i32 ${isNumber}, 0`);

    const numberLabel = this.ctx.nextLabel("json_arr_number");
    const stringLabel = this.ctx.nextLabel("json_arr_string");
    const primEndLabel = this.ctx.nextLabel("json_arr_prim_end");

    this.ctx.emit(`br i1 ${isNumBool}, label %${numberLabel}, label %${stringLabel}`);

    // Number case
    this.ctx.emit(`${numberLabel}:`);
    const numValue = this.ctx.nextTemp();
    this.ctx.emit(`${numValue} = call double @csyyjson_get_num(i8* ${itemPtr})`);
    const numAsPtr = this.ctx.nextTemp();
    this.ctx.emit(`${numAsPtr} = fptosi double ${numValue} to i64`);
    const numPtr = this.ctx.nextTemp();
    this.ctx.emit(`${numPtr} = inttoptr i64 ${numAsPtr} to i8*`);
    this.ctx.emit(`br label %${primEndLabel}`);

    // String case
    this.ctx.emit(`${stringLabel}:`);
    const strValue = this.ctx.nextTemp();
    this.ctx.emit(`${strValue} = call i8* @csyyjson_get_str(i8* ${itemPtr})`);
    this.ctx.emit(`br label %${primEndLabel}`);

    // Merge primitives
    this.ctx.emit(`${primEndLabel}:`);
    const primResult = this.ctx.nextTemp();
    this.ctx.emit(
      `${primResult} = phi i8* [ ${numPtr}, %${numberLabel} ], [ ${strValue}, %${stringLabel} ]`,
    );
    this.ctx.emit(`br label %${objEndLabel}`);

    this.ctx.emit(`${objEndLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = phi i8* [ null, %${nullLabel} ], [ ${itemPtr}, %${objectLabel} ], [ ${primResult}, %${primEndLabel} ]`,
    );
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  private generateJSONMemberArrayIndex(expr: IndexAccessNode, params: string[]): string {
    const jsonPtr = this.ctx.generateExpression(expr.object, params);

    const ptrType = this.ctx.getVariableType(jsonPtr);
    if (
      ptrType === "%ObjectArray*" ||
      (ptrType === "i8*" && this.isNonJSONObjectMemberAccess(expr.object))
    ) {
      const arrayPtr = ptrType === "i8*" ? this.ctx.nextTemp() : jsonPtr;
      if (ptrType === "i8*") {
        this.ctx.emit(`${arrayPtr} = bitcast i8* ${jsonPtr} to %ObjectArray*`);
      }
      const indexDouble = this.ctx.generateExpression(expr.index, params);
      const idxType = this.ctx.getVariableType(indexDouble);
      let index = indexDouble;
      if (idxType === "i64") {
        index = this.ctx.nextTemp();
        this.ctx.emit(`${index} = trunc i64 ${indexDouble} to i32`);
      } else if (idxType === "double") {
        index = this.ctx.nextTemp();
        this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
      }
      const dataPtr = this.ctx.nextTemp();
      this.ctx.emit(
        `${dataPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
      );
      const data = this.ctx.nextTemp();
      this.ctx.emit(`${data} = load i8*, i8** ${dataPtr}`);
      const dataAsPtrs = this.ctx.nextTemp();
      this.ctx.emit(`${dataAsPtrs} = bitcast i8* ${data} to i8**`);
      const elemPtr = this.ctx.nextTemp();
      this.ctx.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataAsPtrs}, i32 ${index}`);
      const elem = this.ctx.nextTemp();
      this.ctx.emit(`${elem} = load i8*, i8** ${elemPtr}`);
      this.ctx.setVariableType(elem, "i8*");
      return elem;
    }

    const indexDouble = this.ctx.generateExpression(expr.index, params);
    const indexType = this.ctx.getVariableType(indexDouble);
    let index = indexDouble;
    if (indexType === "i64") {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = trunc i64 ${indexDouble} to i32`);
    } else if (indexType === "double" || indexType === undefined) {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
    }

    const itemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${itemPtr} = call i8* @csyyjson_arr_get(i8* ${jsonPtr}, i32 ${index})`);

    const isNull = this.ctx.nextTemp();
    this.ctx.emit(`${isNull} = icmp eq i8* ${itemPtr}, null`);
    const nullLabel = this.ctx.nextLabel("json_marr_null");
    const validLabel = this.ctx.nextLabel("json_marr_valid");
    const objEndLabel = this.ctx.nextLabel("json_marr_obj_end");
    this.ctx.emit(`br i1 ${isNull}, label %${nullLabel}, label %${validLabel}`);

    this.ctx.emit(`${nullLabel}:`);
    this.ctx.emit(`br label %${objEndLabel}`);

    this.ctx.emit(`${validLabel}:`);
    const isObject = this.ctx.nextTemp();
    this.ctx.emit(`${isObject} = call i32 @csyyjson_is_obj(i8* ${itemPtr})`);
    const isObjBool = this.ctx.nextTemp();
    this.ctx.emit(`${isObjBool} = icmp ne i32 ${isObject}, 0`);

    const objectLabel = this.ctx.nextLabel("json_marr_object");
    const primitiveLabel = this.ctx.nextLabel("json_marr_primitive");

    this.ctx.emit(`br i1 ${isObjBool}, label %${objectLabel}, label %${primitiveLabel}`);

    this.ctx.emit(`${objectLabel}:`);
    this.ctx.emit(`br label %${objEndLabel}`);

    this.ctx.emit(`${primitiveLabel}:`);
    const isNumber = this.ctx.nextTemp();
    this.ctx.emit(`${isNumber} = call i32 @csyyjson_is_num(i8* ${itemPtr})`);
    const isNumBool = this.ctx.nextTemp();
    this.ctx.emit(`${isNumBool} = icmp ne i32 ${isNumber}, 0`);

    const numberLabel = this.ctx.nextLabel("json_marr_number");
    const stringLabel = this.ctx.nextLabel("json_marr_string");
    const primEndLabel = this.ctx.nextLabel("json_marr_prim_end");

    this.ctx.emit(`br i1 ${isNumBool}, label %${numberLabel}, label %${stringLabel}`);

    this.ctx.emit(`${numberLabel}:`);
    const numValue = this.ctx.nextTemp();
    this.ctx.emit(`${numValue} = call double @csyyjson_get_num(i8* ${itemPtr})`);
    const numAsPtr = this.ctx.nextTemp();
    this.ctx.emit(`${numAsPtr} = fptosi double ${numValue} to i64`);
    const numPtr = this.ctx.nextTemp();
    this.ctx.emit(`${numPtr} = inttoptr i64 ${numAsPtr} to i8*`);
    this.ctx.emit(`br label %${primEndLabel}`);

    this.ctx.emit(`${stringLabel}:`);
    const strValue = this.ctx.nextTemp();
    this.ctx.emit(`${strValue} = call i8* @csyyjson_get_str(i8* ${itemPtr})`);
    this.ctx.emit(`br label %${primEndLabel}`);

    this.ctx.emit(`${primEndLabel}:`);
    const primResult = this.ctx.nextTemp();
    this.ctx.emit(
      `${primResult} = phi i8* [ ${numPtr}, %${numberLabel} ], [ ${strValue}, %${stringLabel} ]`,
    );
    this.ctx.emit(`br label %${objEndLabel}`);

    this.ctx.emit(`${objEndLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = phi i8* [ null, %${nullLabel} ], [ ${itemPtr}, %${objectLabel} ], [ ${primResult}, %${primEndLabel} ]`,
    );
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  private isNonJSONObjectMemberAccess(objExpr: Expression): boolean {
    const base = objExpr as ExprBase;
    if (base.type !== "member_access") return false;
    const memberExpr = objExpr as MemberAccessNode;
    const memberObjBase = memberExpr.object as ExprBase;
    if (memberObjBase.type !== "variable") return false;
    const varName = (memberExpr.object as VariableNode).name;
    if (this.ctx.symbolTable.isJSON(varName)) return false;
    return this.ctx.symbolTable.isObject(varName);
  }

  generateAssignment(expr: IndexAccessAssignmentNode, params: string[]): string {
    const value = this.ctx.generateExpression(expr.value, params);
    const isStringArray = this.ctx.isStringArrayExpression(expr.object);
    const isObjectArray = !isStringArray && this.ctx.isObjectArrayExpression(expr.object);
    const isUint8Array =
      !isStringArray && !isObjectArray && this.ctx.isUint8ArrayExpression(expr.object);
    const isNumericArray =
      !isStringArray && !isObjectArray && !isUint8Array && this.ctx.isArrayExpression(expr.object);

    if (isStringArray) {
      return this.generateStringArrayAssignment(expr, value, params);
    } else if (isObjectArray) {
      return this.generateObjectArrayAssignment(expr, value, params);
    } else if (isUint8Array) {
      return this.generateUint8ArrayAssignment(expr, value, params);
    } else if (isNumericArray) {
      return this.generateNumericArrayAssignment(expr, value, params);
    }

    // Check if it's an object variable with dynamic property write (obj[key] = value)
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === "variable") {
      const varName = (expr.object as VariableNode).name;
      if (this.ctx.symbolTable.isObject(varName)) {
        const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
        if (objMeta && objMeta.keys.length > 0) {
          return this.generateDynamicObjectAssignment(expr, value, params, objMeta);
        }
      }
    }

    return this.ctx.emitError(
      "Index access assignment only supported for arrays and objects",
      expr.loc,
    );
  }

  private generateStringArrayAssignment(
    expr: IndexAccessAssignmentNode,
    value: string,
    params: string[],
  ): string {
    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    const indexDouble = this.ctx.generateExpression(expr.index, params);
    const index = this.toI32Index(indexDouble);

    this.emitBoundsCheck(arrayPtr, "%StringArray", index);

    const dataFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataFieldPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
    );
    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = load i8**, i8*** ${dataFieldPtr}`);

    const indexI64 = this.ctx.nextTemp();
    this.ctx.emit(`${indexI64} = sext i32 ${index} to i64`);

    const elementPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elementPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i64 ${indexI64}`);

    this.ctx.emit(`store i8* ${value}, i8** ${elementPtr}`);

    return value;
  }

  private generateObjectArrayAssignment(
    expr: IndexAccessAssignmentNode,
    value: string,
    params: string[],
  ): string {
    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    const indexDouble = this.ctx.generateExpression(expr.index, params);
    const index = this.toI32Index(indexDouble);

    this.emitBoundsCheck(arrayPtr, "%ObjectArray", index);

    const dataFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataFieldPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
    );
    const data = this.ctx.nextTemp();
    this.ctx.emit(`${data} = load i8*, i8** ${dataFieldPtr}`);
    const dataAsPtrs = this.ctx.nextTemp();
    this.ctx.emit(`${dataAsPtrs} = bitcast i8* ${data} to i8**`);

    const indexI64 = this.ctx.nextTemp();
    this.ctx.emit(`${indexI64} = sext i32 ${index} to i64`);

    const elementPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${elementPtr} = getelementptr inbounds i8*, i8** ${dataAsPtrs}, i64 ${indexI64}`,
    );

    this.ctx.emit(`store i8* ${value}, i8** ${elementPtr}`);

    return value;
  }

  private generateNumericArrayAssignment(
    expr: IndexAccessAssignmentNode,
    value: string,
    params: string[],
  ): string {
    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    const indexDouble = this.ctx.generateExpression(expr.index, params);
    const index = this.toI32Index(indexDouble);

    this.emitBoundsCheck(arrayPtr, "%Array", index);

    const dataFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`,
    );
    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = load double*, double** ${dataFieldPtr}`);

    const indexI64 = this.ctx.nextTemp();
    this.ctx.emit(`${indexI64} = sext i32 ${index} to i64`);

    const elementPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${elementPtr} = getelementptr inbounds double, double* ${dataPtr}, i64 ${indexI64}`,
    );

    const dblValue = this.ctx.ensureDouble(value);
    this.ctx.emit(`store double ${dblValue}, double* ${elementPtr}`);

    return value;
  }

  private generateDynamicObjectAccess(
    expr: IndexAccessNode,
    params: string[],
    objMeta: ObjectMetaBasic,
  ): string {
    const varName = (expr.object as VariableNode).name;

    const keyValue = this.ctx.generateExpression(expr.index, params);
    const keyType = this.ctx.getVariableType(keyValue);
    if (keyType !== "i8*" && !this.ctx.isStringExpression(expr.index)) {
      return this.ctx.emitError(
        `Dynamic object property access requires a string key, got: ${keyType}`,
        expr.loc,
      );
    }

    const objAlloca = this.ctx.getVariableAlloca(varName);
    if (!objAlloca) {
      return this.ctx.emitError(`Cannot find alloca for object '${varName}'`, expr.loc);
    }
    const objPtr = this.ctx.nextTemp();
    this.ctx.emit(`${objPtr} = load i8*, i8** ${objAlloca}`);

    const structType = this.buildStructType(objMeta.types);

    const resultAlloca = this.ctx.nextTemp();
    this.ctx.emit(`${resultAlloca} = alloca i8*`);
    this.ctx.emit(`store i8* null, i8** ${resultAlloca}`);

    const endLabel = this.ctx.nextLabel("obj_access_end");

    for (let i = 0; i < objMeta.keys.length; i++) {
      const key = objMeta.keys[i]!;
      const fieldType = objMeta.types[i]!;
      const keyStr = this.ctx.stringGen.doCreateStringConstant(key);
      const cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = call i32 @strcmp(i8* ${keyValue}, i8* ${keyStr})`);
      const isMatch = this.ctx.nextTemp();
      this.ctx.emit(`${isMatch} = icmp eq i32 ${cmpResult}, 0`);

      const matchLabel = this.ctx.nextLabel("obj_key_match");
      const nextLabel = this.ctx.nextLabel("obj_key_next");
      this.ctx.emit(`br i1 ${isMatch}, label %${matchLabel}, label %${nextLabel}`);

      this.ctx.emit(`${matchLabel}:`);
      const typedPtr = this.ctx.nextTemp();
      this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);
      const fieldPtr = this.ctx.nextTemp();
      this.ctx.emit(
        `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${i}`,
      );

      let fieldValue: string;
      if (fieldType === "i8*") {
        fieldValue = this.ctx.nextTemp();
        this.ctx.emit(`${fieldValue} = load i8*, i8** ${fieldPtr}`);
      } else if (fieldType === "double") {
        const doubleVal = this.ctx.nextTemp();
        this.ctx.emit(`${doubleVal} = load double, double* ${fieldPtr}`);
        fieldValue = this.ctx.nextTemp();
        this.ctx.emit(`${fieldValue} = call i8* @__double_to_string(double ${doubleVal})`);
        this.ctx.setVariableType(fieldValue, "i8*");
      } else {
        fieldValue = this.ctx.nextTemp();
        this.ctx.emit(`${fieldValue} = load i8*, i8** ${fieldPtr}`);
      }

      this.ctx.emit(`store i8* ${fieldValue}, i8** ${resultAlloca}`);
      this.ctx.emit(`br label %${endLabel}`);

      this.ctx.emit(`${nextLabel}:`);
    }

    this.ctx.emit(`br label %${endLabel}`);
    this.ctx.emit(`${endLabel}:`);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = load i8*, i8** ${resultAlloca}`);
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  /**
   * Dynamic object property write: obj[key] = value
   * Mirrors generateDynamicObjectAccess but does stores instead of loads.
   * Uses a strcmp chain over known keys to find the matching field, then GEP + store.
   */
  /**
   * Determine whether the generated value is a double or a string (i8*).
   */
  private isValueDouble(value: string, expr: Expression): boolean {
    const vType = this.ctx.getVariableType(value);
    if (vType === "double" || vType === "i64") return true;
    if (vType === "i8*") return false;
    // Fallback: check the expression itself
    const exprBase = expr as ExprBase;
    if (exprBase.type === "number") return true;
    if (exprBase.type === "string") return false;
    return false;
  }

  private generateDynamicObjectAssignment(
    expr: IndexAccessAssignmentNode,
    value: string,
    params: string[],
    objMeta: ObjectMetaBasic,
  ): string {
    const varName = (expr.object as VariableNode).name;

    const keyValue = this.ctx.generateExpression(expr.index, params);
    const keyType = this.ctx.getVariableType(keyValue);
    if (keyType !== "i8*" && !this.ctx.isStringExpression(expr.index)) {
      return this.ctx.emitError(
        `Dynamic object property write requires a string key, got: ${keyType}`,
        expr.loc,
      );
    }

    const objAlloca = this.ctx.getVariableAlloca(varName);
    if (!objAlloca) {
      return this.ctx.emitError(`Cannot find alloca for object '${varName}'`, expr.loc);
    }
    const objPtr = this.ctx.nextTemp();
    this.ctx.emit(`${objPtr} = load i8*, i8** ${objAlloca}`);

    const structType = this.buildStructType(objMeta.types);
    const endLabel = this.ctx.nextLabel("obj_write_end");
    const valueIsDouble = this.isValueDouble(value, expr.value);

    for (let i = 0; i < objMeta.keys.length; i++) {
      const key = objMeta.keys[i]!;
      const fieldType = objMeta.types[i]!;

      // Skip fields where value type doesn't match field type.
      // At runtime only the matching key executes, but LLVM requires
      // valid IR in all branches.
      const fieldIsDouble = fieldType === "double";
      if (fieldIsDouble !== valueIsDouble) continue;

      const keyStr = this.ctx.stringGen.doCreateStringConstant(key);
      const cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = call i32 @strcmp(i8* ${keyValue}, i8* ${keyStr})`);
      const isMatch = this.ctx.nextTemp();
      this.ctx.emit(`${isMatch} = icmp eq i32 ${cmpResult}, 0`);

      const matchLabel = this.ctx.nextLabel("obj_key_wmatch");
      const nextLabel = this.ctx.nextLabel("obj_key_wnext");
      this.ctx.emit(`br i1 ${isMatch}, label %${matchLabel}, label %${nextLabel}`);

      this.ctx.emit(`${matchLabel}:`);
      const typedPtr = this.ctx.nextTemp();
      this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);
      const fieldPtr = this.ctx.nextTemp();
      this.ctx.emit(
        `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${i}`,
      );

      if (fieldIsDouble) {
        const doubleVal = this.ctx.ensureDouble(value);
        this.ctx.emit(`store double ${doubleVal}, double* ${fieldPtr}`);
      } else {
        this.ctx.emit(`store i8* ${value}, i8** ${fieldPtr}`);
      }

      this.ctx.emit(`br label %${endLabel}`);
      this.ctx.emit(`${nextLabel}:`);
    }

    this.ctx.emit(`br label %${endLabel}`);
    this.ctx.emit(`${endLabel}:`);

    return value;
  }

  private buildStructType(types: string[]): string {
    return "{ " + types.join(", ") + " }";
  }
}
