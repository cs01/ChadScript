import {
  AST,
  Expression,
  FunctionNode,
  BlockStatement,
  VariableDeclaration,
  AssignmentStatement,
  ClassNode,
  ArrayNode,
  ObjectNode,
  ObjectProperty,
  MethodCallNode,
  BinaryNode,
  VariableNode,
  MemberAccessNode,
  IfStatement,
  WhileStatement,
  ForStatement,
  ForOfStatement,
  TryStatement,
  SourceLocation,
  Statement,
  ReturnStatement,
  MapNode,
  SetNode,
  InterfaceDeclaration,
} from "../ast/types.js";
import { checkUnsafeUnionType } from "../codegen/infrastructure/type-system.js";
import { DiagnosticEngine, DIAG_ERROR, DIAG_WARNING } from "../diagnostics/engine.js";

type SymbolType =
  | "number"
  | "string"
  | "boolean"
  | "null"
  | "undefined"
  | "array<number>"
  | "array<string>"
  | "object"
  | "class"
  | "unknown";

interface ExpressionBase {
  type: string;
}

/**
 * Semantic Analyzer - Pre-codegen type validation
 *
 * Validates types BEFORE codegen to catch errors early with better error messages.
 * Builds a symbol table with inferred types for all variables.
 */

export interface TypedSymbol {
  name: string;
  type: SymbolType;
  llvmType: string;
  schemaKeys?: string[];
  schemaTypes?: string[];
}

const NUMBER_SYMBOL: TypedSymbol = { name: "", type: "number", llvmType: "double" };
const STRING_SYMBOL: TypedSymbol = { name: "", type: "string", llvmType: "i8*" };

function lookupPropertyType(typeName: string, property: string): TypedSymbol | null {
  if (typeName === "string" && property === "length") return NUMBER_SYMBOL;
  if (typeName === "array<number>" && property === "length") return NUMBER_SYMBOL;
  if (typeName === "array<string>" && property === "length") return NUMBER_SYMBOL;
  return null;
}

export interface AnalysisError {
  message: string;
  location?: string;
  suggestion?: string;
}

export class SemanticAnalyzer {
  private ast: AST;
  private symbols: Map<string, TypedSymbol>;
  private errors: AnalysisError[] = [];
  private currentFunction: string = "";
  private diagnosticEngine: DiagnosticEngine;
  private suppressWarnings: boolean = false;

  constructor(ast: AST) {
    this.ast = ast;
    this.symbols = new Map();
    this.diagnosticEngine = new DiagnosticEngine();
    // Color off by default; caller sets via setDiagnosticColor after construction
  }

  setDiagnosticColor(enabled: boolean): void {
    this.diagnosticEngine.setColor(enabled);
  }

  setSuppressWarnings(value: boolean): void {
    this.suppressWarnings = value;
  }

