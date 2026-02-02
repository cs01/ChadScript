import { FunctionNode, BlockStatement, Expression, FunctionParameter, AST, VariableDeclaration, IfStatement, WhileStatement, ForStatement, ForOfStatement, InterfaceDeclaration, InterfaceField, TypeAliasDeclaration, TopLevelItem, AssignmentStatement, CallNode, NewNode, MethodCallNode, CommonField } from '../../ast/types.js';
import { SymbolKind, SymbolTable } from './symbol-table.js';
import type { ClosureInfo } from './closure-analyzer.js';
import type { TypeChecker } from '../../typescript/type-checker.js';
import type { StringGenerator } from '../types/collections/string.js';
import type { ControlFlowGenerator } from '../statements/control-flow.js';

interface LiftedFunction extends FunctionNode {
  closureInfo?: ClosureInfo;
}

export interface FunctionGeneratorContext {
  reset(): void;
  syncStateToGenerators(): void;
  nextTemp(): string;
  emit(instruction: string): void;
  defineVariable(name: string, allocaReg: string, llvmType: string, kind: SymbolKind, scope: 'local' | 'global', metadata?: Record<string, unknown>): void;
  generateBlock(block: BlockStatement, params: string[]): string | null;
  generateExpression(expr: Expression, params: string[]): string;
  allocateVariable(stmt: VariableDeclaration, params: string[]): void;
  currentFunction: string;
  currentFunctionReturnType: string;
  isAsyncFunction: boolean;
  asyncResultPromise: string;
  ast: AST;
  typeChecker: TypeChecker | null;
  output: string[];
  stringGen: StringGenerator;
  tempCounter: number;
  symbolTable: SymbolTable;
  controlFlowGen: ControlFlowGenerator;
}

export class FunctionGenerator {
  constructor(private ctx: FunctionGeneratorContext) {}

