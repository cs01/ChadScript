import { Expression, Statement, BlockStatement, MemberAccessNode, VariableNode, BinaryNode, InterfaceDeclaration, ForOfStatement, MethodCallNode, InterfaceField, CommonField, FunctionParameter, SwitchStatement, SwitchCase } from '../../ast/types.js';
import { IGeneratorContext } from '../infrastructure/generator-context.js';
import { SymbolKind, ObjectArrayMetadata, ObjectMetadata } from '../infrastructure/symbol-table.js';
import type { UnionCommonFields } from '../infrastructure/type-resolver/index.js';
import { stripOptional } from '../infrastructure/type-system.js';

interface ExprBase { type: string; }

// ============================================
// CONTROL FLOW GENERATOR - If/while/loops
// ============================================

export class ControlFlowGenerator {
  // Loop context stack for break/continue
  private loopStack: Array<{ continueLabel: string; breakLabel: string }> = [];

  constructor(private ctx: IGeneratorContext) {}

  // Helper methods delegate to context
  private nextTemp(): string { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string): string { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string): void { this.ctx.emit(instruction); }

  // Helper to convert a value to boolean (i1) for branching
  private convertToBool(value: string): string {
    // Check if value is a double or i32 based on variable types
    const valueType = this.ctx.getVariableType(value);

    if (valueType === 'i1') {
      // Value is already a boolean (i1), use it directly
      return value;
    } else if (valueType === 'double' || (value.indexOf('.') !== -1 && !value.startsWith('%'))) {
      // Value is a double, use fcmp
      const condBool = this.nextTemp();
      this.emit(`${condBool} = fcmp one double ${value}, 0.0`);
      return condBool;
    } else if (valueType && valueType.indexOf('*') !== -1) {
      // Value is a pointer type, check if non-null
      const condBool = this.nextTemp();
      this.emit(`${condBool} = icmp ne ${valueType} ${value}, null`);
      return condBool;
    } else if (valueType === 'i32') {
      // Value is i32, use icmp ne for integer comparison
      const condBool = this.nextTemp();
      this.emit(`${condBool} = icmp ne i32 ${value}, 0`);
      return condBool;
    } else {
      // Unknown type - assume double for temp registers
      if (value.startsWith('%')) {
        const condBool = this.nextTemp();
        this.emit(`${condBool} = fcmp one double ${value}, 0.0`);
        return condBool;
      }
      // Literal i32 value - convert to double then compare
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

    const ifStmt = stmt as { type: string; condition: Expression; thenBlock: BlockStatement; elseBlock: BlockStatement | null };

    const thenLabel = this.nextLabel('then');
    const elseLabel = this.nextLabel('else');
    const mergeLabel = this.nextLabel('merge');

    const typeGuard = this.detectTypeGuard(ifStmt.condition);

    const condValue = this.ctx.generateExpression(ifStmt.condition, params);
    const condBool = this.convertToBool(condValue);

    if (ifStmt.elseBlock) {
      this.emit(`br i1 ${condBool}, label %${thenLabel}, label %${elseLabel}`);
    } else {
      this.emit(`br i1 ${condBool}, label %${thenLabel}, label %${mergeLabel}`);
    }

    this.emit(`${thenLabel}:`);
    this.ctx.currentLabel = thenLabel;

    if (typeGuard) {
      const tg = typeGuard as { varName: string; narrowedMetadata: { keys: string[]; types: string[]; tsTypes?: string[] } };
      this.ctx.symbolTable.narrowType(tg.varName, tg.narrowedMetadata);
    }

    this.ctx.generateBlock(ifStmt.thenBlock, params);

    if (typeGuard) {
      const tg = typeGuard as { varName: string; narrowedMetadata: { keys: string[]; types: string[]; tsTypes?: string[] } };
      this.ctx.symbolTable.restoreType(tg.varName);
    }

    const lastInstruction = this.ctx.output[this.ctx.output.length - 1]?.trim() || '';
    const thenHasTerminator = lastInstruction.startsWith('ret ') ||
                              lastInstruction.startsWith('br ') ||
                              lastInstruction.startsWith('unreachable') ||
                              lastInstruction.startsWith('switch ');
    if (!thenHasTerminator) {
      this.emit(`br label %${mergeLabel}`);
    }

    let elseHasTerminator = false;
    if (ifStmt.elseBlock) {
      this.emit(`${elseLabel}:`);
      this.ctx.currentLabel = elseLabel;
      this.ctx.generateBlock(ifStmt.elseBlock, params);
      const lastInstruction = this.ctx.output[this.ctx.output.length - 1]?.trim() || '';
      elseHasTerminator = lastInstruction.startsWith('ret ') ||
                                lastInstruction.startsWith('br ') ||
                                lastInstruction.startsWith('unreachable') ||
                                lastInstruction.startsWith('switch ');
      if (!elseHasTerminator) {
        this.emit(`br label %${mergeLabel}`);
      }
    }

    if (ifStmt.elseBlock && thenHasTerminator && elseHasTerminator) {
      return '0';
    }

    // Merge point
    this.emit(`${mergeLabel}:`);
    this.ctx.currentLabel = mergeLabel;

    return '0';
  }

  generateWhileStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== 'while') {
      throw new Error('Expected while statement');
    }

    const whileStmt = stmt as { type: string; condition: Expression; body: BlockStatement };

    // Generate unique labels
    const condLabel = this.nextLabel('while_cond');
    const bodyLabel = this.nextLabel('while_body');
    const endLabel = this.nextLabel('while_end');

    // Jump to condition check
    this.emit(`br label %${condLabel}`);

