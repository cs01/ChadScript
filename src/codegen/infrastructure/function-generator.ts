import { FunctionNode, BlockStatement, Expression } from '../../ast/types.js';
import { SymbolKind } from './symbol-table.js';

export interface FunctionGeneratorContext {
  reset(): void;
  syncStateToGenerators(): void;
  nextTemp(): string;
  emit(instruction: string): void;
  defineVariable(name: string, allocaReg: string, llvmType: string, kind: SymbolKind, scope: 'local' | 'global', metadata?: any): void;
  generateBlock(block: BlockStatement, params: string[]): string | null;
  generateExpression(expr: Expression, params: string[]): string;
  allocateVariable(stmt: any, params: string[]): void;
  currentFunction: string;
  currentFunctionReturnType: string;
  ast: any;
  typeChecker: any;
  output: string[];
  stringGen: any;
  tempCounter: number;
  symbolTable: any;
  controlFlowGen: any;
}

export class FunctionGenerator {
  constructor(private ctx: FunctionGeneratorContext) {}

  generate(func: FunctionNode): string {
    this.ctx.reset();
    this.ctx.syncStateToGenerators();
    this.ctx.currentFunction = func.name;

    const paramTypes: string[] = [];
    const paramLLVMTypes: string[] = [];
    let returnType = 'double';
    let returnTypeIsString = false;
    let returnTypeIsVoid = false;
    this.ctx.currentFunctionReturnType = 'double';

    if (func.paramTypes && func.paramTypes.length > 0) {
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
      }
    } else if (this.ctx.typeChecker) {
      try {
        const funcType = this.ctx.typeChecker.getFunctionType(func.name);
        if (funcType) {
          if (funcType.returnType === 'string') {
            returnType = 'i8*';
            returnTypeIsString = true;
            this.ctx.currentFunctionReturnType = 'i8*';
          } else if (funcType.returnType === 'void') {
            returnType = 'void';
            returnTypeIsVoid = true;
            this.ctx.currentFunctionReturnType = 'void';
          } else if (funcType.returnType !== 'number' && funcType.returnType !== 'boolean') {
            returnType = 'i8*';
            this.ctx.currentFunctionReturnType = 'i8*';
          }

          for (let i = 0; i < func.params.length; i++) {
            const paramType = funcType.parameters[i]?.type || 'number';
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
        }
      } catch {
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

    let ir = `define ${returnType} @${func.name}(`;
    ir += func.params.map((_, i) => `${paramLLVMTypes[i]} %arg${i}`).join(', ');
    ir += ') {\n';
    ir += 'entry:\n';

    for (let i = 0; i < func.params.length; i++) {
      const paramName = func.params[i];
      const allocaReg = this.ctx.nextTemp();
      const llvmType = paramLLVMTypes[i];

      if (llvmType === 'i8*') {
        if (paramTypes[i] === 'string') {
          this.ctx.defineVariable(paramName, allocaReg, 'i8*', SymbolKind.String, 'local');
        } else {
          const interfaceDef = this.ctx.ast.interfaces?.find((iface: any) => iface.name === paramTypes[i]);
          if (interfaceDef) {
            const keys = interfaceDef.fields.map((f: any) => f.name);
            const types = interfaceDef.fields.map((f: any) => this.tsTypeToLlvm(f.type));
            this.ctx.defineVariable(paramName, allocaReg, 'i8*', SymbolKind.Object, 'local', {
              objectMetadata: { keys, types }
            });
          } else {
            this.ctx.defineVariable(paramName, allocaReg, 'i8*', SymbolKind.Object, 'local');
          }
        }
        this.ctx.emit(`${allocaReg} = alloca i8*`);
        this.ctx.emit(`store i8* %arg${i}, i8** ${allocaReg}`);
      } else if (llvmType === '%StringArray*') {
        this.ctx.defineVariable(paramName, allocaReg, '%StringArray*', SymbolKind.StringArray, 'local', { isPointerAlloca: true });
        this.ctx.emit(`${allocaReg} = alloca %StringArray*`);
        this.ctx.emit(`store %StringArray* %arg${i}, %StringArray** ${allocaReg}`);
      } else if (llvmType === '%Array*') {
        this.ctx.defineVariable(paramName, allocaReg, '%Array*', SymbolKind.Array, 'local', { isPointerAlloca: true });
        this.ctx.emit(`${allocaReg} = alloca %Array*`);
        this.ctx.emit(`store %Array* %arg${i}, %Array** ${allocaReg}`);
      } else {
        this.ctx.defineVariable(paramName, allocaReg, 'double', SymbolKind.Number, 'local');
        this.ctx.emit(`${allocaReg} = alloca double`);
        this.ctx.emit(`store double %arg${i}, double* ${allocaReg}`);
      }
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
      if (returnTypeIsVoid) {
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
    for (const stmt of block.statements) {
      if (stmt.type === 'return') {
        return true;
      }
      if (stmt.type === 'if' && (stmt as any).thenBlock) {
        if (this.hasReturnStatement((stmt as any).thenBlock)) return true;
        if ((stmt as any).elseBlock && this.hasReturnStatement((stmt as any).elseBlock)) return true;
      }
      if (stmt.type === 'while' && stmt.body) {
        if (this.hasReturnStatement(stmt.body)) return true;
      }
      if (stmt.type === 'for' && stmt.body) {
        if (this.hasReturnStatement(stmt.body)) return true;
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

  generateMain(topLevelObjectVariables: Map<string, any>): string {
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
        this.ctx.allocateVariable(item, []);
      } else if (item.type === 'if') {
        this.ctx.syncStateToGenerators();
        this.ctx.controlFlowGen.generateIfStatement(item as any, []);
      } else if (item.type === 'while') {
        this.ctx.syncStateToGenerators();
        this.ctx.controlFlowGen.generateWhileStatement(item as any, []);
      } else if (item.type === 'for') {
        this.ctx.syncStateToGenerators();
        this.ctx.controlFlowGen.generateForStatement(item as any, []);
      } else if (item.type === 'for_of') {
        this.ctx.syncStateToGenerators();
        this.ctx.controlFlowGen.generateForOfStatement(item as any, []);
      } else if (item.type === 'assignment') {
        this.ctx.generateBlock({ type: 'block', statements: [item as any] }, []);
      } else {
        this.ctx.generateExpression(item, []);
      }
    }

    if (!this.ctx.ast.topLevelItems || this.ctx.ast.topLevelItems.length === 0) {
      for (const stmt of this.ctx.ast.topLevelStatements) {
        this.ctx.allocateVariable(stmt, []);
      }
      for (const expr of this.ctx.ast.topLevelExpressions) {
        if ((expr as any).type === 'if') {
          this.ctx.syncStateToGenerators();
          this.ctx.controlFlowGen.generateIfStatement(expr as any, []);
        } else if ((expr as any).type === 'while') {
          this.ctx.syncStateToGenerators();
          this.ctx.controlFlowGen.generateWhileStatement(expr as any, []);
        } else if ((expr as any).type === 'for') {
          this.ctx.syncStateToGenerators();
          this.ctx.controlFlowGen.generateForStatement(expr as any, []);
        } else if ((expr as any).type === 'for_of') {
          this.ctx.syncStateToGenerators();
          this.ctx.controlFlowGen.generateForOfStatement(expr as any, []);
        } else {
          this.ctx.generateExpression(expr, []);
        }
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
