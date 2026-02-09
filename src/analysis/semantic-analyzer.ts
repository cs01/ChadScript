import { AST, Expression, FunctionNode, BlockStatement, VariableDeclaration, AssignmentStatement, ClassNode, ArrayNode, ObjectNode, ObjectProperty, MethodCallNode, BinaryNode, VariableNode, MemberAccessNode, IfStatement, WhileStatement, ForStatement, ForOfStatement, TryStatement } from '../ast/types.js';

type SymbolType = 'number' | 'string' | 'boolean' | 'null' | 'undefined' | 'array<number>' | 'array<string>' | 'object' | 'class' | 'unknown';

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

const NUMBER_SYMBOL: TypedSymbol = { name: '', type: 'number', llvmType: 'double' };
const STRING_SYMBOL: TypedSymbol = { name: '', type: 'string', llvmType: 'i8*' };

function lookupPropertyType(typeName: string, property: string): TypedSymbol | null {
  if (typeName === 'string' && property === 'length') return NUMBER_SYMBOL;
  if (typeName === 'array<number>' && property === 'length') return NUMBER_SYMBOL;
  if (typeName === 'array<string>' && property === 'length') return NUMBER_SYMBOL;
  return null;
}

export interface AnalysisError {
  message: string;
  location?: string;
  suggestion?: string;
}

export class SemanticAnalyzer {
  private ast: AST;
  private symbols: Map<string, TypedSymbol> = new Map();
  private errors: AnalysisError[] = [];
  private currentFunction: string = '';

  constructor(ast: AST) {
    this.ast = ast;
  }

