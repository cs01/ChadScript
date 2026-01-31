import { Expression, NewNode, MethodCallNode } from '../../../ast/types.js';

/**
 * MemberAccessGenerator  
 *
 * Handles property access expressions (THE BIG ONE ~600 lines):
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

  /**
   * Generate member access expression
   * This handles many different member access patterns
   */
  generate(expr: any, params: string[], generateExpressionFn: (expr: Expression, params: string[]) => string): string {
    console.error('DEBUG MEMBER.generate(): expr.property=', expr.property, 'expr.object.type=', expr.object?.type, 'expr.object.name=', (expr.object as any)?.name);
          // Handle typed JSON struct property access (from .json<T>())
          if (expr.object.type === 'variable') {
            const varType = this.ctx.variableTypes.get(expr.object.name);
            // Check if it's a typed JSON struct pointer (e.g., %JsonTestResponse*)
            if (varType && varType.startsWith('%') && varType.endsWith('*') && !varType.includes('Array') && !varType.includes('Response') && !varType.includes('Map') && !varType.includes('Set')) {
              // Extract the struct type name (e.g., "JsonTestResponse" from "%JsonTestResponse*")
              const structTypeName = varType.substring(1, varType.length - 1);  // Remove % and *

              // Get the interface definition to find field index
              if (this.ctx.typeChecker) {
                const interfaceDef = this.ctx.typeChecker.getInterfaceDefinition(structTypeName);
                if (interfaceDef) {
                  // Find the property index
                  const propIndex = interfaceDef.properties.findIndex((p: any) => p.name === expr.property);
                  if (propIndex === -1) {
                    throw new Error(`Property '${expr.property}' not found in interface ${structTypeName}`);
                  }

                  const propType = interfaceDef.properties[propIndex].type;

                  // Load the struct pointer
                  const varPtr = this.ctx.variables.get(expr.object.name);
                  const structPtr = this.ctx.nextTemp();
                  this.ctx.emit(`${structPtr} = load %${structTypeName}*, %${structTypeName}** ${varPtr}`);

                  // Get field pointer
                  const fieldPtr = this.ctx.nextTemp();
                  this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${structTypeName}, %${structTypeName}* ${structPtr}, i32 0, i32 ${propIndex}`);

                  // Load field value with correct type
                  if (propType === 'string') {
                    const value = this.ctx.nextTemp();
                    this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
                    this.ctx.variableTypes.set(value, 'i8*');  // Mark as string
                    return value;
                  } else if (propType === 'number') {
                    const value = this.ctx.nextTemp();
                    this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
                    this.ctx.variableTypes.set(value, 'double');  // Mark as double
                    return value;
                  } else if (propType === 'boolean') {
                    const value = this.ctx.nextTemp();
                    this.ctx.emit(`${value} = load i1, i1* ${fieldPtr}`);
                    // Convert i1 to double for JavaScript semantics
                    const doubleValue = this.ctx.nextTemp();
                    this.ctx.emit(`${doubleValue} = uitofp i1 ${value} to double`);
                    this.ctx.variableTypes.set(doubleValue, 'double');  // Mark as double
                    return doubleValue;
                  }
                }
              }
            }
          }

          // Handle process.argv - special case
          if (expr.object.type === 'variable' && (expr.object as any).name === 'process' && expr.property === 'argv') {
            // Convert argv (i8**) to a proper %StringArray structure
            // Compute sizeof(%StringArray) dynamically
            const sizePtr = this.ctx.nextTemp();
            this.ctx.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
            const structSize = this.ctx.nextTemp();
            this.ctx.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
            const arrayMem = this.ctx.nextTemp();
            this.ctx.emit(`${arrayMem} = call i8* @malloc(i64 ${structSize})`);
            const argvStruct = this.ctx.nextTemp();
            this.ctx.emit(`${argvStruct} = bitcast i8* ${arrayMem} to %StringArray*`);
    
            // Store argv pointer in data field
            const dataField = this.ctx.nextTemp();
            this.ctx.emit(`${dataField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 0`);
            const argvPtr = this.ctx.nextTemp();
            this.ctx.emit(`${argvPtr} = load i8**, i8*** @__argv`);
            this.ctx.emit(`store i8** ${argvPtr}, i8*** ${dataField}`);
    
            // Store argc in length field
            const lenField = this.ctx.nextTemp();
            this.ctx.emit(`${lenField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 1`);
            const argc = this.ctx.nextTemp();
            this.ctx.emit(`${argc} = load i32, i32* @__argc`);
            this.ctx.emit(`store i32 ${argc}, i32* ${lenField}`);
    
            // Store argc in capacity field too
            const capField = this.ctx.nextTemp();
            this.ctx.emit(`${capField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 2`);
            this.ctx.emit(`store i32 ${argc}, i32* ${capField}`);

            // Track temporary register type
            this.ctx.variableTypes.set(argvStruct, '%StringArray*');
            return argvStruct;
          }
    
          // Handle class instance property access (this.ctx.field or instance.field)
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
            // Get this pointer - check both this.ctx.thisPointer and classGen.thisPointer
            const thisPtr = this.ctx.thisPointer || this.ctx.classGen.thisPointer;
            if (!thisPtr) {
              throw new Error('this.ctx.field accessed outside of class method or constructor');
            }
            instancePtr = thisPtr;
            // Find which class we're in - we'll need to track this better later
            // For now, search for a class that might have this field
            // This is a simplified approach - in a full implementation we'd track the current class
            const classWithField = this.ctx.ast.classes.find((c: any) => {
              // Check if constructor or any method assigns this field
              return c.methods.some((m: any) => {
                // Simple check - look for assignment statements with this.ctx.field
                // For now, we'll just assume any class could have this field
                return true;
              });
            });
            if (classWithField) {
              className = classWithField.name;
            }
          }
    
          if (className && instancePtr) {
            // Get field info from class generator
            const fieldInfo = this.ctx.classGen.getFieldInfo(className, expr.property);
            const fields = this.ctx.classGen.getClassFields(className);
    
            if (fieldInfo) {
              // Typed field - use struct getelementptr
              const fieldPtr = this.ctx.nextTemp();
              if (fields.length > 0) {
                this.ctx.emit(`${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${instancePtr}, i32 0, i32 ${fieldInfo.index}`);
    
                if (fieldInfo.type === 'string') {
                  // Load string pointer (i8*)
                  const value = this.ctx.nextTemp();
                  this.ctx.emit(`${value} = load i8*, i8** ${fieldPtr}`);
                  return value;
                } else if (fieldInfo.type === 'string[]') {
                  // Load string array pointer (%StringArray*)
                  const value = this.ctx.nextTemp();
                  this.ctx.emit(`${value} = load %StringArray*, %StringArray** ${fieldPtr}`);
                  // Track this temporary register type
                  this.ctx.variableTypes.set(value, '%StringArray*');
                  return value;
                } else if (fieldInfo.type.endsWith('[]')) {
                  // Load number/boolean array pointer (%Array*)
                  const value = this.ctx.nextTemp();
                  this.ctx.emit(`${value} = load %Array*, %Array** ${fieldPtr}`);
                  // Track this temporary register type
                  this.ctx.variableTypes.set(value, '%Array*');
                  return value;
                } else {
                  // Load double (JavaScript semantics)
                  const value = this.ctx.nextTemp();
                  this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
                  return value;
                }
              } else {
                // Backward compat: no declared fields, use double*
                this.ctx.emit(`${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 ${fieldInfo.index}`);
                const value = this.ctx.nextTemp();
                this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
                return value;
              }
            } else if (fields.length === 0) {
              // Backward compat: no declared fields, use index 0 with double*
              const fieldPtr = this.ctx.nextTemp();
              this.ctx.emit(`${fieldPtr} = getelementptr inbounds double, double* ${instancePtr}, i32 0`);
              const value = this.ctx.nextTemp();
              this.ctx.emit(`${value} = load double, double* ${fieldPtr}`);
              return value;
            } else {
              throw new Error(`Field '${expr.property}' not found in class ${className}. Did you forget to declare it with a type annotation?`);
            }
          }

          // Check if accessing a JSON object property
          if (expr.object.type === 'variable' && this.ctx.symbolTable.isJSON(expr.object.name)) {
            // Get metadata to check if this property is a nested interface
            const jsonMeta = this.ctx.symbolTable.getObjectInfo(expr.object.name);
            let tsType: string | undefined;
            if (jsonMeta?.tsTypes) {
              const propIdx = jsonMeta.keys.indexOf(expr.property);
              if (propIdx !== -1) {
                tsType = jsonMeta.tsTypes[propIdx];
              }
            }

            // Load JSON object pointer
            const jsonObjPtrPtr = this.ctx.getVariableAlloca(expr.object.name)!;
            const jsonObjPtr = this.ctx.nextTemp();
            this.ctx.emit(`${jsonObjPtr} = load i8*, i8** ${jsonObjPtrPtr}`);

            this.ctx.syncStateToGenerators();
            const fieldNameStr = this.ctx.stringGen.createStringConstant(expr.property);

            // Get the field from JSON object
            const fieldItem = this.ctx.nextTemp();
            this.ctx.emit(`${fieldItem} = call i8* @cJSON_GetObjectItem(i8* ${jsonObjPtr}, i8* ${fieldNameStr})`);

            // If this property is a nested interface, return the cJSON object pointer
            if (tsType && !['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]'].includes(tsType)) {
              // This is a nested interface - look up its definition
              const nestedInterfaceDef = this.ctx.ast?.interfaces?.find((iface: any) => iface.name === tsType);
              if (nestedInterfaceDef) {
                // Track this as a JSON object with its own metadata
                const keys = nestedInterfaceDef.fields.map((f: any) => f.name);
                const tsTypes = nestedInterfaceDef.fields.map((f: any) => f.type);
                const types = nestedInterfaceDef.fields.map((f: any) => {
                  const t = f.type;
                  if (t === 'string') return 'i8*';
                  if (t === 'number') return 'double';
                  if (t === 'boolean') return 'double';
                  if (t === 'string[]') return '%StringArray*';
                  if (t === 'number[]') return '%Array*';
                  return 'i8*';
                });
                // Store metadata for this result so nested access works
                this.ctx.jsonObjectMetadata = this.ctx.jsonObjectMetadata || new Map();
                this.ctx.jsonObjectMetadata.set(fieldItem, { keys, types, tsTypes });
              }
              this.ctx.variableTypes.set(fieldItem, 'i8*');
              return fieldItem;
            }

            // Check if field exists
            const fieldExists = this.ctx.nextTemp();
            this.ctx.emit(`${fieldExists} = icmp ne i8* ${fieldItem}, null`);

            const hasFieldLabel = this.ctx.nextLabel('json_has_field');
            const noFieldLabel = this.ctx.nextLabel('json_no_field');
            const fieldEndLabel = this.ctx.nextLabel('json_field_end');

            this.ctx.emit(`br i1 ${fieldExists}, label %${hasFieldLabel}, label %${noFieldLabel}`);

            // Field exists: check type and extract value
            this.ctx.emit(`${hasFieldLabel}:`);

            // Check if it's a number
            const isNumber = this.ctx.nextTemp();
            this.ctx.emit(`${isNumber} = call i32 @cJSON_IsNumber(i8* ${fieldItem})`);
            const isNumBool = this.ctx.nextTemp();
            this.ctx.emit(`${isNumBool} = icmp ne i32 ${isNumber}, 0`);

            const numberLabel = this.ctx.nextLabel('json_number');
            const stringLabel = this.ctx.nextLabel('json_string');

            this.ctx.emit(`br i1 ${isNumBool}, label %${numberLabel}, label %${stringLabel}`);

            // Number field
            this.ctx.emit(`${numberLabel}:`);
            const numValue = this.ctx.nextTemp();
            this.ctx.emit(`${numValue} = call i32 @cJSON_GetNumberValueAsInt(i8* ${fieldItem})`);
            this.ctx.emit(`br label %${fieldEndLabel}`);

            // String field
            this.ctx.emit(`${stringLabel}:`);
            const strValue = this.ctx.nextTemp();
            this.ctx.emit(`${strValue} = call i8* @cJSON_GetStringValue(i8* ${fieldItem})`);
            // Convert i8* to i32 for now (will be cast back when used)
            const strAsInt = this.ctx.nextTemp();
            this.ctx.emit(`${strAsInt} = ptrtoint i8* ${strValue} to i32`);
            this.ctx.emit(`br label %${fieldEndLabel}`);

            // Field doesn't exist: return 0
            this.ctx.emit(`${noFieldLabel}:`);
            this.ctx.emit(`br label %${fieldEndLabel}`);

            // Merge
            this.ctx.emit(`${fieldEndLabel}:`);
            const result = this.ctx.nextTemp();
            this.ctx.emit(`${result} = phi i32 [ ${numValue}, %${numberLabel} ], [ ${strAsInt}, %${stringLabel} ], [ 0, %${noFieldLabel} ]`);

            // Track type so comparison code can convert if needed
            this.ctx.variableTypes.set(result, 'i32');

            return result;
          }

          // Check if accessing a property on a nested JSON object (from member_access)
          if (expr.object.type === 'member_access') {
            // Generate the inner member access first
            const innerResult = generateExpressionFn(expr.object, params);
            // Check if the inner result has JSON metadata
            const nestedMeta = this.ctx.jsonObjectMetadata?.get(innerResult);
            if (nestedMeta) {
              // This is a nested JSON object - access its property
              this.ctx.syncStateToGenerators();
              const fieldNameStr = this.ctx.stringGen.createStringConstant(expr.property);
              const fieldItem = this.ctx.nextTemp();
              this.ctx.emit(`${fieldItem} = call i8* @cJSON_GetObjectItem(i8* ${innerResult}, i8* ${fieldNameStr})`);

              // Check if this property is itself a nested interface
              const propIdx = nestedMeta.keys.indexOf(expr.property);
              const tsType = propIdx !== -1 ? nestedMeta.tsTypes?.[propIdx] : undefined;

              if (tsType && !['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]'].includes(tsType)) {
                // Another nested interface
                const nestedInterfaceDef = this.ctx.ast?.interfaces?.find((iface: any) => iface.name === tsType);
                if (nestedInterfaceDef) {
                  const keys = nestedInterfaceDef.fields.map((f: any) => f.name);
                  const tsTypes = nestedInterfaceDef.fields.map((f: any) => f.type);
                  const types = nestedInterfaceDef.fields.map((f: any) => {
                    const t = f.type;
                    if (t === 'string') return 'i8*';
                    if (t === 'number') return 'double';
                    if (t === 'boolean') return 'double';
                    if (t === 'string[]') return '%StringArray*';
                    if (t === 'number[]') return '%Array*';
                    return 'i8*';
                  });
                  this.ctx.jsonObjectMetadata.set(fieldItem, { keys, types, tsTypes });
                }
                this.ctx.variableTypes.set(fieldItem, 'i8*');
                return fieldItem;
              }

              // Extract string or number value
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

              // Track type so comparison code can convert if needed
              this.ctx.variableTypes.set(result, 'i32');

              return result;
            }
          }

          // Check if accessing an object property (variable or literal)
          let objPtr: string;
          let keys: string[];
          let types: string[];

          if (expr.object.type === 'variable' && this.ctx.symbolTable.isJSON(expr.object.name)) {
            // JSON variable - check if it has interface metadata for static access
            const jsonMeta = this.ctx.symbolTable.getObjectInfo(expr.object.name);
            console.error('DEBUG: JSON variable', expr.object.name, 'has metadata?', !!jsonMeta);
            if (jsonMeta) {
              // Has metadata - use static struct access
              keys = jsonMeta.keys;
              types = jsonMeta.types;
              console.error('DEBUG: Set keys=', keys, 'types=', types);
              // Load JSON pointer
              const jsonPtrPtr = this.ctx.getVariableAlloca(expr.object.name)!;
              objPtr = this.ctx.nextTemp();
              this.ctx.emit(`${objPtr} = load i8*, i8** ${jsonPtrPtr}`);
            } else {
              // No metadata - this means it's a primitive or array type literal (number, string, number[], etc.)
              // These don't support property access (except .length for arrays, which is handled elsewhere)
              throw new Error(
                this.ctx.formatCodegenError(
                  `Cannot access property '${expr.property}' on JSON.parse() result without interface metadata.\n` +
                  `If you're parsing an object, define an interface and use JSON.parse<InterfaceName>().\n` +
                  `If you're parsing an array, use bracket notation for element access: arr[0]`
                )
              );
            }
          } else if (expr.object.type === 'variable' && this.ctx.symbolTable.isObject(expr.object.name)) {
            // Object stored in variable
            const objMeta = this.ctx.symbolTable.getObjectInfo(expr.object.name);
            if (!objMeta) {
              // Object registered without metadata - skip to other handlers
              keys = [];
              types = [];
              objPtr = '';
            } else {
              keys = objMeta.keys;
              types = objMeta.types;

              // Load object pointer
              const objPtrPtr = this.ctx.getVariableAlloca(expr.object.name)!;
              objPtr = this.ctx.nextTemp();
              this.ctx.emit(`${objPtr} = load i8*, i8** ${objPtrPtr}`);
            }
          } else if ((expr.object as any).type === 'object') {
            // Object literal - generate it and extract metadata
            const metadata = this.ctx.getObjectMetadata(expr.object as any);
            keys = metadata.keys;
            types = metadata.types;
            objPtr = generateExpressionFn(expr.object, params);
          } else if (expr.object.type === 'method_call') {
            // Check if this is JSON.parse() result
            const methodCall = expr.object as any as MethodCallNode;
            if (methodCall.method === 'parse' &&
                methodCall.object.type === 'variable' &&
                (methodCall.object as any).name === 'JSON') {
              // This is accessing a field on JSON.parse() result
              // Use cJSON_GetObjectItem to extract the field
              this.ctx.syncStateToGenerators();
    
              const jsonObjPtr = generateExpressionFn(expr.object, params);
              const fieldNameStr = this.ctx.stringGen.createStringConstant(expr.property);
    
              // Get the field from JSON object
              const fieldItem = this.ctx.nextTemp();
              this.ctx.emit(`${fieldItem} = call i8* @cJSON_GetObjectItem(i8* ${jsonObjPtr}, i8* ${fieldNameStr})`);
    
              // Check if field exists
              const fieldExists = this.ctx.nextTemp();
              this.ctx.emit(`${fieldExists} = icmp ne i8* ${fieldItem}, null`);
    
              const hasFieldLabel = this.ctx.nextLabel('json_has_field');
              const noFieldLabel = this.ctx.nextLabel('json_no_field');
              const fieldEndLabel = this.ctx.nextLabel('json_field_end');
    
              this.ctx.emit(`br i1 ${fieldExists}, label %${hasFieldLabel}, label %${noFieldLabel}`);
    
              // Field exists: check type and extract value
              this.ctx.emit(`${hasFieldLabel}:`);
    
              // Check if it's a number
              const isNumber = this.ctx.nextTemp();
              this.ctx.emit(`${isNumber} = call i32 @cJSON_IsNumber(i8* ${fieldItem})`);
              const isNumBool = this.ctx.nextTemp();
              this.ctx.emit(`${isNumBool} = icmp ne i32 ${isNumber}, 0`);
    
              const numberLabel = this.ctx.nextLabel('json_number');
              const stringLabel = this.ctx.nextLabel('json_string');
    
              this.ctx.emit(`br i1 ${isNumBool}, label %${numberLabel}, label %${stringLabel}`);
    
              // Number field
              this.ctx.emit(`${numberLabel}:`);
              const numValue = this.ctx.nextTemp();
              this.ctx.emit(`${numValue} = call i32 @cJSON_GetNumberValueAsInt(i8* ${fieldItem})`);
              this.ctx.emit(`br label %${fieldEndLabel}`);
    
              // String field
              this.ctx.emit(`${stringLabel}:`);
              const strValue = this.ctx.nextTemp();
              this.ctx.emit(`${strValue} = call i8* @cJSON_GetStringValue(i8* ${fieldItem})`);
              // Convert i8* to i32 for now (will be cast back when used)
              const strAsInt = this.ctx.nextTemp();
              this.ctx.emit(`${strAsInt} = ptrtoint i8* ${strValue} to i32`);
              this.ctx.emit(`br label %${fieldEndLabel}`);
    
              // Field doesn't exist: return 0
              this.ctx.emit(`${noFieldLabel}:`);
              this.ctx.emit(`br label %${fieldEndLabel}`);
    
              // Merge
              this.ctx.emit(`${fieldEndLabel}:`);
              const result = this.ctx.nextTemp();
              this.ctx.emit(`${result} = phi i32 [ ${numValue}, %${numberLabel} ], [ ${strAsInt}, %${stringLabel} ], [ 0, %${noFieldLabel} ]`);
    
              return result;
            }
    
            // Not a JSON.parse result, fall through
            keys = [];
            types = [];
            objPtr = '';
          } else {
            // Not an object, fall through to .length handling
            keys = [];
            types = [];
            objPtr = '';
          }
    
          // If we have an object, access its property
          if (keys.length > 0 && objPtr) {
            const propIndex = keys.indexOf(expr.property);
            if (propIndex === -1) {
              const objDesc = expr.object.type === 'variable' ? (expr.object as any).name : 'literal';
              throw new Error(`Unknown property: ${expr.property} on object ${objDesc}. Available properties: ${keys.join(', ')}`);
            }
    
            const propType = types[propIndex];
            const structType = `{ ${types.join(', ')} }`;
    
            // Cast generic pointer to typed struct
            const typedPtr = this.ctx.nextTemp();
            this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);
    
            // Get pointer to property field
            const fieldPtr = this.ctx.nextTemp();
            this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`);
    
            // Load property value with correct type
            const value = this.ctx.nextTemp();
            this.ctx.emit(`${value} = load ${propType}, ${propType}* ${fieldPtr}`);
            // Track the type
            this.ctx.variableTypes.set(value, propType);
            return value;
          }

          // Handle .length property
          if (expr.property === 'length') {
            // Check if it's an array
            if (expr.object.type === 'variable' && this.ctx.symbolTable.isNumberArray(expr.object.name)) {
              const arrayPtr = generateExpressionFn(expr.object, params);
              const lenPtr = this.ctx.nextTemp();
              this.ctx.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
              const lenI32 = this.ctx.nextTemp();
              this.ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
              // Convert to double for JavaScript semantics
              const len = this.ctx.nextTemp();
              this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
              this.ctx.variableTypes.set(len, 'double');
              return len;
            } else if (expr.object.type === 'member_access' &&
                       expr.object.object.type === 'variable' &&
                       (expr.object.object as any).name === 'process' &&
                       expr.object.property === 'argv') {
              // Handle process.argv.length - it's a StringArray
              const stringArrayPtr = generateExpressionFn(expr.object, params);
              const lenPtr = this.ctx.nextTemp();
              this.ctx.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${stringArrayPtr}, i32 0, i32 1`);
              const lenI32 = this.ctx.nextTemp();
              this.ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
              const len = this.ctx.nextTemp();
              this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
              this.ctx.variableTypes.set(len, 'double');
              return len;
            } else if (expr.object.type === 'variable' && this.ctx.symbolTable.isStringArray(expr.object.name)) {
              // Check if it's a string array
              const stringArrayPtr = generateExpressionFn(expr.object, params);
              const lenPtr = this.ctx.nextTemp();
              this.ctx.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${stringArrayPtr}, i32 0, i32 1`);
              const lenI32 = this.ctx.nextTemp();
              this.ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
              // Convert to double for JavaScript semantics
              const len = this.ctx.nextTemp();
              this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
              this.ctx.variableTypes.set(len, 'double');
              return len;
            } else if (expr.object.type === 'member_access' &&
                       expr.object.object.type === 'variable' &&
                       this.ctx.symbolTable.isClass(expr.object.object.name)) {
              // Check if it's accessing a class instance field that's an array (parser.field.length)
              const classMeta = this.ctx.symbolTable.getClassInfo(expr.object.object.name)!;
              const fieldInfo = this.ctx.classGen.getFieldInfo(classMeta.className, expr.object.property);
              if (fieldInfo && fieldInfo.type === 'string[]') {
                const stringArrayPtr = generateExpressionFn(expr.object, params);
                const lenPtr = this.ctx.nextTemp();
                this.ctx.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${stringArrayPtr}, i32 0, i32 1`);
                const lenI32 = this.ctx.nextTemp();
                this.ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
                const len = this.ctx.nextTemp();
                this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
                this.ctx.variableTypes.set(len, 'double');
                return len;
              } else if (fieldInfo && (fieldInfo.type === 'number[]' || fieldInfo.type === 'boolean[]')) {
                const arrayPtr = generateExpressionFn(expr.object, params);
                const lenPtr = this.ctx.nextTemp();
                this.ctx.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
                const lenI32 = this.ctx.nextTemp();
                this.ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
                const len = this.ctx.nextTemp();
                this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
                this.ctx.variableTypes.set(len, 'double');
                return len;
              }
              const objPtr = generateExpressionFn(expr.object, params);
              const lenI64 = this.ctx.nextTemp();
              this.ctx.emit(`${lenI64} = call i64 @strlen(i8* ${objPtr})`);
              const lenI32 = this.ctx.nextTemp();
              this.ctx.emit(`${lenI32} = trunc i64 ${lenI64} to i32`);
              const len = this.ctx.nextTemp();
              this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
              this.ctx.variableTypes.set(len, 'double');
              return len;
            } else if (expr.object.type === 'member_access' && expr.object.object.type === 'this') {
              // Check if it's accessing a class field that's a string array
              const className = this.ctx.currentClassName || (this.ctx.classGen as any).currentClassName;
              if (className) {
                const fieldInfo = this.ctx.classGen.getFieldInfo(className, expr.object.property);
                if (fieldInfo && fieldInfo.type === 'string[]') {
                  // It's a string array field - access its length properly
                  const stringArrayPtr = generateExpressionFn(expr.object, params);
                  const lenPtr = this.ctx.nextTemp();
                  this.ctx.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${stringArrayPtr}, i32 0, i32 1`);
                  const lenI32 = this.ctx.nextTemp();
                  this.ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
                  // Convert to double for JavaScript semantics
                  const len = this.ctx.nextTemp();
                  this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
                  this.ctx.variableTypes.set(len, 'double');
                  return len;
                } else if (fieldInfo && (fieldInfo.type === 'number[]' || fieldInfo.type === 'boolean[]')) {
                  // It's a numeric/boolean array field
                  const arrayPtr = generateExpressionFn(expr.object, params);
                  const lenPtr = this.ctx.nextTemp();
                  this.ctx.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
                  const lenI32 = this.ctx.nextTemp();
                  this.ctx.emit(`${lenI32} = load i32, i32* ${lenPtr}`);
                  // Convert to double for JavaScript semantics
                  const len = this.ctx.nextTemp();
                  this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
                  this.ctx.variableTypes.set(len, 'double');
                  return len;
                }
              }
              // Fall through to string length if not an array type
              const objPtr = generateExpressionFn(expr.object, params);
              const lenI64 = this.ctx.nextTemp();
              this.ctx.emit(`${lenI64} = call i64 @strlen(i8* ${objPtr})`);
              const lenI32 = this.ctx.nextTemp();
              this.ctx.emit(`${lenI32} = trunc i64 ${lenI64} to i32`);
              // Convert to double for JavaScript semantics
              const len = this.ctx.nextTemp();
              this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
              this.ctx.variableTypes.set(len, 'double');
              return len;
            } else {
              // String length
              const objPtr = generateExpressionFn(expr.object, params);
              const lenI64 = this.ctx.nextTemp();
              this.ctx.emit(`${lenI64} = call i64 @strlen(i8* ${objPtr})`);
              const lenI32 = this.ctx.nextTemp();
              this.ctx.emit(`${lenI32} = trunc i64 ${lenI64} to i32`);
              // Convert to double for JavaScript semantics
              const len = this.ctx.nextTemp();
              this.ctx.emit(`${len} = sitofp i32 ${lenI32} to double`);
              this.ctx.variableTypes.set(len, 'double');
              return len;
            }
          }
    
          // Handle .size property (for Map and Set)
          if (expr.property === 'size') {
            // Check if it's a Map
            if (expr.object.type === 'variable' && this.ctx.symbolTable.isMap(expr.object.name)) {
              const mapPtr = generateExpressionFn(expr.object, params);
              this.ctx.syncStateToGenerators();
              return this.ctx.mapGen.generateMapSize(mapPtr);
            }
            // Check if it's a Set
            if (expr.object.type === 'variable' && this.ctx.symbolTable.isSet(expr.object.name)) {
              const setPtr = generateExpressionFn(expr.object, params);
              this.ctx.syncStateToGenerators();
              return this.ctx.setGen.generateSetSize(setPtr);
            }
          }

          // Handle Response properties (.status and .ok)
          if (expr.property === 'status' || expr.property === 'ok') {
            if (expr.object.type === 'variable') {
              const varType = this.ctx.variableTypes.get((expr.object as any).name);
              if (varType === '%Response*') {
                // Load the Response pointer
                const varPtr = this.ctx.variables.get((expr.object as any).name);
                const responsePtr = this.ctx.nextTemp();
                this.ctx.emit(`${responsePtr} = load %Response*, %Response** ${varPtr}`);

                this.ctx.syncStateToGenerators();
                if (expr.property === 'status') {
                  return this.ctx.responseGen.generateStatus(responsePtr);
                } else { // ok
                  return this.ctx.responseGen.generateOk(responsePtr);
                }
              }
            }
          }

          // If we reach here, it's an unsupported property access pattern
          if (expr.object.type === 'variable') {
            const varName = (expr.object as any).name;
    
            // Check if this variable is a function parameter
            if (params.includes(varName)) {
              // Try to get type information from TypeScript if available
              if (this.ctx.typeChecker && this.ctx.currentFunction) {
                const typeInfo = this.ctx.typeChecker.getPropertyType(varName, expr.property, this.ctx.currentFunction);
    
                if (typeInfo && typeInfo.properties) {
                  // We have TypeScript type information! Generate proper struct access
                  const properties = Array.from(typeInfo.properties.entries()) as [string, any][];
                  const propInfo = typeInfo.properties.get(expr.property);

                  if (propInfo) {
                    // Build struct type from TypeScript type information
                    const structTypes = properties.map(([_, info]) => info.type);
                    const structType = `{ ${structTypes.join(', ')} }`;
                    const propIndex = properties.findIndex(([name, _]) => name === expr.property);
    
                    // Load parameter (it's an i8* pointer to the object)
                    const paramPtr = this.ctx.getVariableAlloca(varName);
                    if (!paramPtr) {
                      throw new Error(`Parameter ${varName} not found in variables`);
                    }
                    const objPtrI32 = this.ctx.nextTemp();
                    this.ctx.emit(`${objPtrI32} = load i32, i32* ${paramPtr}`);
    
                    // Cast i32 to i8*
                    const objPtr = this.ctx.nextTemp();
                    this.ctx.emit(`${objPtr} = inttoptr i32 ${objPtrI32} to i8*`);
    
                    // Cast to typed struct pointer
                    const typedPtr = this.ctx.nextTemp();
                    this.ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);
    
                    // Get field pointer
                    const fieldPtr = this.ctx.nextTemp();
                    this.ctx.emit(`${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`);
    
                    // Load field value with correct type
                    const value = this.ctx.nextTemp();
                    this.ctx.emit(`${value} = load ${propInfo.type}, ${propInfo.type}* ${fieldPtr}`);
    
                    // Convert to i32 if needed (for compatibility)
                    if (propInfo.type === 'i8*') {
                      // String pointer - keep as is, but need to return as "i32" for now
                      // TODO: Better type system
                      return value;
                    } else {
                      return value;
                    }
                  }
                }
              }
    
              // No TypeScript info available - show helpful error
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
    
          throw new Error(this.ctx.formatCodegenError(`Unknown property: ${expr.property}`));
  }
}