  generate(func: FunctionNode): string {
    this.ctx.reset();
    this.ctx.syncStateToGenerators();
    this.ctx.currentFunction = func.name;
    this.ctx.isAsyncFunction = func.async || false;
    this.ctx.asyncResultPromise = '';

    const paramTypes: string[] = [];
    const paramLLVMTypes: string[] = [];
    let returnType = 'double';
    let returnTypeIsString = false;
    let returnTypeIsVoid = false;
    this.ctx.currentFunctionReturnType = 'double';

    if (func.async) {
      returnType = '%Promise*';
      this.ctx.currentFunctionReturnType = '%Promise*';
    } else if (func.paramTypes && func.paramTypes.length > 0) {
      for (let i = 0; i < func.params.length; i++) {
        const paramType = func.paramTypes[i] || 'number';
        paramTypes.push(paramType);
        if (paramType === 'string') {
          paramLLVMTypes.push('i8*');
        } else if (paramType === 'string[]') {
          paramLLVMTypes.push('%StringArray*');
        } else if (paramType === 'number[]' || paramType === 'boolean[]') {
          paramLLVMTypes.push('%Array*');
        } else if (paramType !== 'number' && paramType !== 'boolean') {
          paramLLVMTypes.push('i8*');
        } else {
          paramLLVMTypes.push('double');
        }
      }
      if (func.returnType === 'string') {
        returnType = 'i8*';
        returnTypeIsString = true;
        this.ctx.currentFunctionReturnType = 'i8*';
      } else if (func.returnType === 'void') {
        returnType = 'void';
        returnTypeIsVoid = true;
        this.ctx.currentFunctionReturnType = 'void';
      } else if (func.returnType && func.returnType !== 'number' && func.returnType !== 'boolean') {
        returnType = 'i8*';
        this.ctx.currentFunctionReturnType = 'i8*';
      }
    } else if (func.parameters && func.parameters.length > 0) {
      for (let i = 0; i < func.params.length; i++) {
        const param = func.parameters[i] as { name: string; type: string };
        const paramType = param?.type || 'number';
        paramTypes.push(paramType);
        if (paramType === 'string') {
          paramLLVMTypes.push('i8*');
        } else if (paramType === 'string[]') {
          paramLLVMTypes.push('%StringArray*');
        } else if (paramType === 'number[]' || paramType === 'boolean[]') {
          paramLLVMTypes.push('%Array*');
        } else if (paramType !== 'number' && paramType !== 'boolean') {
          paramLLVMTypes.push('i8*');
        } else {
          paramLLVMTypes.push('double');
        }
      }
      if (func.returnType === 'string') {
        returnType = 'i8*';
        returnTypeIsString = true;
        this.ctx.currentFunctionReturnType = 'i8*';
      } else if (func.returnType === 'void') {
        returnType = 'void';
        returnTypeIsVoid = true;
        this.ctx.currentFunctionReturnType = 'void';
      } else if (func.returnType && func.returnType !== 'number' && func.returnType !== 'boolean') {
        returnType = 'i8*';
        this.ctx.currentFunctionReturnType = 'i8*';
      }
    }

    if (!returnTypeIsString && !returnTypeIsVoid && !this.hasReturnStatement(func.body)) {
      returnType = 'void';
      returnTypeIsVoid = true;
      this.ctx.currentFunctionReturnType = 'void';
    }

    while (paramLLVMTypes.length < func.params.length) {
      paramTypes.push('number');
      paramLLVMTypes.push('double');
    }

    const liftedFunc = func as LiftedFunction;
    const hasClosure = liftedFunc.closureInfo && liftedFunc.closureInfo.captures.length > 0;
    const hasOptionalParams = func.parameters && func.parameters.some(p => p.optional || p.defaultValue);

    let ir = `define ${returnType} @${func.name}(`;
    const paramStrings: string[] = [];
    if (hasClosure) {
      paramStrings.push('i8* %__env');
    }
    if (hasOptionalParams) {
      paramStrings.push('i32 %__argc');
    }
    const paramMapped = func.params.map((_, i) => `${paramLLVMTypes[i]} %arg${i}`);
    for (let i = 0; i < paramMapped.length; i++) {
      paramStrings.push(paramMapped[i]);
    }
    ir += paramStrings.join(', ');
    ir += ') {\n';
    ir += 'entry:\n';

    for (let i = 0; i < func.params.length; i++) {
      const paramName = func.params[i];
      const allocaReg = this.ctx.nextTemp();
      const llvmType = paramLLVMTypes[i];
      const paramInfo = func.parameters?.[i];
      const isOptional = paramInfo?.optional || paramInfo?.defaultValue;

      if (llvmType === 'i8*') {
        if (paramTypes[i] === 'string') {
          this.ctx.defineVariable(paramName, allocaReg, 'i8*', SymbolKind.String, 'local');
        } else {
          let interfaceDefResult: { name: string; fields: { name: string; type: string }[] } | null = null;
          const interfaces = this.ctx.ast.interfaces || [];
          for (let j = 0; j < interfaces.length; j++) {
            const iface = interfaces[j] as { name: string; fields: { name: string; type: string }[] };
            if (iface.name === paramTypes[i]) {
              interfaceDefResult = iface;
              break;
            }
          }

          let typeAliasResult: { name: string; unionMembers: string[] } | null = null;
          const typeAliases = this.ctx.ast.typeAliases || [];
          for (let j = 0; j < typeAliases.length; j++) {
            const ta = typeAliases[j] as { name: string; unionMembers: string[] };
            if (ta.name === paramTypes[i]) {
              typeAliasResult = ta;
              break;
            }
          }

          if (interfaceDefResult) {
            const interfaceDef = interfaceDefResult as { name: string; fields: { name: string; type: string }[] };
            const keys: string[] = [];
            const types: string[] = [];
            for (let j = 0; j < interfaceDef.fields.length; j++) {
              const field = interfaceDef.fields[j] as { name: string; type: string };
              keys.push(field.name);
              types.push(this.tsTypeToLlvm(field.type));
            }
            this.ctx.defineVariable(paramName, allocaReg, 'i8*', SymbolKind.Object, 'local', {
              objectMetadata: { keys, types },
              declaredType: paramTypes[i]
            });
          } else if (typeAliasResult && typeAliasResult.unionMembers) {
            const commonFields = this.getUnionCommonFields(typeAliasResult.unionMembers);
            this.ctx.defineVariable(paramName, allocaReg, 'i8*', SymbolKind.Object, 'local', {
              objectMetadata: commonFields,
              unionType: paramTypes[i],
              unionMembers: typeAliasResult.unionMembers
            });
          } else {
            this.ctx.defineVariable(paramName, allocaReg, 'i8*', SymbolKind.Object, 'local');
          }
        }
        this.ctx.emit(`${allocaReg} = alloca i8*`);
        if (isOptional && hasOptionalParams) {
          this.generateOptionalParamInit(i, allocaReg, llvmType, paramInfo!, func.params);
        } else {
          this.ctx.emit(`store i8* %arg${i}, i8** ${allocaReg}`);
        }
      } else if (llvmType === '%StringArray*') {
        this.ctx.defineVariable(paramName, allocaReg, '%StringArray*', SymbolKind.StringArray, 'local', { isPointerAlloca: true });
        this.ctx.emit(`${allocaReg} = alloca %StringArray*`);
        if (isOptional && hasOptionalParams) {
          this.generateOptionalParamInit(i, allocaReg, llvmType, paramInfo!, func.params);
        } else {
          this.ctx.emit(`store %StringArray* %arg${i}, %StringArray** ${allocaReg}`);
        }
      } else if (llvmType === '%Array*') {
        this.ctx.defineVariable(paramName, allocaReg, '%Array*', SymbolKind.Array, 'local', { isPointerAlloca: true });
        this.ctx.emit(`${allocaReg} = alloca %Array*`);
        if (isOptional && hasOptionalParams) {
          this.generateOptionalParamInit(i, allocaReg, llvmType, paramInfo!, func.params);
        } else {
          this.ctx.emit(`store %Array* %arg${i}, %Array** ${allocaReg}`);
        }
      } else {
        this.ctx.defineVariable(paramName, allocaReg, 'double', SymbolKind.Number, 'local');
        this.ctx.emit(`${allocaReg} = alloca double`);
        if (isOptional && hasOptionalParams) {
          this.generateOptionalParamInit(i, allocaReg, llvmType, paramInfo!, func.params);
        } else {
          this.ctx.emit(`store double %arg${i}, double* ${allocaReg}`);
        }
      }
    }

    if (hasClosure) {
      const closureInfo = liftedFunc.closureInfo!;
      const envTyped = this.ctx.nextTemp();
      this.ctx.emit(`${envTyped} = bitcast i8* %__env to ${closureInfo.envStructName}*`);

      for (let i = 0; i < closureInfo.captures.length; i++) {
        const capture = closureInfo.captures[i];
        const fieldPtr = this.ctx.nextTemp();
        this.ctx.emit(`${fieldPtr} = getelementptr ${closureInfo.envStructName}, ${closureInfo.envStructName}* ${envTyped}, i32 0, i32 ${i}`);

        const valueReg = this.ctx.nextTemp();
        this.ctx.emit(`${valueReg} = load ${capture.llvmType}, ${capture.llvmType}* ${fieldPtr}`);

        const allocaReg = this.ctx.nextTemp();
        this.ctx.emit(`${allocaReg} = alloca ${capture.llvmType}`);
        this.ctx.emit(`store ${capture.llvmType} ${valueReg}, ${capture.llvmType}* ${allocaReg}`);

        const kind = this.llvmTypeToSymbolKind(capture.llvmType);
        this.ctx.defineVariable(capture.name, allocaReg, capture.llvmType, kind, 'local');
      }
    }

    if (func.async) {
      const resultPromise = this.ctx.nextTemp();
      this.ctx.asyncResultPromise = resultPromise;
      this.ctx.emit(`${resultPromise} = call %Promise* @__Promise_new()`);
    }

    const result = this.ctx.generateBlock(func.body, func.params);

    if (this.ctx.output.length > 0) {
      ir += this.ctx.output.map(line => '  ' + line).join('\n') + '\n';
    }

    const lastInstruction = this.ctx.output.length > 0 ? this.ctx.output[this.ctx.output.length - 1].trim() : '';
    const hasTerminator = lastInstruction.startsWith('ret ') ||
                          lastInstruction.startsWith('br ') ||
                          lastInstruction === 'unreachable';

    if (!hasTerminator) {
      if (func.async) {
        this.ctx.emit(`call void @__Promise_resolve(%Promise* ${this.ctx.asyncResultPromise}, i8* null)`);
        ir += this.ctx.output.slice(-1).map(line => '  ' + line).join('\n') + '\n';
        ir += `  ret %Promise* ${this.ctx.asyncResultPromise}\n`;
      } else if (returnTypeIsVoid) {
        ir += '  ret void\n';
      } else if (result !== null) {
        ir += `  ret ${returnType} ${result}\n`;
      } else {
        if (returnTypeIsString) {
          this.ctx.syncStateToGenerators();
          const emptyStr = this.ctx.stringGen.createStringConstant('');
          ir += `  ret i8* ${emptyStr}\n`;
        } else {
          ir += `  ret ${returnType} 0.0\n`;
        }
      }
    }
    ir += '}\n';

    return ir;
  }