  /**
   * Run semantic analysis - returns true if no errors
   */
  analyze(): boolean {
    this.errors = [];

    this.symbols.set("process", { name: "process", type: "object", llvmType: "i8*" });
    this.symbols.set("console", { name: "console", type: "object", llvmType: "i8*" });
    this.symbols.set("Math", { name: "Math", type: "object", llvmType: "i8*" });
    this.symbols.set("JSON", { name: "JSON", type: "object", llvmType: "i8*" });
    this.symbols.set("Date", { name: "Date", type: "object", llvmType: "i8*" });
    this.symbols.set("path", { name: "path", type: "object", llvmType: "i8*" });
    this.symbols.set("fs", { name: "fs", type: "object", llvmType: "i8*" });
    this.symbols.set("os", { name: "os", type: "object", llvmType: "i8*" });
    this.symbols.set("crypto", { name: "crypto", type: "object", llvmType: "i8*" });
    this.symbols.set("sqlite", { name: "sqlite", type: "object", llvmType: "i8*" });
    this.symbols.set("child_process", { name: "child_process", type: "object", llvmType: "i8*" });
    this.symbols.set("tty", { name: "tty", type: "object", llvmType: "i8*" });
    this.symbols.set("assert", { name: "assert", type: "object", llvmType: "i8*" });
    this.symbols.set("Number", { name: "Number", type: "object", llvmType: "i8*" });
    this.symbols.set("Object", { name: "Object", type: "object", llvmType: "i8*" });
    this.symbols.set("ChadScript", { name: "ChadScript", type: "object", llvmType: "i8*" });

    if (this.ast.enums) {
      for (let _ei = 0; _ei < this.ast.enums.length; _ei++) {
        const enumNode = this.ast.enums[_ei] as { name: string };
        if (enumNode.name) {
          this.symbols.set(enumNode.name, { name: enumNode.name, type: "object", llvmType: "i8*" });
        }
      }
    }

    // Register class names so static member access (ClassName.method()) passes analysis
    if (this.ast.classes) {
      for (let _ci = 0; _ci < this.ast.classes.length; _ci++) {
        const classNode = this.ast.classes[_ci] as { name: string };
        if (classNode.name) {
          this.symbols.set(classNode.name, {
            name: classNode.name,
            type: "object",
            llvmType: "i8*",
          });
        }
      }
    }

    if (this.ast.imports) {
      for (let _ii = 0; _ii < this.ast.imports.length; _ii++) {
        const imp = this.ast.imports[_ii];
        if (imp.aliasedSpecifiers) {
          for (let _ai = 0; _ai < imp.aliasedSpecifiers.length; _ai++) {
            const spec = imp.aliasedSpecifiers[_ai];
            if (spec.name) {
              this.symbols.set(spec.name, { name: spec.name, type: "object", llvmType: "i8*" });
            }
          }
        }
      }
    }

    // NOTE: Interface field/method union checking is intentionally omitted here.
    // The native compiler can't handle iface.fields[i].name or iface.methods[i].name
    // (array-of-objects field access pattern) during self-hosting. The variable
    // declaration and class field checks below still catch most unsafe unions.

    for (let _si = 0; _si < this.ast.topLevelStatements.length; _si++) {
      const stmt = this.ast.topLevelStatements[_si];
      if (stmt.type === "variable_declaration") {
        this.analyzeVariableDeclaration(stmt);
      } else if (stmt.type === "assignment") {
        this.analyzeAssignment(stmt);
      }
    }

    for (let _fi = 0; _fi < this.ast.functions.length; _fi++) {
      const func = this.ast.functions[_fi];
      this.analyzeFunction(func);
    }

    for (let _ci = 0; _ci < this.ast.classes.length; _ci++) {
      const classNode = this.ast.classes[_ci];
      this.analyzeClass(classNode);
    }

    return this.errors.length === 0;
  }

  /**
   * Get all errors found during analysis
   */
  getErrors(): AnalysisError[] {
    return this.errors;
  }

  /**
   * Get symbol table for codegen to use
   */
  getSymbols(): Map<string, TypedSymbol> {
    return this.symbols;
  }

  getSymbolTypeByName(name: string): string {
    const sym = this.symbols.get(name);
    if (!sym) return "unknown";
    return sym.type;
  }

  getSymbolLlvmTypeByName(name: string): string {
    const sym = this.symbols.get(name);
    if (!sym) return "double";
    return sym.llvmType;
  }

  getSymbolSchemaKeysByName(name: string): string[] | undefined {
    const sym = this.symbols.get(name);
    if (!sym) return undefined;
    return sym.schemaKeys;
  }

  getSymbolSchemaTypesByName(name: string): string[] | undefined {
    const sym = this.symbols.get(name);
    if (!sym) return undefined;
    return sym.schemaTypes;
  }

  private inferDeclaredType(declaredType: string | undefined): {
    type: SymbolType;
    llvmType: string;
  } {
    if (!declaredType) return { type: "number", llvmType: "double" };
    if (declaredType === "string") return { type: "string", llvmType: "i8*" };
    if (declaredType === "number" || declaredType === "boolean")
      return { type: "number", llvmType: "double" };
    if (declaredType === "string[]") return { type: "array<string>", llvmType: "%StringArray*" };
    if (declaredType === "number[]" || declaredType === "boolean[]")
      return { type: "array<number>", llvmType: "%Array*" };
    if (declaredType.endsWith("| undefined") || declaredType.endsWith("| null")) {
      const baseType = declaredType.split("|")[0].trim();
      return this.inferDeclaredType(baseType);
    }
    return { type: "unknown", llvmType: "double" };
  }

