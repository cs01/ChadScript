import { FunctionNode, BlockStatement, Expression, FunctionParameter, AST, VariableDeclaration, IfStatement, WhileStatement, ForStatement, ForOfStatement, AssignmentStatement, CommonField, SwitchStatement } from '../../ast/types.js';
import { SymbolKind, SymbolTable, createPointerAllocaMetadata, createInterfacePointerAllocaMetadata, createClassMetadata, createObjectMetadataWithInterface, createUnionMetadata, createInterfaceMetadata, SymbolMetadata } from './symbol-table.js';
import type { ClosureInfo } from './closure-analyzer.js';
import type { TypeChecker } from '../../typescript/type-checker.js';
import type { StringGenerator } from '../types/collections/string.js';
import type { ControlFlowGenerator } from '../statements/control-flow.js';
import type { InterfaceStructGenerator } from '../types/interface-struct-generator.js';
import { stripOptional, tsTypeToLlvm } from './type-system.js';

interface LiftedFunction extends FunctionNode {
  closureInfo?: ClosureInfo;
}

export interface FunctionGeneratorContext {
  reset(): void;
  syncStateToGenerators(): void;
  nextTemp(): string;
  emit(instruction: string): void;
  setCurrentLabel(label: string): void;
  defineVariable(name: string, allocaReg: string, llvmType: string, kind: number, scope: string): void;
  defineVariableWithMetadata(name: string, allocaReg: string, llvmType: string, kind: number, scope: string, metadata: SymbolMetadata): void;
  generateBlock(block: BlockStatement, params: string[]): string | null;
  generateExpression(expr: Expression, params: string[]): string;
  allocateVariable(stmt: VariableDeclaration, params: string[]): void;
  getAst(): AST | undefined;
  topLevelStatementsCount: number;
  topLevelExpressionsCount: number;
  topLevelItemsCount: number;
  getTopLevelItemsCount(): number;
  getTopLevelStatementsCount(): number;
  getTopLevelExpressionsCount(): number;
  getTopLevelItem(index: number): Expression;
  getTopLevelStatement(index: number): VariableDeclaration;
  getTopLevelExpression(index: number): Expression;
  getOutputAsString(): string;
  processTopLevelItem(index: number): void;
  setCurrentFunction(name: string): void;
  setCurrentFunctionReturnType(type: string): void;
  setCurrentFunctionTsReturnType(type: string | undefined): void;
  setIsAsyncFunction(value: boolean): void;
  setAsyncResultPromise(value: string): void;
  getAsyncResultPromise(): string;
  interfaceStructGenHasInterface(name: string): boolean;
  getAllocaInstructions(): string[];
  clearAllocaInstructions(): void;
  getOutput(): string[];
  clearOutput(): void;
  pushOutput(line: string): void;
  createEmptyStringConstant(): string;
}

export class FunctionGenerator {
  private ctx: FunctionGeneratorContext;

  constructor(ctx: FunctionGeneratorContext) {
    this.ctx = ctx;
  }