  private hasReturnStatement(block: BlockStatement): boolean {
    for (let i = 0; i < block.statements.length; i++) {
      const stmt = block.statements[i] as { type: string };
      if (stmt.type === 'return') {
        return true;
      }
      if (stmt.type === 'if') {
        const ifStmt = block.statements[i] as IfStatement;
        if (this.hasReturnStatement(ifStmt.thenBlock)) return true;
        if (ifStmt.elseBlock && this.hasReturnStatement(ifStmt.elseBlock)) return true;
      }
      if (stmt.type === 'while') {
        const whileStmt = block.statements[i] as WhileStatement;
        if (whileStmt.body && this.hasReturnStatement(whileStmt.body)) return true;
      }
      if (stmt.type === 'for') {
        const forStmt = block.statements[i] as ForStatement;
        if (forStmt.body && this.hasReturnStatement(forStmt.body)) return true;
      }
    }
    return false;
  }

  private tsTypeToLlvm(tsType: string): string {
    if (tsType === 'string') return 'i8*';
    if (tsType === 'number') return 'double';
    if (tsType === 'boolean') return 'i1';
    if (tsType === 'string[]') return '%StringArray*';
    if (tsType === 'number[]' || tsType === 'boolean[]') return '%Array*';
    return 'i8*';
  }

