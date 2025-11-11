import { AST, Expression, FunctionNode, BlockStatement } from '../ast/types.js';

/**
 * Semantic Analyzer - Pre-codegen type validation
 * 
 * Validates types BEFORE codegen to catch errors early with better error messages.
 * Builds a symbol table with inferred types for all variables.
 */

export interface TypedSymbol {
  name: string;
  type: 'number' | 'string' | 'boolean' | 'array<number>' | 'array<string>' | 'object' | 'class' | 'unknown';
  llvmType: string;
  objectSchema?: { [key: string]: string }; // For objects: field name -> LLVM type
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

    // Analyze top-level variables
    for (const stmt of this.ast.topLevelStatements) {
      this.analyzeVariableDeclaration(stmt);
    }

    // Analyze functions
    for (const func of this.ast.functions) {
      this.analyzeFunction(func);
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

  private analyzeVariableDeclaration(stmt: any): void {
    if (!stmt.value) {
      // Uninitialized variable defaults to number
      this.symbols.set(stmt.name, {
        name: stmt.name,
        type: 'number',
        llvmType: 'i32',
      });
      return;
    }

    const inferredType = this.inferExpressionType(stmt.value);
    this.symbols.set(stmt.name, inferredType);
  }

  private analyzeFunction(func: FunctionNode): void {
    this.currentFunction = func.name;

    // Add parameters to symbol table (scoped to function)
    for (const param of func.params) {
      // Default to number unless TypeScript types tell us otherwise
      this.symbols.set(param, {
        name: param,
        type: 'number',
        llvmType: 'i32',
      });
    }

    // Analyze function body
    this.analyzeBlock(func.body);
  }

  private analyzeBlock(block: BlockStatement): void {
    for (const stmt of block.statements) {
      if (stmt.type === 'variable_declaration') {
        this.analyzeVariableDeclaration(stmt);
      } else if (stmt.type === 'assignment') {
        this.analyzeAssignment(stmt);
      }
      // Add more statement types as needed
    }
  }

  private analyzeAssignment(stmt: any): void {
    const varSymbol = this.symbols.get(stmt.name);
    if (!varSymbol) {
      this.errors.push({
        message: `Assignment to undeclared variable '${stmt.name}'`,
        location: this.currentFunction,
      });
      return;
    }

    const valueType = this.inferExpressionType(stmt.value);

    // Check type compatibility
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
   */
  private inferExpressionType(expr: Expression): TypedSymbol {
    // String literal
    if (expr.type === 'string') {
      return {
        name: '',
        type: 'string',
        llvmType: 'i8*',
      };
    }

    // Number literal
    if (expr.type === 'number') {
      return {
        name: '',
        type: 'number',
        llvmType: 'i32',
      };
    }

    // Boolean literal
    if (expr.type === 'boolean') {
      return {
        name: '',
        type: 'boolean',
        llvmType: 'i32',
      };
    }

    // Array literal - VALIDATE HOMOGENEITY HERE
    if (expr.type === 'array') {
      const elements = (expr as any).elements || [];
      
      if (elements.length === 0) {
        // Empty array - default to number array
        return {
          name: '',
          type: 'array<number>',
          llvmType: '%Array*',
        };
      }

      // Check first element type
      const firstType = this.inferExpressionType(elements[0]);
      
      // Validate ALL elements match
      for (let i = 1; i < elements.length; i++) {
        const elemType = this.inferExpressionType(elements[i]);
        
        if (elemType.llvmType !== firstType.llvmType) {
          this.errors.push({
            message: `Mixed array types: element 0 is ${firstType.type}, element ${i} is ${elemType.type}`,
            location: this.currentFunction,
            suggestion: `Arrays must be homogeneous. Use all ${firstType.type}s or all ${elemType.type}s.`,
          });
          
          // Return error type but continue analysis
          return {
            name: '',
            type: 'unknown',
            llvmType: 'i32',
          };
        }
      }

      // All elements match - return appropriate array type
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

    // Object literal - VALIDATE STATICALLY KNOWN STRUCTURE
    if ((expr as any).type === 'object') {
      const objExpr = expr as any;
      const schema: { [key: string]: string } = {};

      for (const prop of objExpr.properties) {
        const valueType = this.inferExpressionType(prop.value);
        schema[prop.key] = valueType.llvmType;
      }

      return {
        name: '',
        type: 'object',
        llvmType: 'i8*',
        objectSchema: schema,
      };
    }

    // Variable reference - look up in symbol table
    if (expr.type === 'variable') {
      const symbol = this.symbols.get(expr.name);
      if (!symbol) {
        this.errors.push({
          message: `Reference to undeclared variable '${expr.name}'`,
          location: this.currentFunction,
        });
        return {
          name: expr.name,
          type: 'unknown',
          llvmType: 'i32',
        };
      }
      return symbol;
    }

    // Method call - special cases
    if (expr.type === 'method_call') {
      const methodExpr = expr as any;
      
      // String methods return string
      if (['substr', 'substring', 'concat', 'repeat', 'padStart', 'charAt'].includes(methodExpr.method)) {
        return {
          name: '',
          type: 'string',
          llvmType: 'i8*',
        };
      }

      // Array.filter/map return arrays
      if (['filter', 'map'].includes(methodExpr.method)) {
        const objType = this.inferExpressionType(methodExpr.object);
        return objType; // Same type as input array
      }

      // String.split returns string array
      if (methodExpr.method === 'split') {
        return {
          name: '',
          type: 'array<string>',
          llvmType: '%StringArray*',
        };
      }
    }

    // Binary expressions
    if (expr.type === 'binary') {
      const binExpr = expr as any;
      
      // String concatenation
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

      // Comparison operators return boolean
      if (['<', '>', '<=', '>=', '==', '!=', '===', '!=='].includes(binExpr.op)) {
        return {
          name: '',
          type: 'boolean',
          llvmType: 'i32',
        };
      }

      // Arithmetic operators return number
      return {
        name: '',
        type: 'number',
        llvmType: 'i32',
      };
    }

    // Default to unknown
    return {
      name: '',
      type: 'unknown',
      llvmType: 'i32',
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

    for (const error of this.errors) {
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
