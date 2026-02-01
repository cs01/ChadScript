import { Expression, NewNode, MethodCallNode } from '../../../ast/types.js';

/**
 * MemberAccessGenerator
 *
 * Handles property access expressions:
 * - process.argv (special case)
 * - Class instance properties (this.field, instance.field)
 * - JSON object properties
 * - Regular object properties
 * - Array/String .length property
 * - Map/Set .size property
 * - TypeScript interface-based property access
 */
export class MemberAccessGenerator {
  constructor(private ctx: any) {}

  generate(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    const enumResult = this.handleEnumMemberAccess(expr);
    if (enumResult !== null) return enumResult;

    // Try typed JSON struct access first
    const typedJsonResult = this.handleTypedJsonStructAccess(expr);
    if (typedJsonResult !== null) return typedJsonResult;

    // Handle process.argv special case
    if (this.isProcessArgv(expr)) {
      return this.handleProcessArgv();
    }

    // Handle class instance property access
    const classResult = this.handleClassPropertyAccess(expr, params, generateExpressionFn);
    if (classResult !== null) return classResult;

    // Handle JSON object property access
    if (expr.object.type === 'variable' && this.ctx.symbolTable.isJSON(expr.object.name)) {
      return this.handleJsonPropertyAccess(expr, params, generateExpressionFn);
    }

    // Handle nested JSON object access
    if (expr.object.type === 'member_access') {
      const nestedResult = this.handleNestedJsonAccess(expr, params, generateExpressionFn);
      if (nestedResult !== null) return nestedResult;
    }

    // Handle regular object property access
    const objResult = this.handleObjectPropertyAccess(expr, params, generateExpressionFn);
    if (objResult !== null) return objResult;

    // Handle .length property
    if (expr.property === 'length') {
      return this.handleLengthProperty(expr, params, generateExpressionFn);
    }

    // Handle .size property (Map/Set)
    if (expr.property === 'size') {
      const sizeResult = this.handleSizeProperty(expr, params, generateExpressionFn);
      if (sizeResult !== null) return sizeResult;
    }

    // Handle Response properties
    const responseResult = this.handleResponseProperty(expr);
    if (responseResult !== null) return responseResult;

    // Handle TypeScript parameter property access
    return this.handleParameterPropertyAccess(expr, params);
  }

  private isProcessArgv(expr: any): boolean {
    return expr.object.type === 'variable' &&
           (expr.object as any).name === 'process' &&
           expr.property === 'argv';
  }

  private handleEnumMemberAccess(expr: any): string | null {
    if (expr.object.type !== 'variable') return null;

    const enumName = (expr.object as any).name;
    const memberName = expr.property;
    const enums = this.ctx.ast?.enums;
    if (!enums) return null;

    const enumDecl = enums.find((e: any) => e.name === enumName);
    if (!enumDecl) return null;

    const member = enumDecl.members.find((m: any) => m.name === memberName);
    if (!member) {
      throw new Error(`Enum member '${memberName}' not found in enum '${enumName}'`);
    }

    const value = member.value;
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = fadd double ${value.toFixed(1)}, 0.0`);
    this.ctx.variableTypes.set(result, 'double');
    return result;
  }

  private handleTypedJsonStructAccess(expr: any): string | null {
    if (expr.object.type !== 'variable') return null;

    const varType = this.ctx.getVariableType(expr.object.name);
    if (!varType || !varType.startsWith('%') || !varType.endsWith('*')) return null;
    if (varType === '%Response*' || varType.includes('Array') || varType.includes('Map') || varType.includes('Set')) {
      return null;
    }

    const structTypeName = varType.substring(1, varType.length - 1);
    if (!this.ctx.typeChecker) return null;

    const interfaceDef = this.ctx.typeChecker.getInterfaceDefinition(structTypeName);
    if (!interfaceDef) return null;

    const propIndex = interfaceDef.properties.findIndex((p: any) => p.name === expr.property);
    if (propIndex === -1) {
      throw new Error(`Property '${expr.property}' not found in interface ${structTypeName}`);
    }

    const propType = interfaceDef.properties[propIndex].type;
    const varPtr = this.ctx.getVariableAlloca(expr.object.name);
    const structPtr = this.ctx.nextTemp();
    this.ctx.emit(`${structPtr} = load %${structTypeName}*, %${structTypeName}** ${varPtr}`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${structTypeName}, %${structTypeName}* ${structPtr}, i32 0, i32 ${propIndex}`);