  private analyzeVariableDeclaration(stmt: VariableDeclaration): void {
    // Reject unsafe union type annotations on variables (e.g. `let x: string | number`)
    if (stmt.declaredType) {
      const warning = checkUnsafeUnionType(stmt.declaredType);
      if (warning) {
        this.errors.push({
          message: `Variable '${stmt.name}': ${warning}`,
          location: this.currentFunction || "top-level",
        });
      }
    }

    if (!stmt.value) {
      const inferred = this.inferDeclaredType(stmt.declaredType);
      this.symbols.set(stmt.name, {
        name: stmt.name,
        type: inferred.type,
        llvmType: inferred.llvmType,
      });
      return;
    }

    this.checkUntypedGenericConstructor(stmt);

    const inferredType = this.inferExpressionType(stmt.value, stmt.declaredType);
    if (!inferredType) return;
    const symbolEntry = {
      name: stmt.name,
      type: inferredType.type,
      llvmType: inferredType.llvmType,
    };
    this.symbols.set(stmt.name, symbolEntry);
  }

  private checkUntypedGenericConstructor(stmt: VariableDeclaration): void {
    if (!stmt.value) return;
    const valType = (stmt.value as { type: string }).type;

    if (valType === "map") {
      const mapNode = stmt.value as MapNode;
      if (!mapNode.keyType || !mapNode.valueType) {
        const hasDeclaredMapType =
          stmt.declaredType !== undefined && stmt.declaredType.indexOf("Map<") !== -1;
        if (!hasDeclaredMapType) {
          this.errors.push({
            message:
              "Map constructor requires explicit type parameters: use new Map<KeyType, ValueType>() or add a declared type",
          });
        }
      }
    }

    if (valType === "set") {
      const setNode = stmt.value as SetNode;
      if (!setNode.valueType) {
        const hasDeclaredSetType =
          stmt.declaredType !== undefined && stmt.declaredType.indexOf("Set<") !== -1;
        if (!hasDeclaredSetType) {
          this.errors.push({
            message:
              "Set constructor requires explicit type parameters: use new Set<ValueType>() or add a declared type",
          });
        }
      }
    }
  }

  private analyzeFunction(func: FunctionNode): void {
    // External declarations have no body to analyze
    if (func.declare) return;

    this.currentFunction = func.name;

    this.checkFunctionUnionTypes(func.name, func.paramTypes, func.returnType);

    for (let _pi = 0; _pi < func.params.length; _pi++) {
      const param = func.params[_pi];
      const paramType = func.paramTypes ? func.paramTypes[_pi] : undefined;
      const inferred = this.inferDeclaredType(paramType);

      this.symbols.set(param, {
        name: param,
        type: inferred.type,
        llvmType: inferred.llvmType,
      });
    }

    this.analyzeBlock(func.body);

    if (
      !this.suppressWarnings &&
      func.returnType &&
      func.returnType !== "void" &&
      func.returnType !== "Promise<void>"
    ) {
      if (!this.blockAlwaysReturns(func.body)) {
        const funcAny = func as { loc?: SourceLocation };
        this.diagnosticEngine.warning(
          "function '" + func.name + "' may not return a value on all paths",
          funcAny.loc,
          "add a return statement at the end",
        );
      }
    }
  }

