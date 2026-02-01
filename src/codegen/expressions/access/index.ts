import { Expression, IndexAccessNode, MemberAccessNode, VariableNode } from '../../../ast/types.js';
import type { SymbolTable } from '../../infrastructure/symbol-table.js';

export interface IndexAccessGeneratorContext {
  nextTemp(): string;
  nextLabel(prefix: string): string;
  emit(instruction: string): void;
  variableTypes: Map<string, string>;
  symbolTable: SymbolTable;
  isStringArrayExpression(expr: Expression): boolean;
  isArrayExpression(expr: Expression): boolean;
  getVariableAlloca(name: string): string | undefined;
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
   * @param generateExpressionFn - Callback to generate sub-expressions
   */
  generate(expr: IndexAccessNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    // Check if it's process.argv[i]
    if (expr.object.type === 'member_access') {
      const memberAccess = expr.object as MemberAccessNode;
      if (memberAccess.object.type === 'variable' &&
          (memberAccess.object as VariableNode).name === 'process' &&
          memberAccess.property === 'argv') {
        return this.generateProcessArgvIndex(expr, params, generateExpressionFn);
      }
    }

    // Check if it's a JSON array (from JSON.parse<number[]> or similar)
    if (expr.object.type === 'variable' && this.ctx.symbolTable.isJSON((expr.object as VariableNode).name)) {
      return this.generateJSONArrayIndex(expr, params, generateExpressionFn);
    }

    // Determine if we're indexing into a string array or numeric array
    // We use isStringArrayExpression/isArrayExpression which check types comprehensively
    const isStringArray = this.ctx.isStringArrayExpression(expr.object);
    const isNumericArray = !isStringArray && this.ctx.isArrayExpression(expr.object);

    if (isStringArray) {
      return this.generateStringArrayIndex(expr, params, generateExpressionFn);
    } else if (isNumericArray) {
      return this.generateNumericArrayIndex(expr, params, generateExpressionFn);
    } else {
      // Handle string[index] - returns character code as i32, then convert to double
      return this.generateStringCharIndex(expr, params, generateExpressionFn);
    }
  }

  private generateProcessArgvIndex(expr: IndexAccessNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    // Index into argv: process.argv[i]
    const argvStruct = generateExpressionFn(expr.object, params);
    const indexDouble = generateExpressionFn(expr.index, params);

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
    this.ctx.variableTypes.set(arg, 'i8*');

    return arg;
  }

  private generateStringArrayIndex(expr: IndexAccessNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    const stringArrayPtr = generateExpressionFn(expr.object, params);
    const indexDouble = generateExpressionFn(expr.index, params);

    // Convert double index to i32 for getelementptr
    const indexType = this.ctx.variableTypes.get(indexDouble);
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
    this.ctx.variableTypes.set(elem, 'i8*');
    return elem;
  }

  private generateNumericArrayIndex(expr: IndexAccessNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    const arrayPtr = generateExpressionFn(expr.object, params);
    const indexDouble = generateExpressionFn(expr.index, params);

    // Convert double index to i32 for getelementptr
    const indexType = this.ctx.variableTypes.get(indexDouble);
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
    this.ctx.variableTypes.set(elem, 'double');
    return elem;
  }

  private generateStringCharIndex(expr: IndexAccessNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    const objPtr = generateExpressionFn(expr.object, params);
    const indexDouble = generateExpressionFn(expr.index, params);

    // Convert double index to i32 (assume double if not explicitly i32)
    const indexType = this.ctx.variableTypes.get(indexDouble);
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

    const charI32 = this.ctx.nextTemp();
    this.ctx.emit(`${charI32} = zext i8 ${charI8} to i32`);

    // Convert char code to double for compatibility with numeric system
    const charDouble = this.ctx.nextTemp();
    this.ctx.emit(`${charDouble} = sitofp i32 ${charI32} to double`);
    this.ctx.variableTypes.set(charDouble, 'double');

    return charDouble;
  }

  private generateJSONArrayIndex(expr: IndexAccessNode, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    // Load JSON array pointer
    const varName = (expr.object as VariableNode).name;
    const jsonPtrPtr = this.ctx.getVariableAlloca(varName)!;
    const jsonPtr = this.ctx.nextTemp();
    this.ctx.emit(`${jsonPtr} = load i8*, i8** ${jsonPtrPtr}`);

    // Generate index and convert to i32
    const indexDouble = generateExpressionFn(expr.index, params);
    const indexType = this.ctx.variableTypes.get(indexDouble);
    let index = indexDouble;
    if (indexType === 'double' || indexType === undefined) {
      index = this.ctx.nextTemp();
      this.ctx.emit(`${index} = fptosi double ${indexDouble} to i32`);
    }

    // Get array item using cJSON_GetArrayItem
    const itemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${itemPtr} = call i8* @cJSON_GetArrayItem(i8* ${jsonPtr}, i32 ${index})`);

    // Check if item is a number or string and extract value
    const isNumber = this.ctx.nextTemp();
    this.ctx.emit(`${isNumber} = call i32 @cJSON_IsNumber(i8* ${itemPtr})`);
    const isNumBool = this.ctx.nextTemp();
    this.ctx.emit(`${isNumBool} = icmp ne i32 ${isNumber}, 0`);

    const numberLabel = this.ctx.nextLabel('json_arr_number');
    const stringLabel = this.ctx.nextLabel('json_arr_string');
    const endLabel = this.ctx.nextLabel('json_arr_end');

    this.ctx.emit(`br i1 ${isNumBool}, label %${numberLabel}, label %${stringLabel}`);

    // Number case
    this.ctx.emit(`${numberLabel}:`);
    const numValue = this.ctx.nextTemp();
    this.ctx.emit(`${numValue} = call double @cJSON_GetNumberValue(i8* ${itemPtr})`);
    this.ctx.emit(`br label %${endLabel}`);

    // String case
    this.ctx.emit(`${stringLabel}:`);
    const strValue = this.ctx.nextTemp();
    this.ctx.emit(`${strValue} = call i8* @cJSON_GetStringValue(i8* ${itemPtr})`);
    const strAsDouble = this.ctx.nextTemp();
    this.ctx.emit(`${strAsDouble} = ptrtoint i8* ${strValue} to i64`);
    const strDouble = this.ctx.nextTemp();
    this.ctx.emit(`${strDouble} = sitofp i64 ${strAsDouble} to double`);
    this.ctx.emit(`br label %${endLabel}`);

    // Merge
    this.ctx.emit(`${endLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi double [ ${numValue}, %${numberLabel} ], [ ${strDouble}, %${stringLabel} ]`);
    this.ctx.variableTypes.set(result, 'double');

    return result;
  }
}