    if (propType === 'string') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      this.ctx.variableTypes.set(value, 'i8*');
      return value;
    } else if (propType === 'number') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      this.ctx.variableTypes.set(value, 'double');
      return value;
    } else if (propType === 'boolean') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i1, i1* ${fieldPtr}`);
      const doubleValue = this.ctx.nextTemp();
      this.ctx.emit(`${doubleValue} = uitofp i1 ${value} to double`);
      this.ctx.variableTypes.set(doubleValue, 'double');
      return doubleValue;
    }
    return null;
  }

  private handleProcessArgv(): string {
    const sizePtr = this.ctx.nextTemp();
    this.ctx.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
    const structSize = this.ctx.nextTemp();
    this.ctx.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
    const arrayMem = this.ctx.nextTemp();
    this.ctx.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
    const argvStruct = this.ctx.nextTemp();
    this.ctx.emit(`${argvStruct} = bitcast i8* ${arrayMem} to %StringArray*`);

    const dataField = this.ctx.nextTemp();
    this.ctx.emit(`${dataField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 0`);
    const argvPtr = this.ctx.nextTemp();
    this.ctx.emit(`${argvPtr} = load i8**, i8*** @__argv`);
    this.ctx.emit(`store i8** ${argvPtr}, i8*** ${dataField}`);

    const lenField = this.ctx.nextTemp();
    this.ctx.emit(`${lenField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 1`);
    const argc = this.ctx.nextTemp();
    this.ctx.emit(`${argc} = load i32, i32* @__argc`);
    this.ctx.emit(`store i32 ${argc}, i32* ${lenField}`);

    const capField = this.ctx.nextTemp();
    this.ctx.emit(`${capField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 2`);
    this.ctx.emit(`store i32 ${argc}, i32* ${capField}`);

    this.ctx.variableTypes.set(argvStruct, '%StringArray*');
    return argvStruct;
  }

  private handleClassPropertyAccess(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string | null {
    let className: string | null = null;
    let instancePtr: string | null = null;

    if (expr.object.type === 'variable' && this.ctx.symbolTable.isClass(expr.object.name)) {
      const classMeta = this.ctx.symbolTable.getClassInfo(expr.object.name)!;
      className = classMeta.className;
      instancePtr = generateExpressionFn(expr.object, params);
    } else if ((expr.object as any).type === 'new') {
      const newExpr = expr.object as any as NewNode;
      className = newExpr.className;
      instancePtr = generateExpressionFn(expr.object, params);
    } else if ((expr.object as any).type === 'this') {
      const thisPtr = this.ctx.thisPointer || this.ctx.classGen.thisPointer;
      if (!thisPtr) {
        throw new Error('this.field accessed outside of class method or constructor');
      }
      instancePtr = thisPtr;
      const classWithField = this.ctx.ast.classes.find((c: any) => {
        return c.methods.some((m: any) => true);
      });
      if (classWithField) {
        className = classWithField.name;
      }
    }

    if (!className || !instancePtr) return null;

    const fieldInfo = this.ctx.classGen.getFieldInfo(className, expr.property);
    const fields = this.ctx.classGen.getClassFields(className);

    if (fieldInfo) {
      const fieldPtr = this.ctx.nextTemp();
      if (fields.length > 0) {
        this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${instancePtr}, i32 0, i32 ${fieldInfo.index}`);
        return this.loadFieldValue(fieldPtr, fieldInfo);
      } else {
        this.ctx.emit(`${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 ${fieldInfo.index}`);
        const value = this.ctx.nextTemp();
        this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
        return value;
      }
    } else if (fields.length === 0) {
      const fieldPtr = this.ctx.nextTemp();
      this.ctx.emit(`${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 0`);
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      return value;
    } else {
      throw new Error(`Field '${expr.property}' not found in class ${className}. Did you forget to declare it with a type annotation?`);
    }
  }

  private loadFieldValue(fieldPtr: string, fieldInfo: any): string {
    if (fieldInfo.type === 'string') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
      return value;
    } else if (fieldInfo.type === 'string[]') {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %StringArray*, %StringArray** ${fieldPtr}`);
      this.ctx.variableTypes.set(value, '%StringArray*');
      return value;
    } else if (fieldInfo.type.endsWith('[]')) {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load %Array*, %Array** ${fieldPtr}`);
      this.ctx.variableTypes.set(value, '%Array*');
      return value;
    } else if (fieldInfo.type === 'boolean') {
      const boolValue = this.ctx.nextTemp();
      this.ctx.emit(`${boolValue} = load i1, i1* ${fieldPtr}`);
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = uitofp i1 ${boolValue} to double`);
      this.ctx.variableTypes.set(value, 'double');
      return value;
    } else {
      const value = this.ctx.nextTemp();
      this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
      this.ctx.variableTypes.set(value, 'double');
      return value;
    }
  }

  private handleJsonPropertyAccess(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    const jsonMeta = this.ctx.symbolTable.getObjectInfo(expr.object.name);
    let tsType: string | undefined;
    if (jsonMeta?.tsTypes) {
      const propIdx = jsonMeta.keys.indexOf(expr.property);
      if (propIdx !== -1) {
        tsType = jsonMeta.tsTypes[propIdx];
      }
    }

    const jsonObjPtrPtr = this.ctx.getVariableAlloca(expr.object.name)!;
    const jsonObjPtr = this.ctx.nextTemp();
    this.ctx.emit(`${jsonObjPtr} = load i8*, i8** ${jsonObjPtrPtr}`);

    this.ctx.syncStateToGenerators();
    const fieldNameStr = this.ctx.stringGen.createStringConstant(expr.property);

    const fieldItem = this.ctx.nextTemp();
    this.ctx.emit(`${fieldItem} = call i8* @cJSON_GetObjectItem(i8* ${jsonObjPtr}, i8* ${fieldNameStr})`);

    if (tsType && !['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]'].includes(tsType)) {
      return this.handleNestedInterfaceField(fieldItem, tsType);
    }

    return this.extractJsonFieldValue(fieldItem);
  }

  private handleNestedInterfaceField(fieldItem: string, tsType: string): string {
    const nestedInterfaceDef = this.ctx.ast?.interfaces?.find((iface: any) => iface.name === tsType);
    if (nestedInterfaceDef) {
      const keys = nestedInterfaceDef.fields.map((f: any) => f.name);
      const tsTypes = nestedInterfaceDef.fields.map((f: any) => f.type);
      const types = nestedInterfaceDef.fields.map((f: any) => this.tsTypeToLlvm(f.type));
      this.ctx.jsonObjectMetadata = this.ctx.jsonObjectMetadata || new Map();
      this.ctx.jsonObjectMetadata.set(fieldItem, { keys, types, tsTypes });
    }
    this.ctx.variableTypes.set(fieldItem, 'i8*');
    return fieldItem;
  }

  private tsTypeToLlvm(t: string): string {
    if (t === 'string') return 'i8*';
    if (t === 'number') return 'double';
    if (t === 'boolean') return 'double';
    if (t === 'string[]') return '%StringArray*';
    if (t === 'number[]') return '%Array*';
    return 'i8*';
  }

  private extractJsonFieldValue(fieldItem: string): string {
    const fieldExists = this.ctx.nextTemp();
    this.ctx.emit(`${fieldExists} = icmp ne i8* ${fieldItem}, null`);

    const hasFieldLabel = this.ctx.nextLabel('json_has_field');
    const noFieldLabel = this.ctx.nextLabel('json_no_field');
    const fieldEndLabel = this.ctx.nextLabel('json_field_end');

    this.ctx.emit(`br i1 ${fieldExists}, label %${hasFieldLabel}, label %${noFieldLabel}`);
    this.ctx.emit(`${hasFieldLabel}:`);

    const isNumber = this.ctx.nextTemp();
    this.ctx.emit(`${isNumber} = call i32 @cJSON_IsNumber(i8* ${fieldItem})`);
    const isNumBool = this.ctx.nextTemp();
    this.ctx.emit(`${isNumBool} = icmp ne i32 ${isNumber}, 0`);

    const numberLabel = this.ctx.nextLabel('json_number');
    const stringLabel = this.ctx.nextLabel('json_string');

    this.ctx.emit(`br i1 ${isNumBool}, label %${numberLabel}, label %${stringLabel}`);

    this.ctx.emit(`${numberLabel}:`);
    const numValue = this.ctx.nextTemp();
    this.ctx.emit(`${numValue} = call i32 @cJSON_GetNumberValueAsInt(i8* ${fieldItem})`);
    this.ctx.emit(`br label %${fieldEndLabel}`);

    this.ctx.emit(`${stringLabel}:`);
    const strValue = this.ctx.nextTemp();
    this.ctx.emit(`${strValue} = call i8* @cJSON_GetStringValue(i8* ${fieldItem})`);
    const strAsInt = this.ctx.nextTemp();
    this.ctx.emit(`${strAsInt} = ptrtoint i8* ${strValue} to i32`);
    this.ctx.emit(`br label %${fieldEndLabel}`);

    this.ctx.emit(`${noFieldLabel}:`);
    this.ctx.emit(`br label %${fieldEndLabel}`);

    this.ctx.emit(`${fieldEndLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi i32 [ ${numValue}, %${numberLabel} ], [ ${strAsInt}, %${stringLabel} ], [ 0, %${noFieldLabel} ]`);

    this.ctx.variableTypes.set(result, 'i32');
    return result;
  }

  private handleNestedJsonAccess(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string | null {
    const innerResult = generateExpressionFn(expr.object, params);
    const nestedMeta = this.ctx.jsonObjectMetadata?.get(innerResult);
    if (!nestedMeta) return null;

    this.ctx.syncStateToGenerators();
    const fieldNameStr = this.ctx.stringGen.createStringConstant(expr.property);
    const fieldItem = this.ctx.nextTemp();
    this.ctx.emit(`${fieldItem} = call i8* @cJSON_GetObjectItem(i8* ${innerResult}, i8* ${fieldNameStr})`);

    const propIdx = nestedMeta.keys.indexOf(expr.property);
    const tsType = propIdx !== -1 ? nestedMeta.tsTypes?.[propIdx] : undefined;

    if (tsType && !['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]'].includes(tsType)) {
      return this.handleNestedInterfaceField(fieldItem, tsType);
    }

    return this.extractNestedJsonFieldValue(fieldItem);
  }

  private extractNestedJsonFieldValue(fieldItem: string): string {
    const isNumber = this.ctx.nextTemp();
    this.ctx.emit(`${isNumber} = call i32 @cJSON_IsNumber(i8* ${fieldItem})`);
    const isNumBool = this.ctx.nextTemp();
    this.ctx.emit(`${isNumBool} = icmp ne i32 ${isNumber}, 0`);

    const numberLabel = this.ctx.nextLabel('json_number');
    const stringLabel = this.ctx.nextLabel('json_string');
    const fieldEndLabel = this.ctx.nextLabel('json_field_end');

    this.ctx.emit(`br i1 ${isNumBool}, label %${numberLabel}, label %${stringLabel}`);

    this.ctx.emit(`${numberLabel}:`);
    const numValue = this.ctx.nextTemp();
    this.ctx.emit(`${numValue} = call i32 @cJSON_GetNumberValueAsInt(i8* ${fieldItem})`);
    this.ctx.emit(`br label %${fieldEndLabel}`);

    this.ctx.emit(`${stringLabel}:`);
    const strValue = this.ctx.nextTemp();
    this.ctx.emit(`${strValue} = call i8* @cJSON_GetStringValue(i8* ${fieldItem})`);
    const strAsInt = this.ctx.nextTemp();
    this.ctx.emit(`${strAsInt} = ptrtoint i8* ${strValue} to i32`);
    this.ctx.emit(`br label %${fieldEndLabel}`);

    this.ctx.emit(`${fieldEndLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi i32 [ ${numValue}, %${numberLabel} ], [ ${strAsInt}, %${stringLabel} ]`);

    this.ctx.variableTypes.set(result, 'i32');
    return result;
  }

  private handleObjectPropertyAccess(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string | null {
    let objPtr: string = '';
    let keys: string[] = [];
    let types: string[] = [];

    if (expr.object.type === 'variable' && this.ctx.symbolTable.isJSON(expr.object.name)) {
      return null;  // Already handled in handleJsonPropertyAccess
    } else if (expr.object.type === 'variable' && this.ctx.symbolTable.isObject(expr.object.name)) {
      const objMeta = this.ctx.symbolTable.getObjectInfo(expr.object.name);
      if (!objMeta) return null;
      keys = objMeta.keys;
      types = objMeta.types;
      const objPtrPtr = this.ctx.getVariableAlloca(expr.object.name)!;
      objPtr = this.ctx.nextTemp();
      this.ctx.emit(`${objPtr} = load i8*, i8** ${objPtrPtr}`);
    } else if ((expr.object as any).type === 'object') {
      const metadata = this.ctx.getObjectMetadata(expr.object as any);
      keys = metadata.keys;
      types = metadata.types;
      objPtr = generateExpressionFn(expr.object, params);
    } else if (expr.object.type === 'method_call') {
      const result = this.handleMethodCallPropertyAccess(expr, params, generateExpressionFn);
      if (result !== null) return result;
      return null;
    } else {
      return null;
    }

    if (keys.length === 0 || !objPtr) return null;

    const propIndex = keys.indexOf(expr.property);
    if (propIndex === -1) {
      const objDesc = expr.object.type === 'variable' ? (expr.object as any).name : 'literal';
      throw new Error(`Unknown property: ${expr.property} on object ${objDesc}. Available properties: ${keys.join(', ')}`);
    }

    const propType = types[propIndex];
    const structType = `{ ${types.join(', ')} }`;

    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`);

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${propType}, ${propType}* ${fieldPtr}`);
    this.ctx.variableTypes.set(value, propType);
    return value;
  }

  private handleMethodCallPropertyAccess(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string | null {
    const methodCall = expr.object as any as MethodCallNode;
    if (methodCall.method !== 'parse') return null;
    if (methodCall.object.type !== 'variable') return null;
    if ((methodCall.object as any).name !== 'JSON') return null;

    this.ctx.syncStateToGenerators();
    const jsonObjPtr = generateExpressionFn(expr.object, params);
    const fieldNameStr = this.ctx.stringGen.createStringConstant(expr.property);

    const fieldItem = this.ctx.nextTemp();
    this.ctx.emit(`${fieldItem} = call i8* @cJSON_GetObjectItem(i8* ${jsonObjPtr}, i8* ${fieldNameStr})`);

    return this.extractJsonFieldValue(fieldItem);
  }

  private handleLengthProperty(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    if (expr.object.type === 'variable' && this.ctx.symbolTable.isNumberArray(expr.object.name)) {
      return this.getArrayLength(expr.object, params, generateExpressionFn, '%Array');
    }

    if (this.isProcessArgvLength(expr)) {
      const stringArrayPtr = generateExpressionFn(expr.object, params);
      return this.getStringArrayLength(stringArrayPtr);
    }

    if (expr.object.type === 'variable' && this.ctx.symbolTable.isStringArray(expr.object.name)) {
      const stringArrayPtr = generateExpressionFn(expr.object, params);
      return this.getStringArrayLength(stringArrayPtr);
    }

    if (expr.object.type === 'member_access') {
      const result = this.handleMemberAccessLength(expr, params, generateExpressionFn);
      if (result !== null) return result;
    }

    return this.getStringLength(expr.object, params, generateExpressionFn);
  }

  private isProcessArgvLength(expr: any): boolean {
    return expr.object.type === 'member_access' &&
           expr.object.object.type === 'variable' &&
           (expr.object.object as any).name === 'process' &&
           expr.object.property === 'argv';
  }

  private getArrayLength(obj: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string, arrayType: string): string {
    const arrayPtr = generateExpressionFn(obj, params);
    const lenPtr = this.ctx.nextTemp();
    this.ctx.emit(`${lenPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${arrayPtr}, i32 0, i32 1`);
    const lenI32 = this.ctx.nextTemp();
    this.ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
    const len = this.ctx.nextTemp();
    this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
    this.ctx.variableTypes.set(len, 'double');
    return len;
  }

  private getStringArrayLength(stringArrayPtr: string): string {
    const lenPtr = this.ctx.nextTemp();
    this.ctx.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${stringArrayPtr}, i32 0, i32 1`);
    const lenI32 = this.ctx.nextTemp();
    this.ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
    const len = this.ctx.nextTemp();
    this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
    this.ctx.variableTypes.set(len, 'double');
    return len;
  }

  private handleMemberAccessLength(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string | null {
    if (expr.object.object.type === 'variable' && this.ctx.symbolTable.isClass(expr.object.object.name)) {
      const classMeta = this.ctx.symbolTable.getClassInfo(expr.object.object.name)!;
      const fieldInfo = this.ctx.classGen.getFieldInfo(classMeta.className, expr.object.property);
      if (fieldInfo && fieldInfo.type === 'string[]') {
        const stringArrayPtr = generateExpressionFn(expr.object, params);
        return this.getStringArrayLength(stringArrayPtr);
      } else if (fieldInfo && (fieldInfo.type === 'number[]' || fieldInfo.type === 'boolean[]')) {
        const arrayPtr = generateExpressionFn(expr.object, params);
        return this.getArrayLengthFromPtr(arrayPtr, '%Array');
      }
    } else if (expr.object.object.type === 'this') {
      const className = this.ctx.currentClassName || (this.ctx.classGen as any).currentClassName;
      if (className) {
        const fieldInfo = this.ctx.classGen.getFieldInfo(className, expr.object.property);
        if (fieldInfo && fieldInfo.type === 'string[]') {
          const stringArrayPtr = generateExpressionFn(expr.object, params);
          return this.getStringArrayLength(stringArrayPtr);
        } else if (fieldInfo && (fieldInfo.type === 'number[]' || fieldInfo.type === 'boolean[]')) {
          const arrayPtr = generateExpressionFn(expr.object, params);
          return this.getArrayLengthFromPtr(arrayPtr, '%Array');
        }
      }
    }
    return null;
  }

  private getArrayLengthFromPtr(arrayPtr: string, arrayType: string): string {
    const lenPtr = this.ctx.nextTemp();
    this.ctx.emit(`${lenPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${arrayPtr}, i32 0, i32 1`);
    const lenI32 = this.ctx.nextTemp();
    this.ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
    const len = this.ctx.nextTemp();
    this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
    this.ctx.variableTypes.set(len, 'double');
    return len;
  }

  private getStringLength(obj: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    const objPtr = generateExpressionFn(obj, params);
    const lenI64 = this.ctx.nextTemp();
    this.ctx.emit(`${lenI64} = call i64 @strlen(i8* ${objPtr})`);
    const lenI32 = this.ctx.nextTemp();
    this.ctx.emit(`${lenI32} = trunc i64 ${lenI64} to i32`);
    const len = this.ctx.nextTemp();
    this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
    this.ctx.variableTypes.set(len, 'double');
    return len;
  }

  private handleSizeProperty(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string | null {
    if (expr.object.type === 'variable' && this.ctx.symbolTable.isMap(expr.object.name)) {
      const mapPtr = generateExpressionFn(expr.object, params);
      this.ctx.syncStateToGenerators();
      return this.ctx.mapGen.generateMapSize(mapPtr);
    }
    if (expr.object.type === 'variable' && this.ctx.symbolTable.isSet(expr.object.name)) {
      const setPtr = generateExpressionFn(expr.object, params);
      this.ctx.syncStateToGenerators();
      return this.ctx.setGen.generateSetSize(setPtr);
    }
    return null;
  }

  private handleResponseProperty(expr: any): string | null {
    if (expr.property !== 'status' && expr.property !== 'ok') return null;
    if (expr.object.type !== 'variable') return null;

    const varType = this.ctx.getVariableType((expr.object as any).name);
    if (varType !== '%Response*' && varType !== 'i8*') return null;

    const varPtr = this.ctx.getVariableAlloca((expr.object as any).name);
    let responsePtr: string;

    if (varType === 'i8*') {
      const i8Ptr = this.ctx.nextTemp();
      this.ctx.emit(`${i8Ptr} = load i8*, i8** ${varPtr}`);
      responsePtr = this.ctx.nextTemp();
      this.ctx.emit(`${responsePtr} = bitcast i8* ${i8Ptr} to %Response*`);
    } else {
      responsePtr = this.ctx.nextTemp();
      this.ctx.emit(`${responsePtr} = load %Response*, %Response** ${varPtr}`);
    }

    this.ctx.syncStateToGenerators();
    if (expr.property === 'status') {
      return this.ctx.responseGen.generateStatus(responsePtr);
    } else {
      return this.ctx.responseGen.generateOk(responsePtr);
    }
  }

  private handleParameterPropertyAccess(expr: any, params: string[]): string {
    if (expr.object.type !== 'variable') {
      throw new Error(this.ctx.formatCodegenError(`Unknown property: ${expr.property}`));
    }

    const varName = (expr.object as any).name;

    if (params.includes(varName)) {
      if (this.ctx.typeChecker && this.ctx.currentFunction) {
        const typeInfo = this.ctx.typeChecker.getPropertyType(varName, expr.property, this.ctx.currentFunction);
        if (typeInfo && typeInfo.properties) {
          return this.accessTypedParameter(varName, expr.property, typeInfo);
        }
      }

      const suggestion =
        `\x1b[33mWhy this happens:\x1b[0m\n` +
        `ChadScript needs TypeScript type annotations to compile object parameters.\n\n` +
        `\x1b[33mSolution:\x1b[0m Add a TypeScript interface:\n` +
        `  \x1b[32minterface MyType {\x1b[0m\n` +
        `  \x1b[32m  ${expr.property}: string;  // or number, etc.\x1b[0m\n` +
        `  \x1b[32m}\x1b[0m\n` +
        `  \x1b[32mfunction ${this.ctx.currentFunction}(${varName}: MyType) { ... }\x1b[0m\n\n` +
        `Without TypeScript types, ChadScript can't determine struct layout at compile-time.\n` +
        `Use \x1b[36m.ts\x1b[0m files instead of \x1b[36m.js\x1b[0m to enable type-aware compilation.`;

      throw new Error(this.ctx.formatCodegenError(
        `Cannot access property '${expr.property}' on function parameter '${varName}'.`,
        suggestion
      ));
    }

    const suggestion =
      `\x1b[33mThis variable exists but ChadScript doesn't know its type.\x1b[0m\n\n` +
      `ChadScript tracks these types automatically:\n` +
      `  • Objects: \x1b[32mconst obj = { x: 5, y: 10 }; obj.x\x1b[0m ✅\n` +
      `  • Arrays: \x1b[32mconst arr = [1,2,3]; arr[0]\x1b[0m ✅\n` +
      `  • Classes: \x1b[32mconst p = new Point(1, 2); p.x\x1b[0m ✅\n` +
      `  • Maps/Sets: \x1b[32mconst m = new Map(); m.set(...)\x1b[0m ✅\n\n` +
      `Common issues:\n` +
      `  • Variable assigned from function return? Return type might be unclear.\n` +
      `  • Variable assigned conditionally? Type tracking might lose it.\n` +
      `  • Imported from another file? Cross-file tracking not implemented yet.\n\n` +
      `\x1b[33mDebug tip:\x1b[0m Where is '${varName}' assigned? Does it come from an object literal?`;

    throw new Error(this.ctx.formatCodegenError(
      `Cannot access property '${expr.property}' on variable '${varName}'.`,
      suggestion
    ));
  }

  private accessTypedParameter(varName: string, property: string, typeInfo: any): string {
    const properties = Array.from(typeInfo.properties.entries()) as [string, any][];
    const propInfo = typeInfo.properties.get(property);

    const structTypes = properties.map(([_, info]) => info.type);
    const structType = `{ ${structTypes.join(', ')} }`;
    const propIndex = properties.findIndex(([name, _]) => name === property);

    const paramPtr = this.ctx.getVariableAlloca(varName);
    if (!paramPtr) {
      throw new Error(`Parameter ${varName} not found in variables`);
    }
    const objPtrI32 = this.ctx.nextTemp();
    this.ctx.emit(`${objPtrI32} = load i32, i32* ${paramPtr}`);

    const objPtr = this.ctx.nextTemp();
    this.ctx.emit(`${objPtr} = inttoptr i32 ${objPtrI32} to i8*`);

    const typedPtr = this.ctx.nextTemp();
    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`);

    const value = this.ctx.nextTemp();
    this.ctx.emit(`${value} = load ${propInfo.type}, ${propInfo.type}* ${fieldPtr}`);

    return value;
  }
}