  private analyzeClass(classNode: ClassNode): void {
    const classFields = classNode.fields || [];
    for (let _fli = 0; _fli < classFields.length; _fli++) {
      const field = classFields[_fli];

      // Check tsType for unsafe unions (fieldType is already resolved to a primitive)
      if (field.tsType) {
        const warning = checkUnsafeUnionType(field.tsType);
        if (warning) {
          this.errors.push({
            message: `In class '${classNode.name}', field '${field.name}': ${warning}`,
            location: classNode.name,
          });
        }
      }

      let llvmType = "i32";
      let type: SymbolType = "number";

      if (field.fieldType === "string") {
        llvmType = "i8*";
        type = "string";
      } else if (field.fieldType === "string[]") {
        llvmType = "%StringArray*";
        type = "array<string>";
      } else if (field.fieldType === "number[]" || field.fieldType === "boolean[]") {
        llvmType = "%Array*";
        type = "array<number>";
      }

      this.symbols.set(field.name, {
        name: field.name,
        type,
        llvmType,
      });

      if (!this.suppressWarnings && field.initializer) {
        const initBase = field.initializer as { type: string };
        if (initBase.type === "new") {
          const classAny = classNode as { loc?: SourceLocation };
          this.diagnosticEngine.warning(
            "class '" + classNode.name + "' field '" + field.name + "' uses new in initializer",
            classAny.loc,
            "move the new call to the constructor body for reliable initialization",
          );
        }
      }
    }

    const classMethods = classNode.methods || [];
    for (let _mi = 0; _mi < classMethods.length; _mi++) {
      const method = classMethods[_mi];
      this.currentFunction = `${classNode.name}.${method.name}`;

      this.checkFunctionUnionTypes(this.currentFunction, method.paramTypes, method.returnType);

      for (let i = 0; i < method.params.length; i++) {
        const param = method.params[i];
        const paramType = method.paramTypes ? method.paramTypes[i] : undefined;
        const inferred = this.inferDeclaredType(paramType);

        this.symbols.set(param, {
          name: param,
          type: inferred.type,
          llvmType: inferred.llvmType,
        });
      }

      this.analyzeBlock(method.body);
    }
  }

  private checkFunctionUnionTypes(
    funcName: string,
    paramTypes: string[] | undefined,
    returnType: string | undefined,
  ): void {
    if (paramTypes) {
      for (let i = 0; i < paramTypes.length; i++) {
        const warning = checkUnsafeUnionType(paramTypes[i]);
        if (warning) {
          this.errors.push({
            message: `In function '${funcName}', parameter ${i}: ${warning}`,
            location: funcName,
          });
        }
      }
    }
    if (returnType) {
      const warning = checkUnsafeUnionType(returnType);
      if (warning) {
        this.errors.push({
          message: `In function '${funcName}', return type: ${warning}`,
          location: funcName,
        });
      }
    }
  }

