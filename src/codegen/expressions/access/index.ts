import { Expression, IndexAccessNode, IndexAccessAssignmentNode, MemberAccessNode, VariableNode } from '../../../ast/types.js';

interface ExprBase { type: string; }
import type { SymbolTable } from '../../infrastructure/symbol-table.js';

export interface IndexAccessGeneratorContext {
  nextTemp(): string;
  nextLabel(prefix: string): string;
  emit(instruction: string): void;
  variableTypes: Map<string, string>;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  symbolTable: SymbolTable;
  isStringArrayExpression(expr: Expression): boolean;
  isArrayExpression(expr: Expression): boolean;
  isObjectArrayExpression(expr: Expression): boolean;
  getVariableAlloca(name: string): string | undefined;
  generateExpression(expr: Expression, params: string[]): string;
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
    // Check if it's process.argv[i]
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === 'member_access') {
      const memberAccess = expr.object as MemberAccessNode;
      const memberAccessObjBase = memberAccess.object as ExprBase;
      if (memberAccessObjBase.type === 'variable' &&
          (memberAccess.object as VariableNode).name === 'process' &&
          memberAccess.property === 'argv') {
        return this.generateProcessArgvIndex(expr, params);
      }
    }

    // Check if it's a JSON array (from JSON.parse<number[]> or similar)
    if (exprObjBase.type === 'variable' && this.ctx.symbolTable.isJSON((expr.object as VariableNode).name)) {
      return this.generateJSONArrayIndex(expr, params);
    }

    // Determine if we're indexing into a string array, numeric array, or object array
    const isStringArray = this.ctx.isStringArrayExpression(expr.object);
    const isObjectArray = !isStringArray && this.ctx.isObjectArrayExpression(expr.object);
    const isNumericArray = !isStringArray && !isObjectArray && this.ctx.isArrayExpression(expr.object);

    if (isStringArray) {
      return this.generateStringArrayIndex(expr, params);
    } else if (isObjectArray) {
      return this.generateObjectArrayIndex(expr, params);
    } else if (isNumericArray) {
      return this.generateNumericArrayIndex(expr, params);
    } else {
      // Handle string[index] - returns character code as i32, then convert to double
      return this.generateStringCharIndex(expr, params);
    }
  }

  private generateProcessArgvIndex(expr: IndexAccessNode, params: string[]): string {
    // Index into argv: process.argv[i]
    const argvStruct = this.ctx.generateExpression(expr.object, params);
    const indexDouble = this.ctx.generateExpression(expr.index, params);

    // Convert double index to i32
    const index = this.ctx.nextTemp();
    this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);

    // Extract data pointer from StringArray struct (field 0)
    const dataField = this.ctx.nextTemp();
    this.ctx.emit(`${dataField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 0`);
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
    this.ctx.setVariableType(arg, 'i8*');

    return arg;
  }

  private generateStringArrayIndex(expr: IndexAccessNode, params: string[]): string {
    const stringArrayPtr = this.ctx.generateExpression(expr.object, params);
    const indexDouble = this.ctx.generateExpression(expr.index, params);

    // Convert double index to i32 for getelementptr
    const indexType = this.ctx.getVariableType(indexDouble);
    let index = indexDouble;
    if (indexType === 'double') {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
    }

    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = getelementptr inbounds %StringArray, %StringArray* ${stringArrayPtr}, i32 0, i32 0`);

    const data = this.ctx.nextTemp();
    this.ctx.emit(`${data} = load i8**, i8*** ${dataPtr}`);

    const elemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${data}, i32 ${index}`);

    const elem = this.ctx.nextTemp();
    this.ctx.emit(`${elem} = load i8*, i8** ${elemPtr}`);
    // Track that this loaded value is a string
    this.ctx.setVariableType(elem, 'i8*');
    return elem;
  }

  private generateNumericArrayIndex(expr: IndexAccessNode, params: string[]): string {
    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const indexDouble = this.ctx.generateExpression(expr.index, params);

    // Convert double index to i32 for getelementptr
    const indexType = this.ctx.getVariableType(indexDouble);
    let index = indexDouble;
    if (indexType === 'double') {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
    }

    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);

    const data = this.ctx.nextTemp();
    this.ctx.emit(`${data} = load double*, double** ${dataPtr}`);

    const elemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elemPtr} = getelementptr inbounds double, double* ${data}, i32 ${index}`);

    // Load double element
    const elem = this.ctx.nextTemp();
    this.ctx.emit(`${elem} = load double, double* ${elemPtr}`);
    this.ctx.setVariableType(elem, 'double');
    return elem;
  }

  private generateObjectArrayIndex(expr: IndexAccessNode, params: string[]): string {
    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const indexDouble = this.ctx.generateExpression(expr.index, params);

    const indexType = this.ctx.getVariableType(indexDouble);
    let index = indexDouble;
    if (indexType === 'double') {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
    }

    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);

    const dataDouble = this.ctx.nextTemp();
    this.ctx.emit(`${dataDouble} = load double*, double** ${dataPtr}`);

    const data = this.ctx.nextTemp();
    this.ctx.emit(`${data} = bitcast double* ${dataDouble} to i8**`);

    const elemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${data}, i32 ${index}`);

    const elem = this.ctx.nextTemp();
    this.ctx.emit(`${elem} = load i8*, i8** ${elemPtr}`);
    this.ctx.setVariableType(elem, 'i8*');
    return elem;
  }

  private generateStringCharIndex(expr: IndexAccessNode, params: string[]): string {
    const objPtr = this.ctx.generateExpression(expr.object, params);
    const indexDouble = this.ctx.generateExpression(expr.index, params);

    // Convert double index to i32 (assume double if not explicitly i32)
    const indexType = this.ctx.getVariableType(indexDouble);
    let index = indexDouble;
    if (indexType !== 'i32') {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
    }

    const indexI64 = this.ctx.nextTemp();
    this.ctx.emit(`${indexI64} = sext i32 ${index} to i64`);

    const charPtr = this.ctx.nextTemp();
    this.ctx.emit(`${charPtr} = getelementptr inbounds i8, i8* ${objPtr}, i64 ${indexI64}`);

    const charI8 = this.ctx.nextTemp();
    this.ctx.emit(`${charI8} = load i8, i8* ${charPtr}`);

    // TypeScript str[i] returns a single-character string, not a number
    // Allocate 2 bytes for the character + null terminator
    const strBuf = this.ctx.nextTemp();
    this.ctx.emit(`${strBuf} = call i8* @GC_malloc_atomic(i64 2)`);

    // Store the character at position 0
    this.ctx.emit(`store i8 ${charI8}, i8* ${strBuf}`);

    // Store null terminator at position 1
    const nullPos = this.ctx.nextTemp();
    this.ctx.emit(`${nullPos} = getelementptr inbounds i8, i8* ${strBuf}, i64 1`);
    this.ctx.emit(`store i8 0, i8* ${nullPos}`);

    this.ctx.setVariableType(strBuf, 'i8*');

    return strBuf;
  }

  private generateJSONArrayIndex(expr: IndexAccessNode, params: string[]): string {
    // Load JSON array pointer
    const varName = (expr.object as VariableNode).name;
    const jsonPtrPtr = this.ctx.getVariableAlloca(varName)!;
    const jsonPtr = this.ctx.nextTemp();
    this.ctx.emit(`${jsonPtr} = load i8*, i8** ${jsonPtrPtr}`);

    // Generate index and convert to i32
    const indexDouble = this.ctx.generateExpression(expr.index, params);
    const indexType = this.ctx.getVariableType(indexDouble);
    let index = indexDouble;
    if (indexType === 'double' || indexType === undefined) {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
    }

    // Get array item using cJSON_GetArrayItem
    const itemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${itemPtr} = call i8* @cJSON_GetArrayItem(i8* ${jsonPtr}, i32 ${index})`);

    // Check if item is an object - if so, return the item pointer directly
    const isObject = this.ctx.nextTemp();
    this.ctx.emit(`${isObject} = call i32 @cJSON_IsObject(i8* ${itemPtr})`);
    const isObjBool = this.ctx.nextTemp();
    this.ctx.emit(`${isObjBool} = icmp ne i32 ${isObject}, 0`);

    const objectLabel = this.ctx.nextLabel('json_arr_object');
    const primitiveLabel = this.ctx.nextLabel('json_arr_primitive');
    const objEndLabel = this.ctx.nextLabel('json_arr_obj_end');

    this.ctx.emit(`br i1 ${isObjBool}, label %${objectLabel}, label %${primitiveLabel}`);

    // Object case - return item pointer as-is
    this.ctx.emit(`${objectLabel}:`);
    this.ctx.emit(`br label %${objEndLabel}`);

    // Primitive case - check if number or string
    this.ctx.emit(`${primitiveLabel}:`);
    const isNumber = this.ctx.nextTemp();
    this.ctx.emit(`${isNumber} = call i32 @cJSON_IsNumber(i8* ${itemPtr})`);
    const isNumBool = this.ctx.nextTemp();
    this.ctx.emit(`${isNumBool} = icmp ne i32 ${isNumber}, 0`);

    const numberLabel = this.ctx.nextLabel('json_arr_number');
    const stringLabel = this.ctx.nextLabel('json_arr_string');
    const primEndLabel = this.ctx.nextLabel('json_arr_prim_end');

    this.ctx.emit(`br i1 ${isNumBool}, label %${numberLabel}, label %${stringLabel}`);

    // Number case
    this.ctx.emit(`${numberLabel}:`);
    const numValue = this.ctx.nextTemp();
    this.ctx.emit(`${numValue} = call double @cJSON_GetNumberValue(i8* ${itemPtr})`);
    const numAsPtr = this.ctx.nextTemp();
    this.ctx.emit(`${numAsPtr} = fptosi double ${numValue} to i64`);
    const numPtr = this.ctx.nextTemp();
    this.ctx.emit(`${numPtr} = inttoptr i64 ${numAsPtr} to i8*`);
    this.ctx.emit(`br label %${primEndLabel}`);

    // String case
    this.ctx.emit(`${stringLabel}:`);
    const strValue = this.ctx.nextTemp();
    this.ctx.emit(`${strValue} = call i8* @cJSON_GetStringValue(i8* ${itemPtr})`);
    this.ctx.emit(`br label %${primEndLabel}`);

    // Merge primitives
    this.ctx.emit(`${primEndLabel}:`);
    const primResult = this.ctx.nextTemp();
    this.ctx.emit(`${primResult} = phi i8* [ ${numPtr}, %${numberLabel} ], [ ${strValue}, %${stringLabel} ]`);
    this.ctx.emit(`br label %${objEndLabel}`);

    // Final merge
    this.ctx.emit(`${objEndLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi i8* [ ${itemPtr}, %${objectLabel} ], [ ${primResult}, %${primEndLabel} ]`);
    this.ctx.setVariableType(result, 'i8*');

    return result;
  }

  generateAssignment(expr: IndexAccessAssignmentNode, params: string[]): string {
    const value = this.ctx.generateExpression(expr.value, params);
    const isStringArray = this.ctx.isStringArrayExpression(expr.object);
    const isNumericArray = !isStringArray && this.ctx.isArrayExpression(expr.object);

    if (isStringArray) {
      return this.generateStringArrayAssignment(expr, value, params);
    } else if (isNumericArray) {
      return this.generateNumericArrayAssignment(expr, value, params);
    } else {
      throw new Error('Index access assignment only supported for arrays');
    }
  }

  private generateStringArrayAssignment(expr: IndexAccessAssignmentNode, value: string, params: string[]): string {
    const objectExpr = expr.object as VariableNode;
    const varName = objectExpr.name;

    const arrayAllocaReg = this.ctx.symbolTable.getArrayAlloca(varName);
    if (!arrayAllocaReg) {
      throw new Error(`Unknown string array variable: ${varName}`);
    }

    const arrayPtr = this.ctx.nextTemp();
    this.ctx.emit(`${arrayPtr} = load %StringArray*, %StringArray** ${arrayAllocaReg}`);

    const dataFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataFieldPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = load i8**, i8*** ${dataFieldPtr}`);

    const indexDouble = this.ctx.generateExpression(expr.index, params);
    const index = this.ctx.nextTemp();
    this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
    const indexI64 = this.ctx.nextTemp();
    this.ctx.emit(`${indexI64} = sext i32 ${index} to i64`);

    const elementPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elementPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i64 ${indexI64}`);

    this.ctx.emit(`store i8* ${value}, i8** ${elementPtr}`);

    return value;
  }

  private generateNumericArrayAssignment(expr: IndexAccessAssignmentNode, value: string, params: string[]): string {
    const objectExpr = expr.object as VariableNode;
    const varName = objectExpr.name;

    const arrayAllocaReg = this.ctx.symbolTable.getArrayAlloca(varName);
    if (!arrayAllocaReg) {
      throw new Error(`Unknown numeric array variable: ${varName}`);
    }

    const arrayPtr = this.ctx.nextTemp();
    this.ctx.emit(`${arrayPtr} = load %Array*, %Array** ${arrayAllocaReg}`);

    const dataFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataFieldPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = load double*, double** ${dataFieldPtr}`);

    const indexDouble = this.ctx.generateExpression(expr.index, params);
    const index = this.ctx.nextTemp();
    this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
    const indexI64 = this.ctx.nextTemp();
    this.ctx.emit(`${indexI64} = sext i32 ${index} to i64`);

    const elementPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elementPtr} = getelementptr inbounds double, double* ${dataPtr}, i64 ${indexI64}`);

    this.ctx.emit(`store double ${value}, double* ${elementPtr}`);

    return value;
  }
}