  /**
   * Run semantic analysis - returns true if no errors
   */
  analyze(): boolean {
    this.errors = [];

    if (this.ast.enums) {
      for (let _ei = 0; _ei < this.ast.enums.length; _ei++) {
        const enumNode = this.ast.enums[_ei] as { name: string };
        if (enumNode.name) {
          this.symbols.set(enumNode.name, { name: enumNode.name, type: 'object', llvmType: 'i8*' });
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
              this.symbols.set(spec.name, { name: spec.name, type: 'object', llvmType: 'i8*' });
            }
          }
        }
      }
    }

    for (let _si = 0; _si < this.ast.topLevelStatements.length; _si++) {
      const stmt = this.ast.topLevelStatements[_si];
      if (stmt.type === 'variable_declaration') {
        this.analyzeVariableDeclaration(stmt);
      } else if (stmt.type === 'assignment') {
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

  private inferDeclaredType(declaredType: string | undefined): { type: SymbolType; llvmType: string } {
    if (!declaredType) return { type: 'number', llvmType: 'double' };
    if (declaredType === 'string') return { type: 'string', llvmType: 'i8*' };
    if (declaredType === 'number' || declaredType === 'boolean') return { type: 'number', llvmType: 'double' };
    if (declaredType === 'string[]') return { type: 'array<string>', llvmType: '%StringArray*' };
    if (declaredType === 'number[]' || declaredType === 'boolean[]') return { type: 'array<number>', llvmType: '%Array*' };
    if (declaredType.endsWith('| undefined') || declaredType.endsWith('| null')) {
      const baseType = declaredType.split('|')[0].trim();
      return this.inferDeclaredType(baseType);
    }
    return { type: 'unknown', llvmType: 'double' };
  }

  private analyzeVariableDeclaration(stmt: VariableDeclaration): void {
    if (!stmt.value) {
      const inferred = this.inferDeclaredType(stmt.declaredType);
      this.symbols.set(stmt.name, {
        name: stmt.name,
        type: inferred.type,
        llvmType: inferred.llvmType,
      });
      return;
    }

    const inferredType = this.inferExpressionType(stmt.value, stmt.declaredType);
    const symbolEntry = {
      name: stmt.name,
      type: inferredType.type,
      llvmType: inferredType.llvmType,
    };
    this.symbols.set(stmt.name, symbolEntry);
  }

  private analyzeFunction(func: FunctionNode): void {
    this.currentFunction = func.name;

    // Add parameters to symbol table (scoped to function)
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

    // Analyze function body
    this.analyzeBlock(func.body);
  }

  private analyzeClass(classNode: ClassNode): void {
    const classFields = classNode.fields || [];
    for (let _fli = 0; _fli < classFields.length; _fli++) {
      const field = classFields[_fli];
      let llvmType = 'i32';
      let type: SymbolType = 'number';

      if (field.fieldType === 'string') {
        llvmType = 'i8*';
        type = 'string';
      } else if (field.fieldType === 'string[]') {
        llvmType = '%StringArray*';
        type = 'array<string>';
      } else if (field.fieldType === 'number[]' || field.fieldType === 'boolean[]') {
        llvmType = '%Array*';
        type = 'array<number>';
      }

      this.symbols.set(field.name, {
        name: field.name,
        type,
        llvmType,
      });
    }

    const classMethods = classNode.methods || [];
    for (let _mi = 0; _mi < classMethods.length; _mi++) {
      const method = classMethods[_mi];
      this.currentFunction = `${classNode.name}.${method.name}`;

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

  private analyzeBlock(block: BlockStatement): void {
    for (let _bi = 0; _bi < block.statements.length; _bi++) {
      const stmt = block.statements[_bi];
      if (stmt.type === 'variable_declaration') {
        this.analyzeVariableDeclaration(stmt);
      } else if (stmt.type === 'assignment') {
        this.analyzeAssignment(stmt);
      } else if (stmt.type === 'if') {
        const ifStmt = stmt as IfStatement;
        if (ifStmt.thenBlock) this.analyzeBlock(ifStmt.thenBlock);
        if (ifStmt.elseBlock) this.analyzeBlock(ifStmt.elseBlock);
      } else if (stmt.type === 'while') {
        const whileStmt = stmt as WhileStatement;
        if (whileStmt.body) this.analyzeBlock(whileStmt.body);
      } else if (stmt.type === 'for') {
        const forStmt = stmt as ForStatement;
        if (forStmt.init && forStmt.init.type === 'variable_declaration') {
          this.analyzeVariableDeclaration(forStmt.init as VariableDeclaration);
        }
        if (forStmt.body) this.analyzeBlock(forStmt.body);
      } else if (stmt.type === 'for_of') {
        const forOfStmt = stmt as ForOfStatement;
        if (forOfStmt.body) this.analyzeBlock(forOfStmt.body);
      } else if (stmt.type === 'try') {
        const tryStmt = stmt as TryStatement;
        if (tryStmt.tryBlock) this.analyzeBlock(tryStmt.tryBlock);
        if (tryStmt.catchClause && tryStmt.catchClause.body) this.analyzeBlock(tryStmt.catchClause.body);
        if (tryStmt.finallyBlock) this.analyzeBlock(tryStmt.finallyBlock);
      }
    }
  }

  private analyzeAssignment(stmt: AssignmentStatement): void {
    if (stmt.name.startsWith('__member_access__')) {
      this.inferExpressionType(stmt.value);
      return;
    }

    const varSymbol = this.symbols.get(stmt.name);
    if (!varSymbol) {
      return;
    }

    const valueType = this.inferExpressionType(stmt.value);

    if (varSymbol.llvmType !== valueType.llvmType && varSymbol.type !== 'null' && valueType.type !== 'null' && varSymbol.type !== 'unknown' && valueType.type !== 'unknown' && !this.areAssignmentCompatible(varSymbol, valueType)) {
      this.errors.push({
        message: `Type mismatch: Cannot assign ${valueType.type} to ${varSymbol.type}`,
        location: `${this.currentFunction}: ${stmt.name} = ...`,
        suggestion: `Expected ${varSymbol.llvmType}, got ${valueType.llvmType}`,
      });
    }
  }

  private areAssignmentCompatible(target: TypedSymbol, value: TypedSymbol): boolean {
    if (target.type === 'array<string>' && value.type === 'array<number>') return true;
    if (target.type === 'array<number>' && value.type === 'array<string>') return true;
    if (target.type === 'object' || value.type === 'object') return true;
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
    if (e.type === 'string') {
      return {
        name: '',
        type: 'string',
        llvmType: 'i8*',
      };
    }

    // Number literal
    if (e.type === 'number') {
      return {
        name: '',
        type: 'number',
        llvmType: 'double',
      };
    }

    // Boolean literal
    if (e.type === 'boolean') {
      return {
        name: '',
        type: 'boolean',
        llvmType: 'double',
      };
    }

    // Null literal
    if (e.type === 'null') {
      return {
        name: '',
        type: 'null',
        llvmType: 'i8*',
      };
    }

    // Undefined literal
    if (e.type === 'undefined') {
      return {
        name: '',
        type: 'undefined',
        llvmType: 'i8*',
      };
    }

    // Array literal - VALIDATE HOMOGENEITY HERE
    if (e.type === 'array') {
      const arrayExpr = expr as ArrayNode;
      const elements = arrayExpr.elements || [];

      if (elements.length === 0) {
        if (declaredType === 'string[]') {
          return {
            name: '',
            type: 'array<string>',
            llvmType: '%StringArray*',
          };
        } else if (declaredType === 'number[]' || declaredType === 'boolean[]') {
          return {
            name: '',
            type: 'array<number>',
            llvmType: '%Array*',
          };
        }

        return {
          name: '',
          type: 'array<number>',
          llvmType: '%Array*',
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
            name: '',
            type: 'unknown',
            llvmType: 'double',
          };
        }
      }

      if (firstType.llvmType === 'i8*') {
        return {
          name: '',
          type: 'array<string>',
          llvmType: '%StringArray*',
        };
      } else {
        return {
          name: '',
          type: 'array<number>',
          llvmType: '%Array*',
        };
      }
    }

    if (e.type === 'object') {
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
        name: '',
        type: 'object',
        llvmType: 'i8*',
        schemaKeys: keys,
        schemaTypes: types,
      };
    }

    // Variable reference - look up in symbol table
    if (e.type === 'variable') {
      const varExpr = expr as VariableNode;
      if (varExpr.name === 'null' || varExpr.name === 'undefined') {
        return { name: varExpr.name, type: 'null', llvmType: 'i8*' };
      }
      const symbol = this.symbols.get(varExpr.name);
      if (!symbol) {
        this.errors.push({
          message: `Reference to undeclared variable '${varExpr.name}'`,
          location: this.currentFunction,
        });
        return {
          name: varExpr.name,
          type: 'unknown',
          llvmType: 'double',
        };
      }
      return symbol;
    }

    // Method call - special cases
    if (e.type === 'method_call') {
      const methodExpr = expr as MethodCallNode;

      const m = methodExpr.method;
      if (m === 'substr' || m === 'substring' || m === 'concat' || m === 'repeat' || m === 'padStart' || m === 'charAt' || m === 'trim' || m === 'trimStart' || m === 'trimEnd' || m === 'replace' || m === 'replaceAll' || m === 'toLowerCase' || m === 'toUpperCase' || m === 'toString' || m === 'slice' || m === 'join') {
        return {
          name: '',
          type: 'string',
          llvmType: 'i8*',
        };
      }

      if (m === 'indexOf' || m === 'lastIndexOf' || m === 'findIndex') {
        return NUMBER_SYMBOL;
      }

      if (m === 'includes' || m === 'startsWith' || m === 'endsWith' || m === 'has' || m === 'every' || m === 'some') {
        return { name: '', type: 'boolean', llvmType: 'double' };
      }

      if (m === 'filter' || m === 'map') {
        const objType = this.inferExpressionType(methodExpr.object);
        return objType;
      }

      if (m === 'split') {
        return {
          name: '',
          type: 'array<string>',
          llvmType: '%StringArray*',
        };
      }

      return {
        name: '',
        type: 'unknown',
        llvmType: 'double',
      };
    }

    if (e.type === 'member_access') {
      const memberExpr = expr as MemberAccessNode;
      const objectType = this.inferExpressionType(memberExpr.object);

      const propType = lookupPropertyType(objectType.type, memberExpr.property);
      if (propType) return propType;

      if (objectType.type === 'object' && objectType.schemaKeys) {
        const sKeys = objectType.schemaKeys;
        const sTypes = objectType.schemaTypes || [];
        for (let si = 0; si < sKeys.length; si++) {
          if (sKeys[si] === memberExpr.property) {
            const fieldLlvmType = sTypes[si];
            if (fieldLlvmType === 'i8*') return STRING_SYMBOL;
            if (fieldLlvmType === 'double') return NUMBER_SYMBOL;
            break;
          }
        }
      }

      return {
        name: '',
        type: 'unknown',
        llvmType: 'double',
      };
    }

    if (e.type === 'template_literal') {
      return {
        name: '',
        type: 'string',
        llvmType: 'i8*',
      };
    }

    if (e.type === 'binary') {
      const binExpr = expr as BinaryNode;

      if (binExpr.op === '+') {
        const left = this.inferExpressionType(binExpr.left);
        const right = this.inferExpressionType(binExpr.right);

        if (left.llvmType === 'i8*' || right.llvmType === 'i8*') {
          return {
            name: '',
            type: 'string',
            llvmType: 'i8*',
          };
        }
      }

      if (binExpr.op === '||' || binExpr.op === '&&') {
        const left = this.inferExpressionType(binExpr.left);
        return left;
      }

      const op = binExpr.op;
      if (op === '<' || op === '>' || op === '<=' || op === '>=' || op === '==' || op === '!=' || op === '===' || op === '!==') {
        return {
          name: '',
          type: 'boolean',
          llvmType: 'double',
        };
      }

      // Arithmetic operators return number
      return {
        name: '',
        type: 'number',
        llvmType: 'double',
      };
    }

    // Default to unknown
    return {
      name: '',
      type: 'unknown',
      llvmType: 'double',
    };
  }

  /**
   * Format errors for display
   */
  formatErrors(): string {
    if (this.errors.length === 0) {
      return '';
    }

    let output = '\x1b[31m\x1b[1m✗ Semantic Analysis Errors:\x1b[0m\n\n';

    for (let i = 0; i < this.errors.length; i++) {
      const error = this.errors[i] as AnalysisError;
      output += `  \x1b[31m•\x1b[0m ${error.message}` + '\n';
      if (error.location) {
        output += `    \x1b[90mLocation: ${error.location}\x1b[0m` + '\n';
      }
      if (error.suggestion) {
        output += `    \x1b[36mℹ ${error.suggestion}\x1b[0m` + '\n';
      }
      output += '\n';
    }

    return output;
  }
}
