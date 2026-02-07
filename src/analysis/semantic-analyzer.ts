import { AST, Expression, FunctionNode, BlockStatement, VariableDeclaration, AssignmentStatement, ClassNode, ArrayNode, ObjectNode, ObjectProperty, MethodCallNode, BinaryNode, VariableNode } from '../ast/types.js';

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
  objectSchema?: Map<string, string>;
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

  private analyzeVariableDeclaration(stmt: VariableDeclaration): void {
    if (!stmt.value) {
      this.symbols.set(stmt.name, {
        name: stmt.name,
        type: 'number',
        llvmType: 'double',
      });
      return;
    }

    const inferredType = this.inferExpressionType(stmt.value, stmt.declaredType);
    const symbolEntry = {
      type: inferredType.type,
      llvmType: inferredType.llvmType,
      name: stmt.name
    };
    this.symbols.set(stmt.name, symbolEntry);
  }

  private analyzeFunction(func: FunctionNode): void {
    this.currentFunction = func.name;

    // Add parameters to symbol table (scoped to function)
    for (let _pi = 0; _pi < func.params.length; _pi++) {
      const param = func.params[_pi];
      this.symbols.set(param, {
        name: param,
        type: 'number',
        llvmType: 'double',
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
        const paramType = method.paramTypes?.[i];

        let llvmType = 'i32';
        let type: SymbolType = 'number';

        if (paramType === 'string') {
          llvmType = 'i8*';
          type = 'string';
        } else if (paramType === 'string[]') {
          llvmType = '%StringArray*';
          type = 'array<string>';
        } else if (paramType === 'number[]' || paramType === 'boolean[]') {
          llvmType = '%Array*';
          type = 'array<number>';
        }

        this.symbols.set(param, {
          name: param,
          type,
          llvmType,
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
      this.errors.push({
        message: `Assignment to undeclared variable '${stmt.name}'`,
        location: this.currentFunction,
      });
      return;
    }

    const valueType = this.inferExpressionType(stmt.value);

    if (varSymbol.llvmType !== valueType.llvmType) {
      this.errors.push({
        message: `Type mismatch: Cannot assign ${valueType.type} to ${varSymbol.type}`,
        location: `${this.currentFunction}: ${stmt.name} = ...`,
        suggestion: `Expected ${varSymbol.llvmType}, got ${valueType.llvmType}`,
      });
    }
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
      const schema = new Map<string, string>();

      for (let i = 0; i < objExpr.properties.length; i++) {
        const prop = objExpr.properties[i] as ObjectProperty;
        const valueType = this.inferExpressionType(prop.value);
        schema.set(prop.key, valueType.llvmType);
      }

      return {
        name: '',
        type: 'object',
        llvmType: 'i8*',
        objectSchema: schema,
      };
    }

    // Variable reference - look up in symbol table
    if (e.type === 'variable') {
      const varExpr = expr as VariableNode;
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

      if (['substr', 'substring', 'concat', 'repeat', 'padStart', 'charAt'].includes(methodExpr.method)) {
        return {
          name: '',
          type: 'string',
          llvmType: 'i8*',
        };
      }

      if (['filter', 'map'].includes(methodExpr.method)) {
        const objType = this.inferExpressionType(methodExpr.object);
        return objType;
      }

      if (methodExpr.method === 'split') {
        return {
          name: '',
          type: 'array<string>',
          llvmType: '%StringArray*',
        };
      }
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

      if (['<', '>', '<=', '>=', '==', '!=', '===', '!=='].includes(binExpr.op)) {
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
      output += `  \x1b[31m•\x1b[0m ${error.message}\n`;
      if (error.location) {
        output += `    \x1b[90mLocation: ${error.location}\x1b[0m\n`;
      }
      if (error.suggestion) {
        output += `    \x1b[36mℹ ${error.suggestion}\x1b[0m\n`;
      }
      output += '\n';
    }

    return output;
  }
}
