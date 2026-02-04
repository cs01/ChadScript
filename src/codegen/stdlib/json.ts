import { Expression, MethodCallNode } from '../../ast/types.js';

interface ExprBase { type: string; }

import { IGeneratorContext } from '../infrastructure/generator-context.js';

interface InterfaceDefInfo {
  fields: { name: string; type: string }[];
}

export class JsonGenerator {
  private generatedStructs: Set<string> = new Set();
  private generatedParsers: Set<string> = new Set();

  constructor(private ctx: IGeneratorContext) {}

  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    return exprObjBase.type === 'variable' &&
           (expr.object as any).name === 'JSON' &&
           (expr.method === 'parse' || expr.method === 'stringify');
  }

  generateParse(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      throw new Error('JSON.parse() requires 1 argument (JSON string)');
    }

    const typeParam = (expr as any).typeParameter;
    if (!typeParam) {
      throw new Error(
        'JSON.parse() requires a type parameter. Use JSON.parse<InterfaceName>(jsonString).\n' +
        'ChadScript needs static types for JSON to generate efficient native code.\n\n' +
        'Example:\n' +
        '  interface User { name: string; age: number; }\n' +
        '  const user = JSON.parse<User>(\'{"name":"Alice","age":30}\');\n\n' +
        'Without type information, property access cannot be compiled.'
      );
    }

    if (typeParam === 'number[]') {
      return this.generateParseNumberArray(expr, params);
    }

    const interfaceDefResult = this.ctx.getInterfaceFromAST(typeParam);
    if (!interfaceDefResult) {
      throw new Error(`JSON.parse<${typeParam}>: Interface '${typeParam}' not found in AST`);
    }

    const interfaceDef: InterfaceDefInfo = {
      fields: interfaceDefResult.fields.map((f: any) => ({
        name: f.name.replace(/\?$/, ''),
        type: f.type
      }))
    };

    this.generateJsonStruct(typeParam, interfaceDef);
    this.generateJsonParser(typeParam, interfaceDef);

    const jsonStr = this.ctx.generateExpression(expr.args[0], params);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call %${typeParam}* @parse_json_${typeParam}(i8* ${jsonStr})`);
    this.ctx.setVariableType(result, `%${typeParam}*`);

    return result;
  }

  private generateParseNumberArray(expr: MethodCallNode, params: string[]): string {
    const jsonStr = this.ctx.generateExpression(expr.args[0], params);

    const jsonRoot = this.ctx.nextTemp();
    this.ctx.emit(`${jsonRoot} = call i8* @cJSON_Parse(i8* ${jsonStr})`);

    const isNull = this.ctx.nextTemp();
    this.ctx.emit(`${isNull} = icmp eq i8* ${jsonRoot}, null`);

    const successLabel = this.ctx.nextLabel('json_arr_success');
    const errorLabel = this.ctx.nextLabel('json_arr_error');
    const endLabel = this.ctx.nextLabel('json_arr_end');

    this.ctx.emit(`br i1 ${isNull}, label %${errorLabel}, label %${successLabel}`);

    this.ctx.emit(`${errorLabel}:`);
    const nullArray = this.ctx.nextTemp();
    this.ctx.emit(`${nullArray} = inttoptr i64 0 to %Array*`);
    this.ctx.emit(`br label %${endLabel}`);

    this.ctx.emit(`${successLabel}:`);

    const sizeI32 = this.ctx.nextTemp();
    this.ctx.emit(`${sizeI32} = call i32 @cJSON_GetArraySize(i8* ${jsonRoot})`);
    const size = this.ctx.nextTemp();
    this.ctx.emit(`${size} = sitofp i32 ${sizeI32} to double`);

    const arrPtr = this.ctx.nextTemp();
    this.ctx.emit(`${arrPtr} = call i8* @GC_malloc(i64 24)`);
    const arr = this.ctx.nextTemp();
    this.ctx.emit(`${arr} = bitcast i8* ${arrPtr} to %Array*`);

    const lenFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${lenFieldPtr} = getelementptr %Array, %Array* ${arr}, i32 0, i32 0`);
    this.ctx.emit(`store double ${size}, double* ${lenFieldPtr}`);

    const capFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${capFieldPtr} = getelementptr %Array, %Array* ${arr}, i32 0, i32 1`);
    this.ctx.emit(`store double ${size}, double* ${capFieldPtr}`);

    const sizeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${sizeI64} = fptosi double ${size} to i64`);
    const dataSize = this.ctx.nextTemp();
    this.ctx.emit(`${dataSize} = mul i64 ${sizeI64}, 8`);
    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = call i8* @GC_malloc(i64 ${dataSize})`);
    const data = this.ctx.nextTemp();
    this.ctx.emit(`${data} = bitcast i8* ${dataPtr} to double*`);

    const dataFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataFieldPtr} = getelementptr %Array, %Array* ${arr}, i32 0, i32 2`);
    this.ctx.emit(`store double* ${data}, double** ${dataFieldPtr}`);

    const loopInit = this.ctx.nextLabel('json_arr_loop_init');
    const loopCond = this.ctx.nextLabel('json_arr_loop_cond');
    const loopBody = this.ctx.nextLabel('json_arr_loop_body');
    const loopEnd = this.ctx.nextLabel('json_arr_loop_end');

    this.ctx.emit(`br label %${loopInit}`);
    this.ctx.emit(`${loopInit}:`);
    this.ctx.emit(`br label %${loopCond}`);

    this.ctx.emit(`${loopCond}:`);
    const i = this.ctx.nextTemp();
    const phiPlaceholder = `${i}.next`;
    this.ctx.emit(`${i} = phi i32 [ 0, %${loopInit} ], [ ${phiPlaceholder}, %${loopBody} ]`);
    const cond = this.ctx.nextTemp();
    this.ctx.emit(`${cond} = icmp slt i32 ${i}, ${sizeI32}`);
    this.ctx.emit(`br i1 ${cond}, label %${loopBody}, label %${loopEnd}`);

    this.ctx.emit(`${loopBody}:`);
    const item = this.ctx.nextTemp();
    this.ctx.emit(`${item} = call i8* @cJSON_GetArrayItem(i8* ${jsonRoot}, i32 ${i})`);
    const valPtr = this.ctx.nextTemp();
    this.ctx.emit(`${valPtr} = call double @cJSON_GetNumberValue(i8* ${item})`);
    const elemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elemPtr} = getelementptr double, double* ${data}, i32 ${i}`);
    this.ctx.emit(`store double ${valPtr}, double* ${elemPtr}`);
    const iInc = this.ctx.nextTemp();
    this.ctx.emit(`${iInc} = add i32 ${i}, 1`);
    this.ctx.emit(`br label %${loopCond}`);

    const phiIdx = this.ctx.output.findIndex((line: string) => line.includes(phiPlaceholder));
    if (phiIdx !== -1) {
      this.ctx.output[phiIdx] = this.ctx.output[phiIdx].replace(phiPlaceholder, iInc);
    }

    this.ctx.emit(`${loopEnd}:`);
    this.ctx.emit(`br label %${endLabel}`);

    this.ctx.emit(`${endLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi %Array* [ ${nullArray}, %${errorLabel} ], [ ${arr}, %${loopEnd} ]`);
    this.ctx.setVariableType(result, '%Array*');

    return result;
  }

  private hasStructInGlobalStrings(typeName: string): boolean {
    const pattern = `%${typeName} = type`;
    for (let i = 0; i < this.ctx.globalStrings.length; i++) {
      if (this.ctx.globalStrings[i].includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  private generateJsonStruct(typeName: string, interfaceDef: InterfaceDefInfo): void {
    if (this.generatedStructs.has(typeName)) {
      return;
    }
    this.generatedStructs.add(typeName);

    if (this.hasStructInGlobalStrings(typeName)) {
      return;
    }

    if (this.ctx.interfaceStructGen && this.ctx.interfaceStructGen.hasInterface(typeName)) {
      return;
    }

    const fieldTypes: string[] = [];
    for (const field of interfaceDef.fields) {
      if (field.type === 'string') {
        fieldTypes.push('i8*');
      } else if (field.type === 'number') {
        fieldTypes.push('double');
      } else if (field.type === 'boolean') {
        fieldTypes.push('i1');
      } else {
        const nestedInterface = this.ctx.getInterfaceFromAST(field.type);
        if (nestedInterface) {
          fieldTypes.push(`%${field.type}*`);
        } else {
          fieldTypes.push('i8*');
        }
      }
    }

    const structDef = `%${typeName} = type { ${fieldTypes.join(', ')} }\n`;
    const newGlobalStrings: string[] = [structDef];
    for (let i = 0; i < this.ctx.globalStrings.length; i++) {
      newGlobalStrings.push(this.ctx.globalStrings[i]);
    }
    this.ctx.globalStrings.length = 0;
    for (let i = 0; i < newGlobalStrings.length; i++) {
      this.ctx.globalStrings.push(newGlobalStrings[i]);
    }
  }

  private generateJsonParser(typeName: string, interfaceDef: InterfaceDefInfo): void {
    if (this.generatedParsers.has(typeName)) {
      return;
    }
    this.generatedParsers.add(typeName);

    for (const field of interfaceDef.fields) {
      if (field.type !== 'string' && field.type !== 'number' && field.type !== 'boolean') {
        const nestedInterface = this.ctx.getInterfaceFromAST(field.type);
        if (nestedInterface) {
          const nestedDef: InterfaceDefInfo = {
            fields: nestedInterface.fields.map((f: any) => ({
              name: f.name.replace(/\?$/, ''),
              type: f.type
            }))
          };
          this.generateJsonStruct(field.type, nestedDef);
          this.generateJsonParser(field.type, nestedDef);
        }
      }
    }

    const structSize = interfaceDef.fields.length * 8;
    let parserIR = `define %${typeName}* @parse_json_${typeName}(i8* %json_str) {\n`;
    parserIR += 'entry:\n';
    parserIR += `  %struct_bytes = call i8* @GC_malloc(i64 ${structSize})\n`;
    parserIR += `  %struct_ptr = bitcast i8* %struct_bytes to %${typeName}*\n`;
    parserIR += `  %json_root = call i8* @cJSON_Parse(i8* %json_str)\n`;
    parserIR += `  %json_is_null = icmp eq i8* %json_root, null\n`;
    parserIR += `  br i1 %json_is_null, label %json_error, label %json_ok\n\n`;

    parserIR += `json_error:\n`;
    parserIR += `  ret %${typeName}* null\n\n`;

    parserIR += `json_ok:\n`;
    for (let fieldIndex = 0; fieldIndex < interfaceDef.fields.length; fieldIndex++) {
      const field = interfaceDef.fields[fieldIndex];
      const fieldName = field.name;
      const fieldType = field.type;
      const fieldNameConst = this.ctx.nextString();
      this.ctx.globalStrings.push(`${fieldNameConst} = private unnamed_addr constant [${fieldName.length + 1} x i8] c"${fieldName}\\00", align 1`);

      parserIR += `  %item_${fieldIndex} = call i8* @cJSON_GetObjectItemCaseSensitive(i8* %json_root, i8* getelementptr inbounds ([${fieldName.length + 1} x i8], [${fieldName.length + 1} x i8]* ${fieldNameConst}, i64 0, i64 0))\n`;

      if (fieldType === 'string') {
        parserIR += `  %temp_str_${fieldIndex} = call i8* @cJSON_GetStringValue(i8* %item_${fieldIndex})\n`;
        parserIR += `  %value_${fieldIndex} = call i8* @strdup(i8* %temp_str_${fieldIndex})\n`;
        parserIR += `  %field_ptr_${fieldIndex} = getelementptr inbounds %${typeName}, %${typeName}* %struct_ptr, i32 0, i32 ${fieldIndex}\n`;
        parserIR += `  store i8* %value_${fieldIndex}, i8** %field_ptr_${fieldIndex}\n\n`;
      } else if (fieldType === 'number') {
        parserIR += `  %value_${fieldIndex} = call double @cJSON_GetNumberValue(i8* %item_${fieldIndex})\n`;
        parserIR += `  %field_ptr_${fieldIndex} = getelementptr inbounds %${typeName}, %${typeName}* %struct_ptr, i32 0, i32 ${fieldIndex}\n`;
        parserIR += `  store double %value_${fieldIndex}, double* %field_ptr_${fieldIndex}\n\n`;
      } else if (fieldType === 'boolean') {
        parserIR += `  %num_${fieldIndex} = call double @cJSON_GetNumberValue(i8* %item_${fieldIndex})\n`;
        parserIR += `  %value_${fieldIndex} = fcmp one double %num_${fieldIndex}, 0.0\n`;
        parserIR += `  %field_ptr_${fieldIndex} = getelementptr inbounds %${typeName}, %${typeName}* %struct_ptr, i32 0, i32 ${fieldIndex}\n`;
        parserIR += `  store i1 %value_${fieldIndex}, i1* %field_ptr_${fieldIndex}\n\n`;
      } else {
        parserIR += `  %nested_str_${fieldIndex} = call i8* @cJSON_PrintUnformatted(i8* %item_${fieldIndex})\n`;
        parserIR += `  %value_${fieldIndex} = call %${fieldType}* @parse_json_${fieldType}(i8* %nested_str_${fieldIndex})\n`;
        parserIR += `  %field_ptr_${fieldIndex} = getelementptr inbounds %${typeName}, %${typeName}* %struct_ptr, i32 0, i32 ${fieldIndex}\n`;
        parserIR += `  store %${fieldType}* %value_${fieldIndex}, %${fieldType}** %field_ptr_${fieldIndex}\n\n`;
      }
    }
    parserIR += `  call void @cJSON_Delete(i8* %json_root)\n`;
    parserIR += `  ret %${typeName}* %struct_ptr\n`;
    parserIR += `}\n\n`;

    this.ctx.globalStrings.push(parserIR);
  }

  generateStringify(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      throw new Error('JSON.stringify() requires 1 argument');
    }

    const arg = expr.args[0];

    if (this.ctx.isStringExpression(arg)) {
      return this.stringifyString(arg, params);
    } else {
      return this.stringifyNumber(arg, params);
    }
  }

  private stringifyString(arg: Expression, params: string[]): string {
    const strPtr = this.ctx.generateExpression(arg, params);

    const strLen = this.ctx.nextTemp();
    this.ctx.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
    const bufferSize = this.ctx.nextTemp();
    this.ctx.emit(`${bufferSize} = add i64 ${strLen}, 3`);
    const buffer = this.ctx.nextTemp();
    this.ctx.emit(`${buffer} = call i8* @GC_malloc_atomic(i64 ${bufferSize})`);

    const formatStr = this.ctx.createStringConstant('"%s"');
    const sprintfResult = this.ctx.nextTemp();
    this.ctx.emit(`${sprintfResult} = call i32 (i8*, i8*, ...) @sprintf(i8* ${buffer}, i8* ${formatStr}, i8* ${strPtr})`);

    return buffer;
  }

  private stringifyNumber(arg: Expression, params: string[]): string {
    const numValue = this.ctx.generateExpression(arg, params);

    const buffer = this.ctx.nextTemp();
    this.ctx.emit(`${buffer} = call i8* @GC_malloc_atomic(i64 30)`);

    const formatStr = this.ctx.createStringConstant('%f');
    const sprintfResult = this.ctx.nextTemp();
    this.ctx.emit(`${sprintfResult} = call i32 (i8*, i8*, ...) @sprintf(i8* ${buffer}, i8* ${formatStr}, double ${numValue})`);

    return buffer;
  }
}
