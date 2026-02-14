import { Expression, MethodCallNode } from '../../ast/types.js';

interface ExprBase { type: string; }

import { IGeneratorContext } from '../infrastructure/generator-context.js';

interface JsonInterfaceDef {
  fields: { name: string; type: string }[];
}

export class JsonGenerator {
  private generatedStructs: Set<string>;
  private generatedParsers: Set<string>;

  constructor(private ctx: IGeneratorContext) {
    this.generatedStructs = new Set();
    this.generatedParsers = new Set();
  }

  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== 'variable') return false;
    const varNode = expr.object as { type: string; name: string };
    if (varNode.name !== 'JSON') return false;
    return (expr.method === 'parse' || expr.method === 'stringify');
  }

  generateParse(expr: MethodCallNode, params: string[], typeParam?: string): string {
    if (expr.args.length < 1) {
      throw new Error('JSON.parse() requires 1 argument (JSON string)');
    }

    if (!typeParam) {
      return this.generateUntypedParse(expr, params);
    }

    if (typeParam === 'number[]') {
      return this.generateParseNumberArray(expr, params);
    }

    const interfaceDefResult = this.ctx.getInterfaceFromAST(typeParam);
    if (!interfaceDefResult) {
      throw new Error(`JSON.parse<${typeParam}>: Interface '${typeParam}' not found in AST`);
    }

    const mappedFields: { name: string; type: string }[] = [];
    for (let mfi = 0; mfi < interfaceDefResult.fields.length; mfi++) {
      const rawField = interfaceDefResult.fields[mfi] as { name: string; type: string };
      mappedFields.push({
        name: rawField.name.replace(/\?$/, ''),
        type: rawField.type
      });
    }
    const interfaceDef: JsonInterfaceDef = {
      fields: mappedFields
    };

    this.generateJsonStruct(typeParam, interfaceDef);
    this.generateJsonParser(typeParam, interfaceDef);

    const jsonStr = this.ctx.generateExpression(expr.args[0], params);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call %${typeParam}* @parse_json_${typeParam}(i8* ${jsonStr})`);
    this.ctx.setVariableType(result, `%${typeParam}*`);

    return result;
  }

  private generateUntypedParse(expr: MethodCallNode, params: string[]): string {
    const jsonStr = this.ctx.generateExpression(expr.args[0], params);
    const jsonRoot = this.ctx.nextTemp();
    this.ctx.emit(`${jsonRoot} = call i8* @csyyjson_parse(i8* ${jsonStr})`);
    return jsonRoot;
  }

  private generateParseNumberArray(expr: MethodCallNode, params: string[]): string {
    const jsonStr = this.ctx.generateExpression(expr.args[0], params);

    const jsonRoot = this.ctx.nextTemp();
    this.ctx.emit(`${jsonRoot} = call i8* @csyyjson_parse(i8* ${jsonStr})`);

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
    this.ctx.emit(`${sizeI32} = call i32 @csyyjson_arr_size(i8* ${jsonRoot})`);
    const size = this.ctx.nextTemp();
    this.ctx.emit(`${size} = sitofp i32 ${sizeI32} to double`);

    const sizeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${sizeI64} = fptosi double ${size} to i64`);
    const dataSize = this.ctx.nextTemp();
    this.ctx.emit(`${dataSize} = mul i64 ${sizeI64}, 8`);
    const dataPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataPtr} = call i8* @GC_malloc(i64 ${dataSize})`);
    const data = this.ctx.nextTemp();
    this.ctx.emit(`${data} = bitcast i8* ${dataPtr} to double*`);

    const arrPtr = this.ctx.nextTemp();
    this.ctx.emit(`${arrPtr} = call i8* @GC_malloc(i64 24)`);
    const arr = this.ctx.nextTemp();
    this.ctx.emit(`${arr} = bitcast i8* ${arrPtr} to %Array*`);

    const dataFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${dataFieldPtr} = getelementptr %Array, %Array* ${arr}, i32 0, i32 0`);
    this.ctx.emit(`store double* ${data}, double** ${dataFieldPtr}`);

    const lenFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${lenFieldPtr} = getelementptr %Array, %Array* ${arr}, i32 0, i32 1`);
    this.ctx.emit(`store i32 ${sizeI32}, i32* ${lenFieldPtr}`);

    const capFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${capFieldPtr} = getelementptr %Array, %Array* ${arr}, i32 0, i32 2`);
    this.ctx.emit(`store i32 ${sizeI32}, i32* ${capFieldPtr}`);

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
    this.ctx.emit(`${item} = call i8* @csyyjson_arr_get(i8* ${jsonRoot}, i32 ${i})`);
    const valPtr = this.ctx.nextTemp();
    this.ctx.emit(`${valPtr} = call double @csyyjson_get_num(i8* ${item})`);
    const elemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elemPtr} = getelementptr double, double* ${data}, i32 ${i}`);
    this.ctx.emit(`store double ${valPtr}, double* ${elemPtr}`);
    const iInc = this.ctx.nextTemp();
    this.ctx.emit(`${iInc} = add i32 ${i}, 1`);
    this.ctx.emit(`br label %${loopCond}`);

    let phiIdx = -1;
    for (let phiSearchIdx = 0; phiSearchIdx < this.ctx.getOutputLength(); phiSearchIdx++) {
      if (this.ctx.getOutputLine(phiSearchIdx).includes(phiPlaceholder)) {
        phiIdx = phiSearchIdx;
        break;
      }
    }
    if (phiIdx !== -1) {
      this.ctx.setOutputLine(phiIdx, this.ctx.getOutputLine(phiIdx).replace(phiPlaceholder, iInc));
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
    for (let i = 0; i < this.ctx.getGlobalStringsLength(); i++) {
      if (this.ctx.getGlobalStringAt(i).includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  private generateJsonStruct(typeName: string, interfaceDef: JsonInterfaceDef): void {
    if (this.generatedStructs.has(typeName)) {
      return;
    }
    this.generatedStructs.add(typeName);

    if (this.hasStructInGlobalStrings(typeName)) {
      return;
    }

    if (this.ctx.interfaceStructGenHasInterface(typeName)) {
      return;
    }

    const fieldTypes: string[] = [];
    for (let fi = 0; fi < interfaceDef.fields.length; fi++) {
      const fieldItem = interfaceDef.fields[fi] as { name: string; type: string };
      const fieldType = fieldItem.type;
      const fieldName = fieldItem.name;
      if (fieldType === 'string') {
        fieldTypes.push('i8*');
      } else if (fieldType === 'number') {
        fieldTypes.push('double');
      } else if (fieldType === 'boolean') {
        fieldTypes.push('double');
      } else {
        const nestedInterface = this.ctx.getInterfaceFromAST(fieldType);
        if (nestedInterface) {
          fieldTypes.push(`%${fieldType}*`);
        } else {
          fieldTypes.push('i8*');
        }
      }
    }

    const structDef = `%${typeName} = type { ${fieldTypes.join(', ')} }` + '\n';
    const newGlobalStrings: string[] = [structDef];
    for (let i = 0; i < this.ctx.getGlobalStringsLength(); i++) {
      newGlobalStrings.push(this.ctx.getGlobalStringAt(i));
    }
    this.ctx.clearGlobalStrings();
    for (let i = 0; i < newGlobalStrings.length; i++) {
      this.ctx.pushGlobalString(newGlobalStrings[i]);
    }
  }

  private generateJsonParser(typeName: string, interfaceDef: JsonInterfaceDef): void {
    if (this.generatedParsers.has(typeName)) {
      return;
    }
    this.generatedParsers.add(typeName);

    for (let fi = 0; fi < interfaceDef.fields.length; fi++) {
      const fieldItem = interfaceDef.fields[fi] as { name: string; type: string };
      const fieldType = fieldItem.type;
      if (fieldType !== 'string' && fieldType !== 'number' && fieldType !== 'boolean') {
        const nestedInterface = this.ctx.getInterfaceFromAST(fieldType);
        if (nestedInterface) {
          const nestedMappedFields: { name: string; type: string }[] = [];
          for (let nfi = 0; nfi < nestedInterface.fields.length; nfi++) {
            const nf = nestedInterface.fields[nfi] as { name: string; type: string };
            nestedMappedFields.push({
              name: nf.name.replace(/\?$/, ''),
              type: nf.type
            });
          }
          const nestedDef: JsonInterfaceDef = {
            fields: nestedMappedFields
          };
          this.generateJsonStruct(fieldType, nestedDef);
          this.generateJsonParser(fieldType, nestedDef);
        }
      }
    }

    const structSize = interfaceDef.fields.length * 8;
    let parserIR = `define %${typeName}* @parse_json_${typeName}(i8* %json_str) {\n`;
    parserIR += 'entry:\n';
    parserIR += `  %struct_bytes = call i8* @GC_malloc(i64 ${structSize})\n`;
    parserIR += `  %struct_ptr = bitcast i8* %struct_bytes to %${typeName}*\n`;

    for (let fieldIndex = 0; fieldIndex < interfaceDef.fields.length; fieldIndex++) {
      const fieldEntry = interfaceDef.fields[fieldIndex] as { name: string; type: string };
      if (fieldEntry.type === 'string') {
        parserIR += `  %init_ptr_${fieldIndex} = getelementptr inbounds %${typeName}, %${typeName}* %struct_ptr, i32 0, i32 ${fieldIndex}\n`;
        parserIR += `  store i8* getelementptr inbounds ([1 x i8], [1 x i8]* @.empty_str, i64 0, i64 0), i8** %init_ptr_${fieldIndex}\n`;
      }
    }

    parserIR += `  %json_root = call i8* @csyyjson_parse(i8* %json_str)\n`;
    parserIR += `  %json_is_null = icmp eq i8* %json_root, null\n`;
    parserIR += `  br i1 %json_is_null, label %json_error, label %json_ok\n\n`;

    parserIR += `json_error:\n`;
    parserIR += `  ret %${typeName}* %struct_ptr\n\n`;

    const getNextLabel = (fieldIndex: number): string => {
      if (fieldIndex + 1 < interfaceDef.fields.length) {
        return `field_${fieldIndex + 1}`;
      }
      return 'json_cleanup';
    };

    if (interfaceDef.fields.length === 0) {
      parserIR += `json_ok:\n`;
      parserIR += `  br label %json_cleanup\n\n`;
    } else {
      parserIR += `json_ok:\n`;
      parserIR += `  br label %field_0\n\n`;

      for (let fieldIndex = 0; fieldIndex < interfaceDef.fields.length; fieldIndex++) {
        const fieldEntry = interfaceDef.fields[fieldIndex] as { name: string; type: string };
        const fieldName = fieldEntry.name;
        const fieldType = fieldEntry.type;
        const nextLabel = getNextLabel(fieldIndex);
        const fieldNameConst = this.ctx.nextString();
        this.ctx.pushGlobalString(fieldNameConst + ' = private unnamed_addr constant [' + (fieldName.length + 1) + ' x i8] c"' + fieldName + '\\00", align 1');

        parserIR += `field_${fieldIndex}:\n`;
        parserIR += `  %item_${fieldIndex} = call i8* @csyyjson_obj_get(i8* %json_root, i8* getelementptr inbounds ([${fieldName.length + 1} x i8], [${fieldName.length + 1} x i8]* ${fieldNameConst}, i64 0, i64 0))\n`;
        parserIR += `  %item_${fieldIndex}_null = icmp eq i8* %item_${fieldIndex}, null\n`;
        parserIR += `  br i1 %item_${fieldIndex}_null, label %${nextLabel}, label %field_${fieldIndex}_extract\n\n`;

        if (fieldType === 'string') {
          parserIR += `field_${fieldIndex}_extract:\n`;
          parserIR += `  %temp_str_${fieldIndex} = call i8* @csyyjson_get_str(i8* %item_${fieldIndex})\n`;
          parserIR += `  %str_${fieldIndex}_null = icmp eq i8* %temp_str_${fieldIndex}, null\n`;
          parserIR += `  br i1 %str_${fieldIndex}_null, label %${nextLabel}, label %field_${fieldIndex}_store\n\n`;

          parserIR += `field_${fieldIndex}_store:\n`;
          parserIR += `  %value_${fieldIndex} = call i8* @strdup(i8* %temp_str_${fieldIndex})\n`;
          parserIR += `  %field_ptr_${fieldIndex} = getelementptr inbounds %${typeName}, %${typeName}* %struct_ptr, i32 0, i32 ${fieldIndex}\n`;
          parserIR += `  store i8* %value_${fieldIndex}, i8** %field_ptr_${fieldIndex}\n`;
          parserIR += `  br label %${nextLabel}\n\n`;
        } else if (fieldType === 'number' || fieldType === 'boolean') {
          parserIR += `field_${fieldIndex}_extract:\n`;
          parserIR += `  %value_${fieldIndex} = call double @csyyjson_get_num(i8* %item_${fieldIndex})\n`;
          parserIR += `  %field_ptr_${fieldIndex} = getelementptr inbounds %${typeName}, %${typeName}* %struct_ptr, i32 0, i32 ${fieldIndex}\n`;
          parserIR += `  store double %value_${fieldIndex}, double* %field_ptr_${fieldIndex}\n`;
          parserIR += `  br label %${nextLabel}\n\n`;
        } else {
          parserIR += `field_${fieldIndex}_extract:\n`;
          parserIR += `  %nested_str_${fieldIndex} = call i8* @csyyjson_val_write(i8* %item_${fieldIndex})\n`;
          parserIR += `  %value_${fieldIndex} = call %${fieldType}* @parse_json_${fieldType}(i8* %nested_str_${fieldIndex})\n`;
          parserIR += `  %field_ptr_${fieldIndex} = getelementptr inbounds %${typeName}, %${typeName}* %struct_ptr, i32 0, i32 ${fieldIndex}\n`;
          parserIR += `  store %${fieldType}* %value_${fieldIndex}, %${fieldType}** %field_ptr_${fieldIndex}\n`;
          parserIR += `  br label %${nextLabel}\n\n`;
        }
      }
    }

    parserIR += `json_cleanup:\n`;
    parserIR += `  call void @csyyjson_free(i8* %json_root)\n`;
    parserIR += `  ret %${typeName}* %struct_ptr\n`;
    parserIR += `}\n\n`;

    this.ctx.pushGlobalString(parserIR);
  }

  generateStringify(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      throw new Error('JSON.stringify() requires 1 argument');
    }

    const arg = expr.args[0];

    if (this.ctx.isStringExpression(arg)) {
      return this.stringifyString(arg, params);
    }

    const interfaceType = this.resolveInterfaceType(arg);
    if (interfaceType) {
      return this.stringifyInterface(arg, params, interfaceType);
    }

    return this.stringifyNumber(arg, params);
  }

  private resolveInterfaceType(arg: Expression): string | null {
    if (arg.type === 'variable') {
      const varNode = arg as { type: string; name: string };
      return this.ctx.symbolTable.getInterfaceType(varNode.name) || null;
    }
    if (arg.type === 'index_access') {
      const indexAccess = arg as { type: string; object: Expression; index: Expression };
      if (indexAccess.object.type === 'variable') {
        const arrayName = (indexAccess.object as { type: string; name: string }).name;
        return this.ctx.symbolTable.getObjectArrayElementType(arrayName) || null;
      }
    }
    return null;
  }

  private stringifyInterface(arg: Expression, params: string[], interfaceType: string): string {
    const interfaceDefResult = this.ctx.getInterfaceFromAST(interfaceType);
    if (!interfaceDefResult) {
      return this.stringifyNumber(arg, params);
    }

    const mappedFields: { name: string; type: string }[] = [];
    for (let i = 0; i < interfaceDefResult.fields.length; i++) {
      const rawField = interfaceDefResult.fields[i] as { name: string; type: string };
      mappedFields.push({
        name: rawField.name.replace(/\?$/, ''),
        type: rawField.type
      });
    }

    const fieldTypes: string[] = [];
    for (let i = 0; i < mappedFields.length; i++) {
      const ft = mappedFields[i].type;
      if (ft === 'string') {
        fieldTypes.push('i8*');
      } else if (ft === 'number' || ft === 'boolean') {
        fieldTypes.push('double');
      } else {
        fieldTypes.push('i8*');
      }
    }
    const structType = `{ ${fieldTypes.join(', ')} }`;

    const objPtr = this.ctx.generateExpression(arg, params);

    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

    this.ctx.setUsesJson(true);
    const jsonDoc = this.ctx.nextTemp();
    this.ctx.emit(`${jsonDoc} = call i8* @csyyjson_create_obj()`);
    const jsonObj = this.ctx.nextTemp();
    this.ctx.emit(`${jsonObj} = call i8* @csyyjson_mut_get_root(i8* ${jsonDoc})`);

    for (let i = 0; i < mappedFields.length; i++) {
      const field = mappedFields[i];
      const fieldPtr = this.ctx.nextTemp();
      this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${i}`);

      const nameConst = this.ctx.createStringConstant(field.name);

      if (field.type === 'string') {
        const val = this.ctx.nextTemp();
        this.ctx.emit(`${val} = load i8*, i8** ${fieldPtr}`);
        this.ctx.emit(`call void @csyyjson_obj_add_str(i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, i8* ${val})`);
      } else if (field.type === 'boolean') {
        const val = this.ctx.nextTemp();
        this.ctx.emit(`${val} = load double, double* ${fieldPtr}`);
        const boolInt = this.ctx.nextTemp();
        this.ctx.emit(`${boolInt} = fptosi double ${val} to i32`);
        this.ctx.emit(`call void @csyyjson_obj_add_bool(i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, i32 ${boolInt})`);
      } else {
        const val = this.ctx.nextTemp();
        this.ctx.emit(`${val} = load double, double* ${fieldPtr}`);
        this.ctx.emit(`call void @csyyjson_obj_add_num(i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, double ${val})`);
      }
    }

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call i8* @csyyjson_stringify(i8* ${jsonDoc})`);
    this.ctx.setVariableType(result, 'i8*');

    return result;
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

    this.ctx.setVariableType(buffer, 'i8*');
    return buffer;
  }

  private stringifyNumber(arg: Expression, params: string[]): string {
    const numValue = this.ctx.generateExpression(arg, params);

    const buffer = this.ctx.nextTemp();
    this.ctx.emit(`${buffer} = call i8* @GC_malloc_atomic(i64 30)`);

    const formatStr = this.ctx.createStringConstant('%f');
    const sprintfResult = this.ctx.nextTemp();
    this.ctx.emit(`${sprintfResult} = call i32 (i8*, i8*, ...) @sprintf(i8* ${buffer}, i8* ${formatStr}, double ${numValue})`);

    this.ctx.setVariableType(buffer, 'i8*');
    return buffer;
  }
}