    // Condition block
    this.emit(`${condLabel}:`);
    const condValue = this.ctx.generateExpression(whileStmt.condition, params);
    const condBool = this.convertToBool(condValue);
    this.emit(`br i1 ${condBool}, label %${bodyLabel}, label %${endLabel}`);

    // Body block - push loop context for break/continue
    this.emit(`${bodyLabel}:`);
    this.ctx.currentLabel = bodyLabel;
    this.loopStack.push({ continueLabel: condLabel, breakLabel: endLabel });
    this.ctx.generateBlock(whileStmt.body, params);
    this.loopStack.pop();
    // Check if the LAST instruction is a terminator
    const lastInstruction = this.ctx.output[this.ctx.output.length - 1]?.trim() || '';
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

    const forStmt = stmt as { type: string; init: Statement | null; condition: Expression | null; update: Statement | null; body: BlockStatement };

    // Generate init if present
    if (forStmt.init) {
      const initTyped = forStmt.init as { type: string; name: string; value: Expression | null };
      if (initTyped.type === 'variable_declaration') {
        // Handle variable declaration - allocate and store
        if (!initTyped.value) {
          throw new Error('Variable declaration in for loop must have an initializer');
        }
        const value = this.ctx.generateExpression(initTyped.value, params);
        const allocaReg = this.nextTemp();
        // Register the variable in the variables map
        this.ctx.defineVariable(initTyped.name, allocaReg, 'double', SymbolKind.Number, 'local');
        this.emit(`${allocaReg} = alloca double`);
        this.emit(`store double ${value}, double* ${allocaReg}`);
      } else if (initTyped.type === 'assignment') {
        const initAssign = forStmt.init as { type: string; name: string; value: Expression };
        const value = this.ctx.generateExpression(initAssign.value, params);
        const allocaReg = this.ctx.getVariableAlloca(initAssign.name);
        if (!allocaReg) {
          throw new Error(`Variable ${initAssign.name} not found`);
        }
        const varType = this.ctx.getVariableType(initAssign.name) || 'double';
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
    if (forStmt.condition) {
      const condValue = this.ctx.generateExpression(forStmt.condition, params);
      const condBool = this.convertToBool(condValue);
      this.emit(`br i1 ${condBool}, label %${bodyLabel}, label %${endLabel}`);
    } else {
      // No condition means infinite loop
      this.emit(`br label %${bodyLabel}`);
    }

    // Body block - push loop context for break/continue
    this.emit(`${bodyLabel}:`);
    this.ctx.currentLabel = bodyLabel;
    this.loopStack.push({ continueLabel: updateLabel, breakLabel: endLabel });
    this.ctx.generateBlock(forStmt.body, params);
    this.loopStack.pop();
    // Check if the LAST instruction is a terminator
    const lastInstruction = this.ctx.output[this.ctx.output.length - 1]?.trim() || '';
    const bodyHasTerminator = lastInstruction.startsWith('ret ') ||
                              lastInstruction.startsWith('br ') ||
                              lastInstruction.startsWith('unreachable') ||
                              lastInstruction.startsWith('switch ');
    if (!bodyHasTerminator) {
      this.emit(`br label %${updateLabel}`);
    }

    // Update block
    this.emit(`${updateLabel}:`);
    if (forStmt.update) {
      const updateTyped = forStmt.update as { type: string; name: string; value: Expression };
      if (updateTyped.type === 'assignment') {
        const value = this.ctx.generateExpression(updateTyped.value, params);
        const allocaReg = this.ctx.getVariableAlloca(updateTyped.name);
        if (!allocaReg) {
          throw new Error(`Variable ${updateTyped.name} not found in update`);
        }
        const varType = this.ctx.getVariableType(updateTyped.name) || 'double';
        this.emit(`store ${varType} ${value}, ${varType}* ${allocaReg}`);
      } else {
        // It's an expression (like i++)
        this.ctx.generateExpression(forStmt.update as Expression, params);
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

    const forOfStmt = stmt as { type: string; variableName: string; iterable: Expression; body: BlockStatement; destructuredNames: string[] | null };

    const objectArrayInfo = this.getObjectArrayInfo(forOfStmt.iterable);
    if (objectArrayInfo) {
      return this.generateObjectArrayForOf(stmt, params, objectArrayInfo);
    }

    if (forOfStmt.destructuredNames && forOfStmt.destructuredNames.length === 2 && this.isMapEntriesCall(forOfStmt.iterable)) {
      return this.generateMapEntriesForOf(stmt, params);
    }

    const iterableValue = this.ctx.generateExpression(forOfStmt.iterable, params);

    const isStringArray = this.ctx.isStringArrayExpression(forOfStmt.iterable);
    const isObjectArray = !isStringArray && this.ctx.isObjectArrayExpression(forOfStmt.iterable);
    const isStringSet = this.isStringSetExpression(forOfStmt.iterable);
    let arrayType: string;
    let elementType: string;
    let elementKind: SymbolKind;

    if (isStringSet) {
      arrayType = '%StringSet';
      elementType = 'i8*';
      elementKind = SymbolKind.String;
    } else if (isStringArray) {
      arrayType = '%StringArray';
      elementType = 'i8*';
      elementKind = SymbolKind.String;
    } else if (isObjectArray) {
      arrayType = '%Array';
      elementType = 'i8*';
      elementKind = SymbolKind.Object;
    } else {
      arrayType = '%Array';
      elementType = 'double';
      elementKind = SymbolKind.Number;
    }

    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${iterableValue}, i32 0, i32 1`);
    const lengthI32 = this.nextTemp();
    this.emit(`${lengthI32} = load i32, i32* ${lenPtr}`);

    const indexAlloca = this.nextTemp();
    this.emit(`${indexAlloca} = alloca i32`);
    this.emit(`store i32 0, i32* ${indexAlloca}`);

    const elemAlloca = this.nextTemp();
    this.emit(`${elemAlloca} = alloca ${elementType}`);

    this.ctx.defineVariable(forOfStmt.variableName, elemAlloca, elementType, elementKind, 'local');

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
    this.ctx.currentLabel = bodyLabel;

    // Load current element from array
    // Get pointer to the data array
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${iterableValue}, i32 0, i32 0`);
    let dataArray: string;
    if (isStringSet || isStringArray) {
      dataArray = this.nextTemp();
      this.emit(`${dataArray} = load i8**, i8*** ${dataPtr}`);
    } else if (isObjectArray) {
      const dataDouble = this.nextTemp();
      this.emit(`${dataDouble} = load double*, double** ${dataPtr}`);
      dataArray = this.nextTemp();
      this.emit(`${dataArray} = bitcast double* ${dataDouble} to i8**`);
    } else {
      dataArray = this.nextTemp();
      this.emit(`${dataArray} = load double*, double** ${dataPtr}`);
    }

    // Load the element at current index
    const indexI64 = this.nextTemp();
    this.emit(`${indexI64} = sext i32 ${currentIndex} to i64`);
    const elemPtr = this.nextTemp();
    if (isStringSet || isStringArray || isObjectArray) {
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
    this.ctx.generateBlock(forOfStmt.body, params);
    this.loopStack.pop();

    // Check if body has terminator
    const lastInstruction = this.ctx.output[this.ctx.output.length - 1]?.trim() || '';
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
    const objMeta = symbol.objectMetadata;
    const tsTypes = objMeta.tsTypes;
    const keys = objMeta.keys;
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
          const f = fields[i] as { name: string; type: string };
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
      const ifaceTyped = iface as { name: string; fields: { name: string; type: string }[] };
      const elementKeys: string[] = [];
      const elementTypes: string[] = [];
      const elementTsTypes: string[] = [];
      for (let i = 0; i < ifaceTyped.fields.length; i++) {
        const f = ifaceTyped.fields[i] as { name: string; type: string };
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
        elementInterfaceName: ifaceTyped.name,
        elementKeys,
        elementTypes,
        elementTsTypes
      };
    }

    let typeAlias: { name: string; unionMembers: string[] } | null = null;
    const typeAliases = this.ctx.ast?.typeAliases || [];
    for (let i = 0; i < typeAliases.length; i++) {
      const ta = typeAliases[i] as { name: string; unionMembers: string[] };
      if (ta.name === elementInterface) {
        typeAlias = ta;
        break;
      }
    }
    if (typeAlias) {
      const typeAliasTyped = typeAlias as { name: string; unionMembers: string[] };
      if (typeAliasTyped.unionMembers) {
        const commonFieldsResult = this.getUnionCommonFields(typeAliasTyped.unionMembers);
        const commonFields = commonFieldsResult as UnionCommonFields;
        if (commonFields.keys.length > 0) {
          return {
            elementInterfaceName: elementInterface,
            elementKeys: commonFields.keys,
            elementTypes: commonFields.types,
            elementTsTypes: commonFields.tsTypes || commonFields.keys.map(() => 'string')
          };
        }
      }
    }

    return null;
  }

  private getInterfaceFieldType(interfaceName: string, fieldName: string): string | null {
    const iface = this.ctx.getInterfaceFromAST(interfaceName);
    if (!iface) return null;
    const ifaceTyped = iface as { name: string; fields: { name: string; type: string }[] };
    for (let i = 0; i < ifaceTyped.fields.length; i++) {
      const f = ifaceTyped.fields[i] as { name: string; type: string };
      if (f.name === fieldName) {
        return f.type;
      }
    }
    return null;
  }

  private getInterfaceDecl(name: string): InterfaceDeclaration | null {
    if (!this.ctx.ast?.interfaces) return null;
    for (let i = 0; i < this.ctx.ast.interfaces.length; i++) {
      const iface = this.ctx.ast.interfaces[i] as InterfaceDeclaration;
      if (iface.name === name) {
        return iface;
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
      const memberAccess = iterable as { type: string; object: Expression; property: string };
      const memberAccessObjBase = memberAccess.object as ExprBase;
      if (memberAccessObjBase.type === 'variable') {
        const varName = (memberAccess.object as VariableNode).name;
        const propName = memberAccess.property;
        const fromAST = this.getObjectArrayInfoFromAST(varName, propName);
        if (fromAST) {
          return fromAST;
        }
        const symbol = this.ctx.symbolTable.lookup(varName);
        if (symbol && symbol.objectMetadata && symbol.objectMetadata.tsTypes) {
          const objMeta = symbol.objectMetadata;
          const keys = objMeta.keys;
          const tsTypes = objMeta.tsTypes!;
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
                  const f = fields[i] as { name: string; type: string };
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
                const f = fields[i] as { name: string; type: string };
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
              const elemIfaceTyped = elemIface as { name: string; fields: Array<{ name: string; type: string }> };
              const elementKeys: string[] = [];
              const elementTypes: string[] = [];
              const elementTsTypes: string[] = [];
              for (let i = 0; i < elemIfaceTyped.fields.length; i++) {
                const f = elemIfaceTyped.fields[i] as { name: string; type: string };
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
                elementInterfaceName: elemIfaceTyped.name,
                elementKeys,
                elementTypes,
                elementTsTypes
              };
            }
          }
        }
      }

      const chainedInfo = this.getChainedMemberAccessArrayInfo(iterable as MemberAccessNode);
      if (chainedInfo) {
        return chainedInfo;
      }
    }

    if (iterable.type === 'method_call') {
      const methodCallInfo = this.getMethodCallArrayInfo(iterable as MethodCallNode);
      if (methodCallInfo) {
        return methodCallInfo;
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

  private resolveMemberAccessChainType(expr: Expression): string | null {
    const exprBase = expr as ExprBase;

    if (exprBase.type === 'this') {
      return this.ctx.currentClassName || null;
    }

    if (exprBase.type === 'variable') {
      const varName = (expr as VariableNode).name;
      if (this.ctx.symbolTable.isClass(varName)) {
        const classMeta = this.ctx.symbolTable.getClassInfo(varName);
        return classMeta ? classMeta.className : null;
      }
      const interfaceType = this.ctx.symbolTable.getInterfaceType(varName);
      if (interfaceType) {
        return interfaceType;
      }
      return null;
    }

    if (exprBase.type === 'member_access') {
      const ma = expr as MemberAccessNode;
      const baseType = this.resolveMemberAccessChainType(ma.object);
      if (!baseType) return null;

      const fieldInfo = this.ctx.classGen?.getFieldInfo(baseType, ma.property);
      if (fieldInfo && fieldInfo.tsType) {
        return fieldInfo.tsType;
      }

      const iface = this.ctx.getInterfaceFromAST(baseType);
      if (iface) {
        const ifaceTyped = iface as { fields: { name: string; type: string }[] };
        for (let i = 0; i < ifaceTyped.fields.length; i++) {
          const f = ifaceTyped.fields[i] as { name: string; type: string };
          const fieldName = f.name.replace('?', '');
          if (fieldName === ma.property) {
            return f.type;
          }
        }
      }
    }

    return null;
  }

  private getChainedMemberAccessArrayInfo(memberAccess: MemberAccessNode): ObjectArrayMetadata | null {
    const ma = memberAccess as { type: string; object: Expression; property: string };
    const propName = ma.property;

    const baseTypeName = this.resolveMemberAccessChainType(ma.object);
    if (!baseTypeName) {
      return null;
    }

    const iface = this.ctx.getInterfaceFromAST(baseTypeName);
    if (!iface) {
      return null;
    }
    const ifaceTyped = iface as { name: string; fields: { name: string; type: string }[] };

    let fieldDefResult: InterfaceField | null = null;
    for (let i = 0; i < ifaceTyped.fields.length; i++) {
      const f = ifaceTyped.fields[i] as { name: string; type: string };
      const fieldName = f.name.replace('?', '');
      if (fieldName === propName) {
        fieldDefResult = f as { name: string; type: string };
        break;
      }
    }
    const fieldDef = fieldDefResult as { name: string; type: string };
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
          const f = fields[i] as { name: string; type: string };
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

    const typeAliasInfo = this.resolveTypeAliasUnion(elementTypeName);
    if (typeAliasInfo) {
      return typeAliasInfo;
    }

    const elementIface = this.ctx.getInterfaceFromAST(elementTypeName);
    if (elementIface) {
      const elementIfaceTyped = elementIface as { name: string; fields: { name: string; type: string }[] };
      const elementKeys: string[] = [];
      const elementTypes: string[] = [];
      const elementTsTypes: string[] = [];
      for (let i = 0; i < elementIfaceTyped.fields.length; i++) {
        const f = elementIfaceTyped.fields[i] as { name: string; type: string };
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
        elementInterfaceName: elementIfaceTyped.name,
        elementKeys,
        elementTypes,
        elementTsTypes
      };
    }

    return null;
  }

  private getMethodCallArrayInfo(methodCall: MethodCallNode): ObjectArrayMetadata | null {
    const objType = this.resolveMemberAccessChainType(methodCall.object);
    if (!objType) {
      return null;
    }

    const returnType = this.getMethodReturnType(objType, methodCall.method);
    if (!returnType || !returnType.endsWith('[]')) {
      return null;
    }

    const elementTypeName = returnType.slice(0, -2).trim();

    if (elementTypeName.startsWith('{')) {
      const fields = this.parseInlineObjectType(returnType);
      if (fields) {
        const elementKeys: string[] = [];
        const elementTypes: string[] = [];
        const elementTsTypes: string[] = [];
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i] as { name: string; type: string };
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

    const typeAliasInfo = this.resolveTypeAliasUnion(elementTypeName);
    if (typeAliasInfo) {
      return typeAliasInfo;
    }

    const elementIface = this.ctx.getInterfaceFromAST(elementTypeName);
    if (elementIface) {
      const elementIfaceTyped = elementIface as { name: string; fields: { name: string; type: string }[] };
      const elementKeys: string[] = [];
      const elementTypes: string[] = [];
      const elementTsTypes: string[] = [];
      for (let i = 0; i < elementIfaceTyped.fields.length; i++) {
        const f = elementIfaceTyped.fields[i] as { name: string; type: string };
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
        elementInterfaceName: elementIfaceTyped.name,
        elementKeys,
        elementTypes,
        elementTsTypes
      };
    }

    return null;
  }

  private getMethodReturnType(className: string, methodName: string): string | null {
    const classes = this.ctx.ast?.classes || [];
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i];
      if (cls.name === className) {
        for (let j = 0; j < cls.methods.length; j++) {
          const method = cls.methods[j];
          if (method.name === methodName && method.returnType) {
            return method.returnType;
          }
        }
      }
    }
    return null;
  }

  private resolveTypeAliasUnion(typeName: string): ObjectArrayMetadata | null {
    const typeAliases = this.ctx.ast?.typeAliases || [];
    for (let i = 0; i < typeAliases.length; i++) {
      const ta = typeAliases[i] as { name: string; unionMembers: string[] };
      if (ta.name === typeName && ta.unionMembers && ta.unionMembers.length > 0) {
        const memberInterfaces: { name: string; fields: { name: string; type: string }[] }[] = [];
        for (let j = 0; j < ta.unionMembers.length; j++) {
          const memberName = ta.unionMembers[j];
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
        const firstInterface = memberInterfaces[0] as { name: string; fields: { name: string; type: string }[] };
        for (let k = 0; k < firstInterface.fields.length; k++) {
          const f = firstInterface.fields[k] as { name: string; type: string };
          firstFields.set(f.name, f.type);
        }
        const commonFields: CommonField[] = [];
        for (const [fieldName, fieldType] of firstFields) {
          let isCommon = true;
          let resolvedType = fieldType;
          for (let m = 1; m < memberInterfaces.length; m++) {
            const otherIface = memberInterfaces[m] as { name: string; fields: { name: string; type: string }[] };
            let otherFieldResult: InterfaceField | null = null;
            for (let n = 0; n < otherIface.fields.length; n++) {
              const f = otherIface.fields[n] as { name: string; type: string };
              if (f.name === fieldName) {
                otherFieldResult = f;
                break;
              }
            }
            const otherField = otherFieldResult as { name: string; type: string };
            if (!otherFieldResult) {
              isCommon = false;
              break;
            }
            if (otherField.type !== fieldType) {
              const bothAreLiteralStrings = this.isStringLiteralType(fieldType) && this.isStringLiteralType(otherField.type);
              if (bothAreLiteralStrings) {
                resolvedType = 'string';
              } else {
                isCommon = false;
                break;
              }
            }
          }
          if (isCommon) {
            commonFields.push({ name: fieldName, type: resolvedType });
          }
        }
        if (commonFields.length === 0) {
          return null;
        }
        const elementKeys: string[] = [];
        const elementTypes: string[] = [];
        const elementTsTypes: string[] = [];
        for (let p = 0; p < commonFields.length; p++) {
          const f = commonFields[p];
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
          elementInterfaceName: typeName,
          elementKeys,
          elementTypes,
          elementTsTypes
        };
      }
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
    const firstInterface = memberInterfaces[0] as { name: string; fields: { name: string; type: string }[] };
    for (let i = 0; i < firstInterface.fields.length; i++) {
      const f = firstInterface.fields[i] as { name: string; type: string };
      firstFields.set(f.name, f.type);
    }

    const commonFields: CommonField[] = [];
    for (const [fieldName, fieldType] of firstFields) {
      let isCommon = true;
      let resolvedType = fieldType;
      for (let i = 1; i < memberInterfaces.length; i++) {
        const otherIface = memberInterfaces[i] as { name: string; fields: { name: string; type: string }[] };
        let otherFieldResult: InterfaceField | null = null;
        for (let j = 0; j < otherIface.fields.length; j++) {
          const f = otherIface.fields[j] as { name: string; type: string };
          if (f.name === fieldName) {
            otherFieldResult = f;
            break;
          }
        }
        const otherField = otherFieldResult as { name: string; type: string };
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
      const f = commonFields[i] as CommonField;
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
    if (typeStr.indexOf(' | null') !== -1) {
      return typeStr.replace(' | null', '').trim();
    }
    if (typeStr.indexOf('| null') !== -1) {
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
            const p = fn.parameters[j] as FunctionParameter;
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

    const forOfStmt = stmt as { type: string; variableName: string; iterable: Expression; body: BlockStatement };

    const iterableValue = this.ctx.generateExpression(forOfStmt.iterable, params);

    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${iterableValue}, i32 0, i32 1`);
    const lengthI32 = this.nextTemp();
    this.emit(`${lengthI32} = load i32, i32* ${lenPtr}`);

    const indexAlloca = this.nextTemp();
    this.emit(`${indexAlloca} = alloca i32`);
    this.emit(`store i32 0, i32* ${indexAlloca}`);

    const elemAlloca = this.nextTemp();
    this.emit(`${elemAlloca} = alloca i8*`);

    this.ctx.defineVariable(forOfStmt.variableName, elemAlloca, 'i8*', SymbolKind.Object, 'local', {
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
    this.ctx.currentLabel = bodyLabel;

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
    this.ctx.generateBlock(forOfStmt.body, params);
    this.loopStack.pop();

    const lastInstruction = this.ctx.output[this.ctx.output.length - 1]?.trim() || '';
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
    const loop = this.loopStack[this.loopStack.length - 1] as { continueLabel: string; breakLabel: string };
    this.emit(`br label %${loop.breakLabel}`);
    return '0';
  }

  generateContinueStatement(): string {
    if (this.loopStack.length === 0) {
      throw new Error('continue statement outside of loop');
    }
    const loop = this.loopStack[this.loopStack.length - 1] as { continueLabel: string; breakLabel: string };
    this.emit(`br label %${loop.continueLabel}`);
    return '0';
  }

  generateThrowStatement(stmt: Statement, _params: string[]): string {
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
    const tryStmt = stmt as { type: string; tryBlock: BlockStatement; catchClause: { param: string; body: BlockStatement } | null; finallyBlock: BlockStatement | null };

    // For now, we'll just execute the try block and ignore catch/finally
    // Full exception handling would require LLVM's invoke/landingpad support
    this.ctx.generateBlock(tryStmt.tryBlock, params);

    // If there's a finally block, execute it unconditionally
    if (tryStmt.finallyBlock) {
      this.ctx.generateBlock(tryStmt.finallyBlock, params);
    }

    return '0';
  }

  generateLogicalOp(op: string, left: Expression, right: Expression, params: string[]): string {
    const leftValue = this.ctx.generateExpression(left, params);
    const leftType = this.ctx.getVariableType(leftValue) || 'double';
    const leftBool = this.convertToBool(leftValue);

    const evalRightLabel = this.nextLabel('logop_eval_right');
    const endLabel = this.nextLabel('logop_end');
    const leftCoerceLabel = this.nextLabel('logop_left_coerce');

    if (op === '||') {
      this.emit(`br i1 ${leftBool}, label %${leftCoerceLabel}, label %${evalRightLabel}`);
    } else {
      this.emit(`br i1 ${leftBool}, label %${evalRightLabel}, label %${leftCoerceLabel}`);
    }

    this.emit(`${evalRightLabel}:`);
    const rightValue = this.ctx.generateExpression(right, params);
    const rightType = this.ctx.getVariableType(rightValue) || 'double';
    const resultType = this.getPhiType(leftType, rightType);
    const rightForPhi = this.coerceToTypeNoPhi(rightValue, rightType, resultType);
    const rightCoerceEndLabel = this.ctx.getCurrentLabel();
    this.emit(`br label %${endLabel}`);

    this.emit(`${leftCoerceLabel}:`);
    const leftForPhi = this.coerceToTypeNoPhi(leftValue, leftType, resultType);
    const leftCoerceEndLabel = this.ctx.getCurrentLabel();
    this.emit(`br label %${endLabel}`);

    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = phi ${resultType} [ ${leftForPhi}, %${leftCoerceEndLabel} ], [ ${rightForPhi}, %${rightCoerceEndLabel} ]`);
    this.ctx.setVariableType(result, resultType);
    return result;
  }

  private getPhiType(type1: string, type2: string): string {
    if (type1 === type2) return type1;
    if (type1.indexOf('*') !== -1) return type1;
    if (type2.indexOf('*') !== -1) return type2;
    return 'double';
  }

  private coerceToTypeNoPhi(value: string, fromType: string, toType: string): string {
    if (fromType === toType) return value;
    if (toType.indexOf('*') !== -1 && fromType === 'double') {
      const cmp = this.nextTemp();
      this.emit(`${cmp} = fcmp one double ${value}, 0.0`);
      const zext = this.nextTemp();
      this.emit(`${zext} = zext i1 ${cmp} to i64`);
      const coerced = this.nextTemp();
      this.emit(`${coerced} = inttoptr i64 ${zext} to ${toType}`);
      return coerced;
    }
    if (toType.indexOf('*') !== -1 && fromType === 'i32') {
      const extended = this.nextTemp();
      this.emit(`${extended} = sext i32 ${value} to i64`);
      const coerced = this.nextTemp();
      this.emit(`${coerced} = inttoptr i64 ${extended} to ${toType}`);
      return coerced;
    }
    return value;
  }

  private getUnionCommonFields(memberNames: string[]): { keys: string[]; types: string[]; tsTypes: string[] } {
    if (this.ctx.typeResolver) {
      return this.ctx.typeResolver.getUnionCommonFields(memberNames);
    }

    const foundInterfaces: InterfaceDeclaration[] = [];
    for (let i = 0; i < memberNames.length; i++) {
      const name = memberNames[i];
      const ifaceResult = this.getInterfaceDecl(name);
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
    const commonFields: CommonField[] = [];

    for (let fi = 0; fi < firstFields.length; fi++) {
      const field = firstFields[fi] as { name: string; type: string };
      let isCommon = true;
      for (let ii = 0; ii < interfaces.length; ii++) {
        const ifaceTyped = interfaces[ii] as { fields: { name: string; type: string }[] };
        let found = false;
        for (let fj = 0; fj < ifaceTyped.fields.length; fj++) {
          const f = ifaceTyped.fields[fj] as { name: string; type: string };
          if (f.name === field.name && this.areTypesCompatible(f.type, field.type)) {
            found = true;
            break;
          }
        }
        if (!found) {
          isCommon = false;
          break;
        }
      }
      if (isCommon) {
        commonFields.push({ name: field.name, type: this.normalizeType(field.type) });
      }
    }

    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (let i = 0; i < commonFields.length; i++) {
      const f = commonFields[i] as CommonField;
      keys.push(stripOptional(f.name));
      types.push(this.fieldTypeToLlvm(f.type));
      tsTypes.push(f.type);
    }

    return { keys, types, tsTypes };
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
    if (fieldType === 'boolean') return 'double';
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
    const ma = memberAccess as { type: string; object: Expression; property: string };
    if (ma.property !== 'type') return null;
    const maObjBase = ma.object as ExprBase;
    if (maObjBase.type !== 'variable') return null;

    const varName = (ma.object as VariableNode).name;
    const symbol = this.ctx.symbolTable.lookup(varName);
    if (!symbol || !symbol.objectMetadata) return null;
    const objMeta = symbol.objectMetadata;

    const interfaceName = this.findInterfaceByDiscriminant(literalValue);
    if (!interfaceName) return null;

    const ifaceResult = this.getInterfaceDecl(interfaceName);
    if (!ifaceResult) return null;
    const iface = ifaceResult as { name: string; fields: { name: string; type: string }[] };

    const currentKeys = objMeta.keys;
    const ifaceKeys: string[] = [];
    for (let fi = 0; fi < iface.fields.length; fi++) {
      const f = iface.fields[fi] as { name: string; type: string };
      ifaceKeys.push(f.name);
    }
    let isSubset = true;
    for (let ki = 0; ki < ifaceKeys.length; ki++) {
      if (currentKeys.indexOf(ifaceKeys[ki]) === -1) {
        isSubset = false;
        break;
      }
    }
    if (!isSubset) return null;

    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (let i = 0; i < iface.fields.length; i++) {
      const f = iface.fields[i] as { name: string; type: string };
      keys.push(stripOptional(f.name));
      types.push(this.fieldTypeToLlvm(f.type));
      tsTypes.push(f.type);
    }

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
      const iface = this.ctx.ast.interfaces[i] as { name: string; fields: { name: string; type: string }[] };
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

  private isStringSetExpression(expr: Expression): boolean {
    const e = expr as ExprBase;

    if (e.type === 'variable') {
      const varName = (expr as VariableNode).name;
      if (this.ctx.symbolTable.isSet(varName)) {
        const setMeta = this.ctx.symbolTable.getSetMetadata(varName);
        return !setMeta || setMeta.valueType === 'string';
      }
      return false;
    }

    if (e.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      const memberObjBase = memberExpr.object as ExprBase;
      if (memberObjBase.type === 'this' && this.ctx.currentClassName) {
        const fieldInfoResult = this.ctx.classGen.getFieldInfo(this.ctx.currentClassName, memberExpr.property);
        const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
        if (fieldInfoResult && fieldInfo.tsType && fieldInfo.tsType.startsWith('Set<string>')) {
          return true;
        }
      }
    }

    return false;
  }

  private isMapEntriesCall(expr: Expression): boolean {
    const e = expr as ExprBase;

    if (e.type === 'variable') {
      const varName = (expr as VariableNode).name;
      return this.ctx.symbolTable.isMap(varName);
    }

    if (e.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      const memberObjBase = memberExpr.object as ExprBase;
      if (memberObjBase.type === 'this' && this.ctx.currentClassName) {
        const fieldInfoResult = this.ctx.classGen.getFieldInfo(this.ctx.currentClassName, memberExpr.property);
        const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
        if (fieldInfoResult && fieldInfo.tsType && fieldInfo.tsType.startsWith('Map<')) {
          return true;
        }
      }
    }

    if (e.type !== 'method_call') return false;
    const methodCall = expr as MethodCallNode;
    if (methodCall.method !== 'entries') return false;

    const objBase = methodCall.object as ExprBase;
    if (objBase.type === 'variable') {
      const varName = (methodCall.object as VariableNode).name;
      return this.ctx.symbolTable.isMap(varName);
    }

    if (objBase.type === 'member_access') {
      const memberExpr = methodCall.object as MemberAccessNode;
      const memberObjBase = memberExpr.object as ExprBase;
      if (memberObjBase.type === 'this' && this.ctx.currentClassName) {
        const fieldInfoResult = this.ctx.classGen.getFieldInfo(this.ctx.currentClassName, memberExpr.property);
        const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
        if (fieldInfoResult && fieldInfo.tsType && fieldInfo.tsType.startsWith('Map<')) {
          return true;
        }
      }
    }

    return false;
  }

  private getMapValueTypeInfo(iterable: Expression): { valueType: string; objectMetadata?: ObjectMetadata } | null {
    const e = iterable as ExprBase;

    let valueType: string | null = null;

    if (e.type === 'variable') {
      const varName = (iterable as VariableNode).name;
      const mapMeta = this.ctx.symbolTable.getMapMetadata(varName);
      if (mapMeta) {
        valueType = mapMeta.valueType;
      }
    } else if (e.type === 'member_access') {
      const memberExpr = iterable as MemberAccessNode;
      const memberObjBase = memberExpr.object as ExprBase;
      if (memberObjBase.type === 'this' && this.ctx.currentClassName) {
        const mapTypeInfo = this.ctx.typeResolver?.getClassFieldMapType(
          this.ctx.currentClassName,
          memberExpr.property
        );
        if (mapTypeInfo) {
          valueType = mapTypeInfo.valueType;
        }
      }
    } else if (e.type === 'method_call') {
      const methodCall = iterable as MethodCallNode;
      if (methodCall.method === 'entries') {
        const methodCallObjBase = methodCall.object as ExprBase;
        if (methodCallObjBase.type === 'variable') {
          const varName = (methodCall.object as VariableNode).name;
          const mapMeta = this.ctx.symbolTable.getMapMetadata(varName);
          if (mapMeta) {
            valueType = mapMeta.valueType;
          }
        } else if (methodCallObjBase.type === 'member_access') {
          const memberExpr = methodCall.object as MemberAccessNode;
          const memberExprObjBase = memberExpr.object as ExprBase;
          if (memberExprObjBase.type === 'this' && this.ctx.currentClassName) {
            const mapTypeInfo = this.ctx.typeResolver?.getClassFieldMapType(
              this.ctx.currentClassName,
              memberExpr.property
            );
            if (mapTypeInfo) {
              valueType = mapTypeInfo.valueType;
            }
          }
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
    const destructuredNames = stmt.destructuredNames as string[];
    const keyName = destructuredNames[0];
    const valueName = destructuredNames[1];

    const valueTypeInfo = this.getMapValueTypeInfo(stmt.iterable);

    let iterableValue: string;
    const iterableBase = stmt.iterable as ExprBase;
    if (iterableBase.type === 'variable') {
      const varName = (stmt.iterable as VariableNode).name;
      if (this.ctx.symbolTable.isMap(varName)) {
        const mapPtr = this.ctx.generateExpression(stmt.iterable, params);
        iterableValue = this.ctx.stringMapGen.generateStringMapEntries(mapPtr);
      } else {
        iterableValue = this.ctx.generateExpression(stmt.iterable, params);
      }
    } else if (iterableBase.type === 'member_access') {
      const memberExpr = stmt.iterable as MemberAccessNode;
      const memberObjBase = memberExpr.object as ExprBase;
      if (memberObjBase.type === 'this' && this.ctx.currentClassName) {
        const fieldInfoResult = this.ctx.classGen.getFieldInfo(this.ctx.currentClassName, memberExpr.property);
        const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
        if (fieldInfoResult && fieldInfo.tsType && fieldInfo.tsType.startsWith('Map<')) {
          const mapPtr = this.ctx.generateExpression(stmt.iterable, params);
          iterableValue = this.ctx.stringMapGen.generateStringMapEntries(mapPtr);
        } else {
          iterableValue = this.ctx.generateExpression(stmt.iterable, params);
        }
      } else {
        iterableValue = this.ctx.generateExpression(stmt.iterable, params);
      }
    } else {
      iterableValue = this.ctx.generateExpression(stmt.iterable, params);
    }

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

    if (valueTypeInfo) {
      const vti = valueTypeInfo as { valueType: string; objectMetadata: ObjectMetadata | undefined };
      if (vti.objectMetadata) {
        this.ctx.defineVariable(valueName, valueAlloca, 'i8*', SymbolKind.Object, 'local', {
          objectMetadata: vti.objectMetadata
        });
      } else {
        this.ctx.defineVariable(valueName, valueAlloca, 'i8*', SymbolKind.String, 'local');
      }
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
    this.ctx.currentLabel = bodyLabel;

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

    const lastInstruction = this.ctx.output[this.ctx.output.length - 1]?.trim() || '';
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

  generateSwitchStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== 'switch') {
      throw new Error('Expected switch statement');
    }

    const switchStmt = stmt as SwitchStatement;
    const endLabel = this.nextLabel('switch_end');

    const discriminantValue = this.ctx.generateExpression(switchStmt.discriminant, params);
    const discriminantType = this.ctx.getVariableType(discriminantValue);
    const isString = discriminantType === 'i8*';

    this.loopStack.push({ continueLabel: '', breakLabel: endLabel });

    const caseLabels: string[] = [];
    let defaultLabelIndex = -1;

    for (let i = 0; i < switchStmt.cases.length; i++) {
      const caseItem = switchStmt.cases[i];
      if (caseItem.test === null) {
        defaultLabelIndex = i;
        caseLabels.push(this.nextLabel('case_default'));
      } else {
        caseLabels.push(this.nextLabel('case'));
      }
    }

    const defaultLabel = defaultLabelIndex >= 0 ? caseLabels[defaultLabelIndex] : endLabel;

    let checkLabels: string[] = [];
    let testCaseCount = 0;
    for (let i = 0; i < switchStmt.cases.length; i++) {
      if (switchStmt.cases[i].test !== null) {
        testCaseCount++;
      }
    }

    for (let i = 0; i < testCaseCount; i++) {
      checkLabels.push(this.nextLabel('check'));
    }

    let checkIndex = 0;
    for (let i = 0; i < switchStmt.cases.length; i++) {
      const caseItem = switchStmt.cases[i];
      if (caseItem.test !== null) {
        if (checkIndex > 0) {
          this.emit(`${checkLabels[checkIndex - 1]}:`);
        }

        const testValue = this.ctx.generateExpression(caseItem.test, params);

        if (isString) {
          const strCmp = this.nextTemp();
          this.emit(`${strCmp} = call i32 @strcmp(i8* ${discriminantValue}, i8* ${testValue})`);
          const cmpResult = this.nextTemp();
          this.emit(`${cmpResult} = icmp eq i32 ${strCmp}, 0`);
          const nextLabel = (checkIndex < testCaseCount - 1) ? checkLabels[checkIndex] : defaultLabel;
          this.emit(`br i1 ${cmpResult}, label %${caseLabels[i]}, label %${nextLabel}`);
        } else {
          const cmpResult = this.nextTemp();
          this.emit(`${cmpResult} = fcmp oeq double ${discriminantValue}, ${testValue}`);
          const nextLabel = (checkIndex < testCaseCount - 1) ? checkLabels[checkIndex] : defaultLabel;
          this.emit(`br i1 ${cmpResult}, label %${caseLabels[i]}, label %${nextLabel}`);
        }
        checkIndex++;
      }
    }

    for (let i = 0; i < switchStmt.cases.length; i++) {
      const caseItem = switchStmt.cases[i];
      this.emit(`${caseLabels[i]}:`);
      this.ctx.currentLabel = caseLabels[i];

      for (let j = 0; j < caseItem.consequent.length; j++) {
        const consequentStmt = caseItem.consequent[j];
        if (consequentStmt.type === 'break') {
          this.emit(`br label %${endLabel}`);
        } else if (consequentStmt.type === 'variable_declaration' || consequentStmt.type === 'return' || consequentStmt.type === 'if') {
          this.ctx.generateBlock({ type: 'block', statements: [consequentStmt] }, params);
        } else {
          this.ctx.generateExpression(consequentStmt as Expression, params);
        }
      }

      const lastStmt = caseItem.consequent[caseItem.consequent.length - 1];
      if (!lastStmt || (lastStmt.type !== 'break' && lastStmt.type !== 'return')) {
        const nextCaseLabel = (i < switchStmt.cases.length - 1) ? caseLabels[i + 1] : endLabel;
        this.emit(`br label %${nextCaseLabel}`);
      }
    }

    this.loopStack.pop();
    this.emit(`${endLabel}:`);

    return '0';
  }
}