  generate(func: FunctionNode): string {
    this.ctx.reset();
    this.ctx.syncStateToGenerators();
    const funcName = func.name || '';
    this.ctx.setCurrentFunction(funcName);
    this.ctx.setIsAsyncFunction(func.async || false);
    this.ctx.setAsyncResultPromise('');

    const funcParams: string[] = func.params || [];
    const paramTypes: string[] = [];
    const paramLLVMTypes: string[] = [];
    let returnType = 'double';
    let returnTypeIsString = false;
    let returnTypeIsVoid = false;
    this.ctx.setCurrentFunctionReturnType('double');

    const hasParamTypes = func.paramTypes ? true : false;
    let paramTypesLen = 0;
    if (hasParamTypes) {
      paramTypesLen = func.paramTypes!.length;
    }
    const funcIsAsync = func.async ? true : false;
    if (funcIsAsync) {
      returnType = '%Promise*';
      this.ctx.setCurrentFunctionReturnType('%Promise*');
    } else if (hasParamTypes && paramTypesLen > 0) {
      for (let i = 0; i < funcParams.length; i++) {
        const paramType = func.paramTypes![i] || 'number';
        const paramName = funcParams[i] || '';
        paramTypes.push(paramType);
        if (paramName === 'nodePtr' || paramName === 'treePtr') {
          paramLLVMTypes.push('i8*');
        } else if (paramType === 'string') {
          paramLLVMTypes.push('i8*');
        } else if (paramType === 'string[]') {
          paramLLVMTypes.push('%StringArray*');
        } else if (paramType === 'number[]' || paramType === 'boolean[]') {
          paramLLVMTypes.push('%Array*');
        } else if (paramType.endsWith('[]')) {
          paramLLVMTypes.push('%ObjectArray*');
        } else if (this.isEnumType(paramType)) {
          paramLLVMTypes.push('double');
        } else if (paramType !== 'number' && paramType !== 'boolean') {
          if (this.ctx.interfaceStructGenHasInterface(paramType)) {
            paramLLVMTypes.push(`%${paramType}*`);
          } else {
            paramLLVMTypes.push('i8*');
          }
        } else {
          paramLLVMTypes.push('double');
        }
      }
    } else {
      const hasParameters = func.parameters ? true : false;
      if (hasParameters) {
        let paramCount = 0;
        const paramsArr = func.parameters;
        if (paramsArr) {
          let idx = 0;
          while (paramsArr[idx]) {
            paramCount = paramCount + 1;
            idx = idx + 1;
          }
        }
        if (paramCount > 0) {
          for (let i = 0; i < funcParams.length; i++) {
            const param = func.parameters![i] as { name: string; type: string };
            const paramType = param?.type || 'number';
            const paramName = funcParams[i];
            paramTypes.push(paramType);
            if (paramName === 'nodePtr' || paramName === 'treePtr') {
              paramLLVMTypes.push('i8*');
            } else if (paramType === 'string') {
              paramLLVMTypes.push('i8*');
            } else if (paramType === 'string[]') {
              paramLLVMTypes.push('%StringArray*');
            } else if (paramType === 'number[]' || paramType === 'boolean[]') {
              paramLLVMTypes.push('%Array*');
            } else if (paramType.endsWith('[]')) {
              paramLLVMTypes.push('%ObjectArray*');
            } else if (this.isEnumType(paramType)) {
              paramLLVMTypes.push('double');
            } else if (paramType !== 'number' && paramType !== 'boolean') {
              if (this.ctx.interfaceStructGenHasInterface(paramType)) {
                paramLLVMTypes.push(`%${paramType}*`);
              } else {
                paramLLVMTypes.push('i8*');
              }
            } else {
              paramLLVMTypes.push('double');
            }
          }
        }
      }
    }

    if (!func.async) {
      const theReturnType = func.returnType || '';
      if (theReturnType === 'string') {
        returnType = 'i8*';
        returnTypeIsString = true;
        this.ctx.setCurrentFunctionReturnType('i8*');
      } else if (theReturnType === 'void') {
        returnType = 'void';
        returnTypeIsVoid = true;
        this.ctx.setCurrentFunctionReturnType('void');
      } else if (theReturnType && this.isEnumType(theReturnType)) {
        returnType = 'double';
        this.ctx.setCurrentFunctionReturnType('double');
      } else if (theReturnType && theReturnType !== '' && theReturnType !== 'number' && theReturnType !== 'boolean') {
        returnType = tsTypeToLlvm(theReturnType);
        this.ctx.setCurrentFunctionReturnType(returnType);
      }
      this.ctx.setCurrentFunctionTsReturnType(theReturnType);
    }

    const funcBody = func.body || { statements: [] };
    if (!returnTypeIsString && !returnTypeIsVoid && !this.hasReturnStatement(funcBody)) {
      returnType = 'void';
      returnTypeIsVoid = true;
      this.ctx.setCurrentFunctionReturnType('void');
    }

    while (paramLLVMTypes.length < funcParams.length) {
      paramTypes.push('number');
      paramLLVMTypes.push('double');
    }

    const liftedFunc = func as LiftedFunction;
    const closureInfo = liftedFunc.closureInfo;
    const hasClosure = false;
    const captures = closureInfo ? closureInfo.captures : null;
    let hasOptionalParams = false;
    if (func.parameters) {
      const paramLen = func.parameters.length;
      let pIdx = 0;
      while (pIdx < paramLen) {
        const p = func.parameters[pIdx];
        if (!p) {
          pIdx = pIdx + 1;
          continue;
        }
        const pTyped = p as FunctionParameter;
        if (pTyped.optional || pTyped.defaultValue) {
          hasOptionalParams = true;
          break;
        }
        pIdx = pIdx + 1;
      }
    }

    let ir = `define ${returnType} @${funcName}(`;
    const paramStrings: string[] = [];
    if (hasClosure) {
      paramStrings.push('i8* %__env');
    }
    if (hasOptionalParams) {
      paramStrings.push('i32 %__argc');
    }
    for (let i = 0; i < funcParams.length; i++) {
      const llvmType = paramLLVMTypes[i] || 'double';
      paramStrings.push(`${llvmType} %arg${i}`);
    }
    ir += paramStrings.join(', ');
    ir += ') {\n';
    ir += 'entry:\n';
    this.ctx.setCurrentLabel('entry');

    for (let i = 0; i < funcParams.length; i++) {
      const paramName = funcParams[i];
      if (!paramName) continue;
      const allocaReg = this.ctx.nextTemp();
      const llvmType = paramLLVMTypes[i];
      const paramInfo = func.parameters?.[i];
      const isOptional = paramInfo?.optional || paramInfo?.defaultValue;

      if (llvmType === 'i8*') {
        if (paramTypes[i] === 'string') {
          this.ctx.defineVariable(paramName, allocaReg, 'i8*', SymbolKind.String, 'local');
        } else if (paramName === 'nodePtr' || paramName === 'treePtr') {
          this.ctx.defineVariable(paramName, allocaReg, 'i8*', SymbolKind.Pointer, 'local');
        } else {
          const ast = this.ctx.getAst();
          let classDefResult: { name: string } | null = null;
          const classes = ast?.classes || [];
          for (let j = 0; j < classes.length; j++) {
            const cls = classes[j] as { name: string };
            if (!cls || !cls.name) continue;
            if (cls.name === paramTypes[i]) {
              classDefResult = cls;
              break;
            }
          }

          let interfaceDefResult: { name: string; fields: { name: string; type: string }[] } | null = null;
          const interfaces = ast?.interfaces || [];
          for (let j = 0; j < interfaces.length; j++) {
            const iface = interfaces[j] as { name: string; fields: { name: string; type: string }[] };
            if (!iface || !iface.name) continue;
            if (iface.name === paramTypes[i]) {
              interfaceDefResult = iface;
              break;
            }
          }

          let typeAliasResult: { name: string; unionMembers: string[] } | null = null;
          const typeAliases = ast?.typeAliases || [];
          for (let j = 0; j < typeAliases.length; j++) {
            const ta = typeAliases[j] as { name: string; unionMembers: string[] };
            if (!ta || !ta.name) continue;
            if (ta.name === paramTypes[i]) {
              typeAliasResult = ta;
              break;
            }
          }

          if (classDefResult) {
            this.ctx.defineVariableWithMetadata(paramName, allocaReg, 'i8*', SymbolKind.Class, 'local', createClassMetadata({ className: classDefResult.name }));
          } else if (interfaceDefResult) {
            const interfaceDef = interfaceDefResult as { name: string; fields: { name: string; type: string }[] };
            const keys: string[] = [];
            const types: string[] = [];
            if (interfaceDef.fields) {
              for (let j = 0; j < interfaceDef.fields.length; j++) {
                const field = interfaceDef.fields[j] as { name: string; type: string };
                if (!field || !field.name) continue;
                const fieldName = stripOptional(field.name);
                keys.push(fieldName);
                types.push(this.convertTsTypeForField(fieldName, field.type));
              }
            }
            this.ctx.defineVariableWithMetadata(paramName, allocaReg, 'i8*', SymbolKind.Object, 'local', createObjectMetadataWithInterface({ keys, types }, paramTypes[i]));
          } else if (typeAliasResult && typeAliasResult.unionMembers) {
            const commonFields = this.getUnionCommonFields(typeAliasResult.unionMembers);
            this.ctx.defineVariableWithMetadata(paramName, allocaReg, 'i8*', SymbolKind.Object, 'local', createUnionMetadata(commonFields, paramTypes[i], typeAliasResult.unionMembers));
          } else {
            this.ctx.defineVariable(paramName, allocaReg, 'i8*', SymbolKind.Object, 'local');
          }
        }
        this.ctx.emit(`${allocaReg} = alloca i8*`);
        if (isOptional && hasOptionalParams) {
          this.generateOptionalParamInit(i, allocaReg, llvmType, paramInfo!, funcParams);
        } else {
          this.ctx.emit(`store i8* %arg${i}, i8** ${allocaReg}`);
        }
      } else if (llvmType === '%StringArray*') {
        this.ctx.defineVariableWithMetadata(paramName, allocaReg, '%StringArray*', SymbolKind.StringArray, 'local', createPointerAllocaMetadata());
        this.ctx.emit(`${allocaReg} = alloca %StringArray*`);
        if (isOptional && hasOptionalParams) {
          this.generateOptionalParamInit(i, allocaReg, llvmType, paramInfo!, funcParams);
        } else {
          this.ctx.emit(`store %StringArray* %arg${i}, %StringArray** ${allocaReg}`);
        }
      } else if (llvmType === '%Array*') {
        this.ctx.defineVariableWithMetadata(paramName, allocaReg, '%Array*', SymbolKind.Array, 'local', createPointerAllocaMetadata());
        this.ctx.emit(`${allocaReg} = alloca %Array*`);
        if (isOptional && hasOptionalParams) {
          this.generateOptionalParamInit(i, allocaReg, llvmType, paramInfo!, funcParams);
        } else {
          this.ctx.emit(`store %Array* %arg${i}, %Array** ${allocaReg}`);
        }
      } else if (llvmType === '%ObjectArray*') {
        let elementType = '';
        const pt = paramTypes[i] || '';
        if (pt.endsWith('[]') && pt.length > 2) {
          elementType = pt.substring(0, pt.length - 2);
        }
        if (elementType) {
          this.ctx.defineVariableWithMetadata(paramName, allocaReg, '%ObjectArray*', SymbolKind.ObjectArray, 'local', createInterfaceMetadata(elementType));
        } else {
          this.ctx.defineVariableWithMetadata(paramName, allocaReg, '%ObjectArray*', SymbolKind.ObjectArray, 'local', createPointerAllocaMetadata());
        }
        this.ctx.emit(`${allocaReg} = alloca %ObjectArray*`);
        if (isOptional && hasOptionalParams) {
          this.generateOptionalParamInit(i, allocaReg, llvmType, paramInfo!, funcParams);
        } else {
          this.ctx.emit(`store %ObjectArray* %arg${i}, %ObjectArray** ${allocaReg}`);
        }
      } else if (llvmType.startsWith('%') && llvmType.endsWith('*') && llvmType !== '%__FetchResponse*') {
        const interfaceName = llvmType.slice(1, -1);
        this.ctx.defineVariableWithMetadata(paramName, allocaReg, llvmType, SymbolKind.Object, 'local', createInterfacePointerAllocaMetadata(interfaceName));
        this.ctx.emit(`${allocaReg} = alloca ${llvmType}`);
        if (isOptional && hasOptionalParams) {
          this.generateOptionalParamInit(i, allocaReg, llvmType, paramInfo!, funcParams);
        } else {
          this.ctx.emit(`store ${llvmType} %arg${i}, ${llvmType}* ${allocaReg}`);
        }
      } else {
        this.ctx.defineVariable(paramName, allocaReg, 'double', SymbolKind.Number, 'local');
        this.ctx.emit(`${allocaReg} = alloca double`);
        if (isOptional && hasOptionalParams) {
          this.generateOptionalParamInit(i, allocaReg, llvmType, paramInfo!, funcParams);
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
      this.ctx.setAsyncResultPromise(resultPromise);
      this.ctx.emit(`${resultPromise} = call %Promise* @__Promise_new()`);
    }

    const result = this.ctx.generateBlock(funcBody, funcParams);

    const deferredAllocas = this.ctx.getAllocaInstructions();
    if (deferredAllocas.length > 0) {
      const newOutput: string[] = [];
      for (let i = 0; i < deferredAllocas.length; i++) {
        newOutput.push(deferredAllocas[i]);
      }
      const outputArr: string[] = this.ctx.getOutput();
      const outputArrLen = outputArr.length;
      for (let i = 0; i < outputArrLen; i++) {
        newOutput.push(outputArr[i]);
      }
      this.ctx.clearOutput();
      for (let i = 0; i < newOutput.length; i++) {
        this.ctx.pushOutput(newOutput[i]);
      }
      this.ctx.clearAllocaInstructions();
    }

    const output2: string[] = this.ctx.getOutput();
    const output2Len = output2.length;
    for (let i = 0; i < output2Len; i++) {
      const line: string = output2[i].trim();
      // Match 'ret <type>' without a value (e.g., 'ret i8*' or 'ret double')
      // Stage0-safe: avoid regex due to GC interference with libc malloc
      if (line.startsWith('ret ')) {
        const rest = line.substring(4);
        let isRetTypeOnly = false;
        let retType = '';
        if (rest === 'i8*') {
          isRetTypeOnly = true;
          retType = 'i8*';
        } else if (rest === 'double') {
          isRetTypeOnly = true;
          retType = 'double';
        } else if (rest.startsWith('%') && (rest.endsWith('*') || rest.indexOf(' ') === -1)) {
          const hasSpace = rest.indexOf(' ') !== -1;
          if (!hasSpace) {
            isRetTypeOnly = true;
            retType = rest;
          }
        }
        if (isRetTypeOnly) {
          let defaultValue: string;
          if (retType === 'double') {
            defaultValue = '0.0';
          } else if (retType === 'i8*') {
            defaultValue = this.ctx.createEmptyStringConstant();
          } else {
            defaultValue = 'null';
          }
          output2[i] = `ret ${retType} ${defaultValue}`;
        }
      }
    }

    const ctxOutput: string[] = output2;
    const outputLen = ctxOutput.length;
    if (outputLen > 0) {
      let indentedLines = '';
      for (let idx = 0; idx < outputLen; idx++) {
        const line: string = ctxOutput[idx];
        if (line) {
          if (indentedLines.length > 0) {
            indentedLines = indentedLines + '\n';
          }
          indentedLines = indentedLines + '  ' + line;
        }
      }
      if (indentedLines.length > 0) {
        ir += indentedLines + '\n';
      }
    }

    const lastInstruction: string = outputLen > 0 ? ctxOutput[outputLen - 1].trim() : '';
    const hasTerminator = lastInstruction.startsWith('ret ') ||
                          lastInstruction.startsWith('br ') ||
                          lastInstruction === 'unreachable';

    if (!hasTerminator) {
      if (func.async) {
        const asyncPromise = this.ctx.getAsyncResultPromise();
        this.ctx.emit(`call void @__Promise_resolve(%Promise* ${asyncPromise}, i8* null)`);
        const asyncOutput: string[] = this.ctx.getOutput();
        const asyncOutputLen = asyncOutput.length;
        const lastLine: string = asyncOutputLen > 0 ? asyncOutput[asyncOutputLen - 1] : '';
        if (lastLine) {
          ir += '  ' + lastLine + '\n';
        }
        ir += `  ret %Promise* ${asyncPromise}` + '\n';
      } else if (returnTypeIsVoid) {
        ir += '  ret void\n';
      } else if (result !== null && result !== '' && result !== '0') {
        ir += `  ret ${returnType} ${result}` + '\n';
      } else {
        if (returnTypeIsString) {
          const emptyStr = this.ctx.createEmptyStringConstant();
          ir += `  ret i8* ${emptyStr}` + '\n';
        } else if (returnType && returnType.indexOf('*') !== -1) {
          ir += `  ret ${returnType} null` + '\n';
        } else {
          ir += `  ret ${returnType} 0.0` + '\n';
        }
      }
    }
    ir += '}\n';

    return ir;
  }

  private hasReturnStatement(block: BlockStatement): boolean {
    if (!block) return false;
    if (!block.statements) return false;
    for (let i = 0; i < block.statements.length; i++) {
      const stmt = block.statements[i] as { type: string };
      if (!stmt) continue;
      if (stmt.type === 'return') {
        return true;
      }
      if (stmt.type === 'if') {
        const ifStmt = block.statements[i] as IfStatement;
        if (ifStmt.thenBlock && this.hasReturnStatement(ifStmt.thenBlock)) return true;
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
      if (stmt.type === 'switch') {
        const switchStmt = block.statements[i] as SwitchStatement;
        if (!switchStmt.cases) continue;
        for (let j = 0; j < switchStmt.cases.length; j++) {
          const caseItem = switchStmt.cases[j];
          if (!caseItem) continue;
          if (!caseItem.consequent) continue;
          for (let k = 0; k < caseItem.consequent.length; k++) {
            const consequentStmt = caseItem.consequent[k] as { type: string };
            if (!consequentStmt) continue;
            if (consequentStmt.type === 'return') return true;
          }
        }
      }
      if (stmt.type === 'block') {
        const blockStmt = block.statements[i] as BlockStatement;
        if (this.hasReturnStatement(blockStmt)) return true;
      }
    }
    return false;
  }

  private isEnumType(typeName: string): boolean {
    const ast = this.ctx.getAst();
    const enums = ast?.enums;
    if (!enums) return false;
    let checkType = typeName;
    if (checkType.indexOf(' | ') !== -1) {
      const parts = checkType.split(' | ');
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j].trim();
        if (part !== 'undefined' && part !== 'null') {
          checkType = part;
          break;
        }
      }
    }
    for (let i = 0; i < enums.length; i++) {
      const enumDecl = enums[i];
      if (enumDecl.name === checkType) {
        return true;
      }
    }
    return false;
  }

  private convertTsType(tsType: string): string {
    if (this.isEnumType(tsType)) {
      return 'double';
    }
    return tsTypeToLlvm(tsType);
  }

  private convertTsTypeForField(fieldName: string, tsType: string): string {
    if (fieldName === 'nodePtr' || fieldName === 'treePtr') {
      return 'i8*';
    }
    if (this.isEnumType(tsType)) {
      return 'double';
    }
    return tsTypeToLlvm(tsType);
  }

  private llvmTypeToSymbolKind(llvmType: string): number {
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
    const ast = this.ctx.getAst();
    const astInterfaces = ast?.interfaces || [];
    for (let i = 0; i < memberNames.length; i++) {
      const memberName = memberNames[i];
      if (!memberName) continue;
      for (let j = 0; j < astInterfaces.length; j++) {
        const iface = astInterfaces[j] as { name: string; fields: { name: string; type: string }[] };
        if (!iface || !iface.name) continue;
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
    const firstFields = firstInterface.fields || [];
    const commonFields: CommonField[] = [];

    for (let fi = 0; fi < firstFields.length; fi++) {
      const field = firstFields[fi] as { name: string; type: string };
      if (!field || !field.name) continue;
      let isCommon = true;
      for (let ii = 0; ii < interfaces.length; ii++) {
        const ifaceTyped = interfaces[ii] as { fields: { name: string; type: string }[] };
        if (!ifaceTyped.fields) {
          isCommon = false;
          break;
        }
        let found = false;
        for (let fj = 0; fj < ifaceTyped.fields.length; fj++) {
          const f = ifaceTyped.fields[fj] as { name: string; type: string };
          if (!f || !f.name) continue;
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
      keys.push(stripOptional(cf.name));
      types.push(this.convertTsType(cf.type));
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
    this.ctx.setCurrentLabel('entry');

    ir += '  ; Initialize garbage collector\n';
    ir += '  call void @GC_init()\n';
    ir += '\n';

    ir += '  store i32 %argc, i32* @__argc\n';
    ir += '  store i8** %argv, i8*** @__argv\n';

    this.ctx.reset();

    const topLevelItemsCount = this.ctx.getTopLevelItemsCount();
    const topLevelStatementsCount = this.ctx.getTopLevelStatementsCount();
    const topLevelExpressionsCount = this.ctx.getTopLevelExpressionsCount();

    if (topLevelItemsCount > 0) {
      for (let itemIdx = 0; itemIdx < topLevelItemsCount; itemIdx++) {
        this.ctx.processTopLevelItem(itemIdx);
      }
    } else {
      for (let i = 0; i < topLevelStatementsCount; i++) {
        const stmt = this.ctx.getTopLevelStatement(i);
        this.ctx.allocateVariable(stmt as VariableDeclaration, []);
      }
      for (let i = 0; i < topLevelExpressionsCount; i++) {
        const expr = this.ctx.getTopLevelExpression(i);
        this.ctx.generateExpression(expr as Expression, []);
      }
    }

    const deferredAllocas = this.ctx.getAllocaInstructions();
    if (deferredAllocas.length > 0) {
      const newOutput: string[] = [];
      for (let i = 0; i < deferredAllocas.length; i++) {
        newOutput.push(deferredAllocas[i]);
      }
      const methodOutputArr: string[] = this.ctx.getOutput();
      const methodOutputLen = methodOutputArr.length;
      for (let i = 0; i < methodOutputLen; i++) {
        newOutput.push(methodOutputArr[i]);
      }
      this.ctx.clearOutput();
      for (let i = 0; i < newOutput.length; i++) {
        this.ctx.pushOutput(newOutput[i]);
      }
      this.ctx.clearAllocaInstructions();
    }

    const outputStr = this.ctx.getOutputAsString();
    if (outputStr.length > 0) {
      ir += outputStr;
    }

    ir += '  ret i32 0\n';
    ir += '}\n';

    return ir;
  }
}
