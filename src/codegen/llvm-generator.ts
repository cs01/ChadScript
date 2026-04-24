import {
  AST,
  Expression,
  FunctionNode,
  BlockStatement,
  NewNode,
  CallNode,
  VariableNode,
  VariableDeclaration,
  ObjectNode,
  ObjectProperty,
  MethodCallNode,
  InterfaceDeclaration,
  InterfaceField,
  TypeAliasDeclaration,
  Statement,
  AssignmentStatement,
  ImportDeclaration,
  ImportSpecifier,
  IfStatement,
  WhileStatement,
  DoWhileStatement,
  ForStatement,
  ForOfStatement,
  TryStatement,
  ClassNode,
  ArrayNode,
  MapNode,
  SetNode,
  ArrowFunctionNode,
  UnaryNode,
  IndexAccessNode,
  AwaitExpressionNode,
  BinaryNode,
  SourceLocation,
  FunctionParameter,
  ReturnStatement,
  StringNode,
  MemberAccessNode,
  EnumDeclaration,
} from "../ast/types.js";
import {
  BaseGenerator,
  SymbolKind,
  SymbolKind_Number,
  SymbolKind_String,
  SymbolKind_Boolean,
  SymbolKind_Array,
  SymbolKind_StringArray,
  SymbolKind_ObjectArray,
  SymbolKind_Object,
  SymbolKind_Map,
  SymbolKind_Set,
  SymbolKind_Class,
  SymbolKind_Regex,
  SymbolKind_JSON,
  SymbolKind_Closure,
  SymbolKind_Pointer,
  SymbolKind_Uint8Array,
  SymbolKind_Url,
  SymbolKind_UrlSearchParams,
  SymbolTable,
} from "./infrastructure/base-generator.js";
import {
  MapMetadata,
  SymbolMetadata,
  createPointerAllocaMetadata,
  createClassMetadata,
  createObjectMetadataWithInterface,
  createInterfaceMetadata,
  createMapMetadataSymbol,
  createSetMetadataSymbol,
  ObjectMetadata,
} from "./infrastructure/symbol-table.js";
import { TypeInference, TypeInferenceContext } from "./infrastructure/type-inference.js";
import {
  VariableAllocator,
  VariableAllocatorContext,
} from "./infrastructure/variable-allocator.js";
import {
  FunctionGenerator,
  FunctionGeneratorContext,
} from "./infrastructure/function-generator.js";
import {
  AssignmentGenerator,
  AssignmentGeneratorContext,
} from "./infrastructure/assignment-generator.js";
import { findI64EligibleVariables } from "./infrastructure/integer-analysis.js";
import {
  getLLVMDeclarations,
  getSafeStringHelper,
  getDoubleToStringHelper,
  getStringHashHelper,
  getBoundsCheckHelper,
  getNullCheckHelper,
  getGlobalVariables,
} from "./infrastructure/llvm-declarations.js";
import {
  TypeResolver,
  TypeResolverContext,
  TypeGuardInfo,
} from "./infrastructure/type-resolver/index.js";
import {
  stripOptional,
  stripNullable,
  tsTypeToLlvm,
  tsTypeToLlvmJson,
  mapReturnTypeToLLVM,
  mapParamTypeToLLVM,
} from "./infrastructure/type-system.js";
import {
  parseTypeString,
  parseMapTypeString,
  type ResolvedType,
} from "./infrastructure/type-system.js";
import { DiagnosticEngine } from "../diagnostics/engine.js";
import { TypeContext } from "./infrastructure/type-context.js";
import { IGeneratorContext, IArrowFunctionGenerator } from "./infrastructure/generator-context.js";
import { TrampolineEmitter } from "./infrastructure/trampoline-emitter.js";
import type { FieldInfo } from "./infrastructure/type-resolver/types.js";
import { ArrayGenerator } from "./types/collections/array.js";
import { StringGenerator } from "./types/collections/string.js";
import { ObjectGenerator } from "./types/objects/object.js";
import { MapGenerator, StringMapGenerator, PointerMapGenerator } from "./types/collections/map.js";
import { SetGenerator, StringSetGenerator } from "./types/collections/set.js";
import { ControlFlowGenerator } from "./statements/control-flow.js";
import { ClassGenerator } from "./types/objects/class.js";
import { RegexGenerator } from "./types/objects/regex.js";
import { MathGenerator } from "./stdlib/math.js";
import { ConsoleGenerator } from "./stdlib/console.js";
import { ProcessGenerator } from "./stdlib/process.js";
import { PathGenerator } from "./stdlib/path.js";
import { JsonGenerator } from "./stdlib/json.js";
import { DateGenerator } from "./stdlib/date.js";
import { FilesystemGenerator } from "./stdlib/fs.js";
import { ResponseGenerator } from "./stdlib/response.js";
import { CryptoGenerator } from "./stdlib/crypto.js";
import { generateConsoleTimerHelpers } from "./stdlib/console-timers.js";
import { generateDefaultSortComparators } from "./types/collections/array/sort.js";
import { AsyncFsGenerator } from "./stdlib/async-fs.js";
import { SqliteGenerator } from "./stdlib/sqlite.js";
import { ChildProcessGenerator, AsyncChildProcessGenerator } from "./stdlib/child-process.js";
import { EmbedGenerator } from "./stdlib/embed.js";
import { RuntimeGenerator } from "./runtime/runtime.js";
import { HttpServerGenerator } from "./stdlib/http-server.js";
import { LibuvGenerator } from "./stdlib/libuv.js";
import { PromiseGenerator } from "./stdlib/promise.js";
import { TreeSitterGenerator } from "./stdlib/treesitter.js";
import { ExpressionGenerator } from "./expressions/orchestrator.js";
import type { TypeChecker } from "../typescript/type-checker.js";
import { InterfaceStructGenerator } from "./types/interface-struct-generator.js";
import { JsonObjectMeta } from "./expressions/access/member.js";
import type { TargetInfo } from "../target-types.js";
import { checkClosureMutations } from "../semantic/closure-mutation-checker.js";
import { checkUnionTypes } from "../semantic/union-type-checker.js";
import { checkArraysOfFunctions } from "../semantic/array-of-function-checker.js";
import { markIntSpecializedFunctions } from "./infrastructure/int-specialization-detector.js";
import { checkTypeAssertions } from "../semantic/type-assertion-checker.js";
import { annotateTypes } from "../semantic/type-annotator.js";
import { SemaTable } from "../semantic/sema-table.js";
import { checkUninitializedFields } from "../semantic/uninitialized-field-checker.js";
import { analyzeEscapes } from "../semantic/escape-analysis.js";
// binary-type-checker.ts: original top-level-only checker kept for reference; deep version is in safety-checks.ts
import { checkEnumDeclarations } from "../semantic/enum-checker.js";
import { normalizeInterfaceLayouts } from "../semantic/interface-layout-normalizer.js";
import { checkAsyncAwait } from "../semantic/async-await-checker.js";
import { checkAmbiguousInits } from "../semantic/ambiguous-init-checker.js";
import { checkUntypedParams } from "../semantic/untyped-param-checker.js";
import { checkOrFallback } from "../semantic/or-fallback-checker.js";
import { checkCallResultIndex } from "../semantic/call-result-index-checker.js";
import { checkMixedOperators } from "../semantic/mixed-operator-checker.js";
import {
  checkBinaryTypesDeep,
  checkMissingReturns,
  checkArgumentCounts,
} from "../semantic/safety-checks.js";
import { DebugMetadataBuilder } from "./infrastructure/debug-metadata.js";

export interface SemaSymbolData {
  names: string[];
  types: string[];
  llvmTypes: string[];
  schemaKeys: (string[] | undefined)[];
  schemaTypes: (string[] | undefined)[];
}

export interface LLVMGeneratorOptions {
  sourceCode?: string;
  filename?: string;
  debugInfo?: boolean;
  debugFilename?: string;
  analyzedSymbols?: SemaSymbolData;
  target?: TargetInfo;
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
  public currentFunctionReturnType: string = "double";
  public currentFunctionTsReturnType: string | undefined;
  public isAsyncFunction: boolean = false;
  public asyncResultPromise: string = "";

  // Top-level variables (accessible from all functions)
  private topLevelObjectVariables: Map<string, { ptr: string; keys: string[]; types: string[] }>;

  // Global variables declared with LLVM @ prefix (accessible from any function)
  private globalVariables: Map<string, { llvmType: string; kind: number; initialized: boolean }>;

  // Import alias: parallel arrays for self-hosting compatibility (Map has issues in native runtime)
  private importAliasNames: string[];
  private importAliasOriginals: string[];

  // Specialized generators (public for context pattern access)
  public arrayGen: ArrayGenerator;
  public stringGen: StringGenerator;
  public objectGen: ObjectGenerator;
  public mapGen: MapGenerator;
  public stringMapGen: StringMapGenerator;
  public pointerMapGen: PointerMapGenerator;
  public setGen: SetGenerator;
  public stringSetGen: StringSetGenerator;
  public controlFlowGen: ControlFlowGenerator;
  public classGen: ClassGenerator;
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
  public arrowFunctionGen!: IArrowFunctionGenerator;
  public cryptoGen: CryptoGenerator;
  public sqliteGen: SqliteGenerator;
  public childProcessGen: ChildProcessGenerator;
  public embedGen: EmbedGenerator;
  private runtimeGen: RuntimeGenerator;
  private httpServerGen: HttpServerGenerator;
  private libuvGen: LibuvGenerator;
  private promiseGen: PromiseGenerator;
  private asyncFsGen: AsyncFsGenerator;
  private asyncCpGen: AsyncChildProcessGenerator;
  private treesitterGen: TreeSitterGenerator;
  private httpHandlers: string[];
  private wsHandlers: string[];
  public usesPromises: number = 0;
  public usesSqlite: number = 0;
  public usesCurl: number = 0;
  public usesUvHrtime: number = 0;
  public usesConsoleTime: number = 0;
  public usesArraySort: number = 0;
  public usesCrypto: number = 0;
  public usesJson: number = 0;
  public usesHttpServer: number = 0;
  public usesWsPrimitives: number = 0;
  public usesMultipart: number = 0;
  public usesRegex: number = 0;
  public usesTestRunner: number = 0;
  public usesAsyncFs: number = 0;
  public usesChildProcess: number = 0;
  public usesSpawn: number = 0;
  public usesStringBuilder: number = 0;
  public usesLLVM: number = 0;
  public usesLLD: number = 0;
  public usesV8: number = 0;
  public usesCompression: number = 0;
  public usesYaml: number = 0;
  private stringBuilderSlen: Map<string, string> = new Map();
  private stringBuilderScap: Map<string, string> = new Map();

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
  private interfaceStructDefsCache: string = "";

  // Cache for class struct defs (used at end of generate())
  private classStructDefsCache: string = "";

  // JSON object metadata for tracking parsed JSON structures
  public jsonObjectMetadata: Map<string, JsonObjectMeta>;

  private i64EligibleVars: string[] = [];

  // Diagnostic engine for structured error/warning reporting
  public diagnostics: DiagnosticEngine;

  // Type context for canonical interned type objects
  public typeContext: TypeContext;

  public targetInfo: TargetInfo | undefined;

  // Pre-analyzed symbols from semantic analysis (parallel arrays for self-hosting compat)
  private semaSymbolNames: string[];
  private semaSymbolTypes: string[];
  private semaSymbolLlvmTypes: string[];
  private semaSymbolSchemaKeys: (string[] | undefined)[];
  private semaSymbolSchemaTypes: (string[] | undefined)[];
  private semaSymbolCount: number;

  // Escape analysis result — string keys "name:line:col" for stack-eligible var decls
  private stackEligibleVars: string[] = [];
  public currentVarDeclKey: string | null = null;

  // Debug info emitter (null when debug info is disabled)
  private debugInfoEmitter: number = 0;
  private currentSubprogramId: number = -1;
  private dbgBuilder!: DebugMetadataBuilder;

  public usesGC: number = 0;
  public usesMathRandom: number = 0;

  public emitError(message: string, loc?: SourceLocation, suggestion?: string): never {
    this.diagnostics.error(message, loc, suggestion);
    // Cache result. Two getErrors() calls in one expression hit issue #688.
    const errors = this.diagnostics.getErrors();
    const output = this.diagnostics.formatDiagnostic(errors[errors.length - 1]);
    process.stderr.write(output);
    process.exit(1);
  }

  public emitWarning(message: string, loc?: SourceLocation, suggestion?: string): void {
    this.diagnostics.warning(message, loc, suggestion);
  }

  private extractInlineInterfaceType(returnType: string): string | null {
    if (returnType.startsWith("{")) {
      return returnType;
    }
    if (returnType.indexOf(" | ") !== -1) {
      const parts = returnType.split(" | ");
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part.startsWith("{")) {
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

  public getSymbolTable(): SymbolTable {
    return this.symbolTable;
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
            if (cls.name.indexOf("Mock") !== -1 || cls.name.indexOf("Test") !== -1) {
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
    if (interfaceName.endsWith("Context") || interfaceName.endsWith("Like")) {
      for (let i = 0; i < this.ast.classes.length; i++) {
        const cls = this.ast.classes[i];
        if (!cls) continue;
        if (!cls.name) continue;
        if (cls.implements) {
          for (let j = 0; j < cls.implements.length; j++) {
            if (cls.implements[j] === "IGeneratorContext") {
              if (cls.name.indexOf("Mock") === -1 && cls.name.indexOf("Test") === -1) {
                return cls.name;
              }
            }
          }
        }
      }
    }
    return null;
  }

  public getInterfaceProperties(
    name: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    if (!this.ast || !this.ast.interfaces) return null;
    const baseName = name.endsWith("?") ? name.slice(0, name.length - 1) : name;
    const cleanName = baseName.indexOf(" | ") !== -1 ? baseName.split(" | ")[0] : baseName;
    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (const iface of this.ast.interfaces) {
      if (!iface) continue;
      if (iface.name === cleanName) {
        const allFields = this.getAllInterfaceFields(iface);
        for (let fi = 0; fi < allFields.length; fi++) {
          const field = allFields[fi] as InterfaceField;
          if (!field) continue;
          let fieldName = field.name;
          if (fieldName.endsWith("?")) {
            fieldName = fieldName.slice(0, fieldName.length - 1);
          }
          keys.push(fieldName);
          types.push(tsTypeToLlvm(field.type));
          tsTypes.push(field.type);
        }
      }
    }
    if (keys.length > 0) return { keys, types, tsTypes };
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

  public findInterfaceForFields(fieldNames: string[]): string | null {
    if (!this.ast || !this.ast.interfaces) return null;
    for (let i = 0; i < this.ast.interfaces.length; i++) {
      const iface = this.ast.interfaces[i];
      if (!iface) continue;
      const allFields = this.getAllInterfaceFields(iface);
      let allFound = true;
      for (let j = 0; j < fieldNames.length; j++) {
        let found = false;
        for (let k = 0; k < allFields.length; k++) {
          const fn = allFields[k].name;
          if (fn === fieldNames[j] || fn === fieldNames[j] + "?") {
            found = true;
            break;
          }
        }
        if (!found) {
          allFound = false;
          break;
        }
      }
      if (allFound && this.interfaceStructGen?.hasInterface(iface.name)) return iface.name;
    }
    return null;
  }

  public getAllInterfaceFields(iface: InterfaceDeclaration): InterfaceField[] {
    return this.varAllocator.getAllInterfaceFields(iface);
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

  public getTypeAliasCommonProperties(
    name: string,
  ): { keys: string[]; types: string[]; tsTypes: string[] } | null {
    if (!this.ast || !this.ast.typeAliases) return null;
    for (let i = 0; i < this.ast.typeAliases.length; i++) {
      const ta = this.ast.typeAliases[i];
      if (!ta) continue;
      if (ta.name === name && ta.unionMembers) {
        let commonNames: string[] = [];
        let commonTypes: string[] = [];
        let commonTsTypes: string[] = [];
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
              commonTsTypes.push(memberProps.tsTypes[p]);
            }
            first = false;
          } else {
            const nextNames: string[] = [];
            const nextTypes: string[] = [];
            const nextTsTypes: string[] = [];
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
                nextTsTypes.push(commonTsTypes[ci]);
              }
            }
            commonNames = nextNames;
            commonTypes = nextTypes;
            commonTsTypes = nextTsTypes;
          }
        }
        if (commonNames.length > 0) {
          return { keys: commonNames, types: commonTypes, tsTypes: commonTsTypes };
        }
      }
    }
    return null;
  }

