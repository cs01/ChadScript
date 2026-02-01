import { Expression, Statement, BlockStatement, MemberAccessNode, VariableNode } from '../../ast/types.js';
import { IGeneratorContext } from '../infrastructure/generator-context.js';
import { SymbolKind, ObjectArrayMetadata } from '../infrastructure/symbol-table.js';

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

    // Generate unique labels
    const thenLabel = this.nextLabel('then');
    const elseLabel = this.nextLabel('else');
    const mergeLabel = this.nextLabel('merge');

    // Evaluate condition
    const condValue = this.ctx.generateExpression(stmt.condition, params);

    // Convert to boolean for branching
    const condBool = this.convertToBool(condValue);

    // Branch based on condition
    if (stmt.elseBlock) {
      this.emit(`br i1 ${condBool}, label %${thenLabel}, label %${elseLabel}`);
    } else {
      this.emit(`br i1 ${condBool}, label %${thenLabel}, label %${mergeLabel}`);
    }

    // Generate then block
    this.emit(`${thenLabel}:`);
    this.currentLabel = thenLabel;
    const thenValue = this.ctx.generateBlock(stmt.thenBlock, params);
    // Check if the LAST instruction is a terminator
    const lastInstruction = this.output[this.output.length - 1]?.trim() || '';
    const thenHasTerminator = lastInstruction.startsWith('ret ') ||
                              lastInstruction.startsWith('br ') ||
                              lastInstruction.startsWith('unreachable') ||
                              lastInstruction.startsWith('switch ');
    // Find the actual last label by scanning backwards in the output
    let thenEndLabel = thenLabel;
    for (let i = this.output.length - 1; i >= 0; i--) {
      const line = this.output[i].trim();
      if (line.match(/^[a-z_]+[0-9]+:$/)) {
        thenEndLabel = line.slice(0, -1); // Remove the trailing ':'
        break;
      }
    }
    if (!thenHasTerminator) {
      this.emit(`br label %${mergeLabel}`);
    }

    // Generate else block if it exists
    let elseValue: string | null = null;
    let elseEndLabel = elseLabel;
    let elseHasTerminator = false;
    if (stmt.elseBlock) {
      this.emit(`${elseLabel}:`);
      this.currentLabel = elseLabel;
      elseValue = this.ctx.generateBlock(stmt.elseBlock, params);
      // Check if the LAST instruction is a terminator
      const lastInstruction = this.output[this.output.length - 1]?.trim() || '';
      elseHasTerminator = lastInstruction.startsWith('ret ') ||
                                lastInstruction.startsWith('br ') ||
                                lastInstruction.startsWith('unreachable') ||
                                lastInstruction.startsWith('switch ');
      // Find the actual last label by scanning backwards in the output
      for (let i = this.output.length - 1; i >= 0; i--) {
        const line = this.output[i].trim();
        if (line.match(/^[a-z_]+[0-9]+:$/)) {
          elseEndLabel = line.slice(0, -1); // Remove the trailing ':'
          break;
        }
      }
      if (!elseHasTerminator) {
        this.emit(`br label %${mergeLabel}`);
      }
    }

    // Skip merge point if both branches have terminators (unreachable code)
    if (stmt.elseBlock && thenHasTerminator && elseHasTerminator) {
      // Both branches return/terminate, no merge point needed
      // Return a default value (we won't use it anyway)
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
    if (iterable.type === 'member_access') {
      const memberAccess = iterable as MemberAccessNode;
      if (memberAccess.object.type === 'variable') {
        const varName = (memberAccess.object as VariableNode).name;
        const propName = memberAccess.property;
        if (this.ctx.typeChecker && this.ctx.currentFunction) {
          const arrayInfo = this.ctx.typeChecker.getArrayElementInterface(varName, propName, this.ctx.currentFunction);
          if (arrayInfo && arrayInfo.properties.length > 0) {
            const elementKeys: string[] = [];
            const elementTypes: string[] = [];
            const elementTsTypes: string[] = [];
            for (let i = 0; i < arrayInfo.properties.length; i++) {
              const prop = arrayInfo.properties[i];
              elementKeys.push(prop.name);
              elementTsTypes.push(prop.type);
              if (prop.type === 'string') {
                elementTypes.push('i8*');
              } else if (prop.type === 'number') {
                elementTypes.push('double');
              } else if (prop.type === 'boolean') {
                elementTypes.push('i32');
              } else {
                elementTypes.push('i8*');
              }
            }
            return {
              elementInterfaceName: arrayInfo.interfaceName,
              elementKeys,
              elementTypes,
              elementTsTypes
            };
          }
        }
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
    }

    if (iterable.type === 'variable') {
      const varName = (iterable as VariableNode).name;
      const objArrayMeta = this.ctx.symbolTable.getObjectArrayMetadata(varName);
      if (objArrayMeta) {
        return objArrayMeta;
      }
      if (this.ctx.typeChecker && this.ctx.currentFunction) {
        const arrayInfo = this.ctx.typeChecker.getVariableArrayElementInterface(varName, this.ctx.currentFunction);
        if (arrayInfo && arrayInfo.properties.length > 0) {
          const elementKeys: string[] = [];
          const elementTypes: string[] = [];
          const elementTsTypes: string[] = [];
          for (let i = 0; i < arrayInfo.properties.length; i++) {
            const prop = arrayInfo.properties[i];
            elementKeys.push(prop.name);
            elementTsTypes.push(prop.type);
            if (prop.type === 'string') {
              elementTypes.push('i8*');
            } else if (prop.type === 'number') {
              elementTypes.push('double');
            } else if (prop.type === 'boolean') {
              elementTypes.push('i32');
            } else {
              elementTypes.push('i8*');
            }
          }
          return {
            elementInterfaceName: arrayInfo.interfaceName,
            elementKeys,
            elementTypes,
            elementTsTypes
          };
        }
      }
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
}
