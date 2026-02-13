import { AST, Expression, FunctionNode, BlockStatement, NewNode, CallNode, VariableNode, VariableDeclaration, ObjectNode, ObjectProperty, MethodCallNode, InterfaceDeclaration, InterfaceField, TypeAliasDeclaration, Statement, AssignmentStatement, ImportDeclaration, ImportSpecifier, IfStatement, WhileStatement, ForStatement, ForOfStatement, TryStatement, ClassNode, ArrayNode, MapNode, SetNode, ArrowFunctionNode, UnaryNode, IndexAccessNode } from '../ast/types.js';
import { BaseGenerator, SymbolKind } from './infrastructure/base-generator.js';
import { ClassInfo, MapMetadata, SetMetadata, ObjectArrayMetadata, ClosureMetadata, Symbol as SymbolEntry, createPointerAllocaMetadata, createClassMetadata, createObjectMetadataWithInterface, createInterfaceMetadata, createMapMetadataSymbol, ObjectMetadata } from './infrastructure/symbol-table.js';
import { TypeInference, TypeInferenceContext } from './infrastructure/type-inference.js';
import { VariableAllocator, VariableAllocatorContext } from './infrastructure/variable-allocator.js';
import { FunctionGenerator, FunctionGeneratorContext } from './infrastructure/function-generator.js';
import { AssignmentGenerator, AssignmentGeneratorContext } from './infrastructure/assignment-generator.js';
import { getLLVMDeclarations, getSafeStringHelper, getDoubleToStringHelper, getStringHashHelper, getGlobalVariables } from './infrastructure/llvm-declarations.js';
import { TypeResolver, TypeResolverContext, TypeGuardInfo } from './infrastructure/type-resolver/index.js';
import { stripOptional, stripNullable, tsTypeToLlvmJson, ResolvedType } from './infrastructure/type-system.js';
import { IGeneratorContext } from './infrastructure/generator-context.js';
import { ArrayGenerator } from './types/collections/array.js';
import { StringGenerator } from './types/collections/string.js';
import { ObjectGenerator } from './types/objects/object.js';
import { MapGenerator, StringMapGenerator, PointerMapGenerator } from './types/collections/map.js';
import { SetGenerator, StringSetGenerator } from './types/collections/set.js';
import { ControlFlowGenerator } from './statements/control-flow.js';
import { ClassGenerator } from './types/objects/class.js';
import { RegexGenerator } from './types/objects/regex.js';
import { MathGenerator } from './stdlib/math.js';
import { ConsoleGenerator } from './stdlib/console.js';
import { ProcessGenerator } from './stdlib/process.js';
import { PathGenerator } from './stdlib/path.js';
import { JsonGenerator } from './stdlib/json.js';
import { DateGenerator } from './stdlib/date.js';
import { FilesystemGenerator } from './stdlib/fs.js';
import { ResponseGenerator } from './stdlib/response.js';
import { CryptoGenerator } from './stdlib/crypto.js';
import { SqliteGenerator } from './stdlib/sqlite.js';
import { RuntimeGenerator } from './runtime/runtime.js';
import { MongooseGenerator } from './stdlib/mongoose.js';
import { LibuvGenerator } from './stdlib/libuv.js';
import { PromiseGenerator } from './stdlib/promise.js';
import { TreeSitterGenerator } from './stdlib/treesitter.js';
import { ExpressionGenerator } from './expressions/orchestrator.js';
import type { TypeChecker } from '../typescript/type-checker.js';
import { InterfaceStructGenerator } from './types/interface-struct-generator.js';
import { JsonObjectMeta } from './expressions/access/member.js';

export interface LLVMGeneratorOptions {
  linkTreeSitter?: boolean;
  sourceCode?: string;
  filename?: string;
}

// ============================================
// LLVM IR CODE GENERATOR - Main Orchestrator
// ============================================

export class LLVMGenerator extends BaseGenerator implements IGeneratorContext {
  public ast: AST;
  public typeChecker: TypeChecker | null;
  private externalFunctions: Set<string>;
  public currentFunction: string | null = null;
  public currentDeclaredInterfaceType: string | undefined;
  public currentDeclaredMapType: string | undefined;
  public currentDeclaredSetType: string | undefined;
  public currentFunctionReturnType: string = 'double';
  public currentFunctionTsReturnType: string | undefined;
  public isAsyncFunction: boolean = false;
  public asyncResultPromise: string = '';

  // Top-level variables (accessible from all functions)
  private topLevelObjectVariables: Map<string, { ptr: string; keys: string[]; types: string[] }>;

  // Global variables declared with LLVM @ prefix (accessible from any function)
  private globalVariables: Map<string, { llvmType: string; kind: number; initialized: boolean }>;

  // Import alias map: local name -> original name (for renamed imports like "x as y")
  private importAliasMap: Map<string, string>;

  // Specialized generators (public for context pattern access)
  public arrayGen: ArrayGenerator;
  public stringGen: StringGenerator;
  public objectGen: ObjectGenerator;
  public mapGen: MapGenerator;
  public stringMapGen: StringMapGenerator;
  public pointerMapGen: PointerMapGenerator;
  public setGen: SetGenerator;
  public stringSetGen: StringSetGenerator;
  private controlFlowGen: ControlFlowGenerator;
  public classGen: ClassGenerator;
  public classGenClassFields: Map<string, { name: string; fieldType: string; tsType?: string }[]>;
  public regexGen: RegexGenerator;

  // Method generators (public for context pattern access)
  public mathGen: MathGenerator;
  public consoleGen: ConsoleGenerator;
  public processGen: ProcessGenerator;
  public pathGen: PathGenerator;
  public jsonGen: JsonGenerator;
  public dateGen: DateGenerator;
  public fsGen: FilesystemGenerator;
  public responseGen: ResponseGenerator;
  public cryptoGen: CryptoGenerator;
  public sqliteGen: SqliteGenerator;
  private runtimeGen: RuntimeGenerator;
  private mongooseGen: MongooseGenerator;
  private libuvGen: LibuvGenerator;
  private promiseGen: PromiseGenerator;
  private treesitterGen: TreeSitterGenerator;
  private httpHandlers: string[];
  public usesTimers: number = 0;
  public usesPromises: number = 0;
  public usesSqlite: number = 0;
  public usesCurl: number = 0;
  public usesCrypto: number = 0;
  public usesJson: number = 0;
  public usesMongoose: number = 0;

  // Expression generator (context pattern)
  private exprGen: ExpressionGenerator;

  // Type inference helper
  private typeInference: TypeInference;

  // Type resolver (consolidates type resolution logic)
  public typeResolver: TypeResolver;

  // Variable allocator
  private varAllocator: VariableAllocator;

  // Function generator
  private funcGen: FunctionGenerator;

  // Assignment generator
  private assignmentGen: AssignmentGenerator;

  // Interface struct generator
  public interfaceStructGen: InterfaceStructGenerator;

  // Cache for interface struct defs (used at end of generate())
  private interfaceStructDefsCache: string = '';

  // Cache for class struct defs (used at end of generate())
  private classStructDefsCache: string = '';

  // JSON object metadata for tracking parsed JSON structures
  public jsonObjectMetadata: Map<string, JsonObjectMeta>;

  // Helper: Format nice compiler errors (public for context pattern access)
  public formatCodegenError(message: string, suggestion?: string, pos?: number): string {
    let error = '';

    // If we have source code and position, show the line with arrow
    if (this.sourceCode && pos !== undefined) {
      const lines = this.sourceCode.substring(0, pos).split('\n');
      const lineNum = lines.length;
      const col = lines[lines.length - 1].length;
      const allLines = this.sourceCode.split('\n');

      const lineNumStr = String(lineNum);
      const lineNumWidth = lineNumStr.length > 2 ? lineNumStr.length : 2;

      const filename = this.filename || '<input>';
      error += `${filename}:${lineNum}:${col + 1}: error: ${message}` + '\n';
      error += `${' '.repeat(lineNumWidth)} |` + '\n';

      const lineContent = allLines[lineNum - 1] || '';
      error += `${lineNumStr.padStart(lineNumWidth)} | ${lineContent}` + '\n';
      error += `${' '.repeat(lineNumWidth)} | ${' '.repeat(col)}^` + '\n';

      if (suggestion) {
        error += `${' '.repeat(lineNumWidth)} |` + '\n';
        error += `${' '.repeat(lineNumWidth)} = help: ${suggestion}` + '\n';
      }
    } else {
      error = `error: ${message}` + '\n';
      if (suggestion) {
        error += `  help: ${suggestion}` + '\n';
      }
    }

    return error;
  }