  private analyzeBlock(block: BlockStatement): void {
    if (!block || !block.statements) return;
    let hasTerminator = false;
    for (let _bi = 0; _bi < block.statements.length; _bi++) {
      const stmt = block.statements[_bi];

      if (hasTerminator && !this.suppressWarnings) {
        const stmtAny = stmt as { loc?: SourceLocation };
        this.diagnosticEngine.warning(
          "unreachable code after return/throw/break/continue",
          stmtAny.loc,
          "remove this unreachable statement",
        );
        break;
      }

      const stmtType = stmt.type;
      if (
        stmtType === "return" ||
        stmtType === "throw" ||
        stmtType === "break" ||
        stmtType === "continue"
      ) {
        hasTerminator = true;
      }

      if (stmtType === "variable_declaration") {
        this.analyzeVariableDeclaration(stmt);
      } else if (stmtType === "assignment") {
        this.analyzeAssignment(stmt);
      } else if (stmtType === "if") {
        const ifStmt = stmt as IfStatement;
        if (ifStmt.thenBlock) this.analyzeBlock(ifStmt.thenBlock);
        if (ifStmt.elseBlock) this.analyzeBlock(ifStmt.elseBlock);
      } else if (stmtType === "while" || stmtType === "do_while") {
        const whileStmt = stmt as WhileStatement;
        if (whileStmt.body) this.analyzeBlock(whileStmt.body);
      } else if (stmtType === "for") {
        const forStmt = stmt as ForStatement;
        if (forStmt.init && forStmt.init.type === "variable_declaration") {
          this.analyzeVariableDeclaration(forStmt.init as VariableDeclaration);
        }
        if (forStmt.body) this.analyzeBlock(forStmt.body);
      } else if (stmtType === "for_of") {
        const forOfStmt = stmt as ForOfStatement;
        if (forOfStmt.variableName) {
          const iterableType = this.inferExpressionType(forOfStmt.iterable);
          let elemType: SymbolType = "unknown";
          let elemLlvm = "i8*";
          if (iterableType.type === "array<number>") {
            elemType = "number";
            elemLlvm = "double";
          } else if (iterableType.type === "array<string>") {
            elemType = "string";
            elemLlvm = "i8*";
          }
          this.symbols.set(forOfStmt.variableName, {
            name: forOfStmt.variableName,
            type: elemType,
            llvmType: elemLlvm,
          });
        }
        if (forOfStmt.body) this.analyzeBlock(forOfStmt.body);
      } else if (stmtType === "try") {
        const tryStmt = stmt as TryStatement;
        if (tryStmt.tryBlock) this.analyzeBlock(tryStmt.tryBlock);
        if (tryStmt.catchParam) {
          this.symbols.set(tryStmt.catchParam, {
            name: tryStmt.catchParam,
            type: "string",
            llvmType: "i8*",
          });
        }
        if (tryStmt.catchBody) {
          this.analyzeBlock(tryStmt.catchBody);
        }
        if (tryStmt.finallyBlock) this.analyzeBlock(tryStmt.finallyBlock);
      } else if (stmtType === "return") {
        const retStmt = stmt as ReturnStatement;
        if (retStmt.value) {
          this.inferExpressionType(retStmt.value);
        }
      }
    }
  }

  private analyzeAssignment(stmt: AssignmentStatement): void {
    if (stmt.name.startsWith("__member_access__")) {
      this.inferExpressionType(stmt.value);
      return;
    }

    const varSymbol = this.symbols.get(stmt.name);
    if (!varSymbol) {
      return;
    }

    const valueType = this.inferExpressionType(stmt.value);
    if (!valueType) return;

    if (
      varSymbol.llvmType !== valueType.llvmType &&
      varSymbol.type !== "null" &&
      valueType.type !== "null" &&
      varSymbol.type !== "unknown" &&
      valueType.type !== "unknown" &&
      !this.areAssignmentCompatible(varSymbol, valueType)
    ) {
      this.errors.push({
        message: `Type mismatch: Cannot assign ${valueType.type} to ${varSymbol.type}`,
        location: `${this.currentFunction}: ${stmt.name} = ...`,
        suggestion: `Expected ${varSymbol.llvmType}, got ${valueType.llvmType}`,
      });
    }
  }

  private areAssignmentCompatible(target: TypedSymbol, value: TypedSymbol): boolean {
    if (target.type === "array<string>" && value.type === "array<number>") return true;
    if (target.type === "array<number>" && value.type === "array<string>") return true;
    if (target.type === "object" || value.type === "object") return true;
    return false;
  }

