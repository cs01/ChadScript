import { Expression, Statement, BlockStatement, MemberAccessNode, VariableNode, BinaryNode, InterfaceDeclaration, TypeAliasDeclaration, ForOfStatement, MethodCallNode, InterfaceField } from '../../ast/types.js';
import { IGeneratorContext } from '../infrastructure/generator-context.js';
import { SymbolKind, ObjectArrayMetadata, ObjectMetadata } from '../infrastructure/symbol-table.js';
import type { TypeResolver } from '../infrastructure/type-resolver/index.js';

interface FieldInfo {
  index: number;
  type: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean';
  tsType?: string;
}

// ============================================
// CONTROL FLOW GENERATOR - If/while/loops
// ============================================

export class ControlFlowGenerator {
  // Loop context stack for break/continue
  private loopStack: Array<{ continueLabel: string; breakLabel: string }> = [];

  constructor(private ctx: IGeneratorContext) {}

  // Helper methods delegate to context
  private nextTemp() { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string) { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string) { this.ctx.emit(instruction); }
  private get output() { return this.ctx.output; }
  private get variableTypes() { return this.ctx.variableTypes; }
  private get currentLabel() { return this.ctx.currentLabel; }
  private set currentLabel(label: string) { this.ctx.currentLabel = label; }

  // Helper to convert a value to boolean (i1) for branching
  private convertToBool(value: string): string {
    // Check if value is a double or i32 based on variable types
    const valueType = this.ctx.getVariableType(value);

    if (valueType === 'i1') {
      // Value is already a boolean (i1), use it directly
      return value;
    } else if (valueType === 'double' || (value.includes('.') && !value.startsWith('%'))) {
      // Value is a double, use fcmp
      const condBool = this.nextTemp();
      this.emit(`${condBool} = fcmp one double ${value}, 0.0`);
      return condBool;
    } else {
      // Value is i32 or unknown (assume i32), convert to double then use fcmp
      const condDouble = this.nextTemp();
      this.emit(`${condDouble} = sitofp i32 ${value} to double`);
      const condBool = this.nextTemp();
      this.emit(`${condBool} = fcmp one double ${condDouble}, 0.0`);
      return condBool;
    }
  }

  generateIfStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== 'if') {
      throw new Error('Expected if statement');
    }

    const thenLabel = this.nextLabel('then');
    const elseLabel = this.nextLabel('else');
    const mergeLabel = this.nextLabel('merge');

    const typeGuard = this.detectTypeGuard(stmt.condition);

    const condValue = this.ctx.generateExpression(stmt.condition, params);
    const condBool = this.convertToBool(condValue);

    if (stmt.elseBlock) {
      this.emit(`br i1 ${condBool}, label %${thenLabel}, label %${elseLabel}`);
    } else {
      this.emit(`br i1 ${condBool}, label %${thenLabel}, label %${mergeLabel}`);
    }

    this.emit(`${thenLabel}:`);
    this.currentLabel = thenLabel;

    if (typeGuard) {
      this.ctx.symbolTable.narrowType(typeGuard.varName, typeGuard.narrowedMetadata);
    }

    const thenValue = this.ctx.generateBlock(stmt.thenBlock, params);

    if (typeGuard) {
      this.ctx.symbolTable.restoreType(typeGuard.varName);
    }

    const lastInstruction = this.output[this.output.length - 1]?.trim() || '';
    const thenHasTerminator = lastInstruction.startsWith('ret ') ||
                              lastInstruction.startsWith('br ') ||
                              lastInstruction.startsWith('unreachable') ||
                              lastInstruction.startsWith('switch ');
    let thenEndLabel = thenLabel;
    for (let i = this.output.length - 1; i >= 0; i--) {
      const line = this.output[i].trim();
      if (line.match(/^[a-z_]+[0-9]+:$/)) {
        thenEndLabel = line.slice(0, -1);
        break;
      }
    }
    if (!thenHasTerminator) {
      this.emit(`br label %${mergeLabel}`);
    }

    let elseValue: string | null = null;
    let elseEndLabel = elseLabel;
    let elseHasTerminator = false;
    if (stmt.elseBlock) {
      this.emit(`${elseLabel}:`);
      this.currentLabel = elseLabel;
      elseValue = this.ctx.generateBlock(stmt.elseBlock, params);
      const lastInstruction = this.output[this.output.length - 1]?.trim() || '';
      elseHasTerminator = lastInstruction.startsWith('ret ') ||
                                lastInstruction.startsWith('br ') ||
                                lastInstruction.startsWith('unreachable') ||
                                lastInstruction.startsWith('switch ');
      for (let i = this.output.length - 1; i >= 0; i--) {
        const line = this.output[i].trim();
        if (line.match(/^[a-z_]+[0-9]+:$/)) {
          elseEndLabel = line.slice(0, -1);
          break;
        }
      }
      if (!elseHasTerminator) {
        this.emit(`br label %${mergeLabel}`);
      }
    }

    if (stmt.elseBlock && thenHasTerminator && elseHasTerminator) {
      return '0';
    }

    // Merge point
    this.emit(`${mergeLabel}:`);
    this.currentLabel = mergeLabel;

    return '0';
  }

  private findBranchPosition(label: string): number {
    for (let i = this.output.length - 1; i >= 0; i--) {
      const line = this.output[i].trim();
      if (line.startsWith('br label %') && this.output.slice(0, i).some(l => l.trim() === `${label}:`)) {
        let foundLabel = false;
        for (let j = i - 1; j >= 0; j--) {
          if (this.output[j].trim() === `${label}:`) {
            foundLabel = true;
            break;
          }
          if (this.output[j].trim().match(/^[a-z_]+[0-9]*:$/)) {
            break;
          }
        }
        if (foundLabel) {
          return i;
        }
      }
    }
    return -1;
  }

  generateWhileStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== 'while') {
      throw new Error('Expected while statement');
    }

    // Generate unique labels
    const condLabel = this.nextLabel('while_cond');
    const bodyLabel = this.nextLabel('while_body');
    const endLabel = this.nextLabel('while_end');

    // Jump to condition check
    this.emit(`br label %${condLabel}`);

    // Condition block
    this.emit(`${condLabel}:`);
    const condValue = this.ctx.generateExpression(stmt.condition, params);
    const condBool = this.convertToBool(condValue);
    this.emit(`br i1 ${condBool}, label %${bodyLabel}, label %${endLabel}`);

    // Body block - push loop context for break/continue
    this.emit(`${bodyLabel}:`);
    this.currentLabel = bodyLabel;
    this.loopStack.push({ continueLabel: condLabel, breakLabel: endLabel });
    this.ctx.generateBlock(stmt.body, params);
    this.loopStack.pop();
    // Check if the LAST instruction is a terminator
    const lastInstruction = this.output[this.output.length - 1]?.trim() || '';
    const bodyHasTerminator = lastInstruction.startsWith('ret ') ||
                              lastInstruction.startsWith('br ') ||
                              lastInstruction.startsWith('unreachable') ||
                              lastInstruction.startsWith('switch ');
    if (!bodyHasTerminator) {
      this.emit(`br label %${condLabel}`);
    }

    // End block
    this.emit(`${endLabel}:`);

    return '0';
  }

  generateForStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== 'for') {
      throw new Error('Expected for statement');
    }

    // Generate init if present
    if (stmt.init) {
      if (stmt.init.type === 'variable_declaration') {
        // Handle variable declaration - allocate and store
        if (!stmt.init.value) {
          throw new Error('Variable declaration in for loop must have an initializer');
        }
        const value = this.ctx.generateExpression(stmt.init.value, params);
        const allocaReg = this.nextTemp();
        // Register the variable in the variables map
        this.ctx.defineVariable(stmt.init.name, allocaReg, 'double', SymbolKind.Number, 'local');
        this.emit(`${allocaReg} = alloca double`);
        this.emit(`store double ${value}, double* ${allocaReg}`);
      } else if (stmt.init.type === 'assignment') {
        const value = this.ctx.generateExpression(stmt.init.value, params);
        const allocaReg = this.ctx.getVariableAlloca(stmt.init.name);
        if (!allocaReg) {
          throw new Error(`Variable ${stmt.init.name} not found`);
        }
        const varType = this.ctx.getVariableType(stmt.init.name) || 'double';
        this.emit(`store ${varType} ${value}, ${varType}* ${allocaReg}`);
      }
    }

    // Generate unique labels
    const condLabel = this.nextLabel('for_cond');
    const bodyLabel = this.nextLabel('for_body');
    const updateLabel = this.nextLabel('for_update');
    const endLabel = this.nextLabel('for_end');

    // Jump to condition check
    this.emit(`br label %${condLabel}`);

    // Condition block
    this.emit(`${condLabel}:`);
    if (stmt.condition) {
      const condValue = this.ctx.generateExpression(stmt.condition, params);
      const condBool = this.convertToBool(condValue);
      this.emit(`br i1 ${condBool}, label %${bodyLabel}, label %${endLabel}`);
    } else {
      // No condition means infinite loop
      this.emit(`br label %${bodyLabel}`);
    }

    // Body block - push loop context for break/continue
    this.emit(`${bodyLabel}:`);
    this.currentLabel = bodyLabel;
    this.loopStack.push({ continueLabel: updateLabel, breakLabel: endLabel });
    this.ctx.generateBlock(stmt.body, params);
    this.loopStack.pop();
    // Check if the LAST instruction is a terminator
    const lastInstruction = this.output[this.output.length - 1]?.trim() || '';
    const bodyHasTerminator = lastInstruction.startsWith('ret ') ||
                              lastInstruction.startsWith('br ') ||
                              lastInstruction.startsWith('unreachable') ||
                              lastInstruction.startsWith('switch ');
    if (!bodyHasTerminator) {
      this.emit(`br label %${updateLabel}`);
    }

    // Update block
    this.emit(`${updateLabel}:`);
    if (stmt.update) {
      if (stmt.update.type === 'assignment') {
        const value = this.ctx.generateExpression(stmt.update.value, params);
        const allocaReg = this.ctx.getVariableAlloca(stmt.update.name);
        if (!allocaReg) {
          throw new Error(`Variable ${stmt.update.name} not found in update`);
        }
        const varType = this.ctx.getVariableType(stmt.update.name) || 'double';
        this.emit(`store ${varType} ${value}, ${varType}* ${allocaReg}`);
      } else {
        // It's an expression (like i++)
        this.ctx.generateExpression(stmt.update, params);
      }
    }
    this.emit(`br label %${condLabel}`);

    // End block
    this.emit(`${endLabel}:`);

    return '0';
  }

  generateForOfStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== 'for_of') {
      throw new Error('Expected for...of statement');
    }

    const objectArrayInfo = this.getObjectArrayInfo(stmt.iterable);
    if (objectArrayInfo) {
      return this.generateObjectArrayForOf(stmt, params, objectArrayInfo);
    }

    if (stmt.destructuredNames && stmt.destructuredNames.length === 2 && this.isMapEntriesCall(stmt.iterable)) {
      return this.generateMapEntriesForOf(stmt, params);
    }

    const iterableValue = this.ctx.generateExpression(stmt.iterable, params);

    const isStringArray = this.ctx.isStringArrayExpression(stmt.iterable);
    const arrayType = isStringArray ? '%StringArray' : '%Array';
    const elementType = isStringArray ? 'i8*' : 'double';
    const elementKind = isStringArray ? SymbolKind.String : SymbolKind.Number;

    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${iterableValue}, i32 0, i32 1`);
    const lengthI32 = this.nextTemp();
    this.emit(`${lengthI32} = load i32, i32* ${lenPtr}`);

    const indexAlloca = this.nextTemp();
    this.emit(`${indexAlloca} = alloca i32`);
    this.emit(`store i32 0, i32* ${indexAlloca}`);

    const elemAlloca = this.nextTemp();
    this.emit(`${elemAlloca} = alloca ${elementType}`);

    this.ctx.defineVariable(stmt.variableName, elemAlloca, elementType, elementKind, 'local');

    const condLabel = this.nextLabel('forof_cond');
    const bodyLabel = this.nextLabel('forof_body');
    const updateLabel = this.nextLabel('forof_update');
    const endLabel = this.nextLabel('forof_end');

    // Jump to condition check
    this.emit(`br label %${condLabel}`);

    // Condition block: check if index < length
    this.emit(`${condLabel}:`);
    const currentIndex = this.nextTemp();
    this.emit(`${currentIndex} = load i32, i32* ${indexAlloca}`);
    const condBool = this.nextTemp();
    this.emit(`${condBool} = icmp slt i32 ${currentIndex}, ${lengthI32}`);
    this.emit(`br i1 ${condBool}, label %${bodyLabel}, label %${endLabel}`);

    // Body block
    this.emit(`${bodyLabel}:`);
    this.currentLabel = bodyLabel;

    // Load current element from array
    // Get pointer to the data array
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${iterableValue}, i32 0, i32 0`);
    const dataArray = this.nextTemp();
    if (isStringArray) {
      this.emit(`${dataArray} = load i8**, i8*** ${dataPtr}`);
    } else {
      this.emit(`${dataArray} = load double*, double** ${dataPtr}`);
    }

    // Load the element at current index
    const indexI64 = this.nextTemp();
    this.emit(`${indexI64} = sext i32 ${currentIndex} to i64`);
    const elemPtr = this.nextTemp();
    if (isStringArray) {
      this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataArray}, i64 ${indexI64}`);
    } else {
      this.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataArray}, i64 ${indexI64}`);
    }
    const elemValue = this.nextTemp();
    this.emit(`${elemValue} = load ${elementType}, ${elementType}* ${elemPtr}`);

    // Store in loop variable
    this.emit(`store ${elementType} ${elemValue}, ${elementType}* ${elemAlloca}`);

    // Execute the loop body
    this.loopStack.push({ continueLabel: updateLabel, breakLabel: endLabel });
    this.ctx.generateBlock(stmt.body, params);
    this.loopStack.pop();

    // Check if body has terminator
    const lastInstruction = this.output[this.output.length - 1]?.trim() || '';
    const bodyHasTerminator = lastInstruction.startsWith('ret ') ||
                              lastInstruction.startsWith('br ') ||
                              lastInstruction.startsWith('unreachable') ||
                              lastInstruction.startsWith('switch ');
    if (!bodyHasTerminator) {
      this.emit(`br label %${updateLabel}`);
    }

    // Update block: increment index
    this.emit(`${updateLabel}:`);
    const loadedIndex = this.nextTemp();
    this.emit(`${loadedIndex} = load i32, i32* ${indexAlloca}`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${loadedIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexAlloca}`);
    this.emit(`br label %${condLabel}`);

    // End block
    this.emit(`${endLabel}:`);

    return '0';
  }

  private parseInlineObjectType(typeStr: string): { name: string; type: string }[] | null {
    let str = typeStr.trim();
    if (str.endsWith('[]')) {
      str = str.slice(0, -2).trim();
    }
    if (!str.startsWith('{') || !str.endsWith('}')) {
      return null;
    }
    str = str.slice(1, -1).trim();
    const fields: { name: string; type: string }[] = [];
    const parts = str.split(';');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;
      const colonIdx = part.indexOf(':');
      if (colonIdx === -1) continue;
      const name = part.slice(0, colonIdx).trim();
      const type = part.slice(colonIdx + 1).trim();
      fields.push({ name, type });
    }
    return fields.length > 0 ? fields : null;
  }

  private getObjectArrayInfoFromAST(varName: string, propName: string): ObjectArrayMetadata | null {
    const symbol = this.ctx.symbolTable.lookup(varName);
    if (!symbol || !symbol.objectMetadata) {
      return null;
    }
    const tsTypes = symbol.objectMetadata.tsTypes;
    const keys = symbol.objectMetadata.keys;
    if (!tsTypes || !keys) {
      return null;
    }
    const idx = keys.indexOf(propName);
    if (idx === -1) {
      return null;
    }
    const fieldType = tsTypes[idx];
    if (!fieldType || !fieldType.endsWith('[]')) {
      return null;
    }
    const elementInterface = fieldType.slice(0, -2).trim();
    if (elementInterface.startsWith('{')) {
      const fields = this.parseInlineObjectType(fieldType);
      if (fields) {
        const elementKeys: string[] = [];
        const elementTypes: string[] = [];
        const elementTsTypes: string[] = [];
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i];
          elementKeys.push(f.name);
          elementTsTypes.push(f.type);
          if (f.type === 'string') {
            elementTypes.push('i8*');
          } else if (f.type === 'number') {
            elementTypes.push('double');
          } else if (f.type === 'boolean') {
            elementTypes.push('i32');
          } else {
            elementTypes.push('i8*');
          }
        }
        return {
          elementInterfaceName: '__inline',
          elementKeys,
          elementTypes,
          elementTsTypes
        };
      }
    }
    const iface = this.ctx.getInterfaceFromAST(elementInterface);
    if (iface) {
      const elementKeys: string[] = [];
      const elementTypes: string[] = [];
      const elementTsTypes: string[] = [];
      for (let i = 0; i < iface.fields.length; i++) {
        const f = iface.fields[i];
        elementKeys.push(f.name);
        elementTsTypes.push(f.type);
        if (f.type === 'string') {
          elementTypes.push('i8*');
        } else if (f.type === 'number') {
          elementTypes.push('double');
        } else if (f.type === 'boolean') {
          elementTypes.push('i32');
        } else {
          elementTypes.push('i8*');
        }
      }
      return {
        elementInterfaceName: iface.name,
        elementKeys,
        elementTypes,
        elementTsTypes
      };
    }

    const typeAliasResult = this.ctx.ast?.typeAliases?.find((t: TypeAliasDeclaration) => t.name === elementInterface);
    const typeAlias = typeAliasResult as TypeAliasDeclaration;
    if (typeAliasResult && typeAlias.unionMembers) {
      const commonFieldsResult = this.getUnionCommonFields(typeAlias.unionMembers);
      const commonFields = commonFieldsResult as { keys: string[]; types: string[]; tsTypes: string[] };
      if (commonFields.keys.length > 0) {
        return {
          elementInterfaceName: elementInterface,
          elementKeys: commonFields.keys,
          elementTypes: commonFields.types,
          elementTsTypes: commonFields.tsTypes || commonFields.keys.map(() => 'string')
        };
      }
    }

    return null;
  }

  private getInterfaceFieldType(interfaceName: string, fieldName: string): string | null {
    const iface = this.ctx.getInterfaceFromAST(interfaceName);
    if (!iface) return null;
    for (let i = 0; i < iface.fields.length; i++) {
      const f = iface.fields[i];
      if (f.name === fieldName) {
        return f.type;
      }
    }
    return null;
  }

  private getObjectArrayInfo(iterable: Expression): ObjectArrayMetadata | null {
    if (iterable.type === 'binary') {
      const binaryExpr = iterable as BinaryNode;
      if (binaryExpr.op === '||') {
        const leftInfo = this.getObjectArrayInfo(binaryExpr.left);
        if (leftInfo) {
          return leftInfo;
        }
      }
    }

    if (iterable.type === 'member_access') {
      const memberAccess = iterable as MemberAccessNode;
      if (memberAccess.object.type === 'variable') {
        const varName = (memberAccess.object as VariableNode).name;
        const propName = memberAccess.property;
        const fromAST = this.getObjectArrayInfoFromAST(varName, propName);
        if (fromAST) {
          return fromAST;
        }
        const symbol = this.ctx.symbolTable.lookup(varName);
        if (symbol && symbol.objectMetadata && symbol.objectMetadata.tsTypes) {
          const keys = symbol.objectMetadata.keys;
          const tsTypes = symbol.objectMetadata.tsTypes;
          const idx = keys.indexOf(propName);
          if (idx !== -1) {
            const fieldType = tsTypes[idx];
            if (fieldType && fieldType.endsWith('[]')) {
              const fields = this.parseInlineObjectType(fieldType);
              if (fields) {
                const elementKeys: string[] = [];
                const elementTypes: string[] = [];
                const elementTsTypes: string[] = [];
                for (let i = 0; i < fields.length; i++) {
                  const f = fields[i];
                  elementKeys.push(f.name);
                  elementTsTypes.push(f.type);
                  if (f.type === 'string') {
                    elementTypes.push('i8*');
                  } else if (f.type === 'number') {
                    elementTypes.push('double');
                  } else if (f.type === 'boolean') {
                    elementTypes.push('i32');
                  } else {
                    elementTypes.push('i8*');
                  }
                }
                return {
                  elementInterfaceName: '__inline',
                  elementKeys,
                  elementTypes,
                  elementTsTypes
                };
              }
            }
          }
        }
        const paramTypeInfo = this.getParameterTypeFromAST(varName);
        if (paramTypeInfo) {
          const fieldType = this.getInterfaceFieldType(paramTypeInfo, propName);
          if (fieldType && fieldType.endsWith('[]')) {
            const fields = this.parseInlineObjectType(fieldType);
            if (fields) {
              const elementKeys: string[] = [];
              const elementTypes: string[] = [];
              const elementTsTypes: string[] = [];
              for (let i = 0; i < fields.length; i++) {
                const f = fields[i];
                elementKeys.push(f.name);
                elementTsTypes.push(f.type);
                if (f.type === 'string') {
                  elementTypes.push('i8*');
                } else if (f.type === 'number') {
                  elementTypes.push('double');
                } else if (f.type === 'boolean') {
                  elementTypes.push('i32');
                } else {
                  elementTypes.push('i8*');
                }
              }
              return {
                elementInterfaceName: '__inline',
                elementKeys,
                elementTypes,
                elementTsTypes
              };
            }
            const elementIfaceName = fieldType.slice(0, -2).trim();
            const elemIface = this.ctx.getInterfaceFromAST(elementIfaceName);
            if (elemIface) {
              const elementKeys: string[] = [];
              const elementTypes: string[] = [];
              const elementTsTypes: string[] = [];
              for (let i = 0; i < elemIface.fields.length; i++) {
                const f = elemIface.fields[i];
                elementKeys.push(f.name);
                elementTsTypes.push(f.type);
                if (f.type === 'string') {
                  elementTypes.push('i8*');
                } else if (f.type === 'number') {
                  elementTypes.push('double');
                } else if (f.type === 'boolean') {
                  elementTypes.push('i32');
                } else {
                  elementTypes.push('i8*');
                }
              }
              return {
                elementInterfaceName: elemIface.name,
                elementKeys,
                elementTypes,
                elementTsTypes
              };
            }
          }
        }
      }

      const chainedInfo = this.getChainedMemberAccessArrayInfo(memberAccess);
      if (chainedInfo) {
        return chainedInfo;
      }
    }

    if (iterable.type === 'variable') {
      const varName = (iterable as VariableNode).name;
      const objArrayMeta = this.ctx.symbolTable.getObjectArrayMetadata(varName);
      if (objArrayMeta) {
        return objArrayMeta;
      }
    }

    return null;
  }

  private getChainedMemberAccessArrayInfo(memberAccess: MemberAccessNode): ObjectArrayMetadata | null {
    const propName = memberAccess.property;
    let intermediateTypeName: string | null = null;

    if (memberAccess.object.type === 'member_access') {
      const innerAccess = memberAccess.object as MemberAccessNode;
      if (innerAccess.object.type === 'this') {
        const className = this.ctx.currentClassName;
        if (className) {
          const fieldInfoResult = this.ctx.classGen.getFieldInfo(className, innerAccess.property);
          const fieldInfo = fieldInfoResult as FieldInfo;
          if (fieldInfoResult && fieldInfo.tsType) {
            intermediateTypeName = fieldInfo.tsType;
          }
        }
      } else if (innerAccess.object.type === 'variable') {
        const varName = (innerAccess.object as VariableNode).name;
        if (this.ctx.symbolTable.isClass(varName)) {
          const classMeta = this.ctx.symbolTable.getClassInfo(varName);
          if (classMeta) {
            const fieldInfoResult = this.ctx.classGen.getFieldInfo(classMeta.className, innerAccess.property);
            const fieldInfo = fieldInfoResult as FieldInfo;
            if (fieldInfoResult && fieldInfo.tsType) {
              intermediateTypeName = fieldInfo.tsType;
            }
          }
        }
      }
    }

    if (!intermediateTypeName) {
      return null;
    }

    const iface = this.ctx.getInterfaceFromAST(intermediateTypeName);
    if (!iface) {
      return null;
    }

    const fieldDefResult = iface.fields.find(f => f.name === propName);
    const fieldDef = fieldDefResult as InterfaceField;
    if (!fieldDefResult || !fieldDef.type.endsWith('[]')) {
      return null;
    }

    const elementTypeName = fieldDef.type.slice(0, -2).trim();

    if (elementTypeName.startsWith('{')) {
      const fields = this.parseInlineObjectType(fieldDef.type);
      if (fields) {
        const elementKeys: string[] = [];
        const elementTypes: string[] = [];
        const elementTsTypes: string[] = [];
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i];
          elementKeys.push(f.name);
          elementTsTypes.push(f.type);
          if (f.type === 'string') {
            elementTypes.push('i8*');
          } else if (f.type === 'number') {
            elementTypes.push('double');
          } else if (f.type === 'boolean') {
            elementTypes.push('i32');
          } else {
            elementTypes.push('i8*');
          }
        }
        return {
          elementInterfaceName: '__inline',
          elementKeys,
          elementTypes,
          elementTsTypes
        };
      }
    }

    if (elementTypeName.startsWith('(') && elementTypeName.endsWith(')')) {
      const unionInfo = this.parseUnionTypeCommonProperties(elementTypeName);
      if (unionInfo) {
        return unionInfo;
      }
    }

    const elementIface = this.ctx.getInterfaceFromAST(elementTypeName);
    if (elementIface) {
      const elementKeys: string[] = [];
      const elementTypes: string[] = [];
      const elementTsTypes: string[] = [];
      for (let i = 0; i < elementIface.fields.length; i++) {
        const f = elementIface.fields[i];
        elementKeys.push(f.name);
        elementTsTypes.push(f.type);
        if (f.type === 'string') {
          elementTypes.push('i8*');
        } else if (f.type === 'number') {
          elementTypes.push('double');
        } else if (f.type === 'boolean') {
          elementTypes.push('i32');
        } else {
          elementTypes.push('i8*');
        }
      }
      return {
        elementInterfaceName: elementIface.name,
        elementKeys,
        elementTypes,
        elementTsTypes
      };
    }

    return null;
  }

  private parseUnionTypeCommonProperties(unionType: string): ObjectArrayMetadata | null {
    const inner = unionType.slice(1, -1).trim();
    const members = inner.split('|').map(m => m.trim());
    if (members.length === 0) {
      return null;
    }

    const memberInterfaces: { name: string; fields: { name: string; type: string }[] }[] = [];
    for (let i = 0; i < members.length; i++) {
      const memberName = members[i];
      const iface = this.ctx.getInterfaceFromAST(memberName);
      if (!iface) {
        return null;
      }
      memberInterfaces.push(iface);
    }

    if (memberInterfaces.length === 0) {
      return null;
    }

    const firstFields = new Map<string, string>();
    for (let i = 0; i < memberInterfaces[0].fields.length; i++) {
      const f = memberInterfaces[0].fields[i];
      firstFields.set(f.name, f.type);
    }

    const commonFields: { name: string; type: string }[] = [];
    for (const [fieldName, fieldType] of firstFields) {
      let isCommon = true;
      let resolvedType = fieldType;
      for (let i = 1; i < memberInterfaces.length; i++) {
        const otherIface = memberInterfaces[i];
        const otherFieldResult = otherIface.fields.find(f => f.name === fieldName);
        const otherField = otherFieldResult as InterfaceField;
        if (!otherFieldResult) {
          isCommon = false;
          break;
        }
        if (otherField.type !== fieldType) {
          const bothAreLiteralStrings = this.isStringLiteralType(fieldType) && this.isStringLiteralType(otherField.type);
          const areNullableCompatible = this.areNullableCompatible(fieldType, otherField.type);
          if (bothAreLiteralStrings) {
            resolvedType = 'string';
          } else if (areNullableCompatible) {
            resolvedType = this.getNullableBaseType(fieldType) || this.getNullableBaseType(otherField.type) || fieldType;
          } else {
            isCommon = false;
            break;
          }
        }
      }
      if (isCommon) {
        const normalizedType = this.isStringLiteralType(resolvedType) ? 'string' : resolvedType;
        commonFields.push({ name: fieldName, type: normalizedType });
      }
    }

    if (commonFields.length === 0) {
      return null;
    }

    const elementKeys: string[] = [];
    const elementTypes: string[] = [];
    const elementTsTypes: string[] = [];
    for (let i = 0; i < commonFields.length; i++) {
      const f = commonFields[i];
      elementKeys.push(f.name);
      elementTsTypes.push(f.type);
      if (f.type === 'string') {
        elementTypes.push('i8*');
      } else if (f.type === 'number') {
        elementTypes.push('double');
      } else if (f.type === 'boolean') {
        elementTypes.push('i32');
      } else {
        elementTypes.push('i8*');
      }
    }

    return {
      elementInterfaceName: '__union',
      elementKeys,
      elementTypes,
      elementTsTypes
    };
  }

  private isStringLiteralType(typeStr: string): boolean {
    return typeStr.startsWith("'") && typeStr.endsWith("'");
  }

  private areNullableCompatible(type1: string, type2: string): boolean {
    const base1 = this.getNullableBaseType(type1);
    const base2 = this.getNullableBaseType(type2);
    if (base1 && base2) {
      return base1 === base2;
    }
    if (base1) {
      return base1 === type2;
    }
    if (base2) {
      return type1 === base2;
    }
    return false;
  }

  private getNullableBaseType(typeStr: string): string | null {
    if (typeStr.includes(' | null')) {
      return typeStr.replace(' | null', '').trim();
    }
    if (typeStr.includes('| null')) {
      return typeStr.replace('| null', '').trim();
    }
    return null;
  }

  private getParameterTypeFromAST(paramName: string): string | null {
    if (!this.ctx.ast || !this.ctx.currentFunction) {
      return null;
    }
    for (let i = 0; i < this.ctx.ast.functions.length; i++) {
      const fn = this.ctx.ast.functions[i];
      if (fn.name === this.ctx.currentFunction) {
        if (fn.parameters) {
          for (let j = 0; j < fn.parameters.length; j++) {
            const p = fn.parameters[j];
            if (p.name === paramName && p.type) {
              return p.type;
            }
          }
        }
      }
    }
    for (let i = 0; i < this.ctx.ast.classes.length; i++) {
      const cls = this.ctx.ast.classes[i];
      for (let j = 0; j < cls.methods.length; j++) {
        const method = cls.methods[j];
        if (method.name === this.ctx.currentFunction) {
          if (method.paramTypes) {
            for (let k = 0; k < method.params.length; k++) {
              if (method.params[k] === paramName && method.paramTypes[k]) {
                return method.paramTypes[k];
              }
            }
          }
        }
      }
    }
    return null;
  }

  private generateObjectArrayForOf(stmt: Statement, params: string[], objArrayInfo: ObjectArrayMetadata): string {
    if (stmt.type !== 'for_of') {
      throw new Error('Expected for...of statement');
    }

    const iterableValue = this.ctx.generateExpression(stmt.iterable, params);

    const structTypeFields = objArrayInfo.elementTypes.join(', ');
    const structType = `{ ${structTypeFields} }`;

    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${iterableValue}, i32 0, i32 1`);
    const lengthI32 = this.nextTemp();
    this.emit(`${lengthI32} = load i32, i32* ${lenPtr}`);

    const indexAlloca = this.nextTemp();
    this.emit(`${indexAlloca} = alloca i32`);
    this.emit(`store i32 0, i32* ${indexAlloca}`);

    const elemAlloca = this.nextTemp();
    this.emit(`${elemAlloca} = alloca i8*`);

    this.ctx.defineVariable(stmt.variableName, elemAlloca, 'i8*', SymbolKind.Object, 'local', {
      objectMetadata: {
        keys: objArrayInfo.elementKeys,
        types: objArrayInfo.elementTypes,
        tsTypes: objArrayInfo.elementTsTypes
      }
    });

    const condLabel = this.nextLabel('forof_cond');
    const bodyLabel = this.nextLabel('forof_body');
    const updateLabel = this.nextLabel('forof_update');
    const endLabel = this.nextLabel('forof_end');

    this.emit(`br label %${condLabel}`);

    this.emit(`${condLabel}:`);
    const currentIndex = this.nextTemp();
    this.emit(`${currentIndex} = load i32, i32* ${indexAlloca}`);
    const condBool = this.nextTemp();
    this.emit(`${condBool} = icmp slt i32 ${currentIndex}, ${lengthI32}`);
    this.emit(`br i1 ${condBool}, label %${bodyLabel}, label %${endLabel}`);

    this.emit(`${bodyLabel}:`);
    this.currentLabel = bodyLabel;

    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = getelementptr inbounds %Array, %Array* ${iterableValue}, i32 0, i32 0`);
    const dataArray = this.nextTemp();
    this.emit(`${dataArray} = load double*, double** ${dataPtr}`);

    const elemPtrRaw = this.nextTemp();
    this.emit(`${elemPtrRaw} = bitcast double* ${dataArray} to i8**`);

    const indexI64 = this.nextTemp();
    this.emit(`${indexI64} = sext i32 ${currentIndex} to i64`);
    const elemPtrPtr = this.nextTemp();
    this.emit(`${elemPtrPtr} = getelementptr inbounds i8*, i8** ${elemPtrRaw}, i64 ${indexI64}`);
    const elemValue = this.nextTemp();
    this.emit(`${elemValue} = load i8*, i8** ${elemPtrPtr}`);

    this.emit(`store i8* ${elemValue}, i8** ${elemAlloca}`);

    this.loopStack.push({ continueLabel: updateLabel, breakLabel: endLabel });
    this.ctx.generateBlock(stmt.body, params);
    this.loopStack.pop();

    const lastInstruction = this.output[this.output.length - 1]?.trim() || '';
    const bodyHasTerminator = lastInstruction.startsWith('ret ') ||
                              lastInstruction.startsWith('br ') ||
                              lastInstruction.startsWith('unreachable') ||
                              lastInstruction.startsWith('switch ');
    if (!bodyHasTerminator) {
      this.emit(`br label %${updateLabel}`);
    }

    this.emit(`${updateLabel}:`);
    const loadedIndex = this.nextTemp();
    this.emit(`${loadedIndex} = load i32, i32* ${indexAlloca}`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${loadedIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexAlloca}`);
    this.emit(`br label %${condLabel}`);

    this.emit(`${endLabel}:`);

    return '0';
  }

  generateBreakStatement(): string {
    if (this.loopStack.length === 0) {
      throw new Error('break statement outside of loop');
    }
    const loop = this.loopStack[this.loopStack.length - 1];
    this.emit(`br label %${loop.breakLabel}`);
    return '0';
  }

  generateContinueStatement(): string {
    if (this.loopStack.length === 0) {
      throw new Error('continue statement outside of loop');
    }
    const loop = this.loopStack[this.loopStack.length - 1];
    this.emit(`br label %${loop.continueLabel}`);
    return '0';
  }

  generateThrowStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== 'throw') {
      throw new Error('Expected throw statement');
    }

    // For now, we'll implement throw by calling exit(1)
    // In a full implementation, we'd need exception handling support
    this.emit(`call void @exit(i32 1)`);
    this.emit(`unreachable`);
    return '0';
  }

  generateTryStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== 'try') {
      throw new Error('Expected try statement');
    }

    // For now, we'll just execute the try block and ignore catch/finally
    // Full exception handling would require LLVM's invoke/landingpad support
    this.ctx.generateBlock(stmt.tryBlock, params);

    // If there's a finally block, execute it unconditionally
    if (stmt.finallyBlock) {
      this.ctx.generateBlock(stmt.finallyBlock, params);
    }

    return '0';
  }

  generateLogicalOp(op: string, left: Expression, right: Expression, params: string[]): string {
    // For && and ||, we need short-circuit evaluation
    // We'll use a simpler non-short-circuit version for now (like C's & and |)
    const leftValue = this.ctx.generateExpression(left, params);
    const rightValue = this.ctx.generateExpression(right, params);

    // Convert both to booleans (0 or 1)
    const leftBool = this.convertToBool(leftValue);
    const leftInt = this.nextTemp();
    this.emit(`${leftInt} = zext i1 ${leftBool} to i32`);

    const rightBool = this.convertToBool(rightValue);
    const rightInt = this.nextTemp();
    this.emit(`${rightInt} = zext i1 ${rightBool} to i32`);

    if (op === '&&') {
      // Both must be non-zero (use integer multiply)
      const i32Result = this.nextTemp();
      this.emit(`${i32Result} = mul i32 ${leftInt}, ${rightInt}`);
      // Convert to double for JavaScript semantics
      const result = this.nextTemp();
      this.emit(`${result} = sitofp i32 ${i32Result} to double`);
      this.variableTypes.set(result, 'double');
      return result;
    } else {
      // At least one must be non-zero (add and clamp to 1)
      const sum = this.nextTemp();
      this.emit(`${sum} = add i32 ${leftInt}, ${rightInt}`);
      const cmp = this.nextTemp();
      this.emit(`${cmp} = icmp ne i32 ${sum}, 0`);
      const i32Result = this.nextTemp();
      this.emit(`${i32Result} = zext i1 ${cmp} to i32`);
      // Convert to double for JavaScript semantics
      const result = this.nextTemp();
      this.emit(`${result} = sitofp i32 ${i32Result} to double`);
      this.variableTypes.set(result, 'double');
      return result;
    }
  }

  private getUnionCommonFields(memberNames: string[]): { keys: string[]; types: string[]; tsTypes: string[] } {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.getUnionCommonFields(memberNames);
    }

    const foundInterfaces: InterfaceDeclaration[] = [];
    for (let i = 0; i < memberNames.length; i++) {
      const name = memberNames[i];
      const ifaceResult = this.ctx.ast?.interfaces?.find((iface: InterfaceDeclaration) => iface.name === name);
      const iface = ifaceResult as InterfaceDeclaration;
      if (ifaceResult) {
        foundInterfaces.push(iface);
      }
    }
    const interfaces = foundInterfaces;

    if (interfaces.length === 0) {
      return { keys: [], types: [], tsTypes: [] };
    }

    const firstInterface = interfaces[0] as InterfaceDeclaration;
    const firstFields = firstInterface.fields;
    const commonFields: { name: string; type: string }[] = [];

    for (const field of firstFields) {
      const isCommon = interfaces.every((iface) =>
        iface.fields.some((f) => f.name === field.name && this.areTypesCompatible(f.type, field.type))
      );
      if (isCommon) {
        commonFields.push({ name: field.name, type: this.normalizeType(field.type) });
      }
    }

    return {
      keys: commonFields.map(f => f.name),
      types: commonFields.map(f => this.fieldTypeToLlvm(f.type)),
      tsTypes: commonFields.map(f => f.type)
    };
  }

  private areTypesCompatible(type1: string, type2: string): boolean {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.areTypesCompatible(type1, type2);
    }

    if (type1 === type2) return true;
    const norm1 = this.normalizeType(type1);
    const norm2 = this.normalizeType(type2);
    return norm1 === norm2;
  }

  private normalizeType(type: string): string {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.normalizeType(type);
    }

    if (type.startsWith("'") && type.endsWith("'")) return 'string';
    if (type.startsWith('"') && type.endsWith('"')) return 'string';
    return type;
  }

  private fieldTypeToLlvm(fieldType: string): string {
    if (fieldType === 'string') return 'i8*';
    if (fieldType === 'number') return 'double';
    if (fieldType === 'boolean') return 'i8*';
    if (fieldType.startsWith("'") || fieldType.startsWith('"')) return 'i8*';
    return 'i8*';
  }

  private detectTypeGuard(condition: Expression): { varName: string; narrowedMetadata: { keys: string[]; types: string[]; tsTypes?: string[] } } | null {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.detectTypeGuard(condition);
    }

    if (condition.type !== 'binary') return null;

    const binary = condition as BinaryNode;
    if (binary.op !== '===' && binary.op !== '==' && binary.op !== '!==' && binary.op !== '!=') return null;

    let memberAccess: MemberAccessNode | null = null;
    let literalValue: string | null = null;

    if (binary.left.type === 'member_access' && binary.right.type === 'string') {
      memberAccess = binary.left as MemberAccessNode;
      literalValue = (binary.right as { type: 'string'; value: string }).value;
    } else if (binary.right.type === 'member_access' && binary.left.type === 'string') {
      memberAccess = binary.right as MemberAccessNode;
      literalValue = (binary.left as { type: 'string'; value: string }).value;
    }

    if (!memberAccess || !literalValue) return null;
    if (memberAccess.property !== 'type') return null;
    if (memberAccess.object.type !== 'variable') return null;

    const varName = (memberAccess.object as VariableNode).name;
    const symbol = this.ctx.symbolTable.lookup(varName);
    if (!symbol || !symbol.objectMetadata) return null;

    const interfaceName = this.findInterfaceByDiscriminant(literalValue);
    if (!interfaceName) return null;

    const ifaceResult = this.ctx.ast?.interfaces?.find((i: InterfaceDeclaration) => i.name === interfaceName);
    const iface = ifaceResult as InterfaceDeclaration;
    if (!ifaceResult) return null;

    const keys = iface.fields.map((f) => f.name);
    const types = iface.fields.map((f) => this.fieldTypeToLlvm(f.type));
    const tsTypes = iface.fields.map((f) => f.type);

    if (binary.op === '!==' || binary.op === '!=') {
      return null;
    }

    return {
      varName,
      narrowedMetadata: { keys, types, tsTypes }
    };
  }

  private findInterfaceByDiscriminant(discriminantValue: string): string | null {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.findInterfaceByDiscriminant(discriminantValue);
    }

    if (!this.ctx.ast?.interfaces) return null;

    for (let i = 0; i < this.ctx.ast.interfaces.length; i++) {
      const iface = this.ctx.ast.interfaces[i] as InterfaceDeclaration;
      const match = this.checkDiscriminant(
        iface.name,
        iface.fields,
        discriminantValue
      );
      if (match) return match;
    }
    return null;
  }

  private checkDiscriminant(ifaceName: string, fields: { name: string; type: string }[], discriminantValue: string): string | null {
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i] as { name: string; type: string };
      if (f.name === 'type') {
        const fieldType = f.type;
        if (fieldType === `'${discriminantValue}'` || fieldType === `"${discriminantValue}"`) {
          return ifaceName;
        }
      }
    }
    return null;
  }

  private isMapEntriesCall(expr: Expression): boolean {
    if (expr.type !== 'method_call') return false;
    const methodCall = expr as MethodCallNode;
    if (methodCall.method !== 'entries') return false;

    if (methodCall.object.type === 'variable') {
      const varName = (methodCall.object as VariableNode).name;
      return this.ctx.symbolTable.isMap(varName);
    }

    if (methodCall.object.type === 'member_access') {
      const memberExpr = methodCall.object as MemberAccessNode;
      if (memberExpr.object.type === 'this' && this.ctx.currentClassName) {
        const fieldInfoResult = this.ctx.classGen.getFieldInfo(this.ctx.currentClassName, memberExpr.property);
        const fieldInfo = fieldInfoResult as FieldInfo;
        if (fieldInfoResult && fieldInfo.tsType && fieldInfo.tsType.startsWith('Map<')) {
          return true;
        }
      }
    }

    return false;
  }

  private getMapValueTypeInfo(iterable: Expression): { valueType: string; objectMetadata?: ObjectMetadata } | null {
    if (iterable.type !== 'method_call') return null;
    const methodCall = iterable as MethodCallNode;
    if (methodCall.method !== 'entries') return null;

    let valueType: string | null = null;

    if (methodCall.object.type === 'variable') {
      const varName = (methodCall.object as VariableNode).name;
      const mapMeta = this.ctx.symbolTable.getMapMetadata(varName);
      if (mapMeta) {
        valueType = mapMeta.valueType;
      }
    } else if (methodCall.object.type === 'member_access') {
      const memberExpr = methodCall.object as MemberAccessNode;
      if (memberExpr.object.type === 'this' && this.ctx.currentClassName) {
        const mapTypeInfo = this.ctx.typeResolver?.getClassFieldMapType(
          this.ctx.currentClassName,
          memberExpr.property
        );
        if (mapTypeInfo) {
          valueType = mapTypeInfo.valueType;
        }
      }
    }

    if (!valueType) return null;

    if (valueType === 'string' || valueType === 'number') {
      return { valueType };
    }

    const metadata = this.ctx.typeResolver?.getInterfaceMetadata(valueType);
    if (metadata) {
      return { valueType, objectMetadata: metadata };
    }

    return { valueType };
  }

  private generateMapEntriesForOf(stmt: ForOfStatement, params: string[]): string {
    const [keyName, valueName] = stmt.destructuredNames!;

    const valueTypeInfo = this.getMapValueTypeInfo(stmt.iterable);

    const iterableValue = this.ctx.generateExpression(stmt.iterable, params);

    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${iterableValue}, i32 0, i32 0`);
    const lengthI32 = this.nextTemp();
    this.emit(`${lengthI32} = load i32, i32* ${lenPtr}`);

    const indexAlloca = this.nextTemp();
    this.emit(`${indexAlloca} = alloca i32`);
    this.emit(`store i32 0, i32* ${indexAlloca}`);

    const keyAlloca = this.nextTemp();
    this.emit(`${keyAlloca} = alloca i8*`);
    const valueAlloca = this.nextTemp();
    this.emit(`${valueAlloca} = alloca i8*`);

    this.ctx.defineVariable(keyName, keyAlloca, 'i8*', SymbolKind.String, 'local');

    if (valueTypeInfo?.objectMetadata) {
      this.ctx.defineVariable(valueName, valueAlloca, 'i8*', SymbolKind.Object, 'local', {
        objectMetadata: valueTypeInfo.objectMetadata
      });
    } else {
      this.ctx.defineVariable(valueName, valueAlloca, 'i8*', SymbolKind.String, 'local');
    }

    const condLabel = this.nextLabel('mapof_cond');
    const bodyLabel = this.nextLabel('mapof_body');
    const updateLabel = this.nextLabel('mapof_update');
    const endLabel = this.nextLabel('mapof_end');

    this.emit(`br label %${condLabel}`);

    this.emit(`${condLabel}:`);
    const currentIndex = this.nextTemp();
    this.emit(`${currentIndex} = load i32, i32* ${indexAlloca}`);
    const condBool = this.nextTemp();
    this.emit(`${condBool} = icmp slt i32 ${currentIndex}, ${lengthI32}`);
    this.emit(`br i1 ${condBool}, label %${bodyLabel}, label %${endLabel}`);

    this.emit(`${bodyLabel}:`);
    this.currentLabel = bodyLabel;

    const dataFieldPtr = this.nextTemp();
    this.emit(`${dataFieldPtr} = getelementptr inbounds %Array, %Array* ${iterableValue}, i32 0, i32 2`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load double*, double** ${dataFieldPtr}`);
    const dataCast = this.nextTemp();
    this.emit(`${dataCast} = bitcast double* ${dataPtr} to i8**`);

    const indexI64 = this.nextTemp();
    this.emit(`${indexI64} = sext i32 ${currentIndex} to i64`);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataCast}, i64 ${indexI64}`);
    const entryRaw = this.nextTemp();
    this.emit(`${entryRaw} = load i8*, i8** ${elemPtr}`);

    const entryPtr = this.nextTemp();
    this.emit(`${entryPtr} = bitcast i8* ${entryRaw} to { i8*, i8* }*`);

    const keySlotPtr = this.nextTemp();
    this.emit(`${keySlotPtr} = getelementptr inbounds { i8*, i8* }, { i8*, i8* }* ${entryPtr}, i32 0, i32 0`);
    const keyVal = this.nextTemp();
    this.emit(`${keyVal} = load i8*, i8** ${keySlotPtr}`);
    this.emit(`store i8* ${keyVal}, i8** ${keyAlloca}`);

    const valueSlotPtr = this.nextTemp();
    this.emit(`${valueSlotPtr} = getelementptr inbounds { i8*, i8* }, { i8*, i8* }* ${entryPtr}, i32 0, i32 1`);
    const valueVal = this.nextTemp();
    this.emit(`${valueVal} = load i8*, i8** ${valueSlotPtr}`);
    this.emit(`store i8* ${valueVal}, i8** ${valueAlloca}`);

    this.loopStack.push({ continueLabel: updateLabel, breakLabel: endLabel });
    this.ctx.generateBlock(stmt.body, params);
    this.loopStack.pop();

    const lastInstruction = this.output[this.output.length - 1]?.trim() || '';
    const bodyHasTerminator = lastInstruction.startsWith('ret ') ||
                              lastInstruction.startsWith('br ') ||
                              lastInstruction.startsWith('unreachable') ||
                              lastInstruction.startsWith('switch ');
    if (!bodyHasTerminator) {
      this.emit(`br label %${updateLabel}`);
    }

    this.emit(`${updateLabel}:`);
    const loadedIndex = this.nextTemp();
    this.emit(`${loadedIndex} = load i32, i32* ${indexAlloca}`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${loadedIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexAlloca}`);
    this.emit(`br label %${condLabel}`);

    this.emit(`${endLabel}:`);

    return '0';
  }
}