  private extractInlineInterfaceType(returnType: string): string | null {
    if (returnType.startsWith('{')) {
      return returnType;
    }
    if (returnType.indexOf(' | ') !== -1) {
      const parts = returnType.split(' | ');
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part.startsWith('{')) {
          return part;
        }
      }
    }
    return null;
  }

  public getClassesCount(): number {
    return this.classesCount;
  }

  public getAst(): AST | undefined {
    return this.ast;
  }

  public getAstInterfacesLength(): number {
    if (!this.ast || !this.ast.interfaces) return 0;
    return this.ast.interfaces.length;
  }

  public getAstInterfaceAt(index: number): InterfaceDeclaration | null {
    if (!this.ast || !this.ast.interfaces) return null;
    if (index < 0 || index >= this.ast.interfaces.length) return null;
    return this.ast.interfaces[index];
  }

  public getAstInterfaceNameAt(index: number): string | null {
    if (!this.ast || !this.ast.interfaces) return null;
    if (index < 0 || index >= this.ast.interfaces.length) return null;
    const iface = this.ast.interfaces[index];
    if (!iface || !iface.name) return null;
    return iface.name;
  }

  public getAstFunctionsLength(): number {
    if (!this.ast || !this.ast.functions) return 0;
    return this.ast.functions.length;
  }

  public getAstFunctionAt(index: number): FunctionNode | null {
    if (!this.ast || !this.ast.functions) return null;
    if (index < 0 || index >= this.ast.functions.length) return null;
    return this.ast.functions[index];
  }

  public getAstFunctionNameAt(index: number): string | null {
    if (!this.ast || !this.ast.functions) return null;
    if (index < 0 || index >= this.ast.functions.length) return null;
    const func = this.ast.functions[index];
    if (!func || !func.name) return null;
    return func.name;
  }

  public getAstClassesLength(): number {
    if (!this.ast || !this.ast.classes) return 0;
    return this.ast.classes.length;
  }

  public getAstClassAt(index: number): ClassNode | null {
    if (!this.ast || !this.ast.classes) return null;
    if (index < 0 || index >= this.ast.classes.length) return null;
    return this.ast.classes[index];
  }

  public getAstClassNameAt(index: number): string | null {
    if (!this.ast || !this.ast.classes) return null;
    if (index < 0 || index >= this.ast.classes.length) return null;
    const cls = this.ast.classes[index];
    if (!cls || !cls.name) return null;
    return cls.name;
  }

  public getAstTypeAliasesLength(): number {
    return this.typeAliasesCount;
  }

  public getAstTypeAliasAt(index: number): TypeAliasDeclaration | null {
    if (!this.ast || !this.ast.typeAliases) return null;
    if (index < 0 || index >= this.typeAliasesCount) return null;
    return this.ast.typeAliases[index];
  }

  public getAstTypeAliasNameAt(index: number): string | null {
    if (!this.ast || !this.ast.typeAliases) return null;
    if (index < 0 || index >= this.typeAliasesCount) return null;
    const ta = this.ast.typeAliases[index];
    if (!ta || !ta.name) return null;
    return ta.name;
  }

  public getAstTypeAliasMembersAt(index: number): string[] | null {
    if (!this.ast || !this.ast.typeAliases) return null;
    if (index < 0 || index >= this.typeAliasesCount) return null;
    const ta = this.ast.typeAliases[index];
    if (!ta || !ta.unionMembers) return null;
    return ta.unionMembers;
  }

  public getParameterTypeFromAST(paramName: string): string | null {
    if (!paramName) return null;
    if (!this.ast) return null;
    const currentFunc = this.currentFunction;
    if (!currentFunc) return null;
    for (let i = 0; i < this.ast.functions.length; i++) {
      const fn = this.ast.functions[i];
      if (!fn) continue;
      if (!fn.name) continue;
      if (fn.name === currentFunc) {
        if (fn.parameters) {
          for (let j = 0; j < fn.parameters.length; j++) {
            const p = fn.parameters[j];
            if (!p) continue;
            if (!p.name) continue;
            if (p.name === paramName && p.type) {
              return p.type;
            }
          }
        }
      }
    }
    for (let i = 0; i < this.ast.classes.length; i++) {
      const cls = this.ast.classes[i];
      if (!cls) continue;
      for (let j = 0; j < cls.methods.length; j++) {
        const method = cls.methods[j];
        if (!method) continue;
        if (!method.name) continue;
        if (method.name === currentFunc) {
          if (method.paramTypes) {
            for (let k = 0; k < method.params.length; k++) {
              const methodParam = method.params[k];
              if (!methodParam) continue;
              if (methodParam === paramName && method.paramTypes[k]) {
                return method.paramTypes[k];
              }
            }
          }
        }
      }
    }
    return null;
  }

  public findClassImplementingInterface(interfaceName: string): string | null {
    if (!this.ast || !this.ast.classes) return null;
    let implementingClass: string | null = null;
    for (let i = 0; i < this.ast.classes.length; i++) {
      const cls = this.ast.classes[i];
      if (!cls) continue;
      if (!cls.name) continue;
      if (cls.implements) {
        for (let j = 0; j < cls.implements.length; j++) {
          const implName = cls.implements[j];
          if (!implName) continue;
          if (implName === interfaceName) {
            if (cls.name.indexOf('Mock') !== -1 || cls.name.indexOf('Test') !== -1) {
              continue;
            }
            if (implementingClass !== null) {
              return null;
            }
            implementingClass = cls.name;
          }
        }
      }
    }
    if (implementingClass) {
      return implementingClass;
    }
    if (interfaceName.endsWith('Context') || interfaceName.endsWith('Like')) {
      for (let i = 0; i < this.ast.classes.length; i++) {
        const cls = this.ast.classes[i];
        if (!cls) continue;
        if (!cls.name) continue;
        if (cls.implements) {
          for (let j = 0; j < cls.implements.length; j++) {
            if (cls.implements[j] === 'IGeneratorContext') {
              if (cls.name.indexOf('Mock') === -1 && cls.name.indexOf('Test') === -1) {
                return cls.name;
              }
            }
          }
        }
      }
    }
    return null;
  }

  public getInterfaceProperties(name: string): { keys: string[]; types: string[] } | null {
    if (!this.ast || !this.ast.interfaces) return null;
    const baseName = name.endsWith('?') ? name.slice(0, -1) : name;
    const cleanName = baseName.indexOf(' | ') !== -1 ? baseName.split(' | ')[0] : baseName;
    const keys: string[] = [];
    const types: string[] = [];
    for (let i = 0; i < this.ast.interfaces.length; i++) {
      const iface = this.ast.interfaces[i];
      if (!iface) continue;
      if (iface.name === cleanName) {
        if (!iface.fields) continue;
        for (let j = 0; j < iface.fields.length; j++) {
          const field = iface.fields[j] as InterfaceField;
          if (!field) continue;
          let fieldName = field.name;
          if (fieldName.endsWith('?')) {
            fieldName = fieldName.slice(0, -1);
          }
          keys.push(fieldName);
          types.push(field.type);
        }
      }
    }
    if (keys.length > 0) return { keys, types };
    return null;
  }

  public getInterfaceDeclByName(name: string): InterfaceDeclaration | null {
    if (!this.ast || !this.ast.interfaces) return null;
    for (let i = 0; i < this.ast.interfaces.length; i++) {
      const iface = this.ast.interfaces[i];
      if (!iface) continue;
      if (iface.name === name) {
        return iface;
      }
    }
    return null;
  }

  public isTypeAlias(name: string): boolean {
    if (!this.ast || !this.ast.typeAliases) return false;
    for (let i = 0; i < this.ast.typeAliases.length; i++) {
      const ta = this.ast.typeAliases[i];
      if (!ta) continue;
      if (ta.name === name) return true;
    }
    return false;
  }

  public getTypeAliasCommonProperties(name: string): { keys: string[]; types: string[] } | null {
    if (!this.ast || !this.ast.typeAliases) return null;
    for (let i = 0; i < this.ast.typeAliases.length; i++) {
      const ta = this.ast.typeAliases[i];
      if (!ta) continue;
      if (ta.name === name && ta.unionMembers) {
        let commonNames: string[] = [];
        let commonTypes: string[] = [];
        let first = true;
        for (let m = 0; m < ta.unionMembers.length; m++) {
          const memberName = ta.unionMembers[m];
          if (!memberName) continue;
          const memberProps = this.getInterfaceProperties(memberName);
          if (!memberProps) continue;
          if (first) {
            for (let p = 0; p < memberProps.keys.length; p++) {
              commonNames.push(memberProps.keys[p]);
              commonTypes.push(memberProps.types[p]);
            }
            first = false;
          } else {
            const nextNames: string[] = [];
            const nextTypes: string[] = [];
            for (let ci = 0; ci < commonNames.length; ci++) {
              let found = false;
              for (let p = 0; p < memberProps.keys.length; p++) {
                if (memberProps.keys[p] === commonNames[ci]) {
                  found = true;
                  break;
                }
              }
              if (found) {
                nextNames.push(commonNames[ci]);
                nextTypes.push(commonTypes[ci]);
              }
            }
            commonNames = nextNames;
            commonTypes = nextTypes;
          }
        }
        if (commonNames.length > 0) {
          return { keys: commonNames, types: commonTypes };
        }
      }
    }
    return null;
  }

  public getInterfaceFieldType(interfaceName: string, fieldName: string): string | null {
    if (interfaceName.startsWith('{') && interfaceName.endsWith('}')) {
      return null;
    }
    if (!this.ast || !this.ast.interfaces) return null;
    for (let i = 0; i < this.ast.interfaces.length; i++) {
      const iface = this.ast.interfaces[i];
      if (!iface) continue;
      if (iface.name === interfaceName) {
        if (!iface.fields) continue;
        for (let j = 0; j < iface.fields.length; j++) {
          const f = iface.fields[j] as InterfaceField;
          if (!f) continue;
          let fName = f.name;
          if (fName.endsWith('?')) {
            fName = fName.slice(0, -1);
          }
          if (fName === fieldName) {
            return f.type;
          }
        }
      }
    }
    return null;
  }

  public getMethodReturnType(className: string, methodName: string): string | null {
    if (!this.ast || !this.ast.classes) return null;
    for (let i = 0; i < this.ast.classes.length; i++) {
      const cls = this.ast.classes[i];
      if (!cls) continue;
      if (cls.name === className) {
        for (let j = 0; j < cls.methods.length; j++) {
          const method = cls.methods[j];
          if (!method) continue;
          if (method.name === methodName && method.returnType) {
            return method.returnType;
          }
        }
      }
    }
    return null;
  }

  public isEnumType(name: string): boolean {
    if (!this.ast || !this.ast.enums) return false;
    for (let i = 0; i < this.ast.enums.length; i++) {
      const eRaw = this.ast.enums[i];
      if (!eRaw) continue;
      const e = eRaw as { name: string };
      if (e.name === name) return true;
    }
    return false;
  }

  public getEnumMemberValue(enumName: string, memberName: string): number {
    if (!this.ast || !this.ast.enums) {
      return -1;
    }
    for (let i = 0; i < this.ast.enums.length; i++) {
      const eRaw = this.ast.enums[i];
      if (!eRaw) {
        continue;
      }
      const e = eRaw as { name: string; members: { name: string; value: number }[] };
      if (e.name === enumName && e.members) {
        for (let j = 0; j < e.members.length; j++) {
          const mRaw = e.members[j];
          if (!mRaw) continue;
          const m = mRaw as { name: string; value: number };
          if (m.name === memberName) {
            return j;
          }
        }
      }
    }
    return -1;
  }

  public getLastInstruction(): string {
    if (this.output.length === 0) return '';
    const last = this.output[this.output.length - 1];
    return last ? last.trim() : '';
  }

  public getBlockStatementsLength(block: BlockStatement): number {
    if (!block) return 0;
    const stmts = block.statements;
    if (!stmts) return 0;
    return stmts.length;
  }

  public getBlockStatementAt(block: BlockStatement, index: number): Statement | null {
    if (!block) return null;
    const stmts = block.statements;
    if (!stmts) return null;
    if (index < 0 || index >= stmts.length) return null;
    const stmt = stmts[index];
    return stmt || null;
  }

  public getStatementType(stmt: Statement | null): string {
    if (!stmt) return '';
    const stmtTyped = stmt as { type: string };
    const theType = stmtTyped.type;
    return theType || '';
  }

  // SymbolTable wrapper methods (avoid method chaining issues in native code)
  public symbolTableLookup(name: string): SymbolEntry | undefined { return this.symbolTable.lookup(name); }
  public symbolTableIsClass(name: string): boolean {
    const result = this.symbolTable.isClass(name);
    return result;
  }
  public symbolTableIsJSON(name: string): boolean {
    const result = this.symbolTable.isJSON(name);
    return result;
  }
  public symbolTableIsObject(name: string): boolean {
    const result = this.symbolTable.isObject(name);
    return result;
  }
  public symbolTableIsMap(name: string): boolean {
    const result = this.symbolTable.isMap(name);
    return result;
  }
  public symbolTableIsSet(name: string): boolean {
    const result = this.symbolTable.isSet(name);
    return result;
  }
  public symbolTableIsNumberArray(name: string): boolean {
    const result = this.symbolTable.isNumberArray(name);
    return result;
  }
  public symbolTableIsStringArray(name: string): boolean {
    const result = this.symbolTable.isStringArray(name);
    return result;
  }
  public symbolTableIsBooleanArray(name: string): boolean {
    const result = this.symbolTable.isBooleanArray(name);
    return result;
  }
  public symbolTableIsObjectArray(name: string): boolean {
    const result = this.symbolTable.isObjectArray(name);
    return result;
  }
  public symbolTableIsString(name: string): boolean {
    const result = this.symbolTable.isString(name);
    return result;
  }
  public symbolTableIsRegex(name: string): boolean {
    const result = this.symbolTable.isRegex(name);
    return result;
  }
  public symbolTableGetType(name: string): string | undefined { return this.symbolTable.getType(name); }
  public symbolTableGetClassName(name: string): string | undefined { return this.symbolTable.getClassName(name); }
  public symbolTableGetClassInfo(name: string): ClassInfo | undefined { return this.symbolTable.getClassInfo(name); }
  public symbolTableGetObjectInfo(name: string): { ptr: string; keys: string[]; types: string[]; tsTypes?: string[] } | undefined { return this.symbolTable.getObjectInfo(name); }
  public symbolTableHasObjectInfo(name: string): boolean {
    if (!this.symbolTable.isObject(name) && !this.symbolTable.isJSON(name)) return false;
    return this.symbolTable.getObjectMetadataKeys(name) !== undefined;
  }
  public symbolTableGetObjectInfoPtr(name: string): string | undefined {
    return this.symbolTable.getAlloca(name);
  }
  public symbolTableGetObjectInfoKeys(name: string): string[] | undefined {
    return this.symbolTable.getObjectMetadataKeys(name);
  }
  public symbolTableGetObjectInfoTypes(name: string): string[] | undefined {
    return this.symbolTable.getObjectMetadataTypes(name);
  }
  public symbolTableGetObjectInfoTsTypes(name: string): string[] | undefined {
    return this.symbolTable.getObjectMetadataTsTypes(name);
  }
  public symbolTableGetMapMetadata(name: string): MapMetadata | undefined { return this.symbolTable.getMapMetadata(name); }
  public symbolTableGetSetMetadata(name: string): string | undefined { return this.symbolTable.getSetValueType(name); }
  public symbolTableGetKind(name: string): number | undefined { return this.symbolTable.getKind(name); }
  public symbolTableGetClassMetadata(name: string) { return this.symbolTable.getClassMetadata(name); }
  public symbolTableGetArrayMetadata(name: string): string | undefined { return this.symbolTable.getArrayMetadataElementType(name); }
  public symbolTableGetInterfaceType(name: string): string | undefined { return this.symbolTable.getInterfaceType(name); }
  public symbolTableGetObjectArrayElementType(name: string): string | undefined { return this.symbolTable.getObjectArrayElementType(name); }
  public symbolTableGetConcreteClass(name: string): string | undefined { return this.symbolTable.getConcreteClass(name); }
  public symbolTableSetConcreteClass(name: string, concreteClass: string): void { this.symbolTable.setConcreteClass(name, concreteClass); }
  public symbolTableGetAlloca(name: string): string | undefined { return this.symbolTable.getAlloca(name); }
  public symbolTableGetScope(name: string): string | undefined { return this.symbolTable.getScope(name); }
  public symbolTableGetObjectArrayMetadata(name: string): ObjectArrayMetadata | undefined { return this.symbolTable.getObjectArrayMetadata(name); }
  public symbolTableIsPointerAlloca(name: string): boolean { return this.symbolTable.isPointerAlloca(name); }
  public symbolTableNarrowType(name: string, narrowedMetadata: { keys: string[]; types: string[]; tsTypes?: string[] }): void { this.symbolTable.narrowType(name, narrowedMetadata); }
  public symbolTableRestoreType(name: string): void { this.symbolTable.restoreType(name); }
  public symbolTableGetScopeVarsArraysForClosure(): { names: string[]; types: string[] } { return this.symbolTable.getScopeVarsArraysForClosure(); }
  public symbolTableIsClosure(name: string): boolean { return this.symbolTable.isClosure(name); }
  public symbolTableGetClosureMetadata(name: string): ClosureMetadata | undefined { return this.symbolTable.getClosureMetadata(name); }
  public symbolTableGetObjectPropertyType(varName: string, propertyName: string): string | null { return this.symbolTable.getObjectPropertyType(varName, propertyName); }
  public symbolTableGetObjectMetadata(name: string): { keys: string[]; types: string[]; tsTypes?: string[] } | undefined { return this.symbolTable.getObjectMetadata(name); }
  public symbolTableGetArrayAlloca(name: string): string | undefined { return this.symbolTable.getArrayAlloca(name); }
  public symbolTableSetObjectArrayMetadata(name: string, metadata: ObjectArrayMetadata): void { this.symbolTable.setObjectArrayMetadata(name, metadata); }
  public symbolTableGetResolvedType(name: string): ResolvedType | undefined { return this.symbolTable.getResolvedType(name); }
  public symbolTableSetResolvedType(name: string, resolvedType: ResolvedType): void { this.symbolTable.setResolvedType(name, resolvedType); }
  public classGenGetFieldInfo(className: string | null, fieldName: string | null): { index: number; type: string; tsType?: string } | null {
    if (!className || !fieldName) return null;
    const result = this.classGen.getFieldInfo(className, fieldName);
    if (!result) return null;
    return result;
  }

  private findClassNodeForFields(className: string): ClassNode | null {
    const ast = this.ast;
    if (!ast || !ast.classes) return null;
    for (let ci = 0; ci < ast.classes.length; ci++) {
      const c = ast.classes[ci] as ClassNode;
      if (!c) continue;
      if (!c.name) continue;
      if (c.name === className) {
        return c;
      }
    }
    return null;
  }

  private getAllFieldsForClass(classNode: ClassNode): { name: string; fieldType: string; tsType?: string }[] {
    const allFields: { name: string; fieldType: string; tsType?: string }[] = [];
    if (classNode.extends) {
      const parentClass = this.findClassNodeForFields(classNode.extends);
      if (parentClass) {
        const parentFields = this.getAllFieldsForClass(parentClass);
        for (let i = 0; i < parentFields.length; i++) {
          allFields.push(parentFields[i]);
        }
      }
    }
    const classFields = classNode.fields;
    const fieldsLen = classFields.length;
    for (let i = 0; i < fieldsLen; i++) {
      const field = classFields[i];
      allFields.push(field as { name: string; fieldType: string; tsType?: string });
    }
    return allFields;
  }
  public classGenGetClassFields(className: string): { name: string; fieldType: string }[] {
    return this.classGenClassFields.get(className) || [];
  }
  public classGenGetFieldType(className: string, fieldName: string): string | null {
    const info = this.classGenGetFieldInfo(className, fieldName);
    if (info) {
      return info.type;
    }
    return null;
  }
  public classGenGetFieldTsType(className: string, fieldName: string): string | null {
    const info = this.classGenGetFieldInfo(className, fieldName);
    if (info) {
      return info.tsType || null;
    }
    return null;
  }
  public classGenGenerateNewExpression(className: string, args: Expression[], params: string[]): string { return this.classGen.generateNewExpression(className, args, params); }
  public classGenGenerateMethodCall(instancePtr: string, className: string, method: string, args: Expression[], params: string[]): string { return this.classGen.generateMethodCall(instancePtr, className, method, args, params); }
  public hasClassGen(): boolean { return this.classGen !== null && this.classGen !== undefined; }

  public setCurrentFunction(name: string | null): void { this.currentFunction = name; }
  public getCurrentFunction(): string | null { return this.currentFunction; }
  public setCurrentFunctionReturnType(type: string): void { this.currentFunctionReturnType = type; }
  public getCurrentFunctionReturnType(): string { return this.currentFunctionReturnType; }
  public setCurrentFunctionTsReturnType(type: string | undefined): void { this.currentFunctionTsReturnType = type; }
  public getCurrentFunctionTsReturnType(): string | undefined { return this.currentFunctionTsReturnType; }
  public setExpectedArrayElementType(type: 'string' | 'number' | 'boolean' | 'pointer' | null): void { this.expectedArrayElementType = type; }
  public getExpectedArrayElementType(): 'string' | 'number' | 'boolean' | 'pointer' | null { return this.expectedArrayElementType; }
  public setCurrentDeclaredMapType(type: string | undefined): void { this.currentDeclaredMapType = type; }
  public getCurrentDeclaredMapType(): string | undefined { return this.currentDeclaredMapType; }
  public setCurrentDeclaredSetType(type: string | undefined): void { this.currentDeclaredSetType = type; }
  public getCurrentDeclaredSetType(): string | undefined { return this.currentDeclaredSetType; }
  public setUsesPromises(value: boolean): void { this.usesPromises = value ? 1 : 0; }
  public getUsesPromises(): boolean { return this.usesPromises !== 0; }
  public setUsesTimers(value: boolean): void { this.usesTimers = value ? 1 : 0; }
  public getUsesTimers(): boolean { return this.usesTimers !== 0; }
  public setUsesTreeSitter(value: boolean): void { this.usesTreeSitter = value; }
  public setUsesSqlite(value: boolean): void { this.usesSqlite = value ? 1 : 0; }
  public getUsesSqlite(): boolean { return this.usesSqlite !== 0; }
  public setUsesCurl(value: boolean): void { this.usesCurl = value ? 1 : 0; }
  public getUsesCurl(): boolean { return this.usesCurl !== 0; }
  public setUsesCrypto(value: boolean): void { this.usesCrypto = value ? 1 : 0; }
  public getUsesCrypto(): boolean { return this.usesCrypto !== 0; }
  public setUsesJson(value: boolean): void { this.usesJson = value ? 1 : 0; }
  public getUsesJson(): boolean { return this.usesJson !== 0; }
  public setUsesMongoose(value: boolean): void { this.usesMongoose = value ? 1 : 0; }
  public getUsesMongoose(): boolean { return this.usesMongoose !== 0; }
  public setCurrentDeclaredInterfaceType(type: string | undefined): void { this.currentDeclaredInterfaceType = type; }
  public getCurrentDeclaredInterfaceType(): string | undefined { return this.currentDeclaredInterfaceType; }
  public setExpectedCallbackParamType(type: string | null): void { this.expectedCallbackParamType = type; }
  public getExpectedCallbackParamType(): string | null { return this.expectedCallbackParamType; }
  public setExpectedCallbackReturnType(type: string | null): void { this.expectedCallbackReturnType = type; }
  public getExpectedCallbackReturnType(): string | null { return this.expectedCallbackReturnType; }
  public setIsAsyncFunction(value: boolean): void { this.isAsyncFunction = value; }
  public setAsyncResultPromise(value: string): void { this.asyncResultPromise = value; }
  public getAsyncResultPromise(): string { return this.asyncResultPromise; }
  public getAllocaInstructions(): string[] { return this.allocaInstructions; }
  public clearAllocaInstructions(): void { this.allocaInstructions.length = 0; }
  public getOutput(): string[] { return this.output; }
  public clearOutput(): void { this.output.length = 0; }
  public pushOutput(line: string): void { this.output.push(line); }
  public getOutputLength(): number { return this.output.length; }
  public getOutputLine(index: number): string { return this.output[index] || ''; }
  public setOutputLine(index: number, line: string): void {
    const newOutput: string[] = [];
    for (let i = 0; i < this.output.length; i++) {
      if (i === index) {
        newOutput.push(line);
      } else {
        newOutput.push(this.output[i]);
      }
    }
    this.output.length = 0;
    for (let i = 0; i < newOutput.length; i++) {
      this.output.push(newOutput[i]);
    }
  }
  public getGlobalStringsLength(): number { return this.globalStrings.length; }
  public getGlobalStringAt(index: number): string { return this.globalStrings[index] || ''; }
  public clearGlobalStrings(): void { this.globalStrings.length = 0; }
  public getOutputAsIndentedString(indent: string): string {
    const lines: string[] = [];
    for (let i = 0; i < this.output.length; i++) {
      const line = this.output[i];
      if (line) {
        lines.push(indent + line);
      } else {
        lines.push(indent);
      }
    }
    return lines.join('\n');
  }
  public createEmptyStringConstant(): string { this.syncStateToGenerators(); return this.stringGen.doCreateStringConstant(''); }

  public typeResolverGetInterface(name: string): InterfaceDeclaration | null { return this.typeResolver ? this.typeResolver.getInterface(name) : null; }
  public typeResolverGetInterfaceProperty(interfaceName: string, propName: string): InterfaceField | null { return this.typeResolver ? this.typeResolver.getInterfaceProperty(interfaceName, propName) : null; }
  public typeResolverGetTypeAlias(name: string): TypeAliasDeclaration | null { return this.typeResolver ? this.typeResolver.getTypeAlias(name) : null; }
  public typeResolverGetMapGetInterfaceType(expr: Expression): string | null { return this.typeResolver ? this.typeResolver.getMapGetInterfaceType(expr) : null; }
  public typeResolverGetUnionCommonFields(memberNames: string[]): { keys: string[]; types: string[] } { return this.typeResolver ? this.typeResolver.getUnionCommonFields(memberNames) : { keys: [], types: [] }; }
  public typeResolverAreTypesCompatible(type1: string, type2: string): boolean { return this.typeResolver ? this.typeResolver.areTypesCompatible(type1, type2) : false; }
  public typeResolverNormalizeType(type: string): string { return this.typeResolver ? this.typeResolver.normalizeType(type) : type; }
  public typeResolverResolveArrayMethodReturnType(expr: Expression): ObjectMetadata | null { return this.typeResolver ? this.typeResolver.resolveArrayMethodReturnType(expr) : null; }
  public typeResolverDetectTypeGuard(condition: Expression): TypeGuardInfo | null { return this.typeResolver ? this.typeResolver.detectTypeGuard(condition) : null; }
  public typeResolverFindInterfaceByDiscriminant(discriminantValue: string): string | null { return this.typeResolver ? this.typeResolver.findInterfaceByDiscriminant(discriminantValue) : null; }
  public typeResolverGetThisFieldMapKeyType(expr: Expression): string | null { return this.typeResolver ? this.typeResolver.getThisFieldMapKeyType(expr) : null; }
  public typeResolverGetThisFieldSetValueType(expr: Expression): string | null { return this.typeResolver ? this.typeResolver.getThisFieldSetValueType(expr) : null; }
  public typeResolverGetClassFieldMapType(className: string, fieldName: string): { keyType: string; valueType: string } | null { return this.typeResolver ? this.typeResolver.getClassFieldMapType(className, fieldName) : null; }
  public typeResolverGetInterfaceMetadata(name: string): { keys: string[]; types: string[]; tsTypes?: string[] } | null { return this.typeResolver ? this.typeResolver.getInterfaceMetadata(name) : null; }

  public stringGenCreateStringConstant(value: string): string { this.syncStateToGenerators(); return this.stringGen.doCreateStringConstant(value); }
  public stringGenGenerateSubstr(strPtr: string, startIndex: string, length: string | null): string { this.syncStateToGenerators(); return this.stringGen.doGenerateSubstr(strPtr, startIndex, length); }
  public stringGenGenerateStringConcatDirect(left: string, right: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateStringConcatDirect(left, right); }
  public stringGenGenerateRepeat(strPtr: string, count: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateRepeat(strPtr, count); }
  public stringGenGeneratePadStart(strPtr: string, targetLength: string, padString: string): string { this.syncStateToGenerators(); return this.stringGen.doGeneratePadStart(strPtr, targetLength, padString); }
  public stringGenGenerateSplit(strPtr: string, delimiter: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateSplit(strPtr, delimiter); }
  public stringGenGenerateStartsWith(strPtr: string, prefix: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateStartsWith(strPtr, prefix); }
  public stringGenGenerateEndsWith(strPtr: string, suffix: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateEndsWith(strPtr, suffix); }
  public stringGenGenerateTrim(strPtr: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateTrim(strPtr); }
  public stringGenGenerateTrimStart(strPtr: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateTrimStart(strPtr); }
  public stringGenGenerateTrimEnd(strPtr: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateTrimEnd(strPtr); }
  public stringGenGenerateToUpperCase(strPtr: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateToUpperCase(strPtr); }
  public stringGenGenerateToLowerCase(strPtr: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateToLowerCase(strPtr); }
  public stringGenGenerateIndexOf(strPtr: string, substring: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateIndexOf(strPtr, substring); }
  public stringGenGenerateIncludes(strPtr: string, substring: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateIncludes(strPtr, substring); }
  public stringGenGenerateSlice(strPtr: string, start: string, end: string | null): string { this.syncStateToGenerators(); return this.stringGen.doGenerateSlice(strPtr, start, end); }
  public stringGenGenerateCharAt(strPtr: string, index: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateCharAt(strPtr, index); }
  public stringGenGenerateCharCodeAt(strPtr: string, index: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateCharCodeAt(strPtr, index); }
  public stringGenGenerateReplace(strPtr: string, search: string, replace: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateReplace(strPtr, search, replace); }
  public stringGenGenerateReplaceAll(strPtr: string, search: string, replace: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateReplaceAll(strPtr, search, replace); }
  public stringGenGenerateGlobalString(value: string): string { this.syncStateToGenerators(); return this.stringGen.doGenerateGlobalString(value); }
  public stringGenGenerateStringConcat(left: Expression, right: Expression, params: string[]): string { this.syncStateToGenerators(); return this.stringGen.doGenerateStringConcat(left, right, params); }
  public stringGenConvertNumberToString(numValue: string): string { this.syncStateToGenerators(); return this.stringGen.doConvertNumberToString(numValue); }

  public interfaceStructGenHasInterface(name: string): boolean { return this.interfaceStructGen ? this.interfaceStructGen.hasInterface(name) : false; }
  public interfaceStructGenGetInterfaceStruct(name: string): { name: string; llvmType: string; fields: { name: string; tsType: string; llvmType: string }[]; isBuiltinConflict: boolean } | undefined { return this.interfaceStructGen ? this.interfaceStructGen.getInterfaceStruct(name) : undefined; }
  public interfaceStructGenGetStructSize(interfaceName: string): number { return this.interfaceStructGen ? this.interfaceStructGen.getStructSize(interfaceName) : 0; }
  public interfaceStructGenGetFieldCount(interfaceName: string): number {
    if (!this.interfaceStructGen) return 0;
    const info = this.interfaceStructGen.getInterfaceStruct(interfaceName);
    if (!info) return 0;
    return info.fields.length;
  }
  public interfaceStructGenGetFieldName(interfaceName: string, fieldIndex: number): string {
    if (!this.interfaceStructGen) return '';
    const info = this.interfaceStructGen.getInterfaceStruct(interfaceName);
    if (!info || fieldIndex < 0 || fieldIndex >= info.fields.length) return '';
    return info.fields[fieldIndex].name;
  }
  public interfaceStructGenGetFieldTsType(interfaceName: string, fieldIndex: number): string {
    if (!this.interfaceStructGen) return '';
    const info = this.interfaceStructGen.getInterfaceStruct(interfaceName);
    if (!info || fieldIndex < 0 || fieldIndex >= info.fields.length) return '';
    return info.fields[fieldIndex].tsType;
  }
  public interfaceStructGenGetFieldLlvmType(interfaceName: string, fieldIndex: number): string {
    if (!this.interfaceStructGen) return '';
    const info = this.interfaceStructGen.getInterfaceStruct(interfaceName);
    if (!info || fieldIndex < 0 || fieldIndex >= info.fields.length) return '';
    return info.fields[fieldIndex].llvmType;
  }

  public stringMapGenGenerateEmptyStringMap(): string { this.syncStateToGenerators(); return this.stringMapGen.generateEmptyStringMap(); }
  public stringMapGenGenerateStringMapSet(mapPtr: string, keyValue: string, valueValue: string): string { this.syncStateToGenerators(); return this.stringMapGen.generateStringMapSet(mapPtr, keyValue, valueValue); }
  public stringMapGenGenerateStringMapGet(mapPtr: string, keyToFind: string): string { this.syncStateToGenerators(); return this.stringMapGen.generateStringMapGet(mapPtr, keyToFind); }
  public stringMapGenGenerateStringMapHas(mapPtr: string, keyToFind: string): string { this.syncStateToGenerators(); return this.stringMapGen.generateStringMapHas(mapPtr, keyToFind); }
  public stringMapGenGenerateStringMapClear(mapPtr: string): string { this.syncStateToGenerators(); return this.stringMapGen.generateStringMapClear(mapPtr); }
  public stringMapGenGenerateStringMapDelete(mapPtr: string, keyToFind: string): string { this.syncStateToGenerators(); return this.stringMapGen.generateStringMapDelete(mapPtr, keyToFind); }
  public stringMapGenGenerateStringMapEntries(mapPtr: string): string { this.syncStateToGenerators(); return this.stringMapGen.generateStringMapEntries(mapPtr); }
  public stringMapGenGenerateStringMapValues(mapPtr: string): string { this.syncStateToGenerators(); return this.stringMapGen.generateStringMapValues(mapPtr); }
  public stringMapGenGenerateStringMapKeys(mapPtr: string): string { this.syncStateToGenerators(); return this.stringMapGen.generateStringMapKeys(mapPtr); }

  public arrayGenGenerateArrayLiteral(expr: ArrayNode, params: string[]): string { this.syncStateToGenerators(); return this.arrayGen.generateArrayLiteral(expr, params); }
  public arrayGenGenerateArrayPush(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.arrayGen.generateArrayPush(expr, params); }
  public arrayGenGenerateArrayPop(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.arrayGen.generateArrayPop(expr, params); }
  public arrayGenGenerateArrayIncludes(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.arrayGen.generateArrayIncludes(expr, params); }
  public arrayGenGenerateArrayMap(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.arrayGen.generateArrayMap(expr, params); }
  public arrayGenGenerateStringArrayMap(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.arrayGen.generateStringArrayMap(expr, params); }
  public arrayGenGenerateArrayJoin(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.arrayGen.generateArrayJoin(expr, params); }
  public arrayGenGenerateArrayFind(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.arrayGen.generateArrayFind(expr, params); }
  public arrayGenGenerateArraySome(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.arrayGen.generateArraySome(expr, params); }
  public arrayGenGenerateArrayEvery(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.arrayGen.generateArrayEvery(expr, params); }
  public arrayGenGenerateArrayFilter(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.arrayGen.generateArrayFilter(expr, params); }
  public arrayGenGenerateArrayForEach(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.arrayGen.generateArrayForEach(expr, params); }
  public arrayGenGenerateArrayReduce(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.arrayGen.generateArrayReduce(expr, params); }
  public arrayGenGenerateArraySlice(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.arrayGen.generateArraySlice(expr, params); }
  public arrayGenGenerateArrayConcat(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.arrayGen.generateArrayConcat(expr, params); }

  public mapGenGenerateMapLiteral(expr: MapNode, params: string[]): string { this.syncStateToGenerators(); return this.mapGen.generateMapLiteral(expr, params); }
  public mapGenGenerateMapSet(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.mapGen.generateMapSet(expr, params); }
  public mapGenGenerateMapGet(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.mapGen.generateMapGet(expr, params); }
  public mapGenGenerateMapHas(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.mapGen.generateMapHas(expr, params); }
  public mapGenGenerateMapDelete(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.mapGen.generateMapDelete(expr, params); }
  public mapGenGenerateMapClear(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.mapGen.generateMapClear(expr, params); }
  public mapGenGenerateMapSize(mapPtr: string): string { this.syncStateToGenerators(); return this.mapGen.generateMapSize(mapPtr); }

  public setGenGenerateSetLiteral(expr: SetNode, params: string[]): string { this.syncStateToGenerators(); return this.setGen.generateSetLiteral(expr, params); }
  public setGenGenerateSetAdd(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.setGen.generateSetAdd(expr, params); }
  public setGenGenerateSetHas(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.setGen.generateSetHas(expr, params); }
  public setGenGenerateSetDelete(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.setGen.generateSetDelete(expr, params); }
  public setGenGenerateSetSize(setPtr: string): string { this.syncStateToGenerators(); return this.setGen.generateSetSize(setPtr); }

  public stringSetGenGenerateEmptyStringSet(): string { this.syncStateToGenerators(); return this.stringSetGen.generateEmptyStringSet(); }
  public stringSetGenGenerateStringSetAdd(setAlloca: string, valueValue: string): string { this.syncStateToGenerators(); return this.stringSetGen.generateStringSetAdd(setAlloca, valueValue); }
  public stringSetGenGenerateStringSetHas(setAlloca: string, valueValue: string): string { this.syncStateToGenerators(); return this.stringSetGen.generateStringSetHas(setAlloca, valueValue); }

  public pointerMapGenGeneratePointerMapSet(mapPtr: string, keyValue: string, valueValue: string): string { this.syncStateToGenerators(); return this.pointerMapGen.generatePointerMapSet(mapPtr, keyValue, valueValue); }
  public pointerMapGenGeneratePointerMapGet(mapPtr: string, keyValue: string, valueType: string): string { this.syncStateToGenerators(); return this.pointerMapGen.generatePointerMapGet(mapPtr, keyValue, valueType); }
  public pointerMapGenGeneratePointerMapClear(mapPtr: string): string { this.syncStateToGenerators(); return this.pointerMapGen.generatePointerMapClear(mapPtr); }

  public responseGenGenerateText(responsePtr: string): string { this.syncStateToGenerators(); return this.responseGen.generateText(responsePtr); }
  public responseGenGenerateJson(responsePtr: string): string { this.syncStateToGenerators(); return this.responseGen.generateJson(responsePtr); }
  public responseGenGenerateTypedJson(responsePtr: string, typeName: string, interfaceDef: { properties: { name: string; type: string }[] }): string { this.syncStateToGenerators(); return this.responseGen.generateTypedJson(responsePtr, typeName, interfaceDef); }
  public responseGenGenerateStatus(responsePtr: string): string { this.syncStateToGenerators(); return this.responseGen.generateStatus(responsePtr); }
  public responseGenGenerateOk(responsePtr: string): string { this.syncStateToGenerators(); return this.responseGen.generateOk(responsePtr); }

  public regexGenGenerateRegexCompile(pattern: string, flags: string): string { this.syncStateToGenerators(); return this.regexGen.generateRegexCompile(pattern, flags); }
  public regexGenGenerateRegexTest(regexPtr: string, testStr: string): string { this.syncStateToGenerators(); return this.regexGen.generateRegexTest(regexPtr, testStr); }
  public regexGenGenerateRegexMatch(regexPtr: string, testStr: string, numGroups: number): string { this.syncStateToGenerators(); return this.regexGen.generateRegexMatch(regexPtr, testStr, numGroups); }
  public regexGenGenerateRegexCompileRuntime(patternPtr: string, cflags: number): string { this.syncStateToGenerators(); return this.regexGen.generateRegexCompileRuntime(patternPtr, cflags); }

  public controlFlowGenGenerateLogicalOp(op: string, left: Expression, right: Expression, params: string[]): string { this.syncStateToGenerators(); return this.controlFlowGen.generateLogicalOp(op, left, right, params); }

  public objectGenGenerateObjectLiteral(expr: Expression, params: string[]): string { this.syncStateToGenerators(); return this.objectGen.generateObjectLiteral(expr, params); }

  public mathGenCanHandle(expr: MethodCallNode): boolean { return this.mathGen.canHandle(expr); }
  public mathGenGenerateMathMethod(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.mathGen.generateMathMethod(expr, params); }

  public pathGenGenerateResolve(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.pathGen.generateResolve(expr, params); }
  public pathGenGenerateDirname(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.pathGen.generateDirname(expr, params); }
  public pathGenGenerateBasename(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.pathGen.generateBasename(expr, params); }
  public pathGenGenerateJoin(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.pathGen.generateJoin(expr, params); }

  public fsGenCanHandle(expr: MethodCallNode): boolean { return this.fsGen.canHandle(expr); }
  public fsGenReadFileSync(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.fsGen.generateReadFileSync(expr, params); }
  public fsGenWriteFileSync(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.fsGen.generateWriteFileSync(expr, params); }
  public fsGenAppendFileSync(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.fsGen.generateAppendFileSync(expr, params); }
  public fsGenExistsSync(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.fsGen.generateExistsSync(expr, params); }
  public fsGenUnlinkSync(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.fsGen.generateUnlinkSync(expr, params); }
  public fsGenReaddirSync(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.fsGen.generateReaddirSync(expr, params); }
  public fsGenStatSync(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.fsGen.generateStatSync(expr, params); }

  public jsonGenCanHandle(expr: MethodCallNode): boolean { return this.jsonGen.canHandle(expr); }
  public jsonGenGenerateParse(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.jsonGen.generateParse(expr, params); }
  public jsonGenGenerateStringify(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.jsonGen.generateStringify(expr, params); }

  public dateGenCanHandle(expr: MethodCallNode): boolean { return this.dateGen.canHandle(expr); }
  public dateGenGenerateNow(): string { this.syncStateToGenerators(); return this.dateGen.generateNow(); }

  public cryptoGenCanHandle(expr: MethodCallNode): boolean { return this.cryptoGen.canHandle(expr); }
  public cryptoGenSha256(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.cryptoGen.generateSha256(expr, params); }
  public cryptoGenMd5(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.cryptoGen.generateMd5(expr, params); }
  public cryptoGenSha512(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.cryptoGen.generateSha512(expr, params); }
  public cryptoGenRandomBytes(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.cryptoGen.generateRandomBytes(expr, params); }

  public sqliteGenCanHandle(expr: MethodCallNode): boolean { return this.sqliteGen.canHandle(expr); }
  public sqliteGenOpen(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.sqliteGen.generateOpen(expr, params); }
  public sqliteGenExec(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.sqliteGen.generateExec(expr, params); }
  public sqliteGenGet(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.sqliteGen.generateGet(expr, params); }
  public sqliteGenAll(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.sqliteGen.generateAll(expr, params); }
  public sqliteGenClose(expr: MethodCallNode, params: string[]): string { this.syncStateToGenerators(); return this.sqliteGen.generateClose(expr, params); }

  public arrowFunctionGenGenerate(expr: Expression, params: string[], typeHints: { paramTypes?: string[]; returnType?: string } | undefined, scopeVarNames: string[] | undefined, scopeVarTypes: string[] | undefined): string {
    this.syncStateToGenerators();
    return this.exprGen.arrowFunctionGen.generateArrowFunction(expr as ArrowFunctionNode, params, typeHints, scopeVarNames, scopeVarTypes);
  }

  public arrowFunctionGenGetClosureInfo(lambdaName: string): { captures: { name: string; llvmType: string }[]; envStructName: string } | null {
    const result = this.exprGen.arrowFunctionGen.getClosureInfoForLambda(lambdaName);
    if (!result) return null;
    return result;
  }

  // Helper: Extract object literal metadata (public for context pattern access)
  public getObjectMetadata(objExpr: ObjectNode): { keys: string[]; types: string[] } {
    if (!objExpr || objExpr.type !== 'object') {
      return { keys: [], types: [] };
    }

    const keys: string[] = [];
    const types: string[] = [];

    const propsLen = objExpr.properties ? objExpr.properties.length : 0;
    for (let i = 0; i < propsLen; i++) {
      const prop = objExpr.properties[i] as ObjectProperty;
      if (!prop) continue;
      keys.push(prop.key);

      let llvmType: string;

      const propValue = prop.value as Expression;
      if (!propValue) {
        llvmType = 'double';
      } else {
        const propValueTyped = propValue as { type: string };
        const propValueType = propValueTyped.type;
        if (propValueType === 'string' || this.isStringExpression(propValue)) {
          llvmType = 'i8*';
        } else if (propValueType === 'array' || this.isStringArrayExpression(propValue)) {
          llvmType = this.isStringArrayExpression(propValue) ? '%StringArray*' : '%Array*';
        } else if (this.isArrayExpression(propValue)) {
          llvmType = '%Array*';
        } else if (propValueType === 'map') {
          llvmType = '%Map*';
        } else if (propValueType === 'set') {
          llvmType = '%Set*';
        } else {
          llvmType = 'double';
        }
      }

      types.push(llvmType);
    }

    return { keys, types };
  }

  // Cached counts for empty array protection (public for FunctionGeneratorContext)
  topLevelStatementsCount: number = 0;
  topLevelExpressionsCount: number = 0;
  topLevelItemsCount: number = 0;
  private functionsCount: number = 0;
  public classesCount: number = 0;
  private typeAliasesCount: number = 0;

  private linkTreeSitter: boolean = false;
  private usesTreeSitter: boolean = false;
  public sourceCode: string = '';
  public filename: string = '';

  constructor(ast: AST, typeChecker: TypeChecker | null, options: LLVMGeneratorOptions) {
    super();

    // Initialize complex fields in constructor (field initializers don't work in native code)
    this.externalFunctions = new Set();
    this.topLevelObjectVariables = new Map();
    this.globalVariables = new Map();
    this.importAliasMap = new Map();
    this.httpHandlers = [];
    this.jsonObjectMetadata = new Map();
    this.usesTimers = 0;
    this.usesPromises = 0;
    this.usesSqlite = 0;
    this.usesCurl = 0;
    this.usesCrypto = 0;
    this.usesJson = 0;
    this.usesMongoose = 0;

    this.ast = ast;

    // Cache all counts BEFORE storing - empty arrays become garbage after assignment
    this.topLevelStatementsCount = ast.topLevelStatements.length;
    this.topLevelExpressionsCount = ast.topLevelExpressions.length;
    this.topLevelItemsCount = ast.topLevelItems ? ast.topLevelItems.length : 0;
    this.functionsCount = ast.functions.length;
    this.classesCount = ast.classes.length;
    this.typeAliasesCount = ast.typeAliases ? ast.typeAliases.length : 0;

    const ifaceCount = ast.interfaces.length;
    this.typeChecker = typeChecker;
    this.linkTreeSitter = options.linkTreeSitter || false;
    this.sourceCode = options.sourceCode || '';
    this.filename = options.filename || '';

    const enumNames: string[] = [];
    if (ast.enums) {
      for (let i = 0; i < ast.enums.length; i++) {
        enumNames.push(ast.enums[i].name);
      }
    }
    this.interfaceStructGen = new InterfaceStructGenerator(ast.interfaces, ifaceCount, enumNames);

    // Initialize specialized generators with context (NEW pattern for RegexGenerator + ObjectGenerator)
    // These generators use explicit context instead of callback binding
    this.regexGen = new RegexGenerator(this); // 'this' implements IGeneratorContext
    this.objectGen = new ObjectGenerator(this); // Clean context pattern! 🎯

    // Initialize method generators with context pattern
    this.mathGen = new MathGenerator(this);
    this.consoleGen = new ConsoleGenerator(this);
    this.processGen = new ProcessGenerator(this);
    this.pathGen = new PathGenerator(this);
    this.jsonGen = new JsonGenerator(this);
    this.dateGen = new DateGenerator(this);
    this.fsGen = new FilesystemGenerator(this);
    this.responseGen = new ResponseGenerator(this);
    this.cryptoGen = new CryptoGenerator(this);
    this.sqliteGen = new SqliteGenerator(this);
    this.runtimeGen = new RuntimeGenerator();
    this.mongooseGen = new MongooseGenerator();
    this.libuvGen = new LibuvGenerator();
    this.promiseGen = new PromiseGenerator();
    this.treesitterGen = new TreeSitterGenerator();

    // Initialize expression generator with context pattern
    this.exprGen = new ExpressionGenerator(this);

    // All generators now use context pattern! 🎉
    this.arrayGen = new ArrayGenerator(this);
    this.stringGen = new StringGenerator(this);
    this.mapGen = new MapGenerator(this);
    this.stringMapGen = new StringMapGenerator(this);
    this.pointerMapGen = new PointerMapGenerator(this);
    this.setGen = new SetGenerator(this);
    this.stringSetGen = new StringSetGenerator(this);
    this.controlFlowGen = new ControlFlowGenerator(this);
    this.classGen = new ClassGenerator(this);
    this.classGenClassFields = this.classGen.classFields;

    this.typeInference = new TypeInference(this as unknown as TypeInferenceContext);

    this.typeResolver = new TypeResolver(this as unknown as TypeResolverContext);

    this.varAllocator = new VariableAllocator(this as unknown as VariableAllocatorContext);

    this.funcGen = new FunctionGenerator(this as unknown as FunctionGeneratorContext);

    this.assignmentGen = new AssignmentGenerator(this as unknown as AssignmentGeneratorContext);

    const importsCount = ast.imports.length;
    if (importsCount > 0) {
      this.buildImportAliasMap(ast.imports, importsCount);
    }

    // No more delegate binding needed - all generators use context pattern! 🎯

    // Note: External function tracking removed for self-hosting compatibility.
    // All imported functions are compiled into the same binary, so no external declarations needed.
  }

  private buildImportAliasMap(imports: ImportDeclaration[], importCount: number): void {
    for (let i = 0; i < importCount; i++) {
      const imp = imports[i] as ImportDeclaration;
      if (imp.aliasedSpecifiers) {
        const specCount = imp.aliasedSpecifiers.length;
        for (let j = 0; j < specCount; j++) {
          const spec = imp.aliasedSpecifiers[j] as ImportSpecifier;
          if (spec.original && spec.original !== spec.name) {
            this.setImportAlias(spec.name, spec.original);
          }
        }
      }
    }
  }

  setImportAlias(name: string, original: string): void {
    this.importAliasMap.set(name, original);
  }

  getImportAlias(name: string): string | undefined {
    return this.importAliasMap.get(name);
  }

  resolveImportAlias(localName: string): string {
    const original = this.getImportAlias(localName);
    return original || localName;
  }

  reset(): void {
    this.tempCounter = 0;
    this.labelCounter = 0;
    this.currentLabel = 'entry';
    this.output.length = 0;
    this.outputCount = 0;
    this.thisPointer = null;
    this.currentClassName = null;
    this.currentFunctionReturnType = 'double';
    this.symbolTable.clearLocals();
    this.variableTypes.clear();
    this.expressionTypes.clear();
  }

  getThisPointer(): string | null {
    return this.thisPointer;
  }

  setThisPointer(ptr: string | null): void {
    this.thisPointer = ptr;
  }

  getCurrentClassName(): string | null {
    return this.currentClassName;
  }

  setCurrentClassName(name: string | null): void {
    this.currentClassName = name;
  }

  setJsonObjectMetadata(key: string, value: JsonObjectMeta): void {
    this.jsonObjectMetadata.set(key, value);
  }

  getJsonObjectMetadata(key: string): JsonObjectMeta | undefined {
    return this.jsonObjectMetadata.get(key);
  }

  hasJsonObjectMetadata(key: string): boolean {
    return this.jsonObjectMetadata.has(key);
  }

  getJsonObjectMetadataKeys(key: string): string[] | undefined {
    const meta = this.jsonObjectMetadata.get(key);
    if (!meta) return undefined;
    return meta.keys;
  }

  getJsonObjectMetadataTypes(key: string): string[] | undefined {
    const meta = this.jsonObjectMetadata.get(key);
    if (!meta) return undefined;
    return meta.types;
  }

  getJsonObjectMetadataTsTypes(key: string): string[] | undefined {
    const meta = this.jsonObjectMetadata.get(key);
    if (!meta) return undefined;
    return meta.tsTypes;
  }

  getJsonObjectMetadataInterfaceType(key: string): string | undefined {
    const meta = this.jsonObjectMetadata.get(key);
    if (!meta) return undefined;
    return meta.interfaceType;
  }

  private generateGlobalVariableDeclarations(): string {
    let ir = '';
    const totalCount = this.topLevelStatementsCount;
    if (totalCount === 0) {
      return ir;
    }
    const items = this.ast.topLevelStatements;
    for (let stmtIdx = 0; stmtIdx < totalCount; stmtIdx++) {
      const stmt = items[stmtIdx] as { type: string; kind: string; name: string; value: Expression | null; declaredType?: string };
      if (stmt.type !== 'variable_declaration') continue;
      if (stmt.value !== null) {
        const name = stmt.name;

        if ((stmt.value as { type: string }).type === 'call') {
          const callNode = stmt.value as { type: string; name: string };
          if (callNode.name) {
            let handled = false;
            for (let fi = 0; fi < this.ast.functions.length; fi++) {
              const fn = this.ast.functions[fi];
              if (!fn) continue;
              if (fn.name === callNode.name && fn.returnType) {
                const rt = fn.returnType;
                if (rt === 'string') {
                  ir += `@${name} = global i8* null` + '\n';
                  this.globalVariables.set(name, { llvmType: 'i8*', kind: SymbolKind.String, initialized: false });
                  this.defineVariable(name, `@${name}`, 'i8*', SymbolKind.String, 'global');
                  handled = true;
                  break;
                }
                const iface = this.getInterfaceDeclByName(rt);
                if (iface) {
                  ir += `@${name} = global i8* null` + '\n';
                  this.globalVariables.set(name, { llvmType: 'i8*', kind: SymbolKind.Object, initialized: false });
                  this.defineVariableWithMetadata(name, `@${name}`, 'i8*', SymbolKind.Object, 'global', createInterfaceMetadata(rt));
                  handled = true;
                  break;
                }
                if (this.isTypeAlias(rt)) {
                  const commonProps = this.getTypeAliasCommonProperties(rt);
                  if (commonProps) {
                    ir += `@${name} = global i8* null` + '\n';
                    this.globalVariables.set(name, { llvmType: 'i8*', kind: SymbolKind.Object, initialized: false });
                    this.defineVariableWithMetadata(name, `@${name}`, 'i8*', SymbolKind.Object, 'global', createObjectMetadataWithInterface(commonProps, rt));
                    handled = true;
                    break;
                  }
                }
                break;
              }
            }
            if (handled) continue;
          }
        }

        const isString = this.isStringExpression(stmt.value);
        let isStringArray = this.isStringArrayExpression(stmt.value);
        if (!isStringArray && stmt.declaredType === 'string[]') {
          isStringArray = true;
        }
        let isObjectArray = this.typeInference.isObjectArrayExpression(stmt.value);
        if (!isObjectArray && stmt.declaredType && stmt.declaredType.endsWith('[]') &&
            stmt.declaredType !== 'string[]' && stmt.declaredType !== 'number[]' && stmt.declaredType !== 'boolean[]') {
          isObjectArray = true;
        }
        const isArray = !isStringArray && !isObjectArray && this.isArrayExpression(stmt.value);
        const isObject = this.isObjectExpression(stmt.value);
        const isMap = this.typeInference.isMapExpression(stmt.value);
        const isSet = this.typeInference.isSetExpression(stmt.value);
        const isRegex = this.typeInference.isRegexExpression(stmt.value);
        const isClassInstance = this.typeInference.isClassInstanceExpression(stmt.value);
        const isBoolean = this.typeInference.isBooleanExpression(stmt.value);
        const isJSONParse = this.typeInference.isJSONParseExpression(stmt.value);

        let llvmType: string = '';
        let kind: number = SymbolKind.Number;
        let defaultValue: string = '0.0';

        if (isString) {
          llvmType = 'i8*';
          kind = SymbolKind.String;
          defaultValue = 'null';
        } else if (isStringArray) {
          llvmType = '%StringArray';
          kind = SymbolKind.StringArray;
          defaultValue = 'zeroinitializer';
        } else if (isObjectArray) {
          let elementType = '';
          if (stmt.declaredType) {
            const declType = stmt.declaredType;
            const typeLen = declType.length;
            if (typeLen > 2) {
              elementType = declType.substr(0, typeLen - 2);
            }
          }
          llvmType = '%ObjectArray*';
          kind = SymbolKind.ObjectArray;
          defaultValue = 'null';
          ir += `@${name} = global ${llvmType} ${defaultValue}` + '\n';
          this.globalVariables.set(name, { llvmType, kind, initialized: false });
          if (elementType) {
            this.defineVariableWithMetadata(name, `@${name}`, llvmType, kind, 'global', createInterfaceMetadata(elementType));
          } else {
            this.defineVariable(name, `@${name}`, llvmType, kind, 'global');
          }
          continue;
        } else if (isArray) {
          llvmType = '%Array';
          kind = SymbolKind.Array;
          defaultValue = 'zeroinitializer';
        } else if (isObject) {
          llvmType = 'i8*';
          kind = SymbolKind.Object;
          defaultValue = 'null';
          const objMeta = this.getObjectMetadata(stmt.value as ObjectNode);
          if (objMeta && objMeta.keys.length > 0) {
            const interfaceName = stmt.declaredType || undefined;
            ir += `@${name} = global ${llvmType} ${defaultValue}` + '\n';
            this.globalVariables.set(name, { llvmType, kind, initialized: false });
            this.defineVariableWithMetadata(name, `@${name}`, llvmType, kind, 'global', createObjectMetadataWithInterface({ keys: objMeta.keys, types: objMeta.types }, interfaceName || ''));
            continue;
          }
        } else if (isMap) {
          let isStringMap = false;
          if (stmt.declaredType) {
            const dt = stmt.declaredType;
            if (dt.indexOf('Map<string') !== -1) {
              isStringMap = true;
            }
          }
          if (isStringMap) {
            llvmType = '%StringMap';
            kind = SymbolKind.Map;
            defaultValue = 'zeroinitializer';
            ir += `@${name} = global ${llvmType} ${defaultValue}` + '\n';
            this.globalVariables.set(name, { llvmType, kind, initialized: false });
            this.defineVariableWithMetadata(name, `@${name}`, llvmType, kind, 'global', createMapMetadataSymbol({
              keyType: 'string',
              valueType: 'string',
              llvmKeyType: 'i8*',
              llvmValueType: 'i8*'
            }));
            continue;
          }
          llvmType = '%Map';
          kind = SymbolKind.Map;
          defaultValue = 'zeroinitializer';
        } else if (isSet) {
          llvmType = '%Set';
          kind = SymbolKind.Set;
          defaultValue = 'zeroinitializer';
        } else if (isRegex) {
          llvmType = 'i8*';
          kind = SymbolKind.Regex;
          defaultValue = 'null';
        } else if (isClassInstance) {
          const className = (stmt.value as NewNode).className;
          const fields = this.classGen ? (this.classGen.getClassFields(className) || []) : [];
          llvmType = fields.length > 0 ? `%${className}_struct*` : 'i32*';
          kind = SymbolKind.Class;
          defaultValue = 'null';
          ir += `@${name} = global ${llvmType} ${defaultValue}` + '\n';
          this.globalVariables.set(name, { llvmType, kind, initialized: false });
          this.defineVariableWithMetadata(name, `@${name}`, llvmType, kind, 'global', createClassMetadata({ className }));
          continue;
        } else if (isBoolean) {
          llvmType = 'double';
          kind = SymbolKind.Boolean;
          defaultValue = '0.0';
        } else if (isJSONParse) {
          const interfaceName = this.typeInference.getJSONParseInterface(stmt.value as MethodCallNode);
          if (interfaceName === 'number[]') {
            llvmType = '%Array*';
            kind = SymbolKind.Array;
            defaultValue = 'null';
            ir += `@${name} = global ${llvmType} ${defaultValue}` + '\n';
            this.globalVariables.set(name, { llvmType, kind, initialized: false });
            this.defineVariableWithMetadata(name, `@${name}`, llvmType, kind, 'global', createPointerAllocaMetadata());
            continue;
          } else if (interfaceName) {
            let interfaceDef: InterfaceDeclaration | null = null;
            for (let i = 0; i < this.ast.interfaces.length; i++) {
              const iface = this.ast.interfaces[i];
              if (!iface) continue;
              if (!iface.name) continue;
              if (iface.name === interfaceName) {
                interfaceDef = iface as InterfaceDeclaration;
                break;
              }
            }
            if (interfaceDef) {
              llvmType = `%${interfaceName}*`;
              kind = SymbolKind.JSON;
              defaultValue = 'null';
              const keys: string[] = [];
              const tsTypes: string[] = [];
              const types: string[] = [];
              for (let i = 0; i < interfaceDef.fields.length; i++) {
                const field = interfaceDef.fields[i] as { name: string; type: string };
                keys.push(stripOptional(field.name));
                tsTypes.push(field.type);
                types.push(this.tsTypeToLlvmJsonWithEnums(field.type));
              }
              ir += `@${name} = global ${llvmType} ${defaultValue}` + '\n';
              this.globalVariables.set(name, { llvmType, kind, initialized: false });
              this.defineVariableWithMetadata(name, `@${name}`, llvmType, kind, 'global', createObjectMetadataWithInterface({ keys, types, tsTypes }, interfaceName));
              continue;
            }
          }
          llvmType = 'i8*';
          kind = SymbolKind.JSON;
          defaultValue = 'null';
        } else {
          const stmtTyped = stmt as { declaredType?: string };
          if (stmtTyped.declaredType) {
            const strippedDeclaredType = stripNullable(stmtTyped.declaredType);
            if (strippedDeclaredType === 'string') {
              llvmType = 'i8*';
              kind = SymbolKind.String;
              defaultValue = 'null';
            } else {
              let foundInterface = false;
              for (let i = 0; i < this.ast.interfaces.length; i++) {
                const iface = this.ast.interfaces[i];
                if (!iface) continue;
                if (!iface.name) continue;
                if (iface.name === strippedDeclaredType) {
                  foundInterface = true;
                  break;
                }
              }
              if (foundInterface) {
                llvmType = 'i8*';
                kind = SymbolKind.Object;
                defaultValue = 'null';
                ir += `@${name} = global ${llvmType} ${defaultValue}` + '\n';
                this.globalVariables.set(name, { llvmType, kind, initialized: false });
                this.defineVariableWithMetadata(name, `@${name}`, llvmType, kind, 'global', createInterfaceMetadata(strippedDeclaredType));
                continue;
              } else {
                llvmType = 'double';
                kind = SymbolKind.Number;
                defaultValue = '0.0';
              }
            }
          } else {
            const funcReturnInterface = this.typeInference.getFunctionCallInterfaceReturn(stmt.value);
            if (funcReturnInterface) {
              llvmType = 'i8*';
              kind = SymbolKind.Object;
              defaultValue = 'null';
              ir += `@${name} = global ${llvmType} ${defaultValue}` + '\n';
              this.globalVariables.set(name, { llvmType, kind, initialized: false });
              this.defineVariableWithMetadata(name, `@${name}`, llvmType, kind, 'global', createInterfaceMetadata(funcReturnInterface));
              continue;
            }
            const indexAccessInterface = this.typeInference.getIndexAccessElementType(stmt.value);
            if (indexAccessInterface) {
              llvmType = 'i8*';
              kind = SymbolKind.Object;
              defaultValue = 'null';
              ir += `@${name} = global ${llvmType} ${defaultValue}` + '\n';
              this.globalVariables.set(name, { llvmType, kind, initialized: false });
              this.defineVariableWithMetadata(name, `@${name}`, llvmType, kind, 'global', createInterfaceMetadata(indexAccessInterface));
              continue;
            }
            if (stmt.value && (stmt.value as { type: string }).type === 'index_access') {
              const idxNode = stmt.value as IndexAccessNode;
              const idxObjBase = idxNode.object as { type: string };
              if (idxObjBase && idxObjBase.type === 'variable') {
                const idxObjVar = idxNode.object as VariableNode;
                if (idxObjVar.name) {
                  const arrSym = this.symbolTable.lookup(idxObjVar.name);
                  if (arrSym && arrSym.kind === SymbolKind.ObjectArray && arrSym.interfaceType) {
                    llvmType = 'i8*';
                    kind = SymbolKind.Object;
                    defaultValue = 'null';
                    ir += `@${name} = global ${llvmType} ${defaultValue}` + '\n';
                    this.globalVariables.set(name, { llvmType, kind, initialized: false });
                    this.defineVariableWithMetadata(name, `@${name}`, llvmType, kind, 'global', createInterfaceMetadata(arrSym.interfaceType));
                    continue;
                  }
                }
              }
            }
            if (llvmType === '') {
              llvmType = 'double';
              kind = SymbolKind.Number;
              defaultValue = '0.0';
            }
          }
        }

        ir += `@${name} = global ${llvmType} ${defaultValue}` + '\n';
        this.globalVariables.set(name, { llvmType, kind, initialized: false });
        this.defineVariable(name, `@${name}`, llvmType, kind, 'global');
      }
    }
    if (ir.length > 0) {
      ir += '\n';
    }
    return ir;
  }

  /**
   * Main entry point for LLVM IR generation.
   * Converts the entire AST to LLVM IR text representation.
   *
   * @example
   * Input AST (for: function add(a, b) { return a + b; }):
   * {
   *   functions: [{
   *     type: 'function',
   *     name: 'add',
   *     params: ['a', 'b'],
   *     body: { statements: [{ type: 'return', value: { type: 'binary', op: '+', ... }}]}
   *   }]
   * }
   *
   * Output LLVM IR:
   * define double @add(double %0, double %1) {
   *   %2 = fadd double %0, %1
   *   ret double %2
   * }
   *
   * @returns Complete LLVM IR module as string (struct types + extern declarations + functions + main)
   */
  generate(): string {
    const parts = this.generateParts();
    return parts.join('');
  }

  generateParts(): string[] {
    const irParts: string[] = [];

    const interfaceStructDefs = this.interfaceStructGen.generateStructTypeDefinitions();
    this.interfaceStructDefsCache = interfaceStructDefs;

    const classStructDefs = this.classGen.generateStructTypeDefinitions(this.classesCount);
    this.classStructDefsCache = classStructDefs;

    const safeStr = getSafeStringHelper();
    if (safeStr) { irParts.push(safeStr); }
    const dblToStr = getDoubleToStringHelper();
    if (dblToStr) { irParts.push(dblToStr); }
    const strHash = getStringHashHelper();
    if (strHash) { irParts.push(strHash); }

    irParts.push(this.fsGen.generateReaddirSyncHelper());
    irParts.push(this.fsGen.generateStatSyncHelper());

    const globalVars = getGlobalVariables();
    if (globalVars) { irParts.push(globalVars); }

    const globalVarDecls = this.generateGlobalVariableDeclarations();
    if (globalVarDecls) { irParts.push(globalVarDecls); }

    for (let classIdx = 0; classIdx < this.classesCount; classIdx++) {
      const classNode = this.ast.classes[classIdx];
      if (!classNode) continue;
      if (!classNode.name) continue;
      this.syncStateToGenerators();
      const classIr = this.classGen.generateClass(classNode);
      if (classIr) {
        irParts.push(classIr);
        irParts.push('\n');
      }
    }

    const userFuncParts: string[] = [];
    for (let funcIdx = 0; funcIdx < this.functionsCount; funcIdx++) {
      const func = this.ast.functions[funcIdx];
      const funcIr = this.generateFunction(func);
      if (funcIr) {
        userFuncParts.push(funcIr);
        userFuncParts.push('\n');
      }
    }

    const mainIr = this.generateMain();

    const liftedFunctions = this.exprGen.arrowFunctionGen.getLiftedFunctions();
    for (let _lfi = 0; _lfi < liftedFunctions.length; _lfi++) {
      const func = liftedFunctions[_lfi];
      const liftedIr = this.generateFunction(func);
      if (liftedIr) {
        irParts.push(liftedIr);
        irParts.push('\n');
      }
    }

    const envStructDefs = this.exprGen.arrowFunctionGen.getEnvStructDefinitions();

    for (let ufi = 0; ufi < userFuncParts.length; ufi++) {
      irParts.push(userFuncParts[ufi]);
    }

    if (mainIr) { irParts.push(mainIr); }

    if (this.httpHandlers.length > 0) {
      irParts.push('\n');
      const httpServe = this.mongooseGen.generateHttpServeFunction();
      if (httpServe) { irParts.push(httpServe); }
      irParts.push('\n');
      const eventHandler = this.mongooseGen.generateEventHandler(this.httpHandlers[0]);
      if (eventHandler) { irParts.push(eventHandler); }
    }

    if (this.usesTimers) {
      irParts.push('\n');
      const timerCb = this.libuvGen.generateTimerCallbackWrapper();
      if (timerCb) { irParts.push(timerCb); }
      const setTimeout = this.libuvGen.generateSetTimeout();
      if (setTimeout) { irParts.push(setTimeout); }
      const setInterval = this.libuvGen.generateSetInterval();
      if (setInterval) { irParts.push(setInterval); }
      const clearTimer = this.libuvGen.generateClearTimer();
      if (clearTimer) { irParts.push(clearTimer); }
      const runLoop = this.libuvGen.generateRunEventLoop();
      if (runLoop) { irParts.push(runLoop); }
    }

    if (this.usesPromises) {
      irParts.push('\n');
      const promiseAll = this.promiseGen.generateAll();
      if (promiseAll) { irParts.push(promiseAll); }
      const fetchCallbacks = this.libuvGen.generateFetchWorkCallbacks();
      if (fetchCallbacks) { irParts.push(fetchCallbacks); }
      const fetchAsync = this.libuvGen.generateFetchAsync();
      if (fetchAsync) { irParts.push(fetchAsync); }
      const promiseAwait = this.libuvGen.generatePromiseAwait();
      if (promiseAwait) { irParts.push(promiseAwait); }
    }

    if (this.linkTreeSitter || this.usesTreeSitter) {
      const tsDecls = this.treesitterGen.generateDeclarations();
      if (tsDecls) { irParts.push(tsDecls); }
      irParts.push('\n');
    }

    const needsLibuv = this.usesTimers || this.usesPromises || this.usesCurl;
    const needsPromise = this.usesPromises || this.usesCurl;

    const finalParts: string[] = [];

    finalParts.push('; Tree-sitter type definitions\n');
    finalParts.push('%TSParser = type opaque\n');
    finalParts.push('%TSTree = type opaque\n');
    finalParts.push('%TSLanguage = type opaque\n');
    finalParts.push('%TSNode = type { [4 x i32], i8*, %TSTree* }\n');
    finalParts.push('%TSPoint = type { i32, i32 }\n\n');

    if (this.interfaceStructDefsCache) {
      finalParts.push(this.interfaceStructDefsCache);
      finalParts.push('\n');
    }

    if (this.classStructDefsCache) {
      finalParts.push(this.classStructDefsCache);
      finalParts.push('\n');
    }

    if (envStructDefs) {
      finalParts.push(envStructDefs);
      finalParts.push('\n');
    }

    if (this.globalStrings.length > 0) {
      for (let gsi = 0; gsi < this.globalStrings.length; gsi++) {
        finalParts.push(this.globalStrings[gsi]);
        finalParts.push('\n');
      }
      finalParts.push('\n');
    }

    finalParts.push(getLLVMDeclarations({ curl: this.usesCurl !== 0, crypto: this.usesCrypto !== 0, sqlite: this.usesSqlite !== 0 }));

    if (this.usesCurl) {
      const fetchRuntime = this.runtimeGen.generateFetchRuntime();
      if (fetchRuntime) { finalParts.push(fetchRuntime); }
      finalParts.push('\n');
    }

    if (this.usesJson) {
      const jsonRuntime = this.runtimeGen.generateJSONRuntime();
      if (jsonRuntime) { finalParts.push(jsonRuntime); }
      finalParts.push('\n');
    }

    if (this.usesMongoose) {
      const mongooseDecls = this.mongooseGen.generateDeclarations();
      if (mongooseDecls) { finalParts.push(mongooseDecls); }
      finalParts.push('\n');
    }

    if (needsLibuv) {
      const libuvDecls = this.libuvGen.generateDeclarations(needsPromise ? true : false);
      if (libuvDecls) { finalParts.push(libuvDecls); }
      finalParts.push('\n');
    }

    if (needsPromise) {
      const promiseDecls = this.promiseGen.generateDeclarations();
      if (promiseDecls) { finalParts.push(promiseDecls); }
      finalParts.push('\n');
    }

    if (this.usesCrypto) {
      finalParts.push(this.cryptoGen.generateBytesToHexHelper());
    }

    if (this.usesSqlite) {
      finalParts.push(this.sqliteGen.generateSqliteGetHelper());
      finalParts.push(this.sqliteGen.generateSqliteAllHelper());
    }

    for (let ipi = 0; ipi < irParts.length; ipi++) {
      finalParts.push(irParts[ipi]);
    }

    return finalParts;
  }

  /**
   * Generates LLVM IR for a function declaration and implementation.
   * Handles parameter types, allocas, body code generation, and return.
   *
   * @example
   * Input: { type: 'function', name: 'multiply', params: ['x', 'y'],
   *          body: { statements: [{ type: 'return', value: { type: 'binary', op: '*', ... }}]}}
   *
   * Output:
   * define double @multiply(double %0, double %1) {
   *   %x = alloca double
   *   store double %0, double* %x
   *   %y = alloca double
   *   store double %1, double* %y
   *   %2 = load double, double* %x
   *   %3 = load double, double* %y
   *   %4 = fmul double %2, %3
   *   ret double %4
   * }
   *
   * @param func - Function AST node
   * @returns LLVM IR function definition as string
   */
  private generateFunction(func: FunctionNode): string {
    return this.funcGen.generate(func);
  }

  /**
   * Allocate stack space for a variable declaration.
   * Handles all variable types: strings, arrays, objects, maps, sets, regex, classes, Response, etc.
   * This eliminates duplicate code between generateBlock() and generateMain().
   *
   * @param stmt - Variable declaration statement
   * @param params - Function parameters for expression generation
   */
  private allocateVariable(stmt: VariableDeclaration, params: string[]): void {
    this.varAllocator.allocate(stmt, params);
  }

  private handleSimpleAssignment(stmt: AssignmentStatement, params: string[]): void {
    const stmtName = stmt.name;
    const stmtValue = stmt.value;
    const value = this.generateExpression(stmtValue as Expression, params);

    const stringAllocaReg = this.symbolTable.getStringAlloca(stmtName);
    if (stringAllocaReg) {
      this.emit(`store i8* ${value}, i8** ${stringAllocaReg}`);
      return;
    }

    const arrayAllocaReg = this.symbolTable.getArrayAlloca(stmtName);
    if (arrayAllocaReg) {
      if (this.symbolTable.isPointerAlloca(stmtName)) {
        const isStringArr = this.symbolTable.isStringArray(stmtName);
        const arrayType = isStringArr ? '%StringArray' : '%Array';
        let pointerValue = value;
        const valueType = this.getVariableType(value);
        if (valueType !== `${arrayType}*`) {
          const typedPtr = this.nextTemp();
          this.emit(`${typedPtr} = bitcast i8* ${value} to ${arrayType}*`);
          pointerValue = typedPtr;
        }
        this.emit(`store ${arrayType}* ${pointerValue}, ${arrayType}** ${arrayAllocaReg}`);
      } else {
        const loadedArray = this.nextTemp();
        this.emit(`${loadedArray} = load %Array, %Array* ${value}`);
        this.emit(`store %Array ${loadedArray}, %Array* ${arrayAllocaReg}`);
      }
      return;
    }

    const allocaReg = this.getVariableAlloca(stmtName);
    if (!allocaReg) {
      throw new Error(`Unknown variable: ${stmtName}`);
    }
    const varType = this.getVariableType(stmtName) || 'double';
    this.emit(`store ${varType} ${value}, ${varType}* ${allocaReg}`);
  }

  private getAssignmentName(stmt: AssignmentStatement): string {
    return stmt.name;
  }

  private getAssignmentValue(stmt: AssignmentStatement): Expression {
    return stmt.value;
  }

  private handleSimpleAssignmentWithFields(stmtName: string, stmtValue: Expression, params: string[]): void {
    if (this.symbolTable.isObjectArray(stmtName)) {
      this.setExpectedArrayElementType('pointer');
    } else if (this.symbolTable.isStringArray(stmtName)) {
      this.setExpectedArrayElementType('string');
    }
    const value = this.generateExpression(stmtValue, params);
    this.setExpectedArrayElementType(null);

    const stringAllocaReg = this.symbolTable.getStringAlloca(stmtName);
    if (stringAllocaReg) {
      this.emit(`store i8* ${value}, i8** ${stringAllocaReg}`);
      return;
    }

    const arrayAllocaReg = this.symbolTable.getArrayAlloca(stmtName);
    if (arrayAllocaReg) {
      if (this.symbolTable.isPointerAlloca(stmtName)) {
        const isStringArr = this.symbolTable.isStringArray(stmtName);
        const arrayType = isStringArr ? '%StringArray' : '%Array';
        let pointerValue = value;
        const valueType = this.getVariableType(value);
        if (valueType !== `${arrayType}*`) {
          const typedPtr = this.nextTemp();
          this.emit(`${typedPtr} = bitcast i8* ${value} to ${arrayType}*`);
          pointerValue = typedPtr;
        }
        this.emit(`store ${arrayType}* ${pointerValue}, ${arrayType}** ${arrayAllocaReg}`);
      } else {
        const loadedArray = this.nextTemp();
        this.emit(`${loadedArray} = load %Array, %Array* ${value}`);
        this.emit(`store %Array ${loadedArray}, %Array* ${arrayAllocaReg}`);
      }
      return;
    }

    const allocaReg = this.getVariableAlloca(stmtName);
    if (!allocaReg) {
      throw new Error(`Unknown variable: ${stmtName}`);
    }
    const varType = this.getVariableType(stmtName) || 'double';
    this.emit(`store ${varType} ${value}, ${varType}* ${allocaReg}`);
  }

  private allocateVariableWithFields(stmtName: string, stmtValue: Expression | null, stmtKind: string, stmtDeclaredType: string | undefined, params: string[]): void {
    const stmt: VariableDeclaration = {
      type: 'variable_declaration',
      kind: stmtKind as 'let' | 'const',
      name: stmtName,
      value: stmtValue,
      declaredType: stmtDeclaredType
    };
    this.varAllocator.allocate(stmt, params);
  }

  public generateBlock(block: BlockStatement, params: string[]): string | null {
    let lastValue: string | null = null;
    let hasTerminator = false;
    const blockLen = this.getBlockStatementsLength(block);

    for (let stmtIdx = 0; stmtIdx < blockLen; stmtIdx++) {
      const stmtRaw = this.getBlockStatementAt(block, stmtIdx);
      if (!stmtRaw) {
        continue;
      }
      if (hasTerminator) {
        break;
      }
      const stmtType = this.getStatementType(stmtRaw);
      if (!stmtType) {
        continue;
      }

      if (stmtType === 'variable_declaration') {
        const stmt = stmtRaw as VariableDeclaration;
        this.allocateVariable(stmt, params);
      } else if (stmtType === 'assignment') {
        const stmt = stmtRaw as AssignmentStatement;
        const stmtName = this.getAssignmentName(stmt);
        const stmtValue = this.getAssignmentValue(stmt);
        if (!stmtName) {
          continue;
        }
        const isMemberAccess = stmtName.startsWith('__member_access__');
        if (isMemberAccess) {
          this.assignmentGen.generateMemberAccessAssignment(stmtRaw as AssignmentStatement, params);
        } else if (stmtName === '__index_access__') {
          this.generateExpression(stmtValue as Expression, params);
        } else {
          this.handleSimpleAssignmentWithFields(stmtName, stmtValue as Expression, params);
        }
      } else if (stmtType === 'return') {
        const stmt = stmtRaw as { type: string; value: Expression | null };
        if (!stmt.value) {
          // Return without value - use default based on return type
          if (this.currentFunctionReturnType === 'void') {
            this.emit(`ret void`);
          } else if (this.currentFunctionReturnType === 'i8*') {
            this.syncStateToGenerators();
            const emptyStr = this.stringGen.doCreateStringConstant('');
            this.emit(`ret i8* ${emptyStr}`);
          } else if (this.currentFunctionReturnType && this.currentFunctionReturnType.indexOf('*') !== -1) {
            this.emit(`ret ${this.currentFunctionReturnType} null`);
          } else {
            this.emit(`ret ${this.currentFunctionReturnType} 0.0`);
          }
          hasTerminator = true;
          continue;
        }

        const stmtValueBase = stmt.value as { type: string };
        if (stmtValueBase.type === 'object' && this.currentFunctionTsReturnType) {
          const inlineType = this.extractInlineInterfaceType(this.currentFunctionTsReturnType);
          if (inlineType) {
            this.currentDeclaredInterfaceType = inlineType;
          } else {
            let returnTypeName = this.currentFunctionTsReturnType;
            if (returnTypeName.indexOf(' | ') !== -1) {
              const parts = returnTypeName.split(' | ');
              const objLit = stmt.value as ObjectNode;
              let discriminantValue: string | null = null;
              if (objLit.properties && objLit.properties.length > 0) {
                const firstProp = objLit.properties[0];
                if (firstProp.key === 'type' && firstProp.value) {
                  const propValue = firstProp.value as { type: string; value?: string };
                  if (propValue.type === 'string' && propValue.value) {
                    discriminantValue = propValue.value;
                  }
                }
              }
              if (discriminantValue && this.interfaceStructGen) {
                for (let i = 0; i < parts.length; i++) {
                  const part = parts[i].trim();
                  if (part === 'null' || part === 'undefined') continue;
                  const ifaceInfo = this.interfaceStructGen.getInterfaceStruct(part);
                  if (ifaceInfo && ifaceInfo.fields) {
                    const firstField = ifaceInfo.fields[0] as { name: string; tsType: string };
                    if (firstField && firstField.name === 'type') {
                      const expectedType = firstField.tsType.replace(/['"]/g, '');
                      if (expectedType === discriminantValue) {
                        returnTypeName = part;
                        break;
                      }
                    }
                  }
                }
              }
              if (returnTypeName === this.currentFunctionTsReturnType) {
                const numObjFields = objLit.properties ? objLit.properties.length : 0;
                let bestMatch: string | null = null;
                for (let i = 0; i < parts.length; i++) {
                  const part = parts[i].trim();
                  if (part === 'null' || part === 'undefined') continue;
                  if (!bestMatch) bestMatch = part;
                  if (this.interfaceStructGen) {
                    const ifaceInfo = this.interfaceStructGen.getInterfaceStruct(part);
                    if (ifaceInfo && ifaceInfo.fields && ifaceInfo.fields.length === numObjFields) {
                      bestMatch = part;
                      break;
                    }
                  }
                }
                if (bestMatch) {
                  returnTypeName = bestMatch;
                }
              }
            }
            if (this.interfaceStructGen && this.interfaceStructGen.hasInterface(returnTypeName)) {
              this.currentDeclaredInterfaceType = returnTypeName;
            }
          }
        }
        lastValue = this.generateExpression(stmt.value as Expression, params);
        this.currentDeclaredInterfaceType = undefined;

        if (!lastValue || lastValue === '') {
          throw new Error(`Return statement generated empty value for function ${this.currentFunction}`);
        }

        if (this.isAsyncFunction) {
          const valueAsPtr = this.nextTemp();
          this.emit(`${valueAsPtr} = bitcast i8* ${lastValue} to i8*`);
          this.emit(`call void @__Promise_resolve(%Promise* ${this.asyncResultPromise}, i8* ${lastValue})`);
          this.emit(`ret %Promise* ${this.asyncResultPromise}`);
        } else {
          if (this.currentFunctionReturnType === 'double') {
            const valueType = this.getVariableType(lastValue);
            if (valueType === 'i32') {
              const converted = this.nextTemp();
              this.emit(`${converted} = sitofp i32 ${lastValue} to double`);
              lastValue = converted;
            } else if (valueType === 'i8*' || lastValue === 'null') {
              lastValue = '0.0';
            }
          }

          if (this.currentFunctionReturnType === 'void') {
            this.emit(`ret void`);
          } else {
            this.emit(`ret ${this.currentFunctionReturnType} ${lastValue}`);
          }
        }
        hasTerminator = true;
      } else if (stmtType === 'if') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateIfStatement(stmtRaw as Statement, params);
        // Don't need to sync back - counters are already shared via bound methods
      } else if (stmtType === 'while') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateWhileStatement(stmtRaw as Statement, params);
      } else if (stmtType === 'for') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateForStatement(stmtRaw as Statement, params);
      } else if (stmtType === 'for_of') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateForOfStatement(stmtRaw as Statement, params);
      } else if (stmtType === 'break') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateBreakStatement();
        hasTerminator = true;  // break generates 'br', which is a terminator
      } else if (stmtType === 'continue') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateContinueStatement();
        hasTerminator = true;  // continue generates 'br', which is a terminator
      } else if (stmtType === 'throw') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateThrowStatement(stmtRaw as Statement, params);
        hasTerminator = true;  // throw generates 'unreachable', which is a terminator
      } else if (stmtType === 'try') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateTryStatement(stmtRaw as Statement, params);
      } else if (stmtType === 'switch') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateSwitchStatement(stmtRaw as Statement, params);
      } else if (stmtType === 'block') {
        lastValue = this.generateBlock(stmtRaw as BlockStatement, params);
      } else {
        // Expression statement
        lastValue = this.generateExpression(stmtRaw as Expression, params);
      }
    }

    return lastValue;
  }

  /**
   * Generates LLVM IR for any expression node.
   * This is the core dispatcher that handles all expression types via visitor pattern.
   *
   * @example
   * // Binary expression: 5 + 3
   * Input: { type: 'binary', op: '+', left: { type: 'number', value: 5 }, right: { type: 'number', value: 3 }}
   * Output: '%1 = fadd double 5.0, 3.0'
   *
   * @example
   * // Variable reference: x
   * Input: { type: 'variable', name: 'x' }
   * Output: '%2 = load double, double* %x'
   *
   * @example
   * // Array literal: [1, 2, 3]
   * Input: { type: 'array', elements: [{ type: 'number', value: 1 }, ...] }
   * Output: (calls to malloc, stores for each element, returns %Array* pointer)
   *
   * @param expr - AST expression node to generate code for
   * @param params - Function parameter names (for resolving variable references)
   * @returns LLVM register name containing the expression result (e.g., '%3')
   */
  public generateExpression(expr: Expression, params: string[]): string {
    const exprBase = expr as { type: string };
    // Delegate all expression types to ExpressionGenerator
    return this.exprGen.generate(expr, params);
  }

  public isArrayExpression(expr: Expression): boolean {
    return this.typeInference.isArrayExpression(expr);
  }

  public isObjectArrayExpression(expr: Expression): boolean {
    return this.typeInference.isObjectArrayExpression(expr);
  }

  public getObjectArrayElementType(expr: Expression): string | null {
    return this.typeInference.getObjectArrayElementType(expr);
  }

  public isObjectExpression(expr: Expression): boolean {
    return this.typeInference.isObjectExpression(expr);
  }

  public isMapExpression(expr: Expression): boolean {
    return this.typeInference.isMapExpression(expr);
  }

  public isSetExpression(expr: Expression): boolean {
    return this.typeInference.isSetExpression(expr);
  }

  public isStringExpression(expr: Expression): boolean {
    return this.typeInference.isStringExpression(expr);
  }

  public isRegexExpression(expr: Expression): boolean {
    return this.typeInference.isRegexExpression(expr);
  }

  public isClassInstanceExpression(expr: Expression): boolean {
    return this.typeInference.isClassInstanceExpression(expr);
  }

  public isPromiseExpression(expr: Expression): boolean {
    return this.typeInference.isPromiseExpression(expr);
  }

  public isAwaitExpression(expr: Expression): boolean {
    return expr.type === 'await';
  }

  public isResponseExpression(expr: Expression): boolean {
    return this.typeInference.isResponseExpression(expr);
  }

  public getTypedJsonInterface(expr: Expression): string | null {
    if (expr.type !== 'method_call') return null;
    return this.typeInference.getTypedJsonInterface(expr as MethodCallNode);
  }

  public getFunctionCallInterfaceReturn(expr: Expression): string | null {
    return this.typeInference.getFunctionCallInterfaceReturn(expr);
  }

  public getMethodCallInterfaceReturn(expr: Expression): string | null {
    return this.typeInference.getMethodCallInterfaceReturn(expr);
  }

  public getMethodCallArrayReturn(expr: Expression): string | null {
    return this.typeInference.getMethodCallArrayReturn(expr);
  }

  public getJSONParseInterface(expr: Expression): string | null {
    if (expr.type !== 'method_call') return null;
    return this.typeInference.getJSONParseInterface(expr as MethodCallNode);
  }

  public isJSONParseExpression(expr: Expression): boolean {
    return this.typeInference.isJSONParseExpression(expr);
  }

  public isStringArrayExpression(expr: Expression): boolean {
    return this.typeInference.isStringArrayExpression(expr);
  }

  public getTopLevelItemsCount(): number {
    return this.topLevelItemsCount;
  }

  private tsTypeToLlvmJsonWithEnums(tsType: string): string {
    if (this.isEnumType(tsType)) {
      return 'double';
    }
    return tsTypeToLlvmJson(tsType);
  }

  public getTopLevelStatementsCount(): number {
    return this.topLevelStatementsCount;
  }

  public getTopLevelExpressionsCount(): number {
    return this.topLevelExpressionsCount;
  }

  public getTopLevelItem(index: number): Expression {
    return this.ast.topLevelItems![index] as Expression;
  }

  public getTopLevelItemType(index: number): string {
    const types = this.ast.topLevelItemTypes;
    if (types && index < types.length) {
      return types[index];
    }
    const items = this.ast.topLevelItems as Expression[];
    const item = items[index];
    if (!item) return '';
    return item.type;
  }

  public getTopLevelStatement(index: number): VariableDeclaration {
    return this.ast.topLevelStatements[index] as VariableDeclaration;
  }

  public getTopLevelExpression(index: number): CallNode | NewNode | MethodCallNode | ForStatement | ForOfStatement | WhileStatement | IfStatement | TryStatement | UnaryNode {
    return this.ast.topLevelExpressions[index];
  }

  public getOutputAsString(): string {
    if (this.output.length === 0) {
      return '';
    }
    const lines: string[] = [];
    for (let i = 0; i < this.output.length; i++) {
      const line = this.output[i];
      if (line) {
        lines.push('  ' + line);
      } else {
        lines.push('  ');
      }
    }
    return lines.join('\n') + '\n';
  }

  public processTopLevelItem(index: number): void {
    const items = this.ast.topLevelItems;
    if (!items) {
      return;
    }
    const item = items[index];
    if (!item) {
      return;
    }
    const itemType = this.getTopLevelItemType(index);
    if (itemType === 'variable_declaration') {
      this.allocateVariable(item as VariableDeclaration, []);
    } else if (itemType === 'if') {
      this.syncStateToGenerators();
      this.controlFlowGen.generateIfStatement(item as IfStatement, []);
    } else if (itemType === 'while') {
      this.syncStateToGenerators();
      this.controlFlowGen.generateWhileStatement(item as WhileStatement, []);
    } else if (itemType === 'for') {
      this.syncStateToGenerators();
      this.controlFlowGen.generateForStatement(item as ForStatement, []);
    } else if (itemType === 'for_of') {
      this.syncStateToGenerators();
      this.controlFlowGen.generateForOfStatement(item as ForOfStatement, []);
    } else if (itemType === 'assignment') {
      this.generateBlock({ type: 'block', statements: [item as AssignmentStatement] }, []);
    } else if (itemType === 'throw') {
      this.syncStateToGenerators();
      this.controlFlowGen.generateThrowStatement(item as Statement, []);
    } else {
      this.generateExpression(item as Expression, []);
    }
  }

  private generateMain(): string {
    return this.funcGen.generateMain(this.topLevelObjectVariables);
  }

  // Generate HTTP server - creates a TCP server that parses HTTP and calls handler
  public generateHttpServe(expr: CallNode, params: string[]): string {
    if (expr.args.length < 2) {
      throw new Error('httpServe() requires 2 arguments: port and handler function');
    }

    const portValue = this.generateExpression(expr.args[0], params);
    const handlerArg = expr.args[1];
    if (handlerArg.type !== 'variable') {
      throw new Error('httpServe() handler must be a function reference');
    }
    const handlerName = (handlerArg as VariableNode).name;

    // Track handler for mongoose event handler generation
    this.httpHandlers.push(handlerName);
    this.usesMongoose = 1;
    this.usesTimers = 1;

    // Convert port from double to i32
    const portI32 = this.nextTemp();
    this.emit(`${portI32} = fptosi double ${portValue} to i32`);

    // Call the runtime http_serve function
    // Handler now takes a single Request object (i8*) and returns Response object (i8*)
    const temp = this.nextTemp();
    this.emit(`${temp} = call i32 @http_serve(i32 ${portI32}, i8* (i8*)* @${handlerName})`);

    return temp;
  }

  public getInterfaceFromAST(name: string): { name: string; fields: { name: string; type: string }[] } | null {
    for (let i = 0; i < this.ast.interfaces.length; i++) {
      const iface = this.ast.interfaces[i] as InterfaceDeclaration;
      if (!iface) continue;
      if (!iface.name) continue;
      if (iface.name === name) {
        return this.ast.interfaces[i];
      }
    }
    return null;
  }

  // Sync state to sub-generators - share Maps/arrays by reference
  // Note: Counters are already shared via bound methods (nextTemp, nextLabel, nextString)
  // Note: ALL generators now use context pattern - no state syncing needed! 🎉
  public syncStateToGenerators() {
    // No generators left to sync - all use context pattern!
    // This method kept for backward compatibility but is now a no-op
  }
}