  /**
   * CORE: Infer the type of any expression
   * This is where we catch array/object type errors EARLY
   * @param declaredType Optional TypeScript type annotation (e.g., "string[]")
   */
  private inferExpressionType(expr: Expression, declaredType?: string): TypedSymbol {
    const e = expr as ExpressionBase;

    // String literal
    if (e.type === "string") {
      return {
        name: "",
        type: "string",
        llvmType: "i8*",
      };
    }

    // Number literal
    if (e.type === "number") {
      return {
        name: "",
        type: "number",
        llvmType: "double",
      };
    }

    // Boolean literal
    if (e.type === "boolean") {
      return {
        name: "",
        type: "boolean",
        llvmType: "double",
      };
    }

    // Null literal
    if (e.type === "null") {
      return {
        name: "",
        type: "null",
        llvmType: "i8*",
      };
    }

    // Undefined literal
    if (e.type === "undefined") {
      return {
        name: "",
        type: "undefined",
        llvmType: "i8*",
      };
    }

    // Array literal - VALIDATE HOMOGENEITY HERE
    if (e.type === "array") {
      const arrayExpr = expr as ArrayNode;
      const elements = arrayExpr.elements || [];

      if (elements.length === 0) {
        if (declaredType === "string[]") {
          return {
            name: "",
            type: "array<string>",
            llvmType: "%StringArray*",
          };
        } else if (declaredType === "number[]" || declaredType === "boolean[]") {
          return {
            name: "",
            type: "array<number>",
            llvmType: "%Array*",
          };
        }

        return {
          name: "",
          type: "array<number>",
          llvmType: "%Array*",
        };
      }

      const firstType = this.inferExpressionType(elements[0]);

      for (let i = 1; i < elements.length; i++) {
        const elemType = this.inferExpressionType(elements[i]);

        if (elemType.llvmType !== firstType.llvmType) {
          this.errors.push({
            message: `Mixed array types: element 0 is ${firstType.type}, element ${i} is ${elemType.type}`,
            location: this.currentFunction,
            suggestion: `Arrays must be homogeneous. Use all ${firstType.type}s or all ${elemType.type}s.`,
          });

          return {
            name: "",
            type: "unknown",
            llvmType: "double",
          };
        }
      }

      if (firstType.llvmType === "i8*") {
        return {
          name: "",
          type: "array<string>",
          llvmType: "%StringArray*",
        };
      } else {
        return {
          name: "",
          type: "array<number>",
          llvmType: "%Array*",
        };
      }
    }

    if (e.type === "object") {
      const objExpr = expr as ObjectNode;
      const keys: string[] = [];
      const types: string[] = [];

      for (let i = 0; i < objExpr.properties.length; i++) {
        const prop = objExpr.properties[i] as ObjectProperty;
        const valueType = this.inferExpressionType(prop.value);
        keys.push(prop.key);
        types.push(valueType.llvmType);
      }

      return {
        name: "",
        type: "object",
        llvmType: "i8*",
        schemaKeys: keys,
        schemaTypes: types,
      };
    }

    // Variable reference - look up in symbol table
    if (e.type === "variable") {
      const varExpr = expr as VariableNode;
      if (varExpr.name === "null" || varExpr.name === "undefined") {
        return { name: varExpr.name, type: "null", llvmType: "i8*" };
      }
      const symbol = this.symbols.get(varExpr.name);
      if (!symbol) {
        this.errors.push({
          message: `Reference to undeclared variable '${varExpr.name}'`,
          location: this.currentFunction,
        });
        return {
          name: varExpr.name,
          type: "unknown",
          llvmType: "double",
        };
      }
      return symbol;
    }

    // Method call - special cases
    if (e.type === "method_call") {
      const methodExpr = expr as MethodCallNode;

      const m = methodExpr.method;
      if (
        m === "substr" ||
        m === "substring" ||
        m === "concat" ||
        m === "repeat" ||
        m === "padStart" ||
        m === "charAt" ||
        m === "trim" ||
        m === "trimStart" ||
        m === "trimEnd" ||
        m === "replace" ||
        m === "replaceAll" ||
        m === "toLowerCase" ||
        m === "toUpperCase" ||
        m === "toString" ||
        m === "slice" ||
        m === "join"
      ) {
        return {
          name: "",
          type: "string",
          llvmType: "i8*",
        };
      }

      if (m === "indexOf" || m === "lastIndexOf" || m === "findIndex") {
        return NUMBER_SYMBOL;
      }

      if (
        m === "includes" ||
        m === "startsWith" ||
        m === "endsWith" ||
        m === "has" ||
        m === "every" ||
        m === "some"
      ) {
        return { name: "", type: "boolean", llvmType: "double" };
      }

      if (m === "filter" || m === "map") {
        const objType = this.inferExpressionType(methodExpr.object);
        return objType;
      }

      if (m === "split") {
        return {
          name: "",
          type: "array<string>",
          llvmType: "%StringArray*",
        };
      }

      return {
        name: "",
        type: "unknown",
        llvmType: "double",
      };
    }

    if (e.type === "member_access") {
      const memberExpr = expr as MemberAccessNode;
      const objectType = this.inferExpressionType(memberExpr.object);

      const propType = lookupPropertyType(objectType.type, memberExpr.property);
      if (propType) return propType;

      if (objectType.type === "object" && objectType.schemaKeys) {
        const sKeys = objectType.schemaKeys;
        const sTypes = objectType.schemaTypes || [];
        for (let si = 0; si < sKeys.length; si++) {
          if (sKeys[si] === memberExpr.property) {
            const fieldLlvmType = sTypes[si];
            if (fieldLlvmType === "i8*") return STRING_SYMBOL;
            if (fieldLlvmType === "double") return NUMBER_SYMBOL;
            break;
          }
        }
      }

      return {
        name: "",
        type: "unknown",
        llvmType: "double",
      };
    }

    if (e.type === "template_literal") {
      return {
        name: "",
        type: "string",
        llvmType: "i8*",
      };
    }

    if (
      e.type === "call" ||
      e.type === "new" ||
      e.type === "index_access" ||
      e.type === "arrow_function" ||
      e.type === "type_assertion" ||
      e.type === "await" ||
      e.type === "regex" ||
      e.type === "map" ||
      e.type === "set"
    ) {
      return {
        name: "",
        type: "unknown",
        llvmType: "double",
      };
    }

    if (e.type === "unary") {
      return {
        name: "",
        type: "number",
        llvmType: "double",
      };
    }

    if (e.type === "conditional") {
      return {
        name: "",
        type: "unknown",
        llvmType: "double",
      };
    }

    if (e.type === "binary") {
      const binExpr = expr as BinaryNode;

      if (binExpr.op === "+") {
        const left = this.inferExpressionType(binExpr.left);
        const right = this.inferExpressionType(binExpr.right);

        if (left.llvmType === "i8*" || right.llvmType === "i8*") {
          return {
            name: "",
            type: "string",
            llvmType: "i8*",
          };
        }
      }

      if (binExpr.op === "||" || binExpr.op === "&&") {
        const left = this.inferExpressionType(binExpr.left);
        return left;
      }

      const op = binExpr.op;
      if (
        op === "<" ||
        op === ">" ||
        op === "<=" ||
        op === ">=" ||
        op === "==" ||
        op === "!=" ||
        op === "===" ||
        op === "!=="
      ) {
        return {
          name: "",
          type: "boolean",
          llvmType: "double",
        };
      }

      // Arithmetic operators return number
      return {
        name: "",
        type: "number",
        llvmType: "double",
      };
    }

    // Default to unknown
    return {
      name: "",
      type: "unknown",
      llvmType: "double",
    };
  }