  private llvmTypeToSymbolKind(llvmType: string): SymbolKind {
    if (llvmType === 'double') return SymbolKind.Number;
    if (llvmType === 'i8*') return SymbolKind.String;
    if (llvmType === '%Array*') return SymbolKind.Array;
    if (llvmType === '%StringArray*') return SymbolKind.StringArray;
    if (llvmType === '%Map*') return SymbolKind.Map;
    if (llvmType === '%Set*') return SymbolKind.Set;
    return SymbolKind.Object;
  }

  private getUnionCommonFields(memberNames: string[]): { keys: string[]; types: string[] } {
    const interfaces: { name: string; fields: { name: string; type: string }[] }[] = [];
    const astInterfaces = this.ctx.ast.interfaces || [];
    for (let i = 0; i < memberNames.length; i++) {
      const memberName = memberNames[i];
      for (let j = 0; j < astInterfaces.length; j++) {
        const iface = astInterfaces[j] as { name: string; fields: { name: string; type: string }[] };
        if (iface.name === memberName) {
          interfaces.push(iface);
          break;
        }
      }
    }

    if (interfaces.length === 0) {
      return { keys: [], types: [] };
    }

    const firstInterface = interfaces[0] as { name: string; fields: { name: string; type: string }[] };
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
    for (let i = 0; i < commonFields.length; i++) {
      const cf = commonFields[i] as CommonField;
      keys.push(cf.name);
      types.push(this.tsTypeToLlvm(cf.type));
    }

    return { keys, types };
  }

  private areTypesCompatible(type1: string, type2: string): boolean {
    if (type1 === type2) return true;
    const norm1 = this.normalizeType(type1);
    const norm2 = this.normalizeType(type2);
    return norm1 === norm2;
  }

  private normalizeType(type: string): string {
    if (type.startsWith("'") && type.endsWith("'")) return 'string';
    if (type.startsWith('"') && type.endsWith('"')) return 'string';
    return type;
  }

  private labelCounter = 0;