  public getInterfaceFieldType(interfaceName: string, fieldName: string): string | null {
    if (interfaceName.startsWith("{") && interfaceName.endsWith("}")) {
      return null;
    }
    if (!this.ast || !this.ast.interfaces) return null;
    for (const iface of this.ast.interfaces) {
      if (!iface) continue;
      if (iface.name === interfaceName) {
        const allFields = this.getAllInterfaceFields(iface);
        for (let fi = 0; fi < allFields.length; fi++) {
          const f = allFields[fi] as InterfaceField;
          if (!f) continue;
          let fName = f.name;
          if (fName.endsWith("?")) {
            fName = fName.slice(0, fName.length - 1);
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
      const e = eRaw as EnumDeclaration;
      if (e.name === name) return true;
    }
    return false;
  }

  public getEnumMemberValue(enumName: string, memberName: string): number {
    if (!this.ast || !this.ast.enums) {
      return -1;
    }
    for (let i = 0; i < this.ast.enums.length; i++) {
      const e = this.ast.enums[i];
      if (!e) continue;
      if (e.name === enumName && e.members) {
        for (let j = 0; j < e.members.length; j++) {
          const m = e.members[j];
          if (!m) continue;
          if (m.name === memberName) {
            return m.value;
          }
        }
      }
    }
    return -1;
  }

  public getEnumMemberStringValue(enumName: string, memberName: string): string | null {
    if (!this.ast || !this.ast.enums) {
      return null;
    }
    for (let i = 0; i < this.ast.enums.length; i++) {
      const e = this.ast.enums[i];
      if (!e) continue;
      if (e.name === enumName && e.members) {
        for (let j = 0; j < e.members.length; j++) {
          const m = e.members[j];
          if (!m) continue;
          if (m.name === memberName && m.stringValue) {
            return m.stringValue;
          }
        }
      }
    }
    return null;
  }

  public getLastInstruction(): string {
    if (this.output.length === 0) return "";
    const last = this.output[this.output.length - 1];
    return last ? last.trim() : "";
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
    if (!stmt) return "";
    return stmt.type || "";
  }

  public hasClassGen(): boolean {
    return this.classGen !== null && this.classGen !== undefined;
  }

  public setCurrentFunction(name: string | null): void {
    this.currentFunction = name;
  }
  public getCurrentFunction(): string | null {
    return this.currentFunction;
  }
  public setCurrentFunctionReturnType(type: string): void {
    this.currentFunctionReturnType = type;
  }
  public getCurrentFunctionReturnType(): string {
    return this.currentFunctionReturnType;
  }
  public setCurrentFunctionTsReturnType(type: string | undefined): void {
    this.currentFunctionTsReturnType = type;
  }
  public getCurrentFunctionTsReturnType(): string | undefined {
    return this.currentFunctionTsReturnType;
  }
  public getI64EligibleVars(): string[] {
    return this.i64EligibleVars;
  }
  public setI64EligibleVars(vars: string[]): void {
    this.i64EligibleVars = vars;
  }
  public setExpectedArrayElementType(
    type: "string" | "number" | "boolean" | "pointer" | null,
  ): void {
    this.expectedArrayElementType = type;
  }
  public getExpectedArrayElementType(): "string" | "number" | "boolean" | "pointer" | null {
    return this.expectedArrayElementType;
  }
  public wantsBinaryReturn: boolean = false;
  public setWantsBinaryReturn(value: boolean): void {
    this.wantsBinaryReturn = value;
  }
  public getWantsBinaryReturn(): boolean {
    return this.wantsBinaryReturn;
  }
  public setCurrentDeclaredMapType(type: string | undefined): void {
    this.currentDeclaredMapType = type;
  }
  public getCurrentDeclaredMapType(): string | undefined {
    return this.currentDeclaredMapType;
  }
  public setCurrentDeclaredSetType(type: string | undefined): void {
    this.currentDeclaredSetType = type;
  }
  public getCurrentDeclaredSetType(): string | undefined {
    return this.currentDeclaredSetType;
  }
  public contiguousObjectArrayStride: number = 0;
  public setContiguousObjectArrayStride(stride: number): void {
    this.contiguousObjectArrayStride = stride;
  }
  public getContiguousObjectArrayStride(): number {
    return this.contiguousObjectArrayStride;
  }
  public setUsesPromises(value: boolean): void {
    this.usesPromises = value ? 1 : 0;
  }
  public getUsesPromises(): boolean {
    return this.usesPromises !== 0;
  }

  // Promise-executor binding stack — see generator-context.ts comment.
  private promiseExecutorStack: { resolveName: string; rejectName: string; promisePtr: string }[] =
    [];
  public pushPromiseExecutor(resolveName: string, rejectName: string, promisePtr: string): void {
    this.promiseExecutorStack.push({ resolveName, rejectName, promisePtr });
  }
  public popPromiseExecutor(): void {
    this.promiseExecutorStack.pop();
  }
  public getActivePromiseExecutor(): {
    resolveName: string;
    rejectName: string;
    promisePtr: string;
  } | null {
    if (this.promiseExecutorStack.length === 0) return null;
    return this.promiseExecutorStack[this.promiseExecutorStack.length - 1];
  }
  public setUsesTrampolines(value: boolean): void {
    this.usesTrampolines = value ? 1 : 0;
  }
  public getUsesTrampolines(): boolean {
    return this.usesTrampolines !== 0;
  }
  public setUsesTimers(value: boolean): void {
    this.usesTimers = value ? 1 : 0;
  }
  public getUsesTimers(): boolean {
    return this.usesTimers !== 0;
  }
  public setUsesTreeSitter(value: boolean): void {
    this.usesTreeSitter = value;
  }
  public getUsesTreeSitter(): boolean {
    return this.usesTreeSitter;
  }
  public setUsesSqlite(value: boolean): void {
    this.usesSqlite = value ? 1 : 0;
  }
  public getUsesSqlite(): boolean {
    return this.usesSqlite !== 0;
  }
  public setUsesCurl(value: boolean): void {
    this.usesCurl = value ? 1 : 0;
  }
  public setUsesOs(_value: boolean): void {}
  public getUsesCurl(): boolean {
    return this.usesCurl !== 0;
  }
  public setUsesUvHrtime(value: boolean): void {
    this.usesUvHrtime = value ? 1 : 0;
  }
  public getUsesUvHrtime(): boolean {
    return this.usesUvHrtime !== 0;
  }
  public setUsesConsoleTime(value: boolean): void {
    this.usesConsoleTime = value ? 1 : 0;
  }
  public setUsesArraySort(value: boolean): void {
    this.usesArraySort = value ? 1 : 0;
  }

  public getTargetOS(): string {
    return this.targetInfo ? this.targetInfo.os : process.platform;
  }

  public setRawInterfaceType(name: string, type: string): void {
    this.symbolTable.setRawInterfaceType(name, type);
  }

  public markContiguousObjectArray(name: string, numFields: number): void {
    this.symbolTable.markContiguousObjectArray(name, numFields);
  }

  public getTargetArch(): string {
    return this.targetInfo ? this.targetInfo.archString : process.arch;
  }
  public setUsesCrypto(value: boolean): void {
    this.usesCrypto = value ? 1 : 0;
  }
  public getUsesCrypto(): boolean {
    return this.usesCrypto !== 0;
  }
  public setUsesJson(value: boolean): void {
    this.usesJson = value ? 1 : 0;
  }
  public getUsesJson(): boolean {
    return this.usesJson !== 0;
  }
  public setUsesHttpServer(value: boolean): void {
    this.usesHttpServer = value ? 1 : 0;
  }
  public getUsesHttpServer(): boolean {
    return this.usesHttpServer !== 0;
  }
  public setUsesMultipart(value: boolean): void {
    this.usesMultipart = value ? 1 : 0;
  }
  public getUsesMultipart(): boolean {
    return this.usesMultipart !== 0;
  }
  public setUsesRegex(value: boolean): void {
    this.usesRegex = value ? 1 : 0;
  }
  public getUsesRegex(): boolean {
    return this.usesRegex !== 0;
  }
  public setUsesTestRunner(value: boolean): void {
    this.usesTestRunner = value ? 1 : 0;
  }
  public getUsesTestRunner(): boolean {
    return this.usesTestRunner !== 0;
  }
  public setUsesChildProcess(value: boolean): void {
    this.usesChildProcess = value ? 1 : 0;
  }
  public getUsesChildProcess(): boolean {
    return this.usesChildProcess !== 0;
  }
  public setUsesSpawn(value: boolean): void {
    this.usesSpawn = value ? 1 : 0;
  }
  public getUsesSpawn(): boolean {
    return this.usesSpawn !== 0;
  }
  public setUsesAsyncFs(value: boolean): void {
    this.usesAsyncFs = value ? 1 : 0;
  }
  public getUsesGC(): boolean {
    return this.usesGC !== 0;
  }
  public setUsesGC(value: boolean): void {
    this.usesGC = value ? 1 : 0;
  }
  public getUsesMathRandom(): boolean {
    return this.usesMathRandom !== 0;
  }
  public setUsesMathRandom(value: boolean): void {
    this.usesMathRandom = value ? 1 : 0;
  }
  public getUsesLLVM(): boolean {
    return this.usesLLVM !== 0;
  }
  public getUsesLLD(): boolean {
    return this.usesLLD !== 0;
  }
  public getUsesV8(): boolean {
    return this.usesV8 !== 0;
  }
  public setUsesV8(value: boolean): void {
    this.usesV8 = value ? 1 : 0;
  }
  public setUsesCompression(value: boolean): void {
    this.usesCompression = value ? 1 : 0;
  }
  public getUsesCompression(): boolean {
    return this.usesCompression !== 0;
  }
  public setUsesYaml(value: boolean): void {
    this.usesYaml = value ? 1 : 0;
  }
  public getUsesYaml(): boolean {
    return this.usesYaml !== 0;
  }
  public setCurrentDeclaredInterfaceType(type: string | undefined): void {
    this.currentDeclaredInterfaceType = type;
  }
  public getCurrentDeclaredInterfaceType(): string | undefined {
    return this.currentDeclaredInterfaceType;
  }
  public setExpectedCallbackParamType(type: string | null): void {
    this.expectedCallbackParamType = type;
  }
  public getExpectedCallbackParamType(): string | null {
    return this.expectedCallbackParamType;
  }
  public setExpectedCallbackReturnType(type: string | null): void {
    this.expectedCallbackReturnType = type;
  }
  public getExpectedCallbackReturnType(): string | null {
    return this.expectedCallbackReturnType;
  }
  public setExpectedCallbackParamTypes(types: string[] | null): void {
    this.expectedCallbackParamTypes = types;
  }
  public getExpectedCallbackParamTypes(): string[] | null {
    return this.expectedCallbackParamTypes;
  }
  public getLastInlineLambdaEnvPtr(): string | null {
    return this.lastInlineLambdaEnvPtr;
  }
  public setLastInlineLambdaEnvPtr(ptr: string | null): void {
    this.lastInlineLambdaEnvPtr = ptr;
  }
  public getLastTypeAssertionSourceVar(): string | null {
    return this.lastTypeAssertionSourceVar;
  }
  public setLastTypeAssertionSourceVar(name: string | null): void {
    this.lastTypeAssertionSourceVar = name;
  }
  public setStackEligibleVars(vars: string[]): void {
    this.stackEligibleVars = vars;
  }
  public isStackEligibleKey(key: string): boolean {
    for (let i = 0; i < this.stackEligibleVars.length; i++) {
      if (this.stackEligibleVars[i] === key) return true;
    }
    return false;
  }
  public setCurrentVarDeclKey(key: string | null): void {
    this.currentVarDeclKey = key;
  }
  public getCurrentVarDeclKey(): string | null {
    return this.currentVarDeclKey;
  }
  public setIsAsyncFunction(value: boolean): void {
    this.isAsyncFunction = value;
  }
  public setAsyncResultPromise(value: string): void {
    this.asyncResultPromise = value;
  }
  public getAsyncResultPromise(): string {
    return this.asyncResultPromise;
  }
  public getAllocaInstructions(): string[] {
    return this.allocaInstructions;
  }
  public clearAllocaInstructions(): void {
    this.allocaInstructions.length = 0;
  }
  public getOutput(): string[] {
    return this.output;
  }
  public clearOutput(): void {
    this.output.length = 0;
    this.outputIsTerminator.length = 0;
    this.stringBuilderSlen.clear();
    this.stringBuilderScap.clear();
  }
  public pushOutput(line: string): void {
    this.output.push(line);
    this.outputIsTerminator.push(this.classifyTerminator(line));
  }
  public getOutputLength(): number {
    return this.output.length;
  }
  public getOutputLine(index: number): string {
    return this.output[index] || "";
  }
  public setOutputLine(index: number, line: string): void {
    const newOutput: string[] = [];
    const newIsTerminator: number[] = [];
    for (let i = 0; i < this.output.length; i++) {
      if (i === index) {
        newOutput.push(line);
        newIsTerminator.push(this.classifyTerminator(line));
      } else {
        newOutput.push(this.output[i]);
        newIsTerminator.push(this.outputIsTerminator[i]);
      }
    }
    this.output.length = 0;
    this.outputIsTerminator.length = 0;
    for (let i = 0; i < newOutput.length; i++) {
      this.output.push(newOutput[i]);
      this.outputIsTerminator.push(newIsTerminator[i]);
    }
  }
  public getGlobalStringsLength(): number {
    return this.globalStrings.length;
  }
  public getGlobalStringAt(index: number): string {
    return this.globalStrings[index] || "";
  }
  public clearGlobalStrings(): void {
    this.globalStrings.length = 0;
  }
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
    return lines.join("\n");
  }

  public typeResolverGetInterface(name: string): InterfaceDeclaration | null {
    return this.typeResolver ? this.typeResolver.getInterface(name) : null;
  }
  public typeResolverGetInterfaceProperty(
    interfaceName: string,
    propName: string,
  ): InterfaceField | null {
    return this.typeResolver
      ? this.typeResolver.getInterfaceProperty(interfaceName, propName)
      : null;
  }
  public typeResolverGetTypeAlias(name: string): TypeAliasDeclaration | null {
    return this.typeResolver ? this.typeResolver.getTypeAlias(name) : null;
  }
  public typeResolverGetMapGetInterfaceType(expr: Expression): string | null {
    return this.typeResolver ? this.typeResolver.getMapGetInterfaceType(expr) : null;
  }
  public typeResolverGetUnionCommonFields(memberNames: string[]): {
    keys: string[];
    types: string[];
    tsTypes: string[];
  } {
    return this.typeResolver
      ? this.typeResolver.getUnionCommonFields(memberNames)
      : { keys: [], types: [], tsTypes: [] };
  }
  public typeResolverAreTypesCompatible(type1: string, type2: string): boolean {
    return this.typeResolver ? this.typeResolver.areTypesCompatible(type1, type2) : false;
  }
  public typeResolverNormalizeType(type: string): string {
    return this.typeResolver ? this.typeResolver.normalizeType(type) : type;
  }
  public typeResolverResolveArrayMethodReturnType(expr: Expression): ObjectMetadata | null {
    return this.typeResolver ? this.typeResolver.resolveArrayMethodReturnType(expr) : null;
  }
  public typeResolverDetectTypeGuard(condition: Expression): TypeGuardInfo | null {
    return this.typeResolver ? this.typeResolver.detectTypeGuard(condition) : null;
  }
  public typeResolverFindInterfaceByDiscriminant(discriminantValue: string): string | null {
    return this.typeResolver
      ? this.typeResolver.findInterfaceByDiscriminant(discriminantValue)
      : null;
  }
  public typeResolverGetThisFieldMapKeyType(expr: Expression): string | null {
    return this.typeResolver ? this.typeResolver.getThisFieldMapKeyType(expr) : null;
  }
  public typeResolverGetThisFieldSetValueType(expr: Expression): string | null {
    return this.typeResolver ? this.typeResolver.getThisFieldSetValueType(expr) : null;
  }
  public typeResolverGetClassFieldMapType(
    className: string,
    fieldName: string,
  ): { keyType: string; valueType: string } | null {
    return this.typeResolver ? this.typeResolver.getClassFieldMapType(className, fieldName) : null;
  }
  public typeResolverGetInterfaceMetadata(
    name: string,
  ): { keys: string[]; types: string[]; tsTypes?: string[] } | null {
    return this.typeResolver ? this.typeResolver.getInterfaceMetadata(name) : null;
  }

  public interfaceStructGenHasInterface(name: string): boolean {
    return this.interfaceStructGen ? this.interfaceStructGen.hasInterface(name) : false;
  }

  public classGenGetFieldInfo(
    className: string | null,
    fieldName: string | null,
  ): FieldInfo | null {
    if (!className || !fieldName) return null;
    return this.classGen.getFieldInfo(className, fieldName);
  }
  public classGenGetFieldType(className: string, fieldName: string): string | null {
    return this.classGen.getFieldType(className, fieldName);
  }
  public classGenGetFieldTsType(className: string, fieldName: string): string | null {
    return this.classGen.getFieldTsType(className, fieldName);
  }
  public classGenGetClassFields(className: string): { name: string; fieldType: string }[] {
    return this.classGen.getClassFields(className);
  }
  public classGenGenerateNewExpression(
    className: string,
    args: Expression[],
    params: string[],
  ): string {
    return this.classGen.generateNewExpression(className, args, params);
  }
  public classGenGenerateMethodCall(
    instancePtr: string,
    className: string,
    method: string,
    args: Expression[],
    params: string[],
  ): string {
    return this.classGen.generateMethodCall(instancePtr, className, method, args, params);
  }
  public classGenGenerateStaticMethodCall(
    className: string,
    method: string,
    args: Expression[],
    params: string[],
  ): string {
    return this.classGen.generateStaticMethodCall(className, method, args, params);
  }
  public classGenIsStaticMethod(className: string, methodName: string): boolean {
    return this.classGen.isStaticMethod(className, methodName);
  }
  public classGenIsStaticField(className: string, fieldName: string): boolean {
    return this.classGen.isStaticField(className, fieldName);
  }
  public classGenGetStaticFieldType(className: string, fieldName: string): string {
    return this.classGen.getStaticFieldType(className, fieldName);
  }
  public interfaceStructGenGetInterfaceStruct(name: string):
    | {
        name: string;
        llvmType: string;
        fields: { name: string; tsType: string; llvmType: string }[];
        isBuiltinConflict: boolean;
      }
    | undefined {
    return this.interfaceStructGen ? this.interfaceStructGen.getInterfaceStruct(name) : undefined;
  }
  public interfaceStructGenGetStructSize(interfaceName: string): number {
    return this.interfaceStructGen ? this.interfaceStructGen.getStructSize(interfaceName) : 0;
  }
  public interfaceStructGenGetFieldCount(interfaceName: string): number {
    if (!this.interfaceStructGen) return 0;
    const info = this.interfaceStructGen.getInterfaceStruct(interfaceName);
    if (!info) return 0;
    return info.fields.length;
  }
  public interfaceStructGenGetFieldName(interfaceName: string, fieldIndex: number): string {
    if (!this.interfaceStructGen) return "";
    const info = this.interfaceStructGen.getInterfaceStruct(interfaceName);
    if (!info || fieldIndex < 0 || fieldIndex >= info.fields.length) return "";
    return info.fields[fieldIndex].name;
  }
  public interfaceStructGenGetFieldTsType(interfaceName: string, fieldIndex: number): string {
    if (!this.interfaceStructGen) return "";
    const info = this.interfaceStructGen.getInterfaceStruct(interfaceName);
    if (!info || fieldIndex < 0 || fieldIndex >= info.fields.length) return "";
    return info.fields[fieldIndex].tsType;
  }
  public interfaceStructGenGetFieldLlvmType(interfaceName: string, fieldIndex: number): string {
    if (!this.interfaceStructGen) return "";
    const info = this.interfaceStructGen.getInterfaceStruct(interfaceName);
    if (!info || fieldIndex < 0 || fieldIndex >= info.fields.length) return "";
    return info.fields[fieldIndex].llvmType;
  }

  // Helper: Extract object literal metadata (public for context pattern access).
  // When `targetInterface` names a known interface, emit keys/types in the
  // interface's DECLARATION order — this matches the canonical struct layout
  // that generateInterfaceObject emits, so variable metadata and actual struct
  // GEP indices agree. Without a target, returns source-order (legacy).
  //
  // The canonical-order path is INLINED here rather than a separate helper
  // method to avoid shifting LLVMGenerator's method count — the native
  // compiler has positional class-method dispatch (see memory
  // `native-method-deletion-breaks-vtable.md`).
  public getObjectMetadata(
    objExpr: ObjectNode,
    targetInterface?: string,
  ): { keys: string[]; types: string[] } {
    if (!objExpr || objExpr.type !== "object") {
      return { keys: [], types: [] };
    }

    // Canonical-order path when a known interface is provided.
    if (
      targetInterface &&
      this.interfaceStructGen &&
      this.interfaceStructGen.hasInterface(targetInterface)
    ) {
      const info = this.interfaceStructGen.getInterfaceStruct(targetInterface);
      if (info) {
        const kOut: string[] = [];
        const tOut: string[] = [];
        const covered: string[] = [];
        for (let fi = 0; fi < info.fields.length; fi++) {
          const f = info.fields[fi] as { name: string; llvmType: string };
          kOut.push(f.name);
          tOut.push(f.llvmType);
          covered.push(f.name);
        }
        if (objExpr.properties) {
          for (let pi = 0; pi < objExpr.properties.length; pi++) {
            const p = objExpr.properties[pi] as ObjectProperty;
            if (!p) continue;
            if (covered.indexOf(p.key) !== -1) continue;
            kOut.push(p.key);
            // Fallback: infer extra-key type inline. i8* is the safe default
            // because most runtime values are pointers.
            let t = "i8*";
            const pvt = (p.value as { type: string }).type;
            if (pvt === "number" || pvt === "boolean" || pvt === "unary") t = "double";
            tOut.push(t);
          }
        }
        return { keys: kOut, types: tOut };
      }
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
      const propValueTyped = propValue as { type: string };
      const propValueType = propValueTyped.type;
      if (!propValue) {
        llvmType = "double";
      } else {
        if (propValueType === "string" || this.isStringExpression(propValue)) {
          llvmType = "i8*";
        } else if (propValueType === "array" || this.isStringArrayExpression(propValue)) {
          llvmType = this.isStringArrayExpression(propValue) ? "%StringArray*" : "%Array*";
        } else if (this.isArrayExpression(propValue)) {
          llvmType = "%Array*";
        } else if (propValueType === "map") {
          llvmType = "%Map*";
        } else if (propValueType === "set") {
          llvmType = "%Set*";
        } else if (
          propValueType === "number" ||
          propValueType === "boolean" ||
          propValueType === "unary"
        ) {
          llvmType = "double";
        } else if (
          propValueType === "call" ||
          propValueType === "method_call" ||
          propValueType === "member_access" ||
          propValueType === "index_access" ||
          propValueType === "variable" ||
          propValueType === "template_literal" ||
          propValueType === "conditional" ||
          propValueType === "null" ||
          propValueType === "undefined" ||
          propValueType === "regex" ||
          propValueType === "new" ||
          propValueType === "object"
        ) {
          // Non-numeric expression types default to pointer — safer than double
          // since most runtime values (strings, objects, arrays) are pointers
          llvmType = "i8*";
        } else if (propValueType === "binary") {
          // Binary expressions could be arithmetic (double) or string concat (i8*).
          // Check if either side is a string to disambiguate.
          if (this.isStringExpression(propValue)) {
            llvmType = "i8*";
          } else {
            llvmType = "double";
          }
        } else if (propValueType === "type_assertion") {
          llvmType = "i8*";
        } else {
          return this.emitError(
            `object property '${prop.key}' has unrecognized expression type '${propValueType}'`,
          );
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

  private usesTreeSitter: boolean = false;
  // Tracks function names from user `declare function` to avoid duplicate
  // LLVM declarations when a name overlaps with hardcoded runtime declarations.
  // Uses string[] instead of Set<string> because Set.has() is unreliable in the
  // native-compiled compiler (self-hosting).
  public declaredExternFunctions: string[];
  public sourceCode: string = "";
  public filename: string = "";
  // IMPORTANT: keep trampolineEmitter and usesTrampolines at the END of the
  // class field list — adding fields in the middle shifts GEP indices in the
  // self-hosted native compiler (see CLAUDE.md rule #5).
  public trampolineEmitter!: TrampolineEmitter;
  public usesTrampolines: number = 0;
  public usesTimers: number = 0;
  // Sema table: pure-AST class + interface catalog built pre-codegen.
  // Consumers (esp. TypeInference) can query `isClass(name)` / `isInterface(name)`
  // etc. without touching mid-codegen SymbolTable state. Empty until
  // generateParts() runs; migration of call sites happens in follow-up PRs.
  public semaTable: SemaTable | null = null;

  constructor(ast: AST, typeChecker: TypeChecker | null, options: LLVMGeneratorOptions) {
    super();

    // Initialize complex fields in constructor (field initializers don't work in native code)
    this.externalFunctions = new Set();
    this.declaredExternFunctions = [];
    this.topLevelObjectVariables = new Map();
    this.globalVariables = new Map();
    this.importAliasNames = [];
    this.importAliasOriginals = [];
    this.httpHandlers = [];
    this.wsHandlers = [];
    this.jsonObjectMetadata = new Map();
    this.dbgBuilder = new DebugMetadataBuilder();
    this.usesTimers = 0;
    this.usesPromises = 0;
    this.usesTrampolines = 0;
    this.usesSqlite = 0;
    this.usesCurl = 0;
    this.usesUvHrtime = 0;
    this.usesConsoleTime = 0;
    this.usesArraySort = 0;
    this.usesCrypto = 0;
    this.usesJson = 0;
    this.usesHttpServer = 0;
    this.usesMultipart = 0;
    this.usesRegex = 0;
    this.usesTestRunner = 0;
    this.usesAsyncFs = 0;
    this.usesGC = 0;
    this.usesMathRandom = 0;

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
    this.sourceCode = options.sourceCode || "";
    this.filename = options.filename || "";
    this.targetInfo = options.target;

    this.diagnostics = new DiagnosticEngine();
    this.diagnostics.setSourceCode(this.sourceCode);
    this.diagnostics.setFilename(this.filename);
    // Color off by default; compiler.ts sets it based on stderr TTY

    this.typeContext = new TypeContext();
    this.symbolTable = new SymbolTable(this.typeContext);
    this.semaSymbolNames = [];
    this.semaSymbolTypes = [];
    this.semaSymbolLlvmTypes = [];
    this.semaSymbolSchemaKeys = [];
    this.semaSymbolSchemaTypes = [];
    this.semaSymbolCount = 0;
    if (options.analyzedSymbols) {
      this.semaSymbolNames = options.analyzedSymbols.names;
      this.semaSymbolTypes = options.analyzedSymbols.types;
      this.semaSymbolLlvmTypes = options.analyzedSymbols.llvmTypes;
      this.semaSymbolSchemaKeys = options.analyzedSymbols.schemaKeys;
      this.semaSymbolSchemaTypes = options.analyzedSymbols.schemaTypes;
      this.semaSymbolCount = this.semaSymbolNames.length;
    }

    if (options.debugInfo && this.filename) {
      const dbgFile = options.debugFilename || this.filename;
      this.dbgBuilder.init(dbgFile);
      this.debugInfoEnabled = true;
    }

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
    this.childProcessGen = new ChildProcessGenerator(this);
    this.embedGen = new EmbedGenerator(this, this.filename);
    this.trampolineEmitter = new TrampolineEmitter();
    this.runtimeGen = new RuntimeGenerator();
    this.httpServerGen = new HttpServerGenerator();
    this.libuvGen = new LibuvGenerator();
    this.promiseGen = new PromiseGenerator();
    this.asyncFsGen = new AsyncFsGenerator();
    this.asyncCpGen = new AsyncChildProcessGenerator();
    this.treesitterGen = new TreeSitterGenerator();

    // Initialize expression generator with context pattern
    this.exprGen = new ExpressionGenerator(this);
    this.arrowFunctionGen = this.exprGen.arrowFunctionGen as unknown as IArrowFunctionGenerator;

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

    this.typeInference = new TypeInference(this as unknown as TypeInferenceContext);

    this.typeResolver = new TypeResolver(this as unknown as TypeResolverContext);

    this.varAllocator = new VariableAllocator(this as unknown as VariableAllocatorContext);

    this.funcGen = new FunctionGenerator(this as unknown as FunctionGeneratorContext);

    this.assignmentGen = new AssignmentGenerator(this as unknown as AssignmentGeneratorContext);

    this.prePopulateFromSema();

    const importsCount = ast.imports.length;
    if (importsCount > 0) {
      this.buildImportAliasMap(ast.imports, importsCount);
    }
    // Also load default import aliases stored as struct-of-arrays on the AST
    if (ast.importAliasNames && ast.importAliasOriginals) {
      const aliasCount = ast.importAliasNames.length;
      for (let ai = 0; ai < aliasCount; ai++) {
        this.setImportAlias(ast.importAliasNames[ai], ast.importAliasOriginals[ai]);
      }
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

  private prePopulateFromSema(): void {
    if (this.semaSymbolCount === 0) return;

    const topLevelNames: string[] = [];
    for (let i = 0; i < this.topLevelStatementsCount; i++) {
      const stmt = this.ast.topLevelStatements[i];
      if (stmt.type === "variable_declaration") {
        const decl = stmt as VariableDeclaration;
        if (decl.name) {
          topLevelNames.push(decl.name);
        }
      }
    }

    for (let ti = 0; ti < topLevelNames.length; ti++) {
      const name = topLevelNames[ti];
      if (
        name === "console" ||
        name === "process" ||
        name === "Math" ||
        name === "JSON" ||
        name === "Date"
      )
        continue;

      let semaIdx: number = -1;
      for (let si = 0; si < this.semaSymbolCount; si++) {
        if (this.semaSymbolNames[si] === name) {
          semaIdx = si;
          break;
        }
      }
      if (semaIdx === -1) continue;

      const stype = this.semaSymbolTypes[semaIdx];
      if (stype === "null" || stype === "undefined" || stype === "unknown") continue;

      let kind: number = -1;
      let llvmType = "";

      if (stype === "number") {
        kind = SymbolKind_Number;
        llvmType = "double";
      } else if (stype === "string") {
        kind = SymbolKind_String;
        llvmType = "i8*";
      } else if (stype === "boolean") {
        kind = SymbolKind_Boolean;
        llvmType = "double";
      } else if (stype === "array<number>") {
        kind = SymbolKind_Array;
        llvmType = "%Array*";
      } else if (stype === "array<string>") {
        kind = SymbolKind_StringArray;
        llvmType = "%StringArray*";
      } else if (stype === "object") {
        kind = SymbolKind_Object;
        llvmType = "i8*";
      } else if (stype === "class") {
        kind = SymbolKind_Class;
        llvmType = "i8*";
      }

      if (kind === -1) continue;

      const schemaKeys = this.semaSymbolSchemaKeys[semaIdx];
      const schemaTypes = this.semaSymbolSchemaTypes[semaIdx];
      if (stype === "object" && schemaKeys && schemaTypes) {
        const metadata: SymbolMetadata = {
          objectMetadata: { keys: schemaKeys, types: schemaTypes },
          classMetadata: undefined,
          arrayMetadata: undefined,
          objectArrayMetadata: undefined,
          closureMetadata: undefined,
          mapMetadata: undefined,
          setMetadata: undefined,
          isPointerAlloca: undefined,
          interfaceType: undefined,
          resolvedType: undefined,
          unionType: undefined,
          unionMembers: undefined,
        };
        this.symbolTable.defineWithMetadata(name, kind, llvmType, "", "global", metadata);
      } else {
        this.symbolTable.define(name, kind, llvmType, "", "global");
      }
    }
  }

  setImportAlias(name: string, original: string): void {
    this.importAliasNames.push(name);
    this.importAliasOriginals.push(original);
  }

  getImportAlias(name: string): string | undefined {
    const len = this.importAliasNames.length;
    for (let i = 0; i < len; i++) {
      if (this.importAliasNames[i] === name) {
        return this.importAliasOriginals[i];
      }
    }
    return undefined;
  }

  resolveImportAlias(localName: string): string {
    const original = this.getImportAlias(localName);
    return original || localName;
  }

  mangleUserName(name: string): string {
    if (name.startsWith("__")) return name;
    return `_cs_${name}`;
  }

  createEmptyStringConstant(): string {
    return this.stringGen.doCreateStringConstant("");
  }

  getSubprogramDbgRef(): string {
    if (this.debugInfoEnabled && this.currentSubprogramId >= 0) {
      return ` !dbg !${this.currentSubprogramId}`;
    }
    return "";
  }

  reset(): void {
    super.reset();
    // LLVMGenerator-specific fields not in BaseGenerator
    this.stringBuilderSlen.clear();
    this.stringBuilderScap.clear();
  }

  // Phase E substrate: authoritative type resolution per AST expression node.
  // First caller to hit a given node triggers resolution via TypeInference; the
  // result is cached and returned to all later callers, eliminating the "two
  // codegen sites ask at different moments and get different answers" class.
  // Caches only substantive resolutions (known sourceKind, non-empty base) so
  // early partial answers don't lock out later authoritative ones.
  typeOf(expr: Expression): ResolvedType | null {
    if (!expr || typeof expr !== "object") return null;
    // Prefer the pre-populated annotator cache (parallel arrays in
    // BaseGenerator). Fall back to on-demand resolution for expressions
    // that the annotator skipped (unknown base or types that only resolve
    // mid-codegen once the symbol table is refined).
    const nodes = this.expressionTypeNodes;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i] === expr) return this.expressionTypeValues[i];
    }
    return this.typeInference.resolveExpressionTypeRich(expr);
  }

  // Sink method for the pre-codegen annotator: convert a declared-type
  // string (e.g. "string", "Node[]", "Foo") to a ResolvedType. Rejects
  // unions, nullable types, and anything that doesn't map to a single
  // concrete shape — callers should gate by `isSafelyAnnotatable` first.
  resolveDeclaredTypeString(typeStr: string): ResolvedType | null {
    if (!typeStr) return null;
    const t = typeStr.trim();
    if (t.length === 0) return null;
    if (t.indexOf("|") !== -1) return null;
    return this.typeContext.resolve(t);
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

  private tryHandleGlobalCallReturn(name: string, callNode: CallNode): string {
    for (let fi = 0; fi < this.ast.functions.length; fi++) {
      const fn = this.ast.functions[fi];
      if (!fn) continue;
      if (fn.name === callNode.name && fn.returnType) {
        let rt = fn.returnType;
        if (fn.typeParameters && fn.typeParameters.length > 0) {
          if (callNode.typeArgs && callNode.typeArgs.length > 0) {
            for (let ti = 0; ti < fn.typeParameters.length; ti++) {
              const tp = fn.typeParameters[ti] || "";
              const ta = callNode.typeArgs[ti] || "any";
              rt = rt.split(tp).join(ta);
            }
          } else {
            for (let ti = 0; ti < fn.typeParameters.length; ti++) {
              const tp = fn.typeParameters[ti] || "";
              if (rt === tp) {
                rt = "string";
                break;
              }
            }
          }
        }
        if (rt === "string" || rt === "i8_ptr" || rt === "ptr") {
          this.globalVariables.set(name, {
            llvmType: "i8*",
            kind: SymbolKind_String,
            initialized: false,
          });
          this.defineVariable(name, `@${name}`, "i8*", SymbolKind_String, "global");
          return `@${name} = global i8* null\n`;
        }
        const iface = this.getInterfaceDeclByName(rt);
        if (iface) {
          const keys: string[] = [];
          const tsTypes: string[] = [];
          const types: string[] = [];
          const allFields = this.getAllInterfaceFields(iface);
          for (let i = 0; i < allFields.length; i++) {
            const field = allFields[i] as { name: string; type: string };
            keys.push(stripOptional(field.name));
            tsTypes.push(field.type);
            types.push(this.tsTypeToLlvmJsonWithEnums(field.type));
          }
          this.globalVariables.set(name, {
            llvmType: "i8*",
            kind: SymbolKind_Object,
            initialized: false,
          });
          this.defineVariableWithMetadata(
            name,
            `@${name}`,
            "i8*",
            SymbolKind_Object,
            "global",
            createObjectMetadataWithInterface({ keys, types, tsTypes }, rt),
          );
          return `@${name} = global i8* null\n`;
        }
        if (this.isKnownClass(rt)) {
          const resolvedClassName = this.resolveImportAlias(rt);
          const fields = this.classGen ? this.classGen.getClassFields(resolvedClassName) || [] : [];
          const llvmType = fields.length > 0 ? `%${resolvedClassName}_struct*` : "i32*";
          this.globalVariables.set(name, {
            llvmType,
            kind: SymbolKind_Class,
            initialized: false,
          });
          this.defineVariableWithMetadata(
            name,
            `@${name}`,
            llvmType,
            SymbolKind_Class,
            "global",
            createClassMetadata({ className: resolvedClassName }),
          );
          return `@${name} = global ${llvmType} null\n`;
        }
        if (rt.endsWith("[]")) {
          const elementType = rt.substring(0, rt.length - 2);
          if (elementType === "string") {
            this.globalVariables.set(name, {
              llvmType: "%StringArray*",
              kind: SymbolKind_StringArray,
              initialized: false,
            });
            this.defineVariable(
              name,
              `@${name}`,
              "%StringArray*",
              SymbolKind_StringArray,
              "global",
            );
            return `@${name} = global %StringArray* null\n`;
          }
          if (elementType === "number" || elementType === "boolean") {
            this.globalVariables.set(name, {
              llvmType: "%Array*",
              kind: SymbolKind_Array,
              initialized: false,
            });
            this.defineVariable(name, `@${name}`, "%Array*", SymbolKind_Array, "global");
            return `@${name} = global %Array* null\n`;
          }
          this.globalVariables.set(name, {
            llvmType: "%ObjectArray*",
            kind: SymbolKind_ObjectArray,
            initialized: false,
          });
          this.defineVariableWithMetadata(
            name,
            `@${name}`,
            "%ObjectArray*",
            SymbolKind_ObjectArray,
            "global",
            createInterfaceMetadata(elementType),
          );
          this.symbolTable.setRawInterfaceType(name, elementType);
          return `@${name} = global %ObjectArray* null\n`;
        }
        if (this.isTypeAlias(rt)) {
          const commonProps = this.getTypeAliasCommonProperties(rt);
          if (commonProps) {
            this.globalVariables.set(name, {
              llvmType: "i8*",
              kind: SymbolKind_Object,
              initialized: false,
            });
            this.defineVariableWithMetadata(
              name,
              `@${name}`,
              "i8*",
              SymbolKind_Object,
              "global",
              createObjectMetadataWithInterface(commonProps, rt),
            );
            return `@${name} = global i8* null\n`;
          }
        }
        break;
      }
    }
    return "";
  }

  private tryHandleGlobalJSONParse(name: string, methodCall: MethodCallNode): string {
    const interfaceName = this.typeInference.getJSONParseInterface(methodCall);
    if (interfaceName === "number[]") {
      const llvmType = "%Array*";
      const kind = SymbolKind_Array;
      this.globalVariables.set(name, { llvmType, kind, initialized: false });
      this.defineVariableWithMetadata(
        name,
        `@${name}`,
        llvmType,
        kind,
        "global",
        createPointerAllocaMetadata(),
      );
      return `@${name} = global ${llvmType} null\n`;
    }
    if (interfaceName) {
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
        const llvmType = `%${interfaceName}*`;
        // Typed JSON.parse<T> produces a concrete %T* struct — treat as a
        // regular object, not a JSON-lazy handle. Previously we tagged it
        // SymbolKind_JSON which made downstream member access re-read via
        // csyyjson_obj_get using the struct pointer as a yyjson handle —
        // bogus for anything but primitive fields, and the root cause of
        // dapweb NOTES #8 (T[] fields returning garbage / crashing).
        const kind = SymbolKind_Object;
        const keys: string[] = [];
        const tsTypes: string[] = [];
        const types: string[] = [];
        const allFields = this.getAllInterfaceFields(interfaceDef);
        for (let i = 0; i < allFields.length; i++) {
          const field = allFields[i] as { name: string; type: string };
          keys.push(stripOptional(field.name));
          tsTypes.push(field.type);
          types.push(this.tsTypeToLlvmJsonWithEnums(field.type));
        }
        this.globalVariables.set(name, { llvmType, kind, initialized: false });
        this.defineVariableWithMetadata(
          name,
          `@${name}`,
          llvmType,
          kind,
          "global",
          createObjectMetadataWithInterface({ keys, types, tsTypes }, interfaceName),
        );
        return `@${name} = global ${llvmType} null\n`;
      }
    }
    return "";
  }

  private tryHandleGlobalDeclaredType(name: string, declaredType: string | undefined): string {
    if (!declaredType) return "";
    const strippedDeclaredType = stripNullable(declaredType);
    if (strippedDeclaredType === "string") return "";
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
      this.globalVariables.set(name, {
        llvmType: "i8*",
        kind: SymbolKind_Object,
        initialized: false,
      });
      this.defineVariableWithMetadata(
        name,
        `@${name}`,
        "i8*",
        SymbolKind_Object,
        "global",
        createInterfaceMetadata(strippedDeclaredType),
      );
      return `@${name} = global i8* null\n`;
    }
    if (this.isKnownClass(strippedDeclaredType)) {
      const fields = this.classGen ? this.classGen.getClassFields(strippedDeclaredType) || [] : [];
      const llvmType = fields.length > 0 ? `%${strippedDeclaredType}_struct*` : "i8*";
      this.globalVariables.set(name, {
        llvmType,
        kind: SymbolKind_Class,
        initialized: false,
      });
      this.defineVariableWithMetadata(
        name,
        `@${name}`,
        llvmType,
        SymbolKind_Class,
        "global",
        createClassMetadata({ className: strippedDeclaredType }),
      );
      return `@${name} = global ${llvmType} null\n`;
    }
    if (this.ast.typeAliases) {
      for (let i = 0; i < this.ast.typeAliases.length; i++) {
        const alias = this.ast.typeAliases[i];
        if (!alias || alias.name !== strippedDeclaredType) continue;
        const members = alias.unionMembers;
        let aliasLlvm = "i8*";
        if (members && members.length > 0) {
          aliasLlvm = tsTypeToLlvm(members[0].trim());
        }
        const kind = aliasLlvm === "double" ? SymbolKind_Number : SymbolKind_Object;
        const defaultValue = aliasLlvm === "double" ? "0.0" : "null";
        this.globalVariables.set(name, {
          llvmType: aliasLlvm,
          kind,
          initialized: false,
        });
        this.defineVariable(name, `@${name}`, aliasLlvm, kind, "global");
        return `@${name} = global ${aliasLlvm} ${defaultValue}\n`;
      }
    }
    return "";
  }

  private tryHandleGlobalExpressionType(name: string, value: Expression | null): string {
    if (!value) return "";
    const funcReturnInterface = this.typeInference.getFunctionCallInterfaceReturn(value);
    if (funcReturnInterface) {
      this.globalVariables.set(name, {
        llvmType: "i8*",
        kind: SymbolKind_Object,
        initialized: false,
      });
      this.defineVariableWithMetadata(
        name,
        `@${name}`,
        "i8*",
        SymbolKind_Object,
        "global",
        createInterfaceMetadata(funcReturnInterface),
      );
      return `@${name} = global i8* null\n`;
    }
    const indexAccessInterface = this.typeInference.getIndexAccessElementType(value);
    if (indexAccessInterface) {
      this.globalVariables.set(name, {
        llvmType: "i8*",
        kind: SymbolKind_Object,
        initialized: false,
      });
      this.defineVariableWithMetadata(
        name,
        `@${name}`,
        "i8*",
        SymbolKind_Object,
        "global",
        createInterfaceMetadata(indexAccessInterface),
      );
      return `@${name} = global i8* null\n`;
    }
    if ((value as { type: string }).type === "index_access") {
      const idxNode = value as IndexAccessNode;
      if (idxNode.object && idxNode.object.type === "variable") {
        const idxObjVar = idxNode.object as VariableNode;
        if (idxObjVar.name) {
          const arrSym = this.symbolTable.lookup(idxObjVar.name);
          if (arrSym && arrSym.kind === SymbolKind_ObjectArray && arrSym.interfaceType) {
            this.globalVariables.set(name, {
              llvmType: "i8*",
              kind: SymbolKind_Object,
              initialized: false,
            });
            this.defineVariableWithMetadata(
              name,
              `@${name}`,
              "i8*",
              SymbolKind_Object,
              "global",
              createInterfaceMetadata(arrSym.interfaceType),
            );
            return `@${name} = global i8* null\n`;
          }
        }
      }
    }
    return "";
  }

  private classifyGlobalCatchAll(
    name: string,
    value: Expression | null,
    declaredType: string | undefined,
    i64Eligible: string[],
  ): { llvmType: string; kind: number; defaultValue: string } | null {
    const exprNodeType = value ? (value as { type: string }).type : "";
    if (exprNodeType === "method_call" && !declaredType) {
      const genericErr = this.getGenericMethodReturnError(value as MethodCallNode, name);
      if (genericErr) {
        this.emitError(genericErr);
      }
    }
    // Function reference RHS — `let cb = namedFn` where namedFn is a
    // top-level function. Must be classified BEFORE the generic type-infer
    // path below because resolveExpressionType doesn't know function names
    // are values; it falls through to number/i64. We'd then emit
    //   store i64 @_cs_fn, i64* @cb
    // which clang rejects ("global variable reference must have pointer
    // type"). Allocate as i8* so the store uses pointer shape. (dapweb #2)
    if (exprNodeType === "variable") {
      const vn = value as VariableNode;
      const funcLen = this.ast.functions.length;
      for (let fi = 0; fi < funcLen; fi++) {
        if (this.ast.functions[fi].name === vn.name) {
          return { llvmType: "i8*", kind: SymbolKind_Object, defaultValue: "null" };
        }
      }
    }
    if (
      exprNodeType === "number" ||
      exprNodeType === "boolean" ||
      exprNodeType === "binary" ||
      exprNodeType === "unary" ||
      exprNodeType === "method_call" ||
      exprNodeType === "call" ||
      exprNodeType === "variable" ||
      exprNodeType === "conditional" ||
      exprNodeType === "index_access" ||
      exprNodeType === "member_access"
    ) {
      const resolved = value ? this.typeOf(value) : null;
      if (resolved) {
        if (resolved.base === "string") {
          return { llvmType: "i8*", kind: SymbolKind_String, defaultValue: "null" };
        }
        if (resolved.base === "boolean") {
          return { llvmType: "i1", kind: SymbolKind_Boolean, defaultValue: "0" };
        }
        // Interface (non-primitive, non-array, non-class) resolved type — e.g.
        // `arr.find(...)` on an interface array returns the element interface.
        // Allocate as opaque i8* with interface metadata so member access later
        // can consult the named interface's struct layout.
        if (
          resolved.arrayDepth === 0 &&
          resolved.base !== "number" &&
          resolved.base !== "void" &&
          resolved.base !== "null" &&
          resolved.base !== "undefined" &&
          resolved.base !== "any" &&
          resolved.base !== "unknown" &&
          resolved.base !== "object" &&
          !resolved.base.startsWith("Map") &&
          !resolved.base.startsWith("Set") &&
          !resolved.base.startsWith("Promise") &&
          this.typeResolver &&
          this.typeResolver.getInterface(resolved.base)
        ) {
          if (name) {
            this.defineVariableWithMetadata(
              name,
              `@${name}`,
              "i8*",
              SymbolKind_Object,
              "global",
              createInterfaceMetadata(resolved.base),
            );
            this.symbolTable.setRawInterfaceType(name, resolved.base);
            this.globalVariables.set(name, {
              llvmType: "i8*",
              kind: SymbolKind_Object,
              initialized: false,
            });
          }
          return { llvmType: "i8*", kind: SymbolKind_Object, defaultValue: "null" };
        }
      }
      let isI64 = false;
      for (let ei = 0; ei < i64Eligible.length; ei++) {
        if (i64Eligible[ei] === name) {
          isI64 = true;
          break;
        }
      }
      if (isI64) {
        return { llvmType: "i64", kind: SymbolKind_Number, defaultValue: "0" };
      }
      return { llvmType: "double", kind: SymbolKind_Number, defaultValue: "0.0" };
    }
    return null;
  }

  private tryGetConstLiteralValue(
    stmt: { kind: string; value: Expression | null; name: string },
    llvmType: string,
    i64Eligible: string[],
  ): { llvmType: string; value: string } | null {
    if (stmt.kind !== "const" || stmt.value === null) return null;
    const val = stmt.value as {
      type: string;
      value?: number | string | boolean;
      loc?: SourceLocation;
      isFloat?: boolean;
    };
    if (val.type === "number" && typeof val.value === "number") {
      let isI64 = false;
      for (let ei = 0; ei < i64Eligible.length; ei++) {
        if (i64Eligible[ei] === stmt.name) {
          isI64 = true;
          break;
        }
      }
      if (isI64 && val.value % 1 === 0 && val.isFloat !== true) {
        return { llvmType: "i64", value: String(Math.trunc(val.value)) };
      }
      const s = String(val.value);
      if (s.indexOf(".") === -1 && s.indexOf("e") === -1 && s.indexOf("E") === -1) {
        return { llvmType: "double", value: s + ".0" };
      }
      return { llvmType: "double", value: s };
    }
    if (val.type === "boolean") {
      return { llvmType: "double", value: val.value === true ? "0x3FF0000000000000" : "0.0" };
    }
    return null;
  }

  private generateGlobalVariableDeclarations(): string {
    let ir = "";
    const totalCount = this.topLevelStatementsCount;
    if (totalCount === 0) {
      return ir;
    }
    const items = this.ast.topLevelStatements;
    const i64Eligible = findI64EligibleVariables(this.ast.topLevelStatements);
    for (let stmtIdx = 0; stmtIdx < totalCount; stmtIdx++) {
      const stmt = items[stmtIdx] as VariableDeclaration;
      if (stmt.type !== "variable_declaration") continue;
      if (stmt.value !== null) {
        const name = stmt.name;

        const stmtValType = (stmt.value as VariableNode).type as string;
        const isUndefinedValue =
          stmtValType === "undefined" ||
          (stmtValType === "variable" && (stmt.value as VariableNode).name === "undefined") ||
          stmtValType === "null";
        if (isUndefinedValue && stmt.declaredType) {
          const globalIr = this.handleUninitializedGlobalVar(name, stmt.declaredType);
          if (globalIr.length > 0) {
            ir += globalIr;
            continue;
          }
        }

        if ((stmt.value as { type: string }).type === "call") {
          const callNode = stmt.value as CallNode;
          if (callNode.name) {
            const callIr = this.tryHandleGlobalCallReturn(name, callNode);
            if (callIr.length > 0) {
              ir += callIr;
              continue;
            }
          }
        }

        const resolved = this.typeOf(stmt.value);
        let resolvedBase = "";
        let resolvedDepth = 0;
        if (resolved) {
          resolvedBase = resolved.base;
          resolvedDepth = resolved.arrayDepth;
        }
        let isString = false;
        let isStringArray = false;
        let isObjectArray = false;
        let isArray = false;
        let isObject = false;
        let isMap = false;
        let isSet = false;
        let isRegex = false;
        let isClassInstance = false;
        let isUint8Array = false;
        let isBoolean = false;
        let isNumber = false;
        if (resolved) {
          const base = resolvedBase;
          const depth = resolvedDepth;
          isString = base === "string" && depth === 0;
          isStringArray = base === "string" && depth > 0;
          isObjectArray = depth > 0 && base !== "string" && base !== "number" && base !== "boolean";
          isArray = depth > 0 && base === "number";
          if (depth > 0 && base === "boolean") isUint8Array = true;
          isMap = base === "Map" || base.startsWith("Map<");
          isSet = base === "Set" || base.startsWith("Set<");
          isRegex = base === "RegExp";
          isObject = base === "object" && depth === 0;
          isBoolean = base === "boolean" && depth === 0;
          isNumber = base === "number" && depth === 0;
          isUint8Array = base === "Uint8Array" && depth === 0;
          isClassInstance =
            !isRegex &&
            depth === 0 &&
            base !== "string" &&
            base !== "number" &&
            base !== "boolean" &&
            base !== "void" &&
            base !== "null" &&
            base !== "unknown" &&
            base !== "object" &&
            base !== "Promise" &&
            base !== "Response" &&
            !base.startsWith("Map") &&
            !base.startsWith("Set") &&
            this.isKnownClass(base);
        }
        if (!isStringArray && stmt.declaredType === "string[]") {
          isStringArray = true;
        }
        if (
          !isObjectArray &&
          stmt.declaredType &&
          stmt.declaredType.endsWith("[]") &&
          stmt.declaredType !== "string[]" &&
          stmt.declaredType !== "number[]" &&
          stmt.declaredType !== "boolean[]"
        ) {
          isObjectArray = true;
        }
        if (
          !isObjectArray &&
          stmt.value &&
          this.typeInference.isObjectArrayExpression(stmt.value)
        ) {
          isObjectArray = true;
        }
        // Detect Uint8Array from declared type or expression analysis.
        // Must clear isString since readFileSync resolves to "string" by default,
        // but the declared type takes precedence.
        if (!isUint8Array && stmt.declaredType === "Uint8Array") {
          isUint8Array = true;
          isString = false;
        }
        if (!isUint8Array && stmt.value && this.typeInference.isUint8ArrayExpression(stmt.value)) {
          isUint8Array = true;
          isString = false;
        }
        if (!isUint8Array && stmt.declaredType === "boolean[]") {
          isUint8Array = true;
          isArray = false;
        }
        if (
          !isClassInstance &&
          stmt.value &&
          (stmt.value as { type: string }).type === "index_access"
        ) {
          const idxClassName = this.getIndexAccessClassName(stmt.value);
          if (idxClassName) {
            isClassInstance = true;
            resolvedBase = idxClassName;
          }
        }
        if (
          !isClassInstance &&
          stmt.value &&
          (stmt.value as { type: string }).type === "member_access"
        ) {
          const memberClassName = this.getMemberAccessClassName(stmt.value);
          if (memberClassName) {
            isClassInstance = true;
            resolvedBase = memberClassName;
          }
        }

        const isJSONParse = this.typeInference.isJSONParseExpression(stmt.value);

        let llvmType: string = "";
        let kind: number = SymbolKind_Number;
        let defaultValue: string = "0.0";

        const stmtValueBase = stmt.value as { type: string };
        if (stmtValueBase.type === "new") {
          const newNode = stmt.value as NewNode;
          if (newNode.className === "URL") {
            ir += `@${name} = global i8* null` + "\n";
            this.globalVariables.set(name, {
              llvmType: "i8*",
              kind: SymbolKind_Url,
              initialized: false,
            });
            this.symbolTable.defineUrl(name, `@${name}`, "global");
            continue;
          }
          if (newNode.className === "URLSearchParams") {
            ir += `@${name} = global i8* null` + "\n";
            this.globalVariables.set(name, {
              llvmType: "i8*",
              kind: SymbolKind_UrlSearchParams,
              initialized: false,
            });
            this.symbolTable.defineUrlSearchParams(name, `@${name}`, "global");
            continue;
          }
        }

        if (isString) {
          llvmType = "i8*";
          kind = SymbolKind_String;
          defaultValue = "null";
          if (stmtValueBase.type === "method_call") {
            const mc = stmt.value as MethodCallNode;
            if (mc.method === "find" || mc.method === "at") {
              const mcObj = mc.object as { type: string };
              if (mcObj.type === "variable") {
                const arrName = (mc.object as VariableNode).name;
                const elemType =
                  this.symbolTable.getObjectArrayElementType(arrName) ||
                  this.symbolTable.getRawInterfaceType(arrName);
                if (elemType) {
                  const classFields = this.classGen
                    ? this.classGen.getClassFields(elemType) || []
                    : [];
                  if (classFields.length > 0) {
                    kind = SymbolKind_Class;
                    ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
                    this.globalVariables.set(name, { llvmType, kind, initialized: false });
                    this.defineVariableWithMetadata(
                      name,
                      `@${name}`,
                      llvmType,
                      kind,
                      "global",
                      createClassMetadata({ className: elemType }),
                    );
                  } else {
                    kind = SymbolKind_Object;
                    ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
                    this.globalVariables.set(name, { llvmType, kind, initialized: false });
                    const props = this.getInterfaceProperties(elemType);
                    if (props) {
                      this.defineVariableWithMetadata(
                        name,
                        `@${name}`,
                        llvmType,
                        kind,
                        "global",
                        createObjectMetadataWithInterface(
                          { keys: props.keys, types: props.types },
                          elemType,
                        ),
                      );
                    } else {
                      this.defineVariable(name, `@${name}`, llvmType, kind, "global");
                    }
                    this.symbolTable.setRawInterfaceType(name, elemType);
                  }
                  continue;
                }
              }
            }
          }
        } else if (isStringArray) {
          llvmType = "%StringArray*";
          kind = SymbolKind_StringArray;
          defaultValue = "null";
        } else if (isObjectArray) {
          let elementType = "";
          if (stmt.declaredType) {
            const declType = stmt.declaredType;
            const typeLen = declType.length;
            if (typeLen > 2) {
              elementType = declType.substr(0, typeLen - 2);
            }
          }
          if (!elementType && resolvedBase && this.isKnownClass(resolvedBase)) {
            elementType = resolvedBase;
          }
          if (!elementType && stmt.value) {
            const objArrElemType = this.typeInference.getObjectArrayElementType(stmt.value);
            if (objArrElemType) elementType = objArrElemType;
          }
          llvmType = "%ObjectArray*";
          kind = SymbolKind_ObjectArray;
          defaultValue = "null";
          ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
          this.globalVariables.set(name, { llvmType, kind, initialized: false });
          if (elementType) {
            this.defineVariableWithMetadata(
              name,
              `@${name}`,
              llvmType,
              kind,
              "global",
              createInterfaceMetadata(elementType),
            );
            this.symbolTable.setRawInterfaceType(name, elementType);
          } else {
            this.defineVariable(name, `@${name}`, llvmType, kind, "global");
          }
          if (stmt.declaredType) {
            this.symbolTable.setResolvedType(name, parseTypeString(stmt.declaredType));
          }
          continue;
        } else if (isUint8Array) {
          llvmType = "%Uint8Array*";
          kind = SymbolKind_Uint8Array;
          defaultValue = "null";
          ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
          this.globalVariables.set(name, { llvmType, kind, initialized: false });
          this.defineVariable(name, `@${name}`, llvmType, kind, "global");
          continue;
        } else if (isArray) {
          llvmType = "%Array*";
          kind = SymbolKind_Array;
          defaultValue = "null";
        } else if (isObject) {
          llvmType = "i8*";
          kind = SymbolKind_Object;
          defaultValue = "null";
          // Pass declaredType so metadata keys/types come out in canonical
          // interface declaration order when stmt.declaredType is a known
          // interface. Keeps variable metadata aligned with the struct layout
          // generateInterfaceObject emits.
          const objMeta = this.getObjectMetadata(stmt.value as ObjectNode, stmt.declaredType);
          if (objMeta && objMeta.keys.length > 0) {
            const interfaceName = stmt.declaredType || undefined;
            ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
            this.globalVariables.set(name, { llvmType, kind, initialized: false });
            this.defineVariableWithMetadata(
              name,
              `@${name}`,
              llvmType,
              kind,
              "global",
              createObjectMetadataWithInterface(
                { keys: objMeta.keys, types: objMeta.types },
                interfaceName || "",
              ),
            );
            continue;
          }
        } else if (isMap) {
          let declaredKeyType: string | null = null;
          if (stmt.declaredType) {
            const parsedDecl = parseMapTypeString(stmt.declaredType);
            if (parsedDecl) declaredKeyType = parsedDecl.keyType;
          }
          let isStringMap = false;
          let mapValueType = "string";
          if (stmt.declaredType) {
            const dt = stmt.declaredType;
            if (dt.indexOf("Map<string") !== -1) {
              isStringMap = true;
              const parsed = parseMapTypeString(dt);
              if (parsed) mapValueType = parsed.valueType;
            }
          }
          if (!isStringMap && declaredKeyType === null && stmt.value) {
            const mapNode = stmt.value as MapNode;
            if (mapNode.keyType === "string") {
              isStringMap = true;
              mapValueType = mapNode.valueType || "string";
            }
          }
          if (!isStringMap && declaredKeyType === null && resolvedBase.startsWith("Map<")) {
            const parsed = parseMapTypeString(resolvedBase);
            if (parsed && parsed.keyType === "string") {
              isStringMap = true;
              mapValueType = parsed.valueType;
            }
          }
          if (isStringMap) {
            llvmType = "%StringMap*";
            kind = SymbolKind_Map;
            defaultValue = "null";
            const llvmValueType = mapValueType === "number" ? "double" : "i8*";
            ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
            this.globalVariables.set(name, { llvmType, kind, initialized: false });
            this.defineVariableWithMetadata(
              name,
              `@${name}`,
              llvmType,
              kind,
              "global",
              createMapMetadataSymbol({
                keyType: "string",
                valueType: mapValueType,
                llvmKeyType: "i8*",
                llvmValueType,
              }),
            );
            continue;
          }
          let isPointerMap = false;
          let pointerMapKeyType = "";
          let pointerMapValueType = "string";
          if (stmt.declaredType) {
            const parsed = parseMapTypeString(stmt.declaredType);
            if (parsed && parsed.keyType !== "string" && parsed.keyType !== "number") {
              isPointerMap = true;
              pointerMapKeyType = parsed.keyType;
              pointerMapValueType = parsed.valueType;
            }
          }
          if (!isPointerMap && declaredKeyType === null && resolvedBase.startsWith("Map<")) {
            const parsed = parseMapTypeString(resolvedBase);
            if (parsed && parsed.keyType !== "string" && parsed.keyType !== "number") {
              isPointerMap = true;
              pointerMapKeyType = parsed.keyType;
              pointerMapValueType = parsed.valueType;
            }
          }
          if (isPointerMap) {
            llvmType = "%StringMap*";
            kind = SymbolKind_Map;
            defaultValue = "null";
            ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
            this.globalVariables.set(name, { llvmType, kind, initialized: false });
            this.defineVariableWithMetadata(
              name,
              `@${name}`,
              llvmType,
              kind,
              "global",
              createMapMetadataSymbol({
                keyType: pointerMapKeyType,
                valueType: pointerMapValueType,
                llvmKeyType: "i8*",
                llvmValueType: "i8*",
              }),
            );
            continue;
          }
          let numMapValueType = "number";
          if (stmt.declaredType) {
            const parsed = parseMapTypeString(stmt.declaredType);
            if (parsed) numMapValueType = parsed.valueType;
          }
          if (numMapValueType === "number" && stmt.value && stmt.value.type === "new") {
            const newNode = stmt.value as NewNode;
            if (newNode.className === "Map" && newNode.typeArgs && newNode.typeArgs.length === 2) {
              numMapValueType = newNode.typeArgs[1];
            }
          }
          if (numMapValueType !== "number" && numMapValueType !== "boolean") {
            this.emitError(
              `Map<number, ${numMapValueType}> is not supported. Use Map<string, ${numMapValueType}> instead`,
            );
          }
          llvmType = "%Map*";
          kind = SymbolKind_Map;
          defaultValue = "null";
        } else if (isSet) {
          let isStringSet = false;
          if (stmt.declaredType) {
            if (stmt.declaredType.indexOf("Set<string") !== -1) {
              isStringSet = true;
            }
          }
          if (!isStringSet && stmt.value) {
            const resolved = this.typeOf(stmt.value);
            if (resolved && resolved.base === "Set<string>") {
              isStringSet = true;
            }
          }
          if (isStringSet) {
            llvmType = "%StringSet*";
            kind = SymbolKind_Set;
            defaultValue = "null";
            ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
            this.globalVariables.set(name, { llvmType, kind, initialized: false });
            this.defineVariableWithMetadata(
              name,
              `@${name}`,
              llvmType,
              kind,
              "global",
              createSetMetadataSymbol({
                valueType: "string",
                llvmValueType: "i8*",
              }),
            );
            continue;
          }
          llvmType = "%Set*";
          kind = SymbolKind_Set;
          defaultValue = "null";
        } else if (isRegex) {
          llvmType = "i8*";
          kind = SymbolKind_Regex;
          defaultValue = "null";
        } else if (isClassInstance) {
          let className = "";
          const stmtValueType = (stmt.value as { type: string }).type;
          if (stmtValueType === "new") {
            className = this.resolveImportAlias((stmt.value as NewNode).className);
          } else if (stmtValueType === "call") {
            const callExpr = stmt.value as CallNode;
            const func = callExpr.name
              ? this.ast.functions.find((f) => f && f.name === callExpr.name && f.returnType)
              : null;
            className = func
              ? this.resolveImportAlias(stripNullable(func.returnType!))
              : resolvedBase;
          } else {
            className = resolvedBase;
          }
          const fields = this.classGen ? this.classGen.getClassFields(className) || [] : [];
          llvmType = fields.length > 0 ? `%${className}_struct*` : "i32*";
          kind = SymbolKind_Class;
          defaultValue = "null";
          ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
          this.globalVariables.set(name, { llvmType, kind, initialized: false });
          this.defineVariableWithMetadata(
            name,
            `@${name}`,
            llvmType,
            kind,
            "global",
            createClassMetadata({ className }),
          );
          continue;
        } else if (isBoolean) {
          llvmType = "double";
          kind = SymbolKind_Boolean;
          defaultValue = "0.0";
        } else if (isNumber) {
          llvmType = "double";
          kind = SymbolKind_Number;
          defaultValue = "0.0";
        } else if (isJSONParse) {
          const jsonIr = this.tryHandleGlobalJSONParse(name, stmt.value as MethodCallNode);
          if (jsonIr.length > 0) {
            ir += jsonIr;
            continue;
          }
          llvmType = "i8*";
          kind = SymbolKind_JSON;
          defaultValue = "null";
        } else {
          const declaredIr = this.tryHandleGlobalDeclaredType(name, stmt.declaredType);
          if (declaredIr.length > 0) {
            ir += declaredIr;
            continue;
          }
          if (stmt.declaredType) {
            const strippedDeclaredType = stripNullable(stmt.declaredType);
            if (strippedDeclaredType === "string") {
              llvmType = "i8*";
              kind = SymbolKind_String;
              defaultValue = "null";
            } else if (strippedDeclaredType === "number") {
              llvmType = "double";
              kind = SymbolKind_Number;
              defaultValue = "0.0";
            } else if (strippedDeclaredType === "boolean") {
              llvmType = "double";
              kind = SymbolKind_Boolean;
              defaultValue = "0.0";
            } else if (strippedDeclaredType === "string[]") {
              isStringArray = true;
            } else if (strippedDeclaredType === "boolean[]") {
              isUint8Array = true;
              isArray = false;
            } else if (strippedDeclaredType === "number[]") {
              isArray = true;
            } else if (strippedDeclaredType.endsWith("[]")) {
              isObjectArray = true;
            }
          }

          if (llvmType === "") {
            const exprIr = this.tryHandleGlobalExpressionType(name, stmt.value);
            if (exprIr.length > 0) {
              ir += exprIr;
              continue;
            }
          }

          if (llvmType === "") {
            const catchAllResult = this.classifyGlobalCatchAll(
              name,
              stmt.value,
              stmt.declaredType,
              i64Eligible,
            );
            if (catchAllResult === null) {
              return this.emitError(
                `cannot determine type of module-scope variable '${name}' (expression type: ${stmt.value ? (stmt.value as { type: string }).type : "unknown"}). ` +
                  `Move the declaration inside a function, or add a type annotation`,
              );
            }
            llvmType = catchAllResult.llvmType;
            kind = catchAllResult.kind;
            defaultValue = catchAllResult.defaultValue;
          }
        }

        const constLiteral = this.tryGetConstLiteralValue(stmt, llvmType, i64Eligible);
        if (constLiteral !== null) {
          ir += `@${name} = constant ${constLiteral.llvmType} ${constLiteral.value}` + "\n";
          this.globalVariables.set(name, {
            llvmType: constLiteral.llvmType,
            kind,
            initialized: false,
          });
          this.defineVariable(name, `@${name}`, constLiteral.llvmType, kind, "global");
          this.symbolTable.markLLVMConstant(name);
        } else {
          ir += `@${name} = global ${llvmType} ${defaultValue}` + "\n";
          this.globalVariables.set(name, { llvmType, kind, initialized: false });
          this.defineVariable(name, `@${name}`, llvmType, kind, "global");
        }
        if (stmt.declaredType) {
          this.symbolTable.setResolvedType(name, parseTypeString(stmt.declaredType));
        } else if (stmt.value) {
          const resolved = this.typeOf(stmt.value);
          if (resolved) {
            this.symbolTable.setResolvedType(name, resolved);
          }
        }
      } else if (stmt.declaredType) {
        const name = stmt.name;
        const globalIr = this.handleUninitializedGlobalVar(name, stmt.declaredType);
        if (globalIr.length > 0) {
          ir += globalIr;
        }
      }
    }
    if (ir.length > 0) {
      ir += "\n";
    }
    return ir;
  }

  private handleUninitializedGlobalVar(name: string, declaredType: string): string {
    const baseType = stripNullable(declaredType);
    if (baseType === "string") {
      this.globalVariables.set(name, {
        llvmType: "i8*",
        kind: SymbolKind_String,
        initialized: false,
      });
      this.defineVariable(name, `@${name}`, "i8*", SymbolKind_String, "global");
      return `@${name} = global i8* null\n`;
    }
    if (baseType === "number") {
      this.globalVariables.set(name, {
        llvmType: "double",
        kind: SymbolKind_Number,
        initialized: false,
      });
      this.defineVariable(name, `@${name}`, "double", SymbolKind_Number, "global");
      return `@${name} = global double 0.0\n`;
    }
    if (baseType === "boolean") {
      this.globalVariables.set(name, {
        llvmType: "double",
        kind: SymbolKind_Boolean,
        initialized: false,
      });
      this.defineVariable(name, `@${name}`, "double", SymbolKind_Boolean, "global");
      return `@${name} = global double 0.0\n`;
    }
    if (baseType === "string[]") {
      this.globalVariables.set(name, {
        llvmType: "%StringArray*",
        kind: SymbolKind_StringArray,
        initialized: false,
      });
      this.defineVariable(name, `@${name}`, "%StringArray*", SymbolKind_StringArray, "global");
      return `@${name} = global %StringArray* null\n`;
    }
    if (baseType === "boolean[]") {
      this.globalVariables.set(name, {
        llvmType: "%Uint8Array*",
        kind: SymbolKind_Uint8Array,
        initialized: false,
      });
      this.defineVariable(name, `@${name}`, "%Uint8Array*", SymbolKind_Uint8Array, "global");
      return `@${name} = global %Uint8Array* null\n`;
    }
    if (baseType === "number[]") {
      this.globalVariables.set(name, {
        llvmType: "%Array*",
        kind: SymbolKind_Array,
        initialized: false,
      });
      this.defineVariable(name, `@${name}`, "%Array*", SymbolKind_Array, "global");
      return `@${name} = global %Array* null\n`;
    }
    if (baseType.endsWith("[]")) {
      this.globalVariables.set(name, {
        llvmType: "%ObjectArray*",
        kind: SymbolKind_ObjectArray,
        initialized: false,
      });
      this.defineVariable(name, `@${name}`, "%ObjectArray*", SymbolKind_ObjectArray, "global");
      return `@${name} = global %ObjectArray* null\n`;
    }
    const declaredIr = this.tryHandleGlobalDeclaredType(name, declaredType);
    if (declaredIr.length > 0) return declaredIr;
    return "";
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
    return parts.join("");
  }

  generateParts(): string[] {
    checkEnumDeclarations(this.ast, this.sourceCode);
    // Semantic normalization: rewrite object literals to canonical interface
    // layout before any codegen reads them. This is ChadScript's equivalent of
    // clang's InitListChecker syntactic→semantic rewrite. Must run before other
    // passes that inspect ObjectNode.properties (order-sensitive).
    normalizeInterfaceLayouts(this.ast);
    checkClosureMutations(this.ast, this.sourceCode);
    checkUnionTypes(this.ast, this.sourceCode);
    checkArraysOfFunctions(this.ast, this.sourceCode);
    checkTypeAssertions(this.ast, this.sourceCode);
    checkUninitializedFields(this.ast, this.sourceCode);
    checkBinaryTypesDeep(this.ast, this.sourceCode);
    checkMissingReturns(this.ast, this.sourceCode);
    checkArgumentCounts(this.ast, this.sourceCode);
    checkAsyncAwait(this.ast, this.sourceCode);
    checkAmbiguousInits(this.ast, this.sourceCode);
    checkUntypedParams(this.ast, this.sourceCode);
    checkOrFallback(this.ast, this.sourceCode, this.filename);
    checkCallResultIndex(this.ast, this.sourceCode, this.filename);
    checkMixedOperators(this.ast, this.sourceCode);
    this.stackEligibleVars = analyzeEscapes(this.ast);
    markIntSpecializedFunctions(this.ast);
    // Build pure-AST class + interface catalog so downstream queries
    // don't need mid-codegen SymbolTable state. Populated once, read-only
    // thereafter. First consumers migrate in follow-up PRs.
    this.semaTable = new SemaTable(this.ast);
    // Pre-codegen type annotation — populate typeOf() cache for every
    // expression in the AST. Codegen consumers migrate to typeOf() in
    // follow-up PRs; this first PR is purely additive (populates the cache,
    // no reads yet). Skips expressions with unknown/missing base.
    annotateTypes(this.ast, this);

    const irParts: string[] = [];

    const interfaceStructDefs = this.interfaceStructGen.generateStructTypeDefinitions();
    this.interfaceStructDefsCache = interfaceStructDefs;

    const classStructDefs = this.classGen.generateStructTypeDefinitions(this.classesCount);
    this.classStructDefsCache = classStructDefs;

    const safeStr = getSafeStringHelper();
    if (safeStr) {
      irParts.push(safeStr);
    }
    const dblToStr = getDoubleToStringHelper();
    if (dblToStr) {
      irParts.push(dblToStr);
    }
    const strHash = getStringHashHelper();
    if (strHash) {
      irParts.push(strHash);
    }
    irParts.push(getBoundsCheckHelper());
    irParts.push(getNullCheckHelper());

    irParts.push(this.fsGen.generateReaddirSyncHelper());
    irParts.push(this.fsGen.generateStatSyncHelper());
    irParts.push(this.fsGen.generateStdinReadHelper());
    irParts.push(this.fsGen.generateStdinReadLineHelper());
    irParts.push(this.pathGen.generateNormalizeHelper());
    irParts.push(this.pathGen.generateRelativeHelper());
    irParts.push(this.pathGen.generateParseHelper());

    const globalVars = getGlobalVariables();
    if (globalVars) {
      irParts.push(globalVars);
    }

    const globalVarDecls = this.generateGlobalVariableDeclarations();
    if (globalVarDecls.length > 0) {
      irParts.push(globalVarDecls);
    }

    for (let classIdx = 0; classIdx < this.classesCount; classIdx++) {
      const classNode = this.ast.classes[classIdx];
      if (!classNode) continue;
      if (!classNode.name) continue;
      const classIr = this.classGen.generateClass(classNode);
      if (classIr.length > 0) {
        irParts.push(classIr);
        irParts.push("\n");
      }
    }

    const userFuncParts: string[] = [];
    for (let funcIdx = 0; funcIdx < this.functionsCount; funcIdx++) {
      const func = this.ast.functions[funcIdx];
      const funcIr = this.generateFunction(func);
      if (funcIr.length > 0) {
        userFuncParts.push(funcIr);
        userFuncParts.push("\n");
      }
    }

    const mainIr = this.generateMain();

    const liftedFunctions = this.exprGen.arrowFunctionGen.getLiftedFunctions();
    for (let _lfi = 0; _lfi < liftedFunctions.length; _lfi++) {
      const func = liftedFunctions[_lfi];
      const liftedIr = this.generateFunction(func);
      if (liftedIr.length > 0) {
        irParts.push(liftedIr);
        irParts.push("\n");
      }
    }

    // C-ABI trampoline closures: per-shape dispatch stubs invoked by C bridges
    // (e.g. child-process-spawn). Emitted after lifted lambdas so the trampoline
    // IR can legally reference the lifted fn-ptr types.
    if (this.usesTrampolines) {
      const trampIr = this.trampolineEmitter.emitAll();
      if (trampIr.length > 0) {
        irParts.push(trampIr);
        irParts.push("\n");
      }
    }

    const envStructDefs = this.exprGen.arrowFunctionGen.getEnvStructDefinitions();

    for (let ufi = 0; ufi < userFuncParts.length; ufi++) {
      irParts.push(userFuncParts[ufi]);
    }

    if (mainIr.length > 0) {
      irParts.push(mainIr);
    }

    if (this.httpHandlers.length > 0) {
      irParts.push("\n");
      const wsHandler = this.wsHandlers.length > 0 ? this.wsHandlers[0] : undefined;
      const mangledHttpHandler = this.mangleUserName(this.httpHandlers[0]);
      const mangledWsHandler = wsHandler ? this.mangleUserName(wsHandler) : undefined;
      const httpServe = this.httpServerGen.generateHttpServeFunction(mangledWsHandler);
      if (httpServe) {
        irParts.push(httpServe);
      }
      irParts.push("\n");

      // Detect if the handler's return type interface has "headers" and/or "bodyLen" fields
      let hasHeaders = false;
      let hasBodyLen = false;
      const handlerName = this.httpHandlers[0];
      let handlerReturnType: string | null = null;
      for (let fi = 0; fi < this.ast.functions.length; fi++) {
        const func = this.ast.functions[fi];
        if (func && func.name === handlerName && func.returnType) {
          handlerReturnType = func.returnType;
          break;
        }
      }
      if (!handlerReturnType) {
        const liftedFuncs = this.exprGen.arrowFunctionGen.getLiftedFunctions();
        for (let fi = 0; fi < liftedFuncs.length; fi++) {
          const func = liftedFuncs[fi];
          const lf = func as {
            name: string;
            params: string[];
            body: BlockStatement;
            returnType?: string;
          };
          if (lf.name === handlerName && lf.returnType) {
            handlerReturnType = lf.returnType;
            break;
          }
        }
      }
      if (handlerReturnType) {
        const retIface = this.getInterfaceFromAST(handlerReturnType);
        if (retIface) {
          const fields = this.getAllInterfaceFields(retIface as InterfaceDeclaration);
          for (let fj = 0; fj < fields.length; fj++) {
            if (fields[fj].name === "headers") {
              hasHeaders = true;
            }
            if (fields[fj].name === "bodyLen") {
              hasBodyLen = true;
            }
          }
        } else if (handlerReturnType === "HttpResponse") {
          // HttpResponse is defined in chadscript.d.ts (not in AST), always has headers + bodyLen
          hasHeaders = true;
          hasBodyLen = true;
        }
      }

      const eventHandler = this.httpServerGen.generateEventHandler(
        mangledHttpHandler,
        mangledWsHandler,
        hasHeaders,
        hasBodyLen,
      );
      if (eventHandler) {
        irParts.push(eventHandler);
      }
      // Emit the WS server→client primitives whenever the program either
      // registered a wsHandler OR directly called wsBroadcast / wsSend.
      // Previously only the former triggered emission, causing
      // "undefined value @__ws_broadcast" at link time for push-only apps.
      if (wsHandler || this.usesWsPrimitives) {
        irParts.push("\n");
        irParts.push(this.httpServerGen.generateWsBroadcastFunction());
        irParts.push(this.httpServerGen.generateWsSendToFunction());
      }
    }

    if (this.usesTimers) {
      irParts.push("\n");
      const timerCb = this.libuvGen.generateTimerCallbackWrapper();
      if (timerCb) {
        irParts.push(timerCb);
      }
      const setTimeout = this.libuvGen.generateSetTimeout();
      if (setTimeout) {
        irParts.push(setTimeout);
      }
      const setInterval = this.libuvGen.generateSetInterval();
      if (setInterval) {
        irParts.push(setInterval);
      }
      const clearTimer = this.libuvGen.generateClearTimer();
      if (clearTimer) {
        irParts.push(clearTimer);
      }
      const runLoop = this.libuvGen.generateRunEventLoop();
      if (runLoop) {
        irParts.push(runLoop);
      }
    }

    if (this.usesPromises) {
      irParts.push("\n");
      const promiseAll = this.promiseGen.generateAll();
      if (promiseAll) {
        irParts.push(promiseAll);
      }
      if (this.usesCurl) {
        const fetchCallbacks = this.libuvGen.generateFetchWorkCallbacks();
        if (fetchCallbacks) {
          irParts.push(fetchCallbacks);
        }
        const fetchAsync = this.libuvGen.generateFetchAsync();
        if (fetchAsync) {
          irParts.push(fetchAsync);
        }
      }
      if (this.usesAsyncFs) {
        irParts.push(this.asyncFsGen.generateAll());
      }
      // Async exec helpers reuse FsWorkContext, so only emit when usesAsyncFs is set
      // (generateExec sets usesAsyncFs; generateSpawn does not need these helpers)
      if (this.usesChildProcess && this.usesAsyncFs) {
        irParts.push(this.asyncCpGen.generateAll());
      }
      const promiseAwait = this.libuvGen.generatePromiseAwait();
      if (promiseAwait) {
        irParts.push(promiseAwait);
      }
    }

    if (this.usesTreeSitter) {
      const tsDecls = this.treesitterGen.generateDeclarations();
      if (tsDecls) {
        irParts.push(this.filterDuplicateDeclarations(tsDecls));
      }
      irParts.push("\n");
    }

    if (this.embedGen.hasEmbeddedFiles()) {
      irParts.push(this.embedGen.generateLookupFunction());
      irParts.push(this.embedGen.generateLengthLookupFunction());
    }

    const needsLibuv =
      this.usesTimers ||
      this.usesPromises ||
      this.usesCurl ||
      this.usesUvHrtime ||
      this.usesHttpServer ||
      this.usesAsyncFs;
    const needsPromise = this.usesPromises || this.usesCurl || this.usesAsyncFs;

    const finalParts: string[] = [];

    if (this.targetInfo) {
      // datalayout must come before triple — LLVM opt validates this order
      finalParts.push('target datalayout = "' + this.targetInfo.dataLayout + '"\n');
      finalParts.push('target triple = "' + this.targetInfo.triple + '"\n');
      finalParts.push("\n");
    }

    finalParts.push("; Tree-sitter type definitions\n");
    finalParts.push("%TSParser = type opaque\n");
    finalParts.push("%TSTree = type opaque\n");
    finalParts.push("%TSLanguage = type opaque\n");
    finalParts.push("%TSNode = type { [4 x i32], i8*, %TSTree* }\n");
    finalParts.push("%TSPoint = type { i32, i32 }\n\n");

    if (this.interfaceStructDefsCache) {
      finalParts.push(this.interfaceStructDefsCache);
      finalParts.push("\n");
    }

    if (this.classStructDefsCache) {
      finalParts.push(this.classStructDefsCache);
      finalParts.push("\n");
    }

    if (envStructDefs) {
      finalParts.push(envStructDefs);
      finalParts.push("\n");
    }

    if (this.globalStrings.length > 0) {
      for (let gsi = 0; gsi < this.globalStrings.length; gsi++) {
        finalParts.push(this.globalStrings[gsi]);
        finalParts.push("\n");
      }
      finalParts.push("\n");
    }

    finalParts.push(
      this.filterDuplicateDeclarations(
        getLLVMDeclarations({
          curl: this.usesCurl !== 0,
          crypto: this.usesCrypto !== 0,
          sqlite: this.usesSqlite !== 0,
          compression: this.usesCompression !== 0,
          yaml: this.usesYaml !== 0,
          testRunner: this.usesTestRunner !== 0,
          targetOS: this.getTargetOS(),
        }),
      ),
    );

    if (this.usesCurl) {
      const fetchRuntime = this.runtimeGen.generateFetchRuntime();
      if (fetchRuntime) {
        finalParts.push(fetchRuntime);
      }
      const statusTextRuntime = this.responseGen.generateStatusTextRuntime();
      if (statusTextRuntime) {
        finalParts.push(statusTextRuntime);
      }
      finalParts.push("\n");
    }

    if (this.usesJson) {
      const jsonRuntime = this.runtimeGen.generateJSONRuntime();
      if (jsonRuntime) {
        finalParts.push(jsonRuntime);
      }
      finalParts.push("\n");
    }

    if (this.usesHttpServer) {
      if (!this.usesCurl) {
        finalParts.push("%__FetchResponse = type { i8*, i32, i8*, i8*, i8*, i32 }\n\n");
      }
      const httpServerDecls = this.httpServerGen.generateDeclarations();
      if (httpServerDecls) {
        finalParts.push(this.filterDuplicateDeclarations(httpServerDecls));
      }
      finalParts.push("\n");
    }

    if (this.usesMultipart) {
      finalParts.push("; multipart parser declarations (via multipart-bridge)\n");
      finalParts.push("declare i8* @cs_parse_multipart_to_array(i8*, i8*, i64)\n\n");
    }

    if (needsLibuv) {
      const libuvDecls = this.libuvGen.generateDeclarations(this.usesCurl !== 0);
      if (libuvDecls) {
        finalParts.push(this.filterDuplicateDeclarations(libuvDecls));
      }
      finalParts.push("\n");
    }

    if (needsPromise) {
      const promiseDecls = this.promiseGen.generateDeclarations();
      if (promiseDecls) {
        finalParts.push(this.filterDuplicateDeclarations(promiseDecls));
      }
      finalParts.push("\n");
    }

    // Timer callback wrapper always references cs_tramp_get / cs_tramp_free
    // since PR3 — so whenever timers are used, the trampoline externs must
    // be declared even if no arrow-closure path was ever taken.
    if (this.usesTrampolines || this.usesTimers) {
      let trampDecls = "";
      trampDecls += "; C-ABI trampoline slot table (trampoline-bridge.c)\n";
      trampDecls += "declare i32 @cs_tramp_alloc(i8*)\n";
      trampDecls += "declare i8* @cs_tramp_get(i32)\n";
      trampDecls += "declare void @cs_tramp_free(i32)\n";
      finalParts.push(this.filterDuplicateDeclarations(trampDecls));
      finalParts.push("\n");
    }

    if (this.usesCrypto) {
      finalParts.push(this.cryptoGen.generateBytesToHexHelper());
      finalParts.push(this.cryptoGen.generateUuidFormatHelper());
    }

    if (this.usesConsoleTime) {
      finalParts.push(generateConsoleTimerHelpers());
    }

    if (this.usesArraySort) {
      finalParts.push(generateDefaultSortComparators());
    }

    if (this.usesSqlite) {
      finalParts.push(this.sqliteGen.generateSqliteRowToStringHelper());
      finalParts.push(this.sqliteGen.generateSqliteGetHelper());
      finalParts.push(this.sqliteGen.generateSqliteAllHelper());
      finalParts.push(this.sqliteGen.generateSqliteBindParamsHelper());
      finalParts.push(this.sqliteGen.generateSqliteExecWithParamsHelper());
      finalParts.push(this.sqliteGen.generateSqliteGetWithParamsHelper());
      finalParts.push(this.sqliteGen.generateSqliteAllWithParamsHelper());
      finalParts.push(this.sqliteGen.generateSqliteRowToStructHelper());
      finalParts.push(this.sqliteGen.generateSqliteQueryHelper());
      finalParts.push(this.sqliteGen.generateSqliteQueryWithParamsHelper());
      finalParts.push(this.sqliteGen.generateSqliteGetRowHelper());
      finalParts.push(this.sqliteGen.generateSqliteGetRowWithParamsHelper());
    }

    if (this.usesStringBuilder) {
      finalParts.push(this.runtimeGen.generateStringBuilderRuntime());
    }

    for (let scanIdx = 0; scanIdx < irParts.length; scanIdx++) {
      const part = irParts[scanIdx];
      if (!part) continue;
      if (part.includes("@drand48")) this.usesMathRandom = 1;
    }

    for (let ipi = 0; ipi < irParts.length; ipi++) {
      finalParts.push(irParts[ipi]);
    }

    // TBAA metadata — disabled for now.
    // ChadScript's type-based alias analysis was causing -O2 segfaults because
    // the optimizer incorrectly reorders loads/stores across struct fields when
    // the TBAA hierarchy claims double and pointer types don't alias. Structs
    // like FunctionNode contain both double and pointer fields, and the coarse
    // type-based TBAA (without proper struct-path TBAA) leads to miscompilation.
    // TODO: re-enable with struct-path TBAA once field-level aliasing is correct.
    finalParts.push("\n; TBAA metadata (currently unused — see comment above)\n");
    finalParts.push('!0 = !{!"ChadScript TBAA Root"}\n');
    finalParts.push('!1 = !{!"omnipotent char", !0, i64 0}\n');
    finalParts.push('!2 = !{!"double", !1, i64 0}\n');
    finalParts.push('!3 = !{!"any pointer", !1, i64 0}\n');
    finalParts.push("!4 = !{!2, !2, i64 0}\n");
    finalParts.push("!5 = !{!3, !3, i64 0}\n");
    finalParts.push('!6 = !{!"int", !1, i64 0}\n');
    finalParts.push("!7 = !{!6, !6, i64 0}\n");

    if (this.debugInfoEnabled) {
      this.dbgBuilder.finalize();
      finalParts.push("\n; Debug metadata\n");
      finalParts.push(this.dbgBuilder.getNumberedMetadata());
      finalParts.push("\n");
      finalParts.push(this.dbgBuilder.getNamedMetadata());
    }

    return finalParts;
  }

  /**
   * Remove `declare` lines whose function name is already in the
   * user-declared extern set (from `declare function` in TS source).
   * Prevents LLVM "invalid redefinition" errors when hardcoded runtime
   * declarations overlap with user declarations.
   */
  private filterDuplicateDeclarations(ir: string): string {
    if (this.declaredExternFunctions.length === 0) return ir;
    const lines = ir.split("\n");
    const filtered: string[] = [];
    for (let dli = 0; dli < lines.length; dli++) {
      const line = lines[dli];
      if (line.startsWith("declare ")) {
        const atIdx = line.indexOf("@");
        if (atIdx !== -1) {
          const rest = line.substring(atIdx + 1);
          const parenIdx = rest.indexOf("(");
          if (parenIdx !== -1) {
            const fnName = rest.substring(0, parenIdx);
            if (this.declaredExternFunctions.indexOf(fnName) !== -1) {
              continue;
            }
          }
        }
      }
      filtered.push(line);
    }
    return filtered.join("\n");
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
  private getLocLine(node: { loc?: { line: number; column: number } }): number {
    if (node.loc) return node.loc.line;
    return 0;
  }

  private getLocColumn(node: { loc?: { line: number; column: number } }): number {
    if (node.loc) return node.loc.column;
    return 0;
  }

  private generateFunction(func: FunctionNode): string {
    // External C function declaration: emit LLVM `declare` with correct types,
    // no _cs_ prefix (external symbols use their real C names)
    if (func.declare) {
      return this.generateDeclareFunction(func);
    }
    if (this.debugInfoEnabled && func.name) {
      const line = this.getLocLine(func);
      this.currentSubprogramId = this.dbgBuilder.createSubprogram(func.name, line);
    }
    const ir = this.funcGen.generate(func);
    this.currentSubprogramId = -1;
    this.currentDebugLocId = -1;
    return ir;
  }

  /** Emit an LLVM `declare` for an external C function (from TS `declare function`). */
  private generateDeclareFunction(func: FunctionNode): string {
    const retType = func.returnType
      ? mapReturnTypeToLLVM(func.returnType, this.isEnumType(func.returnType))
      : "double";

    const paramLlvmTypes: string[] = [];
    if (func.paramTypes) {
      for (let i = 0; i < func.paramTypes.length; i++) {
        const pt = func.paramTypes[i];
        paramLlvmTypes.push(
          mapParamTypeToLLVM(pt, func.params[i] || "", this.isEnumType(stripNullable(pt)), false),
        );
      }
    } else if (func.parameters) {
      for (let i = 0; i < func.parameters.length; i++) {
        const p = func.parameters[i] as FunctionParameter;
        const pType = p.type || "number";
        paramLlvmTypes.push(
          mapParamTypeToLLVM(pType, p.name || "", this.isEnumType(stripNullable(pType)), false),
        );
      }
    }

    this.declaredExternFunctions.push(func.name);
    if (func.name.startsWith("cs_llvm_")) this.usesLLVM = 1;
    if (func.name.startsWith("cs_lld_")) this.usesLLD = 1;
    if (func.name.startsWith("cs_v8_")) this.usesV8 = 1;
    return `declare ${retType} @${func.name}(${paramLlvmTypes.join(", ")})\n`;
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
    if (this.symbolTable.isString(stmt.name)) {
      this.ensureStringBuilderAllocas(stmt.name);
      this.invalidateStringBuilder(stmt.name);
    }
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
        const arrayType = isStringArr ? "%StringArray" : "%Array";
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
      this.emitError(`Unknown variable: ${stmtName}`);
    }
    const varType = this.getVariableType(stmtName) || "double";
    const valueType = this.getVariableType(value);
    let coercedValue = value;
    if (varType === "double" && valueType === "i64") {
      coercedValue = this.ensureDouble(value);
    } else if (varType === "i64" && valueType !== "i64") {
      if (valueType === "double" || !valueType) {
        const temp = this.nextTemp();
        this.emit(`${temp} = fptosi double ${value} to i64`);
        this.setVariableType(temp, "i64");
        coercedValue = temp;
      }
    }
    this.emit(`store ${varType} ${coercedValue}, ${varType}* ${allocaReg}`);
  }

  private getAssignmentName(stmt: AssignmentStatement): string {
    return stmt.name;
  }

  private getAssignmentValue(stmt: AssignmentStatement): Expression {
    return stmt.value;
  }

  private handleSimpleAssignmentWithFields(
    stmtName: string,
    stmtValue: Expression,
    params: string[],
  ): void {
    if (this.symbolTable.isString(stmtName) && stmtValue.type === "binary") {
      const pieces = this.flattenStringAppendChain(stmtName, stmtValue as BinaryNode);
      if (pieces) {
        this.emitStringBuilderAppend(stmtName, pieces, params);
        return;
      }
    }

    if (this.symbolTable.isObjectArray(stmtName)) {
      this.setExpectedArrayElementType("pointer");
    } else if (this.symbolTable.isStringArray(stmtName)) {
      this.setExpectedArrayElementType("string");
    }
    const value = this.generateExpression(stmtValue, params);
    this.setExpectedArrayElementType(null);

    const stringAllocaReg = this.symbolTable.getStringAlloca(stmtName);
    if (stringAllocaReg) {
      this.emit(`store i8* ${value}, i8** ${stringAllocaReg}`);
      this.invalidateStringBuilder(stmtName);
      return;
    }

    const arrayAllocaReg = this.symbolTable.getArrayAlloca(stmtName);
    if (arrayAllocaReg) {
      if (this.symbolTable.isPointerAlloca(stmtName)) {
        const isStringArr = this.symbolTable.isStringArray(stmtName);
        const arrayType = isStringArr ? "%StringArray" : "%Array";
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
      this.emitError(`Unknown variable: ${stmtName}`);
    }
    const varType = this.getVariableType(stmtName) || "double";
    const valueType = this.getVariableType(value);
    let coercedValue = value;
    if (varType === "double" && valueType === "i64") {
      coercedValue = this.ensureDouble(value);
    } else if (varType === "i64" && valueType !== "i64") {
      if (valueType === "double" || !valueType) {
        const temp = this.nextTemp();
        this.emit(`${temp} = fptosi double ${value} to i64`);
        this.setVariableType(temp, "i64");
        coercedValue = temp;
      }
    }
    this.emit(`store ${varType} ${coercedValue}, ${varType}* ${allocaReg}`);
  }

  private flattenStringAppendChain(varName: string, expr: BinaryNode): Expression[] | null {
    if (expr.op !== "+") return null;
    const revPieces: Expression[] = [];
    let currentBin: BinaryNode = expr;
    while (true) {
      if (currentBin.op !== "+") return null;
      revPieces.push(currentBin.right);
      if (currentBin.left.type === "binary") {
        currentBin = currentBin.left as BinaryNode;
      } else if (currentBin.left.type === "variable") {
        if ((currentBin.left as VariableNode).name !== varName) return null;
        const pieces: Expression[] = [];
        let ri = revPieces.length - 1;
        while (ri >= 0) {
          pieces.push(revPieces[ri]);
          ri = ri - 1;
        }
        return pieces;
      } else {
        return null;
      }
    }
  }

  private ensureStringBuilderAllocas(varName: string): void {
    const existing = this.stringBuilderSlen.get(varName);
    if (existing) return;
    const slenName = "%" + this.nextLabel("SBlen");
    const scapName = "%" + this.nextLabel("SBcap");
    this.allocaInstructions.push(slenName + " = alloca i64");
    this.allocaInstructions.push("store i64 0, i64* " + slenName);
    this.allocaInstructions.push(scapName + " = alloca i64");
    this.allocaInstructions.push("store i64 0, i64* " + scapName);
    this.stringBuilderSlen.set(varName, slenName);
    this.stringBuilderScap.set(varName, scapName);
    this.usesStringBuilder = 1;
  }

  private invalidateStringBuilder(varName: string): void {
    const scap = this.stringBuilderScap.get(varName);
    if (scap) {
      this.emit("store i64 0, i64* " + scap);
    }
  }

  private emitStringBuilderAppend(varName: string, pieces: Expression[], params: string[]): void {
    this.ensureStringBuilderAllocas(varName);
    const slen = this.stringBuilderSlen.get(varName);
    const scap = this.stringBuilderScap.get(varName);
    const ptrAlloca = this.symbolTable.getStringAlloca(varName);
    if (!ptrAlloca || !slen || !scap) return;

    const currentCap = this.nextTemp();
    this.emit(currentCap + " = load i64, i64* " + scap);
    const isInit = this.nextTemp();
    this.emit(isInit + " = icmp eq i64 " + currentCap + ", 0");
    const initLabel = this.nextLabel("sb_init");
    const readyLabel = this.nextLabel("sb_ready");
    this.emit("br i1 " + isInit + ", label %" + initLabel + ", label %" + readyLabel);

    this.emit(initLabel + ":");
    const curPtr = this.nextTemp();
    this.emit(curPtr + " = load i8*, i8** " + ptrAlloca);
    const curLen = this.nextTemp();
    this.emit(curLen + " = call i64 @strlen(i8* " + curPtr + ")");
    this.emit("store i64 " + curLen + ", i64* " + slen);
    this.emit("br label %" + readyLabel);

    this.emit(readyLabel + ":");

    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      let pieceStr: string;
      const pieceValue = this.generateExpression(piece, params);
      const pieceType = this.getVariableType(pieceValue);
      if (pieceType === "i8*" || this.isStringExpression(piece)) {
        pieceStr = pieceValue;
      } else {
        pieceStr = this.stringGen.doConvertNumberToString(pieceValue);
      }
      const pieceLen = this.nextTemp();
      this.emit(pieceLen + " = call i64 @strlen(i8* " + pieceStr + ")");
      this.emit(
        "call void @__cs_str_builder_append(i8** " +
          ptrAlloca +
          ", i64* " +
          slen +
          ", i64* " +
          scap +
          ", i8* " +
          pieceStr +
          ", i64 " +
          pieceLen +
          ")",
      );
    }
  }

  private allocateVariableWithFields(
    stmtName: string,
    stmtValue: Expression | null,
    stmtKind: string,
    stmtDeclaredType: string | undefined,
    params: string[],
  ): void {
    const stmt: VariableDeclaration = {
      type: "variable_declaration",
      kind: stmtKind as "let" | "const",
      name: stmtName,
      value: stmtValue,
      declaredType: stmtDeclaredType,
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

      if (this.debugInfoEnabled && this.currentSubprogramId >= 0) {
        const stmtLine = this.getLocLine(stmtRaw as { loc?: { line: number; column: number } });
        const stmtCol = this.getLocColumn(stmtRaw as { loc?: { line: number; column: number } });
        if (stmtLine > 0) {
          this.currentDebugLocId = this.dbgBuilder.createLocation(
            stmtLine,
            stmtCol,
            this.currentSubprogramId,
          );
        }
      }

      const stmtType = this.getStatementType(stmtRaw);
      if (!stmtType) {
        continue;
      }

      if (stmtType === "variable_declaration") {
        const stmt = stmtRaw as VariableDeclaration;
        this.allocateVariable(stmt, params);
      } else if (stmtType === "assignment") {
        const stmt = stmtRaw as AssignmentStatement;
        const stmtName = this.getAssignmentName(stmt);
        const stmtValue = this.getAssignmentValue(stmt);
        if (!stmtName) {
          continue;
        }
        const isMemberAccess = stmtName.startsWith("__member_access__");
        if (isMemberAccess) {
          this.assignmentGen.generateMemberAccessAssignment(stmtRaw as AssignmentStatement, params);
        } else if (stmtName === "__index_access__") {
          this.generateExpression(stmtValue as Expression, params);
        } else {
          this.handleSimpleAssignmentWithFields(stmtName, stmtValue as Expression, params);
        }
      } else if (stmtType === "return") {
        const stmt = stmtRaw as ReturnStatement;
        if (!stmt.value) {
          // Return without value - use default based on return type
          if (this.currentFunctionReturnType === "void") {
            this.emit(`ret void`);
          } else if (this.currentFunctionReturnType === "i8*") {
            const emptyStr = this.stringGen.doCreateStringConstant("");
            this.emit(`ret i8* ${emptyStr}`);
          } else if (
            this.currentFunctionReturnType &&
            this.currentFunctionReturnType.indexOf("*") !== -1
          ) {
            this.emit(`ret ${this.currentFunctionReturnType} null`);
          } else {
            this.emit(`ret ${this.currentFunctionReturnType} 0.0`);
          }
          hasTerminator = true;
          continue;
        }

        const stmtValBase3 = stmt.value as { type: string };
        if (stmtValBase3.type === "object" && this.currentFunctionTsReturnType) {
          const inlineType = this.extractInlineInterfaceType(this.currentFunctionTsReturnType);
          if (inlineType) {
            this.currentDeclaredInterfaceType = inlineType;
          } else {
            let returnTypeName = this.currentFunctionTsReturnType;
            if (returnTypeName.indexOf(" | ") !== -1) {
              const parts = returnTypeName.split(" | ");
              const objLit = stmt.value as ObjectNode;
              let discriminantValue: string | null = null;
              if (objLit.properties && objLit.properties.length > 0) {
                const firstProp = objLit.properties[0];
                if (firstProp.key === "type" && firstProp.value) {
                  const propValue = firstProp.value as StringNode;
                  if (propValue.type === "string" && propValue.value) {
                    discriminantValue = propValue.value;
                  }
                }
              }
              if (discriminantValue && this.interfaceStructGen) {
                for (let i = 0; i < parts.length; i++) {
                  const part = parts[i].trim();
                  if (part === "null" || part === "undefined") continue;
                  const ifaceInfo = this.interfaceStructGen.getInterfaceStruct(part);
                  if (ifaceInfo && ifaceInfo.fields) {
                    const firstField = ifaceInfo.fields[0] as { name: string; tsType: string };
                    if (firstField && firstField.name === "type") {
                      const expectedType = firstField.tsType.replace(/['"]/g, "");
                      if (expectedType === discriminantValue) {
                        returnTypeName = part;
                        break;
                      }
                    }
                  }
                }
              }
              if (returnTypeName === this.currentFunctionTsReturnType) {
                const objKeys: string[] = [];
                if (objLit.properties) {
                  for (let k = 0; k < objLit.properties.length; k++) {
                    objKeys.push(objLit.properties[k].key);
                  }
                }
                let bestMatch: string | null = null;
                let bestMatchSize = -1;
                let exactMatch: string | null = null;
                for (let i = 0; i < parts.length; i++) {
                  const part = parts[i].trim();
                  if (part === "null" || part === "undefined") continue;
                  if (!bestMatch) bestMatch = part;
                  if (this.interfaceStructGen) {
                    const ifaceInfo = this.interfaceStructGen.getInterfaceStruct(part);
                    if (ifaceInfo && ifaceInfo.fields) {
                      const fieldNames: string[] = [];
                      for (let f = 0; f < ifaceInfo.fields.length; f++) {
                        const field = ifaceInfo.fields[f] as { name: string };
                        fieldNames.push(field.name);
                      }
                      let isSuperset = true;
                      for (let k = 0; k < objKeys.length; k++) {
                        let found = false;
                        for (let f = 0; f < fieldNames.length; f++) {
                          if (fieldNames[f] === objKeys[k]) {
                            found = true;
                            break;
                          }
                        }
                        if (!found) {
                          isSuperset = false;
                          break;
                        }
                      }
                      if (isSuperset) {
                        if (ifaceInfo.fields.length === objKeys.length) {
                          exactMatch = part;
                          break;
                        }
                        if (bestMatchSize === -1 || ifaceInfo.fields.length < bestMatchSize) {
                          bestMatch = part;
                          bestMatchSize = ifaceInfo.fields.length;
                        }
                      }
                    }
                  }
                }
                if (exactMatch) {
                  returnTypeName = exactMatch;
                } else if (bestMatch) {
                  returnTypeName = bestMatch;
                }
              }
            }
            if (this.interfaceStructGen && this.interfaceStructGen.hasInterface(returnTypeName)) {
              this.currentDeclaredInterfaceType = returnTypeName;
            }
          }
        }
        let clearFnTypeHints = false;
        if (
          stmtValBase3.type === "arrow_function" &&
          this.currentFunctionTsReturnType &&
          this.currentFunctionTsReturnType.indexOf("=>") !== -1
        ) {
          const fnRetType = this.currentFunctionTsReturnType;
          const arrowIdx = fnRetType.indexOf("=>");
          if (arrowIdx !== -1) {
            const retPart = fnRetType.substring(arrowIdx + 2).trim();
            const paramPart = fnRetType.substring(0, arrowIdx).trim();
            let inner = paramPart;
            if (inner.startsWith("(") && inner.endsWith(")")) {
              inner = inner.substring(1, inner.length - 1).trim();
            }
            const hintParamTypes: string[] = [];
            if (inner.length > 0) {
              const parts = inner.split(",");
              for (let pi = 0; pi < parts.length; pi++) {
                const p = parts[pi].trim();
                const colonIdx = p.indexOf(":");
                if (colonIdx !== -1) {
                  hintParamTypes.push(p.substring(colonIdx + 1).trim());
                } else {
                  hintParamTypes.push("number");
                }
              }
            }
            this.setExpectedCallbackParamTypes(hintParamTypes);
            this.setExpectedCallbackReturnType(retPart);
            clearFnTypeHints = true;
          }
        }
        lastValue = this.generateExpression(stmt.value as Expression, params);
        if (clearFnTypeHints) {
          this.setExpectedCallbackParamTypes(null);
          this.setExpectedCallbackReturnType(null);
        }
        this.currentDeclaredInterfaceType = undefined;

        if (!lastValue || lastValue === "") {
          this.emitError(
            `Return statement generated empty value for function ${this.currentFunction}`,
          );
        }

        if (this.isAsyncFunction) {
          const valueAsPtr = this.nextTemp();
          this.emit(`${valueAsPtr} = bitcast i8* ${lastValue} to i8*`);
          this.emit(
            `call void @__Promise_resolve(%Promise* ${this.asyncResultPromise}, i8* ${lastValue})`,
          );
          this.emit(`ret %Promise* ${this.asyncResultPromise}`);
        } else {
          if (this.currentFunctionReturnType === "double") {
            const valueType = this.getVariableType(lastValue);
            if (valueType === "i32") {
              const converted = this.nextTemp();
              this.emit(`${converted} = sitofp i32 ${lastValue} to double`);
              lastValue = converted;
            } else if (valueType === "i64") {
              const converted = this.nextTemp();
              this.emit(`${converted} = sitofp i64 ${lastValue} to double`);
              lastValue = converted;
            } else if (valueType === "i8*" || lastValue === "null") {
              lastValue = "0.0";
            }
          } else if (this.currentFunctionReturnType === "i64") {
            // Integer-specialized function: every return must end up i64.
            const valueType = this.getVariableType(lastValue);
            if (valueType === "double" || !valueType) {
              const converted = this.nextTemp();
              this.emit(`${converted} = fptosi double ${lastValue} to i64`);
              lastValue = converted;
            } else if (valueType === "i32") {
              const converted = this.nextTemp();
              this.emit(`${converted} = sext i32 ${lastValue} to i64`);
              lastValue = converted;
            }
          }

          if (this.currentFunctionReturnType === "void") {
            this.emit(`ret void`);
          } else if (
            lastValue.startsWith("__lambda_") &&
            this.currentFunctionReturnType === "i8*"
          ) {
            const liftedFunc = this.exprGen.arrowFunctionGen.getLiftedFunctionByName(lastValue);
            if (liftedFunc) {
              const retType = liftedFunc.returnType || "";
              const llvmRet =
                retType === "string" || retType === "i8*"
                  ? "i8*"
                  : retType === "void"
                    ? "void"
                    : "double";
              const paramCount = liftedFunc.params ? liftedFunc.params.length : 0;
              let funcType = `${llvmRet} (i8*`;
              for (let pi = 0; pi < paramCount; pi++) {
                const pType = liftedFunc.paramTypes ? liftedFunc.paramTypes[pi] : "";
                funcType += pType === "string" ? ", i8*" : ", double";
              }
              funcType += ")*";
              const castPtr = this.nextTemp();
              this.emit(`${castPtr} = bitcast ${funcType} @${lastValue} to i8*`);
              const envPtr = this.getLastInlineLambdaEnvPtr() || "null";
              const pairMem = this.nextTemp();
              this.emit(`${pairMem} = call i8* @GC_malloc(i64 16)`);
              const fnSlot = this.nextTemp();
              this.emit(`${fnSlot} = bitcast i8* ${pairMem} to i8**`);
              this.emit(`store i8* ${castPtr}, i8** ${fnSlot}`);
              const envSlot = this.nextTemp();
              this.emit(`${envSlot} = getelementptr i8*, i8** ${fnSlot}, i32 1`);
              this.emit(`store i8* ${envPtr}, i8** ${envSlot}`);
              this.setLastInlineLambdaEnvPtr(null);
              this.emit(`ret i8* ${pairMem}`);
            } else {
              this.emit(`ret ${this.currentFunctionReturnType} ${lastValue}`);
            }
          } else {
            this.emit(`ret ${this.currentFunctionReturnType} ${lastValue}`);
          }
        }
        hasTerminator = true;
      } else if (stmtType === "if") {
        lastValue = this.controlFlowGen.generateIfStatement(stmtRaw as Statement, params);
        if (this.lastInstructionIsTerminator()) {
          hasTerminator = true;
        }
      } else if (stmtType === "while") {
        lastValue = this.controlFlowGen.generateWhileStatement(stmtRaw as Statement, params);
        if (this.lastInstructionIsTerminator()) {
          hasTerminator = true;
        }
      } else if (stmtType === "do_while") {
        lastValue = this.controlFlowGen.generateDoWhileStatement(stmtRaw as Statement, params);
        if (this.lastInstructionIsTerminator()) {
          hasTerminator = true;
        }
      } else if (stmtType === "for") {
        lastValue = this.controlFlowGen.generateForStatement(stmtRaw as Statement, params);
        if (this.lastInstructionIsTerminator()) {
          hasTerminator = true;
        }
      } else if (stmtType === "for_of") {
        lastValue = this.controlFlowGen.generateForOfStatement(stmtRaw as Statement, params);
        if (this.lastInstructionIsTerminator()) {
          hasTerminator = true;
        }
      } else if (stmtType === "break") {
        lastValue = this.controlFlowGen.generateBreakStatement();
        hasTerminator = true; // break generates 'br', which is a terminator
      } else if (stmtType === "continue") {
        lastValue = this.controlFlowGen.generateContinueStatement();
        hasTerminator = true; // continue generates 'br', which is a terminator
      } else if (stmtType === "throw") {
        lastValue = this.controlFlowGen.generateThrowStatement(stmtRaw as Statement, params);
        hasTerminator = true; // throw generates 'unreachable', which is a terminator
      } else if (stmtType === "try") {
        lastValue = this.controlFlowGen.generateTryStatement(stmtRaw as Statement, params);
        if (this.lastInstructionIsTerminator()) {
          hasTerminator = true;
        }
      } else if (stmtType === "switch") {
        lastValue = this.controlFlowGen.generateSwitchStatement(stmtRaw as Statement, params);
        if (this.lastInstructionIsTerminator()) {
          hasTerminator = true;
        }
      } else if (stmtType === "block") {
        lastValue = this.generateBlock(stmtRaw as BlockStatement, params);
      } else {
        // Expression statement
        lastValue = this.generateExpression(stmtRaw as Expression, params);
        if (this.lastInstructionIsTerminator()) {
          hasTerminator = true;
        }
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
    if (this.debugInfoEnabled && this.currentSubprogramId >= 0) {
      const exprLine = this.getLocLine(expr as { loc?: { line: number; column: number } });
      const exprCol = this.getLocColumn(expr as { loc?: { line: number; column: number } });
      if (exprLine > 0) {
        this.currentDebugLocId = this.dbgBuilder.createLocation(
          exprLine,
          exprCol,
          this.currentSubprogramId,
        );
      }
    }
    return this.exprGen.generate(expr, params);
  }

  public isArrayExpression(expr: Expression): boolean {
    return this.typeInference.isArrayExpression(expr);
  }

  public resolveExpressionTypeRich(expr: Expression): ResolvedType | null {
    return this.typeInference.resolveExpressionTypeRich(expr);
  }

  public getArrayStorageStrategy(expr: Expression): "inlined" | "pointer" {
    return this.typeInference.getArrayStorageStrategy(expr);
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

  public isUint8ArrayExpression(expr: Expression): boolean {
    return this.typeInference.isUint8ArrayExpression(expr);
  }

  public isBooleanExpression(expr: Expression): boolean {
    return this.typeInference.isBooleanExpression(expr);
  }

  public isPromiseExpression(expr: Expression): boolean {
    return this.typeInference.isPromiseExpression(expr);
  }

  public isAwaitExpression(expr: Expression): boolean {
    return expr.type === "await";
  }

  public isResponseExpression(expr: Expression): boolean {
    return this.typeInference.isResponseExpression(expr);
  }

  private getGenericMethodReturnError(expr: MethodCallNode, varName: string): string | null {
    if (expr.object.type !== "variable") return null;
    const objName = (expr.object as VariableNode).name;
    const className = this.symbolTable.getConcreteClass(objName);
    if (!className || !this.ast || !this.ast.classes) return null;
    for (let i = 0; i < this.ast.classes.length; i++) {
      const cls = this.ast.classes[i] as ClassNode;
      if (cls.name !== className) continue;
      if (!cls.typeParameters || cls.typeParameters.length === 0) return null;
      for (let j = 0; j < cls.methods.length; j++) {
        const m = cls.methods[j];
        if (m.isConstructor || m.name !== expr.method) continue;
        if (!m.returnType) return null;
        for (let k = 0; k < cls.typeParameters.length; k++) {
          const tp = cls.typeParameters[k] as string;
          if (m.returnType === tp || m.returnType.includes(tp)) {
            return (
              `'${varName}' is assigned from '${objName}.${expr.method}()' which returns generic type '${m.returnType}' — ` +
              `add a type annotation: 'const ${varName}: YourType = ${objName}.${expr.method}()'`
            );
          }
        }
      }
    }
    return null;
  }

  private getIndexAccessClassName(expr: Expression): string | null {
    if (!expr || (expr as { type: string }).type !== "index_access") return null;
    const indexExpr = expr as IndexAccessNode;
    if (!indexExpr.object) return null;
    const objBase = indexExpr.object as { type: string };
    if (objBase.type === "variable") {
      const varName = (indexExpr.object as VariableNode).name;
      const rawType = this.symbolTable.getRawInterfaceType(varName);
      if (rawType && this.isKnownClass(rawType)) return rawType;
    }
    return null;
  }

  private getMemberAccessClassName(expr: Expression): string | null {
    if (!expr || (expr as { type: string }).type !== "member_access") return null;
    const memberExpr = expr as MemberAccessNode;
    const objBase = memberExpr.object as { type: string };
    if (objBase.type !== "variable") return null;
    const varName = (memberExpr.object as VariableNode).name;
    const classMeta = this.symbolTable.getClassMetadata(varName);
    if (!classMeta) return null;
    const className = classMeta.className;
    if (!className) return null;
    if (this.ast && this.ast.classes) {
      for (let j = 0; j < this.ast.classes.length; j++) {
        const cls = this.ast.classes[j];
        if (!cls || !cls.fields) continue;
        if (cls.name !== className) continue;
        for (let k = 0; k < cls.fields.length; k++) {
          const field = cls.fields[k] as { name: string; fieldType: string; tsType?: string };
          if (field.name === memberExpr.property) {
            const rawType = field.tsType || field.fieldType;
            const tsType = stripNullable(rawType);
            if (this.isKnownClass(tsType)) return tsType;
          }
        }
      }
    }
    return null;
  }

  private isKnownClass(name: string): boolean {
    if (!name) return false;
    // Also check resolved alias (e.g., import MyGreeter from './greeter' → Greeter)
    const resolved = this.resolveImportAlias(name);
    if (!this.ast || !this.ast.classes) return false;
    for (let i = 0; i < this.ast.classes.length; i++) {
      const cls = this.ast.classes[i];
      if (cls && (cls.name === name || cls.name === resolved)) return true;
    }
    return false;
  }

  public getTypedJsonInterface(expr: Expression): string | null {
    if (expr.type !== "method_call") return null;
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
    if (expr.type !== "method_call") return null;
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
      return "double";
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
    if (!item) return "";
    return item.type;
  }

  public getTopLevelStatement(index: number): VariableDeclaration {
    return this.ast.topLevelStatements[index] as VariableDeclaration;
  }

  public getTopLevelExpression(
    index: number,
  ):
    | CallNode
    | NewNode
    | MethodCallNode
    | ForStatement
    | ForOfStatement
    | WhileStatement
    | DoWhileStatement
    | IfStatement
    | TryStatement
    | UnaryNode
    | AwaitExpressionNode {
    return this.ast.topLevelExpressions[index];
  }

  public getOutputAsString(): string {
    if (this.output.length === 0) {
      return "";
    }
    const lines: string[] = [];
    for (let i = 0; i < this.output.length; i++) {
      const line = this.output[i];
      if (line) {
        lines.push("  " + line);
      } else {
        lines.push("  ");
      }
    }
    return lines.join("\n") + "\n";
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
    if (itemType === "variable_declaration") {
      this.allocateVariable(item as VariableDeclaration, []);
    } else if (itemType === "if") {
      this.controlFlowGen.generateIfStatement(item as IfStatement, []);
    } else if (itemType === "while") {
      this.controlFlowGen.generateWhileStatement(item as WhileStatement, []);
    } else if (itemType === "do_while") {
      this.controlFlowGen.generateDoWhileStatement(item as DoWhileStatement, []);
    } else if (itemType === "for") {
      this.controlFlowGen.generateForStatement(item as ForStatement, []);
    } else if (itemType === "for_of") {
      this.controlFlowGen.generateForOfStatement(item as ForOfStatement, []);
    } else if (itemType === "assignment") {
      this.generateBlock({ type: "block", statements: [item as AssignmentStatement] }, []);
    } else if (itemType === "throw") {
      this.controlFlowGen.generateThrowStatement(item as Statement, []);
    } else if (itemType === "try") {
      this.controlFlowGen.generateTryStatement(item as Statement, []);
    } else if (itemType === "switch") {
      this.controlFlowGen.generateSwitchStatement(item as Statement, []);
    } else {
      this.generateExpression(item as Expression, []);
    }
  }

  private generateMain(): string {
    if (this.debugInfoEnabled) {
      this.currentSubprogramId = this.dbgBuilder.createSubprogram("main", 0);
      this.currentDebugLocId = this.dbgBuilder.createLocation(1, 1, this.currentSubprogramId);
    }
    let hasTry = false;
    for (let i = 0; i < this.ast.topLevelStatements.length; i++) {
      const stmt = this.ast.topLevelStatements[i];
      if (stmt && (stmt.type as string) === "try") {
        hasTry = true;
        break;
      }
    }
    const ir = this.funcGen.generateMain(this.topLevelObjectVariables, hasTry);
    this.currentSubprogramId = -1;
    this.currentDebugLocId = -1;
    return ir;
  }

  private inferArrowHandlerReturnType(arrow: ArrowFunctionNode): string | null {
    let expr: Expression | null = null;
    if (arrow.body.type === "block") {
      const block = arrow.body as BlockStatement;
      for (const s of block.statements) {
        if (s.type === "return") {
          const ret = s as ReturnStatement;
          if (ret.value) {
            expr = ret.value;
            break;
          }
        }
      }
    } else {
      expr = arrow.body as Expression;
    }
    if (!expr || expr.type !== "method_call") return null;
    const mc = expr as MethodCallNode;
    if (mc.object.type !== "variable") return null;
    const varName = (mc.object as VariableNode).name;
    const className = this.symbolTable.getConcreteClass(varName);
    if (!className) return null;
    return this.getMethodReturnType(className, mc.method);
  }

  // Generate HTTP server - creates a TCP server that parses HTTP and calls handler
  public generateHttpServe(expr: CallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.emitError(
        "httpServe() requires at least 2 arguments: port and handler function",
        expr.loc,
      );
    }

    const portValue = this.generateExpression(expr.args[0], params);
    const handlerArg = expr.args[1];
    let handlerName: string;
    if (handlerArg.type === "variable") {
      handlerName = (handlerArg as VariableNode).name;
    } else if (handlerArg.type === "arrow_function") {
      const arrowExpr = handlerArg as ArrowFunctionNode;
      const returnTypeName = this.inferArrowHandlerReturnType(arrowExpr);
      handlerName = this.exprGen.arrowFunctionGen.generateArrowFunction(arrowExpr, params, {
        paramTypes: ["i8*"],
        returnType: returnTypeName || "i8*",
      });
    } else {
      return this.emitError(
        "httpServe() handler must be a function reference or arrow function",
        expr.loc,
      );
    }

    // Track handler for http server event handler generation
    this.httpHandlers.push(handlerName);
    this.usesHttpServer = 1;

    if (expr.args.length >= 3) {
      const wsHandlerArg = expr.args[2];
      if (wsHandlerArg.type !== "variable") {
        return this.emitError(
          "httpServe() WebSocket handler must be a function reference",
          expr.loc,
        );
      }
      const wsHandlerName = (wsHandlerArg as VariableNode).name;
      this.wsHandlers.push(wsHandlerName);
    }

    // Convert port from double to i32
    const dblPort = this.ensureDouble(portValue);
    const portI32 = this.nextTemp();
    this.emit(`${portI32} = fptosi double ${dblPort} to i32`);

    // Call the runtime http_serve function
    // Handler now takes a single Request object (i8*) and returns Response object (i8*)
    const temp = this.nextTemp();
    this.emit(
      `${temp} = call i32 @http_serve(i32 ${portI32}, i8* (i8*)* @${this.mangleUserName(handlerName)})`,
    );

    return temp;
  }

  public generateWsBroadcast(expr: CallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.emitError("wsBroadcast() requires 1 argument: message string", expr.loc);
    }
    // Mark that this program calls a WS primitive directly so the module
    // finalizer emits @__ws_broadcast (previously gated behind wsHandler
    // presence, which broke server→client push when the app didn't accept
    // incoming WS messages).
    this.usesWsPrimitives = 1;
    const msgValue = this.generateExpression(expr.args[0], params);
    const len = this.nextTemp();
    this.emit(`${len} = call i64 @strlen(i8* ${msgValue})`);
    this.emit(`call void @__ws_broadcast(i8* ${msgValue}, i64 ${len})`);
    return "0.0";
  }

  public generateWsSend(expr: CallNode, params: string[]): string {
    if (expr.args.length < 2) {
      return this.emitError("wsSend() requires 2 arguments: connId, message", expr.loc);
    }
    this.usesWsPrimitives = 1;
    const connIdValue = this.generateExpression(expr.args[0], params);
    const msgValue = this.generateExpression(expr.args[1], params);
    const len = this.nextTemp();
    this.emit(`${len} = call i64 @strlen(i8* ${msgValue})`);
    this.emit(`call void @__ws_send_to(i8* ${connIdValue}, i8* ${msgValue}, i64 ${len})`);
    return "0.0";
  }

  public generateParseMultipart(expr: CallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.emitError("parseMultipart() requires a request argument", expr.loc);
    }
    this.setUsesMultipart(true);
    const reqValue = this.generateExpression(expr.args[0], params);
    const reqType = "%struct.lws_bridge_request";
    const reqPtr = this.nextTemp();
    this.emit(`${reqPtr} = bitcast i8* ${reqValue} to ${reqType}*`);
    const ctGep = this.nextTemp();
    this.emit(`${ctGep} = getelementptr ${reqType}, ${reqType}* ${reqPtr}, i32 0, i32 3`);
    const ctVal = this.nextTemp();
    this.emit(`${ctVal} = load i8*, i8** ${ctGep}`);
    const bodyGep = this.nextTemp();
    this.emit(`${bodyGep} = getelementptr ${reqType}, ${reqType}* ${reqPtr}, i32 0, i32 2`);
    const bodyVal = this.nextTemp();
    this.emit(`${bodyVal} = load i8*, i8** ${bodyGep}`);
    const lenGep = this.nextTemp();
    this.emit(`${lenGep} = getelementptr ${reqType}, ${reqType}* ${reqPtr}, i32 0, i32 5`);
    const lenDbl = this.nextTemp();
    this.emit(`${lenDbl} = load double, double* ${lenGep}`);
    const lenVal = this.nextTemp();
    this.emit(`${lenVal} = fptosi double ${lenDbl} to i64`);
    const rawResult = this.nextTemp();
    this.emit(
      `${rawResult} = call i8* @cs_parse_multipart_to_array(i8* ${ctVal}, i8* ${bodyVal}, i64 ${lenVal})`,
    );
    const objArr = this.nextTemp();
    this.emit(`${objArr} = bitcast i8* ${rawResult} to %ObjectArray*`);
    this.setVariableType(objArr, "%ObjectArray*");
    return objArr;
  }

  public getInterfaceFromAST(
    name: string,
  ): { name: string; fields: { name: string; type: string }[] } | null {
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
}