  private blockAlwaysReturns(block: BlockStatement): boolean {
    if (!block || !block.statements) return false;
    for (let i = 0; i < block.statements.length; i++) {
      const stmt = block.statements[i];
      const t = stmt.type;
      if (t === "return" || t === "throw") return true;
      if (t === "if") {
        const ifStmt = stmt as IfStatement;
        if (ifStmt.elseBlock) {
          if (
            this.blockAlwaysReturns(ifStmt.thenBlock) &&
            this.blockAlwaysReturns(ifStmt.elseBlock)
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Format errors for display
   */
  formatErrors(): string {
    let output = "";

    if (this.errors.length > 0) {
      output += "Semantic Analysis Errors:\n\n";

      for (let i = 0; i < this.errors.length; i++) {
        const error = this.errors[i] as AnalysisError;
        output += "  error: " + error.message + "\n";
        if (error.location) {
          output += "    location: " + error.location + "\n";
        }
        if (error.suggestion) {
          output += "    help: " + error.suggestion + "\n";
        }
        output += "\n";
      }
    }

    const diagOutput = this.diagnosticEngine.format();
    if (diagOutput) {
      output += diagOutput;
    }

    return output;
  }

  getDiagnosticEngine(): DiagnosticEngine {
    return this.diagnosticEngine;
  }
}