  private generateOptionalParamInit(
    paramIndex: number,
    allocaReg: string,
    llvmType: string,
    paramInfo: FunctionParameter,
    params: string[]
  ): void {
    const labelId = this.labelCounter++;
    const hasArgLabel = `has_arg_${labelId}`;
    const noArgLabel = `no_arg_${labelId}`;
    const doneLabel = `done_arg_${labelId}`;

    const cmpReg = this.ctx.nextTemp();
    this.ctx.emit(`${cmpReg} = icmp sgt i32 %__argc, ${paramIndex}`);
    this.ctx.emit(`br i1 ${cmpReg}, label %${hasArgLabel}, label %${noArgLabel}`);

    this.ctx.emit(`${hasArgLabel}:`);
    const ptrType = this.getLlvmPtrType(llvmType);
    this.ctx.emit(`store ${llvmType} %arg${paramIndex}, ${ptrType} ${allocaReg}`);
    this.ctx.emit(`br label %${doneLabel}`);

    this.ctx.emit(`${noArgLabel}:`);
    if (paramInfo.defaultValue) {
      this.ctx.syncStateToGenerators();
      const defaultReg = this.ctx.generateExpression(paramInfo.defaultValue, params);
      this.ctx.emit(`store ${llvmType} ${defaultReg}, ${ptrType} ${allocaReg}`);
    } else {
      const defaultVal = this.getDefaultValue(llvmType);
      this.ctx.emit(`store ${llvmType} ${defaultVal}, ${ptrType} ${allocaReg}`);
    }
    this.ctx.emit(`br label %${doneLabel}`);

    this.ctx.emit(`${doneLabel}:`);
  }

  private getLlvmPtrType(llvmType: string): string {
    if (llvmType === 'double') return 'double*';
    if (llvmType === 'i8*') return 'i8**';
    if (llvmType === '%Array*') return '%Array**';
    if (llvmType === '%StringArray*') return '%StringArray**';
    return `${llvmType}*`;
  }

  private getDefaultValue(llvmType: string): string {
    if (llvmType === 'double') return '0.0';
    if (llvmType === 'i8*') return 'null';
    if (llvmType === '%Array*') return 'null';
    if (llvmType === '%StringArray*') return 'null';
    return 'null';
  }

  generateMain(topLevelObjectVariables: Map<string, { ptr: string; keys: string[]; types: string[] }>): string {
    let ir = 'define i32 @main(i32 %argc, i8** %argv) {\n';
    ir += 'entry:\n';

    ir += '  ; Initialize garbage collector\n';
    ir += '  call void @GC_init()\n';
    ir += '\n';

    ir += '  store i32 %argc, i32* @__argc\n';
    ir += '  store i8** %argv, i8*** @__argv\n';

    this.ctx.tempCounter = 0;
    this.ctx.output = [];

    for (const item of this.ctx.ast.topLevelItems || []) {
      if (item.type === 'variable_declaration') {
        this.ctx.allocateVariable(item as VariableDeclaration, []);
      } else if (item.type === 'if') {
        this.ctx.syncStateToGenerators();
        this.ctx.controlFlowGen.generateIfStatement(item as IfStatement, []);
      } else if (item.type === 'while') {
        this.ctx.syncStateToGenerators();
        this.ctx.controlFlowGen.generateWhileStatement(item as WhileStatement, []);
      } else if (item.type === 'for') {
        this.ctx.syncStateToGenerators();
        this.ctx.controlFlowGen.generateForStatement(item as ForStatement, []);
      } else if (item.type === 'for_of') {
        this.ctx.syncStateToGenerators();
        this.ctx.controlFlowGen.generateForOfStatement(item as ForOfStatement, []);
      } else if (item.type === 'assignment') {
        this.ctx.generateBlock({ type: 'block', statements: [item as AssignmentStatement] }, []);
      } else {
        this.ctx.generateExpression(item as Expression, []);
      }
    }

    if (!this.ctx.ast.topLevelItems || this.ctx.ast.topLevelItems.length === 0) {
      for (let i = 0; i < this.ctx.ast.topLevelStatements.length; i++) {
        const stmt = this.ctx.ast.topLevelStatements[i] as VariableDeclaration;
        this.ctx.allocateVariable(stmt, []);
      }
      for (let i = 0; i < this.ctx.ast.topLevelExpressions.length; i++) {
        const expr = this.ctx.ast.topLevelExpressions[i] as Expression;
        this.ctx.generateExpression(expr, []);
      }
    }

    topLevelObjectVariables.clear();
    for (const symbol of this.ctx.symbolTable.getAll()) {
      if (symbol.kind === SymbolKind.Object && symbol.scope === 'global' && symbol.objectMetadata) {
        topLevelObjectVariables.set(symbol.name, {
          ptr: symbol.allocaRegister,
          keys: symbol.objectMetadata.keys,
          types: symbol.objectMetadata.types
        });
      }
    }

    if (this.ctx.output.length > 0) {
      ir += this.ctx.output.map((line: string) => '  ' + line).join('\n') + '\n';
    }

    ir += '  ret i32 0\n';
    ir += '}\n';

    return ir;
  }
}
