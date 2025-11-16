import { AST, Expression, FunctionNode, CallNode, MethodCallNode, BlockStatement, Statement, VariableDeclaration, AssignmentStatement, IfStatement, WhileStatement, ForStatement, ImportDeclaration, ExportDeclaration, ObjectNode, ArrayNode, MapNode, SetNode, ClassNode, ClassMethod, NewNode, ThisNode, SuperNode, TemplateLiteralNode, ArrowFunctionNode, StringNode } from '../ast/types.js';
import { logger } from '../utils/logger.js';
import { formatUnsupportedFeatureError, isUnsupportedKeyword } from './unsupported-features.js';

// ============================================
// PARSER
// ============================================

export class Parser {
  private code: string;
  private filename: string;
  private pos = 0;
  private functions: FunctionNode[] = [];
  private classes: ClassNode[] = [];
  private imports: ImportDeclaration[] = [];
  private exports: ExportDeclaration[] = [];
  private topLevelStatements: VariableDeclaration[] = [];
  private topLevelExpressions: (CallNode | NewNode | MethodCallNode)[] = [];

  constructor(code: string, filename: string = '<input>') {
    this.code = code;
    this.filename = filename;
  }

  private formatError(message: string, position?: number, options?: {
    help?: string;
    note?: string;
    suggestion?: string;
    contextLines?: number;
  }): string {
    const pos = position !== undefined ? position : this.pos;
    const lines = this.code.substring(0, pos).split('\n');
    const lineNum = lines.length;
    const col = lines[lines.length - 1].length;

    // Get all lines for multi-line context
    const allLines = this.code.split('\n');

    // Build the error message (ANSI codes inlined for bootstrap compatibility)
    // Format like clang: filename:line:col: error: message
    const lineNumStr = String(lineNum);
    const lineNumWidth = lineNumStr.length > 2 ? lineNumStr.length : 2;

    // Use the original terse message on the first line (like clang)
    const line1 = `${this.filename}:${lineNum}:${col + 1}: \x1b[31m\x1b[1merror:\x1b[0m ${message}\n`;
    const line2 = `\x1b[36m\x1b[1m${' '.repeat(lineNumWidth)} |\x1b[0m\n`;

    // Multi-line context (#4)
    let contextOutput = '';
    const numContextLines = options?.contextLines || 1;
    const startLine = Math.max(1, lineNum - numContextLines);
    const endLine = Math.min(allLines.length, lineNum + numContextLines);

    for (let i = startLine; i <= endLine; i++) {
      const currentLineContent = allLines[i - 1] || '';
      const currentLineNumStr = String(i);
      contextOutput += `\x1b[36m\x1b[1m${currentLineNumStr.padStart(lineNumWidth)} |\x1b[0m ${currentLineContent}\n`;

      // Add the caret on the error line
      if (i === lineNum) {
        contextOutput += `\x1b[36m\x1b[1m${' '.repeat(lineNumWidth)} |\x1b[0m ${' '.repeat(col)}\x1b[31m\x1b[1m^\x1b[0m \x1b[31mhere\x1b[0m\n`;
      }
    }

    let result = line1.concat(line2, contextOutput);

    // Add suggestion (#5 - "Did you mean?")
    if (options?.suggestion) {
      result += `\x1b[36m\x1b[1m${' '.repeat(lineNumWidth)} |\x1b[0m\n`;
      result += `\x1b[36mFix:\x1b[0m ${options.suggestion}\n`;
    }

    // Add note
    if (options?.note) {
      result += `\x1b[36mNote:\x1b[0m ${options.note}\n`;
    }

    return result;
  }

  /**
   * Main entry point for parsing. Converts source code to Abstract Syntax Tree.
   * Uses recursive descent parsing with operator precedence climbing.
   *
   * @example
   * Input: "function add(a, b) { return a + b; }"
   *
   * Output:
   * {
   *   imports: [],
   *   exports: [],
   *   functions: [{
   *     type: 'function',
   *     name: 'add',
   *     params: ['a', 'b'],
   *     body: {
   *       statements: [{
   *         type: 'return',
   *         value: { type: 'binary', op: '+', left: {...}, right: {...} }
   *       }]
   *     }
   *   }],
   *   classes: [],
   *   topLevelStatements: [],
   *   topLevelExpressions: []
   * }
   *
   * @returns Complete AST for the entire source file
   * @throws Error with formatted error message if syntax is invalid
   */
  parse(): AST {
    // Skip shebang if present at start of file
    if (this.pos === 0 && this.code.startsWith('#!')) {
      while (this.pos < this.code.length && this.code[this.pos] !== '\n') {
        this.pos++;
      }
      if (this.code[this.pos] === '\n') {
        this.pos++;
      }
    }

    let lastPos = -1;
    let samePositionCount = 0;

    while (this.pos < this.code.length) {
      this.skipWhitespace();
      if (this.pos >= this.code.length) break;

      // Detect infinite loop - if we're stuck at same position
      if (this.pos === lastPos) {
        samePositionCount++;
        if (samePositionCount > 2) {
          const endPos = this.pos + 50 < this.code.length ? this.pos + 50 : this.code.length;
          const preview = this.code.substring(this.pos, endPos);
          const lines = this.code.substring(0, this.pos).split('\n');
          const line = lines.length;
          const col = lines[lines.length - 1].length + 1;
          throw new Error(
            `Parser stuck at line ${line}, column ${col}:\n` +
            `  ${preview.split('\n')[0]}\n` +
            `\nChadScript only supports a subset of JavaScript.\n` +
            `TypeScript syntax (type annotations, interfaces, etc.) is not supported.`
          );
        }
      } else {
        samePositionCount = 0;
      }
      lastPos = this.pos;

      if (this.match('import')) {
        this.parseImport();
      } else if (this.match('export')) {
        this.parseExport();
      } else if (this.match('interface')) {
        this.parseInterface();
      } else if (this.match('class')) {
        this.parseClass();
      } else if (this.match('async')) {
        // Check for async function/arrow - NOT SUPPORTED!
        throw new Error(formatUnsupportedFeatureError('async'));
      } else if (this.match('function')) {
        this.parseFunction();
      } else if (this.match('let') || this.match('const') || this.match('var')) {
        // Parse variable declaration at top level
        const savedPos = this.pos - (this.code[this.pos - 3] === 'l' ? 3 : (this.code[this.pos - 3] === 'v' ? 3 : 5));
        this.pos = savedPos;
        const varDecl = this.parseVariableDeclaration();
        // Store top-level variable declarations in AST
        this.topLevelStatements.push(varDecl);
        // Skip the semicolon if present
        this.skipWhitespace();
        if (this.code[this.pos] === ';') {
          this.pos++;
        }
      } else if (this.match('//')) {
        this.skipComment();
      } else if (this.match('if')) {
        // Parse top-level if statement (but don't store it - just skip it)
        // match('if') already consumed 'if', so we're positioned at the '('
        this.parseIfStatement();
      } else if (this.match('try')) {
        // Parse top-level try-catch (but don't store it - just skip it)
        // match('try') already consumed 'try', so we're positioned at the '{'
        this.parseTryStatement();
      } else {
        // Try to parse as function call, new expression, or method call (entry point)
        const savedPos = this.pos;
        // Try to parse as an expression (could be new, call, method call, etc.)
        try {
          const expr = this.parseExpression();
          this.skipWhitespace();
          if (this.code[this.pos] === ';') {
            this.pos++; // consume semicolon
          }
          // Add to top-level expressions if it's a call, new, or method call
          if (expr.type === 'call' || expr.type === 'new' || expr.type === 'method_call') {
            this.topLevelExpressions.push(expr as any);
          }
        } catch (e) {
          // Re-throw intentional errors for unsupported features
          const errorMsg = (e as Error).message;
          if (errorMsg && errorMsg.includes('is not supported in ChadScript')) {
            throw e;
          }
          // If parsing fails and position hasn't advanced, show error to avoid infinite loop
          if (this.pos === savedPos) {
            const msg = this.formatError('Unexpected token') +
              `\n\x1b[2mChadScript only supports a subset of JavaScript.\x1b[0m\n` +
              `\x1b[2mTypeScript syntax (type annotations, interfaces, etc.) is not supported.\x1b[0m`;
            throw new Error(msg);
          }
        }
      }
    }

    return {
      imports: this.imports,
      functions: this.functions,
      classes: this.classes,
      exports: this.exports,
      topLevelStatements: this.topLevelStatements,
      topLevelExpressions: this.topLevelExpressions
    };
  }

  private skipWhitespace(): void {
    while (this.pos < this.code.length) {
      if (/\s/.test(this.code[this.pos])) {
        this.pos++;
      } else if (this.code[this.pos] === '/' && this.code[this.pos + 1] === '/') {
        // Skip inline comment
        this.pos += 2;
        while (this.pos < this.code.length && this.code[this.pos] !== '\n') {
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  private skipComment(): void {
    while (this.pos < this.code.length && this.code[this.pos] !== '\n') {
      this.pos++;
    }
  }

  private match(str: string): boolean {
    this.skipWhitespace();
    if (this.code.substr(this.pos, str.length) === str) {
      // Check if it's a complete word (not part of a larger identifier)
      // Only do this check for alphabetic strings (keywords), not punctuation
      if (/[a-zA-Z]/.test(str[0])) {
        const nextChar = this.code[this.pos + str.length];
        if (nextChar && /[a-zA-Z0-9_]/.test(nextChar)) {
          return false;
        }
      }
      this.pos += str.length;
      return true;
    }
    return false;
  }

  private expect(str: string): void {
    if (!this.match(str)) {
      // Add helpful suggestions for common cases
      let options: { help?: string; note?: string; suggestion?: string; contextLines?: number } = { contextLines: 1 };

      if (str === ';') {
        // Check what we found instead
        this.skipWhitespace();
        const nextChar = this.code[this.pos];

        if (nextChar && /[a-zA-Z]/.test(nextChar)) {
          options.help = "Statement must end with a semicolon";
          options.suggestion = `Add ';' at the end of the previous line`;
        } else {
          options.help = "Semicolon required after statement";
        }
      } else if (str === '{') {
        options.help = "Opening brace '{' required here";
        options.note = "ChadScript requires braces for function bodies and blocks";
      } else if (str === '}') {
        options.help = "Closing brace '}' required to end block";
      } else if (str === '(') {
        options.help = "Opening parenthesis '(' required here";
      } else if (str === ')') {
        options.help = "Closing parenthesis ')' required here";
        options.note = "Check that all parentheses are balanced";
      }

      throw new Error(this.formatError(`Expected '${str}'`, undefined, options));
    }
  }

  private parseIdentifier(): string {
    this.skipWhitespace();
    let name = '';
    while (this.pos < this.code.length && /[a-zA-Z0-9_]/.test(this.code[this.pos])) {
      name += this.code[this.pos++];
    }
    return name;
  }

  private parseNumber(): number {
    this.skipWhitespace();
    let num = '';
    // Support integers and decimals
    while (this.pos < this.code.length && /[0-9.]/.test(this.code[this.pos])) {
      num += this.code[this.pos++];
    }
    return parseFloat(num);
  }

  private parseTypeAnnotation(): 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | null {
    // Parse TypeScript type annotation and return the type
    // Returns null for unsupported/unknown types
    this.skipWhitespace();

    // Check for simple types
    if (this.match('string')) {
      this.skipWhitespace();
      if (this.code[this.pos] === '[' && this.code[this.pos + 1] === ']') {
        this.pos += 2;  // consume '[]'
        return 'string[]';
      }
      return 'string';
    } else if (this.match('number')) {
      this.skipWhitespace();
      if (this.code[this.pos] === '[' && this.code[this.pos + 1] === ']') {
        this.pos += 2;  // consume '[]'
        return 'number[]';
      }
      return 'number';
    } else if (this.match('boolean')) {
      this.skipWhitespace();
      if (this.code[this.pos] === '[' && this.code[this.pos + 1] === ']') {
        this.pos += 2;  // consume '[]'
        return 'boolean[]';
      }
      return 'boolean';
    } else if (this.match('void')) {
      return 'void';
    }

    // For any other type, skip it and return null
    this.skipTypeAnnotation();
    return null;
  }

  private skipTypeAnnotation(): void {
    // Skip TypeScript type annotations
    // Handles: identifier, union (|), intersection (&), arrays ([]), generics (<...>)
    this.skipWhitespace();

    // Skip identifier or qualified name
    if (/[a-zA-Z_]/.test(this.code[this.pos])) {
      this.parseIdentifier();
      // Skip generic parameters if present (e.g., Array<string>)
      this.skipWhitespace();
      if (this.code[this.pos] === '<') {
        this.pos++; // consume '<'
        this.skipTypeAnnotation(); // recursive for generic type
        this.skipWhitespace();
        while (this.code[this.pos] === ',') {
          this.pos++;
          this.skipWhitespace();
          this.skipTypeAnnotation();
        }
        this.skipWhitespace();
        if (this.code[this.pos] === '>') {
          this.pos++; // consume '>'
        }
      }
      // Skip array brackets if present (e.g., string[])
      this.skipWhitespace();
      while (this.code[this.pos] === '[') {
        this.pos++;
        this.skipWhitespace();
        if (this.code[this.pos] === ']') {
          this.pos++;
        }
      }
    }

    // Skip union/intersection types
    this.skipWhitespace();
    while (this.code[this.pos] === '|' || this.code[this.pos] === '&') {
      this.pos++;
      this.skipWhitespace();
      if (/[a-zA-Z_]/.test(this.code[this.pos])) {
        this.parseIdentifier();
      }
      this.skipWhitespace();
    }
  }

  private parseInterface(): void {
    // Skip interface declarations (they're TypeScript-only and generate no runtime code)
    // interface Point { x: number; y: number; }
    const name = this.parseIdentifier();
    this.expect('{');

    // Skip everything inside the interface until the closing brace
    let braceDepth = 1;
    while (this.pos < this.code.length && braceDepth > 0) {
      this.skipWhitespace();
      if (this.code[this.pos] === '{') {
        braceDepth++;
        this.pos++;
      } else if (this.code[this.pos] === '}') {
        braceDepth--;
        this.pos++;
      } else if (this.code[this.pos] === ';') {
        // Skip property declarations with semicolons
        this.pos++;
      } else if (this.code[this.pos] === ':') {
        // Skip type annotations
        this.pos++;
        this.skipWhitespace();
        this.skipTypeAnnotation();
      } else {
        // Skip any other character (identifiers, keywords, etc.)
        this.pos++;
      }
    }
  }

  /**
   * Parses a function declaration.
   * Handles parameter lists with optional TypeScript type annotations and return types.
   *
   * @example
   * Input: "function add(a, b) { return a + b; }"
   * Output: Adds to this.functions:
   * {
   *   name: 'add',
   *   params: ['a', 'b'],
   *   body: {
   *     type: 'block',
   *     statements: [{
   *       type: 'return',
   *       value: { type: 'binary', op: '+', left: {...}, right: {...} }
   *     }]
   *   }
   * }
   *
   * @example
   * Input: "function greet(name: string): string { return name; }"
   * Output: Same structure, TypeScript annotations are skipped during parsing
   */
  private parseFunction(): void {
    const name = this.parseIdentifier();
    this.expect('(');

    // Parse parameters
    const params: string[] = [];
    this.skipWhitespace();
    if (this.code[this.pos] !== ')') {
      const paramName = this.parseIdentifier();
      // Skip TypeScript type annotation if present (e.g., ": string")
      this.skipWhitespace();
      if (this.code[this.pos] === ':') {
        this.pos++; // consume ':'
        this.skipWhitespace();
        // Skip the type (could be identifier, union, etc.)
        this.skipTypeAnnotation();
      }
      params.push(paramName);
      while (this.match(',')) {
        this.skipWhitespace();
        const nextParamName = this.parseIdentifier();
        // Skip type annotation
        this.skipWhitespace();
        if (this.code[this.pos] === ':') {
          this.pos++; // consume ':'
          this.skipWhitespace();
          this.skipTypeAnnotation();
        }
        params.push(nextParamName);
      }
    }
    this.expect(')');

    // Skip return type annotation if present (e.g., ": number")
    this.skipWhitespace();
    if (this.code[this.pos] === ':') {
      this.pos++; // consume ':'
      this.skipWhitespace();
      this.skipTypeAnnotation();
    }

    this.expect('{');

    // Parse body as block statement
    const body = this.parseBlock();
    this.expect('}');

    this.functions.push({ name, params, body });
  }

  /**
   * Parses a class declaration with fields, methods, and optional inheritance.
   * Supports TypeScript-style field declarations with type annotations.
   *
   * @example
   * Input:
   * class Counter {
   *   value: number;
   *   constructor(initial: number) { this.value = initial; }
   *   increment() { this.value = this.value + 1; }
   *   getValue(): number { return this.value; }
   * }
   *
   * Output: Adds to this.classes:
   * {
   *   name: 'Counter',
   *   extends: undefined,
   *   fields: [{ name: 'value', fieldType: 'double' }],
   *   methods: [
   *     { type: 'method', name: 'constructor', params: ['initial'], body: {...}, isConstructor: true },
   *     { type: 'method', name: 'increment', params: [], body: {...}, isConstructor: false },
   *     { type: 'method', name: 'getValue', params: [], body: {...}, isConstructor: false }
   *   ]
   * }
   *
   * @example
   * Input: "class Dog extends Animal { name: string; }"
   * Output: Same structure with extends: 'Animal'
   */
  private parseClass(): void {
    const className = this.parseIdentifier();

    // Check for extends
    let extendsClass: string | undefined;
    this.skipWhitespace();
    if (this.match('extends')) {
      extendsClass = this.parseIdentifier();
    }

    this.expect('{');

    const fields: { name: string; fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' }[] = [];
    const methods: ClassMethod[] = [];

    while (true) {
      this.skipWhitespace();
      if (this.code[this.pos] === '}') {
        break;
      }

      // Try to parse field declaration first (e.g., "name: string;")
      const savedPos = this.pos;
      const identifier = this.parseIdentifier();
      this.skipWhitespace();

      // Check if this is a field declaration with type annotation
      if (this.code[this.pos] === ':') {
        this.pos++; // consume ':'
        this.skipWhitespace();

        // Parse type
        let fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' = 'double';

        if (this.match('string')) {
          // Check if it's an array type (string[])
          this.skipWhitespace();
          if (this.code[this.pos] === '[' && this.code[this.pos + 1] === ']') {
            this.pos += 2; // consume '[]'
            fieldType = 'string[]';
          } else {
            fieldType = 'string';
          }
        } else if (this.match('number')) {
          // Check if it's an array type (number[])
          this.skipWhitespace();
          if (this.code[this.pos] === '[' && this.code[this.pos + 1] === ']') {
            this.pos += 2; // consume '[]'
            fieldType = 'number[]';
          } else {
            fieldType = 'double';
          }
        } else if (this.match('boolean')) {
          // Check if it's an array type (boolean[])
          this.skipWhitespace();
          if (this.code[this.pos] === '[' && this.code[this.pos + 1] === ']') {
            this.pos += 2; // consume '[]'
            fieldType = 'boolean[]';
          } else {
            throw new Error(this.formatError(`boolean fields are not supported yet. Only string, number, and their array types are supported.`));
          }
        } else {
          throw new Error(this.formatError(`Unsupported field type. Supported types: string, number, string[], number[], boolean[]`));
        }

        this.skipWhitespace();
        this.expect(';');

        fields.push({ name: identifier, fieldType });
        continue;
      }

      // Not a field declaration, restore position and parse as method
      this.pos = savedPos;

      // Parse method or constructor
      const isConstructor = this.match('constructor');
      let methodName: string;

      if (isConstructor) {
        methodName = 'constructor';
      } else {
        methodName = this.parseIdentifier();
      }

      this.expect('(');

      // Parse parameters
      const params: string[] = [];
      const paramTypes: ('string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void')[] = [];
      this.skipWhitespace();
      if (this.code[this.pos] !== ')') {
        const paramName = this.parseIdentifier();
        // Parse TypeScript type annotation if present (e.g., ": string")
        let paramType: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | null = null;
        this.skipWhitespace();
        if (this.code[this.pos] === ':') {
          this.pos++; // consume ':'
          this.skipWhitespace();
          paramType = this.parseTypeAnnotation();
        }
        params.push(paramName);
        if (paramType) paramTypes.push(paramType);

        while (this.match(',')) {
          this.skipWhitespace();
          const nextParamName = this.parseIdentifier();
          // Parse type annotation
          let nextParamType: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | null = null;
          this.skipWhitespace();
          if (this.code[this.pos] === ':') {
            this.pos++; // consume ':'
            this.skipWhitespace();
            nextParamType = this.parseTypeAnnotation();
          }
          params.push(nextParamName);
          if (nextParamType) paramTypes.push(nextParamType);
        }
      }
      this.expect(')');
      // Parse return type annotation if present (e.g., ": string")
      let returnType: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | null = null;
      this.skipWhitespace();
      if (this.code[this.pos] === ':') {
        this.pos++; // consume ':'
        this.skipWhitespace();
        returnType = this.parseTypeAnnotation();
      }
      this.expect('{');

      // Parse body
      const body = this.parseBlock();
      this.expect('}');

      methods.push({
        type: 'method',
        name: methodName,
        params,
        paramTypes: paramTypes.length > 0 ? paramTypes : undefined,
        returnType: returnType || undefined,
        body,
        isConstructor
      });
    }

    this.expect('}');
    this.classes.push({ name: className, extends: extendsClass, fields, methods });
  }

  private parseBlock(): BlockStatement {
    const statements: Statement[] = [];

    while (true) {
      this.skipWhitespace();
      if (this.code[this.pos] === '}') {
        break;
      }

      // Skip comments
      if (this.match('//')) {
        this.skipComment();
        continue;
      }

      const stmt = this.parseStatement();
      statements.push(stmt);
    }

    return { type: 'block', statements };
  }

  /**
   * Parses a single statement (variable declaration, control flow, expression, etc.).
   * Dispatches to specific parsing functions based on keyword or structure.
   *
   * @example
   * // Variable declaration
   * Input: "let x = 5;"
   * Output: { type: 'variable_declaration', kind: 'let', name: 'x',
   *           value: { type: 'number', value: 5 }}
   *
   * @example
   * // Return statement
   * Input: "return x + 1;"
   * Output: { type: 'return', value: { type: 'binary', op: '+', ... }}
   *
   * @example
   * // If statement
   * Input: "if (x > 0) { return 1; }"
   * Output: { type: 'if', condition: ..., thenBranch: ..., elseBranch: null }
   *
   * @returns Statement AST node
   */
  private parseStatement(): Statement {
    this.skipWhitespace();

    // Variable declaration
    if (this.match('let') || this.match('const') || this.match('var')) {
      const savedPos = this.pos - (this.code[this.pos - 3] === 'l' ? 3 : (this.code[this.pos - 3] === 'v' ? 3 : 5));
      this.pos = savedPos;
      return this.parseVariableDeclaration();
    }

    // Return statement
    if (this.match('return')) {
      const value = this.parseExpression();
      this.expect(';');
      return { type: 'return', value };
    }

    // If statement
    if (this.match('if')) {
      return this.parseIfStatement();
    }

    // While loop
    if (this.match('while')) {
      return this.parseWhileStatement();
    }

    // For loop
    if (this.match('for')) {
      return this.parseForStatement();
    }

    // Break statement
    if (this.match('break')) {
      this.expect(';');
      return { type: 'break' };
    }

    // Continue statement
    if (this.match('continue')) {
      this.expect(';');
      return { type: 'continue' };
    }

    // Throw statement
    if (this.match('throw')) {
      const argument = this.parseExpression();
      this.expect(';');
      return { type: 'throw', argument };
    }

    // Try-catch statement
    if (this.match('try')) {
      // Parse try block
      this.expect('{');
      const tryBlock = this.parseBlock();
      this.expect('}');

      // Parse catch if present
      let catchClause: { param: string; body: BlockStatement } | null = null;
      if (this.match('catch')) {
        this.expect('(');
        // Parse error parameter
        this.skipWhitespace();
        const param = this.parseIdentifier();
        this.expect(')');
        this.expect('{');
        const body = this.parseBlock();
        this.expect('}');
        catchClause = { param, body };
      }

      // Parse finally if present
      let finallyBlock: BlockStatement | null = null;
      if (this.match('finally')) {
        this.expect('{');
        finallyBlock = this.parseBlock();
        this.expect('}');
      }

      return { type: 'try', tryBlock, catchClause, finallyBlock };
    }

    // Try to parse assignment or expression statement
    // We need to look ahead to see if it's an assignment
    // This could be: identifier = expr OR this.field = expr OR instance.field = expr
    const savedPos = this.pos;

    // Try to parse a primary expression (only parses variable, member access, etc. - not full expressions)
    const leftExpr = this.parsePrimary();
    this.skipWhitespace();

    // Check for assignment operators (=, +=, -=, etc.)
    const ch = this.code[this.pos];
    const ch2 = this.code[this.pos + 1];

    // Check for compound assignment operators (+=, -=, *=, /=, |=, &=)
    let compoundOp: string | null = null;
    if ((ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '|' || ch === '&') && ch2 === '=') {
      compoundOp = ch; // '+', '-', '*', '/', '|', or '&'
      this.pos += 2; // consume operator and '='
    } else if (ch === '=' && ch2 !== '=') {
      // Regular assignment (=) but NOT comparison operators (==, ===)
      this.pos++; // consume '='
    } else {
      // Not an assignment, must be an expression statement
      this.pos = savedPos;
      const expr = this.parseExpression();
      this.expect(';');
      return expr;
    }

    // Parse the right-hand side value
    const value = this.parseExpression();
    this.expect(';');

    // For compound assignments, convert to: x = x + value or x = x - value
    let finalValue = value;
    if (compoundOp) {
      finalValue = {
        type: 'binary',
        op: compoundOp,
        left: leftExpr,
        right: value
      } as any;
    }

    // Check if leftExpr is a simple variable
    if (leftExpr.type === 'variable') {
      return { type: 'assignment', name: leftExpr.name, value: finalValue };
    } else if (leftExpr.type === 'member_access') {
      // Handle member access assignment (this.field = value or instance.field = value)
      // Store as assignment with special name format to indicate member access
      // We'll use a special format: "member_access:<property>" and store the object in a custom way
      // For now, we'll use a hack: store as assignment with empty name and check in codegen
      return {
        type: 'assignment',
        name: `__member_access__${(leftExpr as any).property}__`, // Special marker
        value: { type: 'member_access_assignment', object: (leftExpr as any).object, property: (leftExpr as any).property, value: finalValue } as any
      } as any;
    } else {
      throw new Error(`Cannot assign to ${leftExpr.type}`);
    }
  }

  private parseIfStatement(): IfStatement {
    this.expect('(');
    const condition = this.parseExpression();
    this.expect(')');

    // Support both braced and single-statement bodies
    let thenBlock: BlockStatement;
    this.skipWhitespace();
    if (this.code[this.pos] === '{') {
      this.expect('{');
      thenBlock = this.parseBlock();
      this.expect('}');
    } else {
      // Single statement without braces
      const stmt = this.parseStatement();
      thenBlock = { type: 'block', statements: [stmt] };
    }

    let elseBlock: BlockStatement | null = null;
    if (this.match('else')) {
      this.skipWhitespace();
      if (this.code[this.pos] === '{') {
        this.expect('{');
        elseBlock = this.parseBlock();
        this.expect('}');
      } else {
        // Single statement without braces
        const stmt = this.parseStatement();
        elseBlock = { type: 'block', statements: [stmt] };
      }
    }

    return { type: 'if', condition, thenBlock, elseBlock };
  }

  private parseTryStatement(): void {
    this.expect('{');
    const tryBlock = this.parseBlock();
    this.expect('}');

    if (this.match('catch')) {
      this.expect('(');
      // Skip error parameter (may have type annotation like "error as Error")
      this.skipWhitespace();
      // Parse identifier
      if (this.code[this.pos] !== ')') {
        this.parseIdentifier();
        // Skip type annotation if present (e.g., "as Error")
        this.skipWhitespace();
        if (this.match('as')) {
          this.skipWhitespace();
          this.parseIdentifier(); // Skip type name
        }
      }
      this.expect(')');
      this.expect('{');
      const catchBlock = this.parseBlock();
      this.expect('}');
    }
  }

  private parseWhileStatement(): WhileStatement {
    this.expect('(');
    const condition = this.parseExpression();
    this.expect(')');
    this.expect('{');
    const body = this.parseBlock();
    this.expect('}');

    return { type: 'while', condition, body };
  }

  private parseForStatement(): ForStatement {
    this.expect('(');

    // Check for for...of loop: for (const item of array)
    this.skipWhitespace();
    const savedPos = this.pos;
    if (this.match('let') || this.match('const') || this.match('var')) {
      const kind = this.code[savedPos] === 'l' ? 'let' : (this.code[savedPos] === 'v' ? 'let' : 'const');
      this.skipWhitespace();
      const varName = this.parseIdentifier();
      this.skipWhitespace();

      // Check if next token is 'of' (for...of) or '=' (regular variable declaration)
      if (this.code[this.pos] === '=' && this.code[this.pos + 1] !== '=') {
        // Regular variable declaration with initializer - not for...of
        this.pos = savedPos;
      } else if (this.match('of')) {
        // It's a for...of loop
        this.skipWhitespace();
        const iterable = this.parseExpression();
        this.expect(')');
        this.expect('{');
        const body = this.parseBlock();
        this.expect('}');
        // Create variable declaration without semicolon
        const varDecl: VariableDeclaration = { type: 'variable_declaration', kind, name: varName, value: { type: 'number', value: 0 } };
        // For now, treat for...of as a regular for loop with the iterable as condition
        // (We'll need to add proper for...of support in AST and codegen later)
        return { type: 'for', init: varDecl, condition: iterable, update: null, body };
      } else {
        // Regular for loop - restore position and parse normally
        this.pos = savedPos;
      }
    }

    // Parse init (can be let/const/var declaration, assignment, or empty)
    let init: VariableDeclaration | AssignmentStatement | null = null;
    this.skipWhitespace();
    if (this.code[this.pos] !== ';') {
      if (this.match('let') || this.match('const') || this.match('var')) {
        const savedPos = this.pos - (this.code[this.pos - 3] === 'l' ? 3 : (this.code[this.pos - 3] === 'v' ? 3 : 5));
        this.pos = savedPos;
        init = this.parseVariableDeclaration();
        // Variable declaration includes ';', so don't expect another one
      } else {
        // Try to parse as assignment or expression
        const leftExpr = this.parseExpression();
        this.skipWhitespace();
        if (this.code[this.pos] === '=') {
          this.pos++; // consume '='
          const value = this.parseExpression();
          if (leftExpr.type === 'variable') {
            init = { type: 'assignment', name: leftExpr.name, value };
          } else {
            throw new Error(`Cannot assign to ${leftExpr.type} in for loop init`);
          }
        }
        this.expect(';');
      }
    } else {
      this.expect(';');
    }

    // Parse condition (can be empty)
    let condition: Expression | null = null;
    this.skipWhitespace();
    if (this.code[this.pos] !== ';') {
      condition = this.parseExpression();
    }
    this.expect(';');

    // Parse update (can be assignment or expression or empty)
    let update: AssignmentStatement | Expression | null = null;
    this.skipWhitespace();
    if (this.code[this.pos] !== ')') {
      const leftExpr = this.parseExpression();
      this.skipWhitespace();
      if (this.code[this.pos] === '=') {
        this.pos++; // consume '='
        const value = this.parseExpression();
        if (leftExpr.type === 'variable') {
          update = { type: 'assignment', name: leftExpr.name, value };
        } else {
          throw new Error(`Cannot assign to ${leftExpr.type} in for loop update`);
        }
      } else {
        update = leftExpr;
      }
    }
    this.expect(')');

    this.expect('{');
    const body = this.parseBlock();
    this.expect('}');

    return { type: 'for', init, condition, update, body };
  }

  private parseVariableDeclaration(): VariableDeclaration {
    let kind: 'let' | 'const';
    if (this.match('let')) {
      kind = 'let';
    } else if (this.match('const')) {
      kind = 'const';
    } else if (this.match('var')) {
      kind = 'let'; // Treat var as let for our purposes
    } else {
      throw new Error('Expected let, const, or var');
    }
    const name = this.parseIdentifier();
    this.skipWhitespace();

    // Capture TypeScript type annotation if present (e.g., ": string[]")
    let declaredType: string | undefined;
    if (this.code[this.pos] === ':') {
      this.pos++; // consume ':'
      this.skipWhitespace();
      const typeStart = this.pos;
      this.skipTypeAnnotation();
      const typeEnd = this.pos;
      // Extract the type string (e.g., "string[]", "number", "boolean")
      declaredType = this.code.substring(typeStart, typeEnd).trim();
      this.skipWhitespace();
    }

    // Check if there's an initializer
    let value: Expression | null = null;
    if (this.code[this.pos] === '=') {
      this.pos++; // consume '='
      value = this.parseExpression();
      this.skipWhitespace();
    }

    // Handle multiple variable declarations: var a, b, c;
    // For simplicity, we only keep the first one and skip the rest
    while (this.code[this.pos] === ',') {
      this.pos++; // consume ','
      this.skipWhitespace();
      // Skip the next variable name
      this.parseIdentifier();
      this.skipWhitespace();
      // Skip initializer if present
      if (this.code[this.pos] === '=') {
        this.pos++; // consume '='
        this.parseExpression();
        this.skipWhitespace();
      }
    }

    this.expect(';');

    return { type: 'variable_declaration', kind, name, value, declaredType };
  }

  /**
   * Parses any expression using operator precedence climbing.
   * Entry point for expression parsing hierarchy.
   *
   * Precedence (low to high):
   * 1. Conditional (ternary) - a ? b : c
   * 2. Logical OR - a || b
   * 3. Logical AND - a && b
   * 4. Bitwise OR - a | b
   * 5. Bitwise XOR - a ^ b
   * 6. Bitwise AND - a & b
   * 7. Comparison - a < b, a === b
   * 8. Shift - a << b, a >> b
   * 9. Additive - a + b, a - b
   * 10. Multiplicative - a * b, a / b, a % b
   * 11. Primary - literals, identifiers, calls
   *
   * @example
   * Input: "5 + 3 * 2"
   * Output: { type: 'binary', op: '+', left: { type: 'number', value: 5 },
   *           right: { type: 'binary', op: '*', left: { type: 'number', value: 3 },
   *                    right: { type: 'number', value: 2 }}}
   *
   * @returns Expression AST node
   */
  private parseExpression(): Expression {
    return this.parseConditional();
  }

  private parseConditional(): Expression {
    let expr = this.parseLogicalOr();

    this.skipWhitespace();
    if (this.code[this.pos] === '?') {
      this.pos++; // skip '?'
      const consequent = this.parseExpression();
      this.skipWhitespace();
      if (this.code[this.pos] !== ':') {
        throw new Error(`Expected ':' in conditional expression at position ${this.pos}`);
      }
      this.pos++; // skip ':'
      const alternate = this.parseExpression();
      return { type: 'conditional', condition: expr, consequent, alternate };
    }

    return expr;
  }

  private parseLogicalOr(): Expression {
    let left = this.parseLogicalAnd();

    while (true) {
      this.skipWhitespace();
      const ch = this.code[this.pos];
      const ch2 = this.code[this.pos + 1];

      if (ch === '|' && ch2 === '|') {
        this.pos += 2;
        const right = this.parseLogicalAnd();
        left = { type: 'binary', op: '||', left, right };
      } else {
        break;
      }
    }

    return left;
  }

  private parseLogicalAnd(): Expression {
    let left = this.parseBitwiseOr();

    while (true) {
      this.skipWhitespace();
      const ch = this.code[this.pos];
      const ch2 = this.code[this.pos + 1];

      if (ch === '&' && ch2 === '&') {
        this.pos += 2;
        const right = this.parseBitwiseOr();
        left = { type: 'binary', op: '&&', left, right };
      } else {
        break;
      }
    }

    return left;
  }

  private parseBitwiseOr(): Expression {
    let left = this.parseBitwiseXor();

    while (true) {
      this.skipWhitespace();
      const ch = this.code[this.pos];
      const ch2 = this.code[this.pos + 1];

      // Check for single | (not ||)
      if (ch === '|' && ch2 !== '|') {
        this.pos++;
        const right = this.parseBitwiseXor();
        left = { type: 'binary', op: '|', left, right };
      } else {
        break;
      }
    }

    return left;
  }

  private parseBitwiseXor(): Expression {
    let left = this.parseBitwiseAnd();

    while (true) {
      this.skipWhitespace();
      const ch = this.code[this.pos];

      // Check for ^ (XOR)
      if (ch === '^') {
        this.pos++;
        const right = this.parseBitwiseAnd();
        left = { type: 'binary', op: '^', left, right };
      } else {
        break;
      }
    }

    return left;
  }

  private parseBitwiseAnd(): Expression {
    let left = this.parseComparison();

    while (true) {
      this.skipWhitespace();
      const ch = this.code[this.pos];
      const ch2 = this.code[this.pos + 1];

      // Check for single & (not &&)
      if (ch === '&' && ch2 !== '&') {
        this.pos++;
        const right = this.parseComparison();
        left = { type: 'binary', op: '&', left, right };
      } else {
        break;
      }
    }

    return left;
  }

  private parseComparison(): Expression {
    let left = this.parseShift();

    while (true) {
      this.skipWhitespace();
      const ch = this.code[this.pos];
      const ch2 = this.code[this.pos + 1];
      const ch3 = this.code[this.pos + 2];

      let op = '';

      // Three-character operators (===, !==)
      if ((ch === '=' && ch2 === '=' && ch3 === '=') ||
          (ch === '!' && ch2 === '=' && ch3 === '=')) {
        op = ch + ch2 + ch3;
        this.pos += 3;
      }
      // Two-character operators (<=, >=, ==, !=)
      else if ((ch === '<' || ch === '>' || ch === '=' || ch === '!') && ch2 === '=') {
        op = ch + ch2;
        this.pos += 2;
      }
      // Single-character operators (but not if it's the start of << or >>)
      else if ((ch === '<' || ch === '>') && ch2 !== ch) {
        op = ch;
        this.pos++;
      }

      if (op) {
        const right = this.parseShift();
        left = { type: 'binary', op, left, right };
      } else {
        break;
      }
    }

    return left;
  }

  private parseShift(): Expression {
    let left = this.parseAdditive();

    while (true) {
      this.skipWhitespace();
      const ch = this.code[this.pos];
      const ch2 = this.code[this.pos + 1];

      let op = '';

      // Check for << or >>
      if ((ch === '<' && ch2 === '<') || (ch === '>' && ch2 === '>')) {
        op = ch + ch2;
        this.pos += 2;
        const right = this.parseAdditive();
        left = { type: 'binary', op, left, right };
      } else {
        break;
      }
    }

    return left;
  }

  private parseAdditive(): Expression {
    let left = this.parseMultiplicative();

    while (true) {
      this.skipWhitespace();
      const op = this.code[this.pos];

      if (op === '+' || op === '-') {
        this.pos++;
        const right = this.parseMultiplicative();
        left = { type: 'binary', op, left, right };
      } else {
        break;
      }
    }

    return left;
  }

  private parseMultiplicative(): Expression {
    let left = this.parsePrimary();

    while (true) {
      this.skipWhitespace();
      const op = this.code[this.pos];

      if (op === '*' || op === '/' || op === '%') {
        this.pos++;
        const right = this.parsePrimary();
        left = { type: 'binary', op, left, right };
      } else {
        break;
      }
    }

    return left;
  }

  /**
   * Parses primary expressions (literals, identifiers, operators, constructors).
   * This is the base level of the expression hierarchy, handling all terminal
   * and prefix expressions before postfix operations like member/index access.
   *
   * Handles:
   * - Literals: numbers, strings, booleans, null, undefined, arrays, objects
   * - Keywords: new, this, super, void, typeof
   * - Operators: unary (!, +, -), grouping (parentheses)
   * - Functions: arrow functions, function expressions
   * - Template literals with interpolation
   * - Regular expressions
   *
   * @example
   * Input: "42"
   * Output: { type: 'number', value: 42 }
   *
   * @example
   * Input: "new Counter(10)"
   * Output: { type: 'new', className: 'Counter', args: [{ type: 'number', value: 10 }] }
   *
   * @example
   * Input: "[1, 2, 3]"
   * Output: { type: 'array', elements: [
   *   { type: 'number', value: 1 },
   *   { type: 'number', value: 2 },
   *   { type: 'number', value: 3 }
   * ]}
   *
   * @example
   * Input: "x => x + 1"
   * Output: { type: 'arrow_function', params: ['x'], body: { type: 'binary', op: '+', ... }}
   *
   * @returns Expression AST node
   */
  private parsePrimary(): Expression {
    this.skipWhitespace();

    // Check for 'new' keyword
    if (this.match('new')) {
      const className = this.parseIdentifier();

      // Special handling for Map and Set constructors
      if (className === 'Map' || className === 'Set') {
        this.expect('(');
        this.skipWhitespace();

        // For now, just expect empty constructor
        this.expect(')');

        if (className === 'Map') {
          return this.parsePostfixExpressions({ type: 'map', entries: [] } as MapNode);
        } else {
          return this.parsePostfixExpressions({ type: 'set', values: [] } as SetNode);
        }
      }

      this.expect('(');
      const args: Expression[] = [];
      this.skipWhitespace();
      if (this.code[this.pos] !== ')') {
        args.push(this.parseExpression());
        while (this.match(',')) {
          args.push(this.parseExpression());
        }
      }
      this.expect(')');
      // Handle member access on new expression
      return this.parsePostfixExpressions({ type: 'new', className, args } as NewNode);
    }

    // Check for 'this' keyword
    if (this.match('this')) {
      return this.parsePostfixExpressions({ type: 'this' } as ThisNode);
    }

    // Check for 'super' keyword
    if (this.match('super')) {
      // Allow super() constructor calls or super.method() calls
      return this.parsePostfixExpressions({ type: 'super' } as SuperNode);
    }

    // Check for 'void' operator (used by TSC for undefined)
    if (this.match('void')) {
      // void always evaluates to undefined, which we treat as 0
      // Parse and ignore the expression after void
      this.parsePrimary();
      return { type: 'number', value: 0 };
    }

    // Check for 'await' keyword - NOT SUPPORTED in AOT compilation!
    if (this.match('await')) {
      throw new Error(formatUnsupportedFeatureError('await'));
    }

    // Check for 'typeof' operator - NOT SUPPORTED in AOT compilation!
    if (this.match('typeof')) {
      throw new Error(formatUnsupportedFeatureError('typeof'));
    }

    // Check for 'instanceof' operator - NOT SUPPORTED in AOT compilation!
    if (this.match('instanceof')) {
      throw new Error(formatUnsupportedFeatureError('instanceof'));
    }

    // Check for unary ! operator
    if (this.code[this.pos] === '!') {
      this.pos++;
      const operand = this.parsePrimary();
      return { type: 'unary', op: '!', operand };
    }

    // Check for unary + and - operators
    if (this.code[this.pos] === '+' || this.code[this.pos] === '-') {
      const op = this.code[this.pos];
      this.pos++;
      const operand = this.parsePrimary();
      return { type: 'unary', op, operand };
    }

    // Check for parentheses - could be arrow function or grouped expression
    if (this.code[this.pos] === '(') {
      // Look ahead to detect arrow functions: () => or (param) => or (param1, param2) =>
      const savedPos = this.pos;
      this.pos++; // consume '('
      this.skipWhitespace();

      // Try to parse as arrow function parameters
      const params: string[] = [];
      let isArrowFunction = false;

      if (this.code[this.pos] === ')') {
        // Empty params: () =>
        this.pos++;
        this.skipWhitespace();
        if (this.code[this.pos] === '=' && this.code[this.pos + 1] === '>') {
          isArrowFunction = true;
        }
      } else {
        // Try to parse parameter list
        const startPos = this.pos;
        try {
          params.push(this.parseIdentifier());
          this.skipWhitespace();
          while (this.code[this.pos] === ',') {
            this.pos++;
            this.skipWhitespace();
            params.push(this.parseIdentifier());
            this.skipWhitespace();
          }
          if (this.code[this.pos] === ')') {
            this.pos++;
            this.skipWhitespace();
            if (this.code[this.pos] === '=' && this.code[this.pos + 1] === '>') {
              isArrowFunction = true;
            }
          }
        } catch (e) {
          // Not valid params, will parse as expression
        }
      }

      if (isArrowFunction) {
        // Parse arrow function body
        this.pos += 2; // consume '=>'
        this.skipWhitespace();
        let body: Expression | BlockStatement;
        if (this.code[this.pos] === '{') {
          this.pos++; // consume '{'
          body = this.parseBlock();
          this.expect('}');
        } else {
          body = this.parseExpression();
        }
        return { type: 'arrow_function', params, body };
      } else {
        // Not an arrow function, parse as grouped expression
        this.pos = savedPos;
        this.pos++; // consume '('
        const expr = this.parseExpression();
        // Skip TypeScript type assertion if present (e.g., "as Error")
        this.skipWhitespace();
        if (this.match('as')) {
          this.skipWhitespace();
          // Skip the type name (could be identifier or qualified name)
          this.parseIdentifier();
          // Skip any remaining type qualifiers (e.g., "as Error | null")
          this.skipWhitespace();
          while (this.code[this.pos] === '|' || this.code[this.pos] === '&') {
            this.pos++;
            this.skipWhitespace();
            this.parseIdentifier();
            this.skipWhitespace();
          }
        }
        this.expect(')');
        // Handle postfix expressions (e.g., (error as Error).message)
        return this.parsePostfixExpressions(expr);
      }
    }

    // Check for array literal
    if (this.code[this.pos] === '[') {
      let expr: Expression = this.parseArrayLiteral();
      // Handle member/index/method access on arrays
      return this.parsePostfixExpressions(expr);
    }

    // Check for object literal
    if (this.code[this.pos] === '{') {
      let expr: Expression = this.parseObjectLiteral();
      // Handle member/index/method access on objects
      return this.parsePostfixExpressions(expr);
    }

    // Check for function expression: function(x) { return x }
    if (this.match('function')) {
      this.skipWhitespace();

      // Function expressions are anonymous, so no name
      this.expect('(');

      // Parse parameters
      const params: string[] = [];
      this.skipWhitespace();
      if (this.code[this.pos] !== ')') {
        params.push(this.parseIdentifier());
        while (this.match(',')) {
          params.push(this.parseIdentifier());
        }
      }
      this.expect(')');
      this.skipWhitespace();
      this.expect('{');

      // Parse body as block statement
      const body = this.parseBlock();
      this.expect('}');

      // Return as arrow_function node (functionally equivalent)
      return { type: 'arrow_function', params, body };
    }

    // Check for template literal (backticks)
    if (this.code[this.pos] === '`') {
      return this.parseTemplateLiteral();
    }

    // Check for string literal
    if (this.code[this.pos] === '"' || this.code[this.pos] === "'") {
      // Check for postfix expressions like .concat(), .repeat(), etc.
      return this.parsePostfixExpressions({ type: 'string', value: this.parseString() } as StringNode);
    }

    // Check for regex literal
    if (this.code[this.pos] === '/') {
      // Look ahead to check if this is a regex (not division)
      // This is a simplified check - in a full implementation we'd need more context
      const savedPos = this.pos;
      try {
        const regex = this.parseRegex();
        if (regex) {
          // Handle postfix expressions (e.g., /pattern/.test())
          return this.parsePostfixExpressions(regex);
        }
      } catch (e) {
        // Not a regex, restore position
        this.pos = savedPos;
      }
    }

    // Check for boolean literals
    if (this.match('true')) {
      return { type: 'boolean', value: true };
    }
    if (this.match('false')) {
      return { type: 'boolean', value: false };
    }

    // Check for null literal (treat as 0 for our purposes)
    if (this.match('null')) {
      return { type: 'number', value: 0 };
    }

    // Check for undefined literal (treat as 0 for our purposes)
    if (this.match('undefined')) {
      return { type: 'number', value: 0 };
    }

    // Check for negative number or unary minus
    if (this.code[this.pos] === '-') {
      const nextChar = this.code[this.pos + 1];
      if (nextChar && /[0-9]/.test(nextChar)) {
        // Negative number literal
        this.pos++; // consume '-'
        return { type: 'number', value: -this.parseNumber() };
      }
    }

    // Check for number
    if (/[0-9]/.test(this.code[this.pos])) {
      return { type: 'number', value: this.parseNumber() };
    }

    // Check for identifier (variable, function call, or arrow function parameter)
    const name = this.parseIdentifier();
    if (!name) {
      throw new Error(this.formatError(`Unexpected character '${this.code[this.pos]}'`));
    }
    this.skipWhitespace();

    // Check for arrow function: param => expr or param => { ... }
    if (this.code[this.pos] === '=' && this.code[this.pos + 1] === '>') {
      // Single parameter arrow function
      this.pos += 2; // consume '=>'
      this.skipWhitespace();
      let body: Expression | BlockStatement;
      if (this.code[this.pos] === '{') {
        this.pos++; // consume '{'
        body = this.parseBlock();
        this.expect('}');
      } else {
        body = this.parseExpression();
      }
      return { type: 'arrow_function', params: [name], body };
    }

    if (this.code[this.pos] === '(') {
      // Could be function call or arrow function with parentheses
      const savedPos = this.pos;
      this.pos++; // consume '('
      this.skipWhitespace();

      // Check if it's an arrow function: (param) => or (param1, param2) =>
      const params: string[] = [];
      if (this.code[this.pos] !== ')') {
        params.push(this.parseIdentifier());
        while (this.match(',')) {
          params.push(this.parseIdentifier());
        }
      }
      this.skipWhitespace();

      if (this.code[this.pos] === ')' && this.code[this.pos + 1] === '=' && this.code[this.pos + 2] === '>') {
        // Arrow function with parentheses
        this.pos += 3; // consume ') =>'
        this.skipWhitespace();
        let body: Expression | BlockStatement;
        if (this.code[this.pos] === '{') {
          this.pos++; // consume '{'
          body = this.parseBlock();
          this.expect('}');
        } else {
          body = this.parseExpression();
        }
        return { type: 'arrow_function', params, body };
      } else {
        // Regular function call
        this.pos = savedPos;
        return this.parseFunctionCallWithName(name);
      }
    } else {
      // Variable reference - check for member access or index access
      let expr: Expression = { type: 'variable', name };
      return this.parsePostfixExpressions(expr);
    }
  }

  private parseFunctionCall(): CallNode | null {
    const savedPos = this.pos;
    try {
      const name = this.parseIdentifier();
      if (!name) return null;
      return this.parseFunctionCallWithName(name);
    } catch (e) {
      // Re-throw intentional errors for unsupported features
      // These contain our formatted error messages and should not be caught
      const errorMsg = (e as Error).message;
      if (errorMsg && errorMsg.includes('is not supported in ChadScript')) {
        throw e;
      }
      // For parse errors, backtrack and return null
      this.pos = savedPos;
      return null;
    }
  }

  private parseFunctionCallWithName(name: string): CallNode {
    // Check for unsupported eval() - dynamic code execution not supported in AOT!
    if (name === 'eval') {
      throw new Error(formatUnsupportedFeatureError('eval'));
    }

    this.expect('(');

    const args: Expression[] = [];
    this.skipWhitespace();
    if (this.code[this.pos] !== ')') {
      args.push(this.parseExpression());
      while (this.match(',')) {
        args.push(this.parseExpression());
      }
    }
    this.expect(')');

    return { type: 'call', name, args };
  }

  private parseTemplateLiteral(): Expression {
    this.pos++; // consume opening backtick
    const parts: Expression[] = [];
    let currentString = '';

    while (this.pos < this.code.length) {
      if (this.code[this.pos] === '`') {
        // End of template literal
        if (currentString) {
          parts.push({ type: 'string', value: currentString });
        }
        this.pos++; // consume closing backtick
        break;
      } else if (this.code[this.pos] === '$' && this.code[this.pos + 1] === '{') {
        // Expression interpolation
        if (currentString) {
          parts.push({ type: 'string', value: currentString });
          currentString = '';
        }
        this.pos += 2; // consume '${'
        this.skipWhitespace();

        // Parse the expression inside ${...}
        // We need to handle nested braces carefully
        let braceDepth = 1;
        let exprCode = '';

        while (this.pos < this.code.length && braceDepth > 0) {
          if (this.code[this.pos] === '{') {
            braceDepth++;
            exprCode += this.code[this.pos++];
          } else if (this.code[this.pos] === '}') {
            braceDepth--;
            if (braceDepth > 0) {
              exprCode += this.code[this.pos++];
            } else {
              // This is the closing } for the template interpolation
              this.pos++; // consume '}'
            }
          } else if (this.code[this.pos] === '"' || this.code[this.pos] === "'") {
            // Handle string literals inside the expression
            const quote = this.code[this.pos];
            exprCode += this.code[this.pos++];
            while (this.pos < this.code.length && this.code[this.pos] !== quote) {
              if (this.code[this.pos] === '\\') {
                exprCode += this.code[this.pos++];
                if (this.pos < this.code.length) {
                  exprCode += this.code[this.pos++];
                }
              } else {
                exprCode += this.code[this.pos++];
              }
            }
            if (this.pos < this.code.length) {
              exprCode += this.code[this.pos++]; // closing quote
            }
          } else {
            exprCode += this.code[this.pos++];
          }
        }

        // Parse the extracted expression
        const savedPos = this.pos;
        const savedCode = this.code;
        this.code = exprCode;
        this.pos = 0;
        const expr = this.parseExpression();
        this.code = savedCode;
        this.pos = savedPos;

        parts.push(expr);
      } else if (this.code[this.pos] === '\\') {
        // Handle escape sequences
        this.pos++;
        if (this.pos >= this.code.length) {
          throw new Error('Unterminated template literal');
        }
        const escaped = this.code[this.pos];
        if (escaped === 'n') currentString += '\n';
        else if (escaped === 't') currentString += '\t';
        else if (escaped === 'r') currentString += '\r';
        else if (escaped === '\\') currentString += '\\';
        else if (escaped === '`') currentString += '`';
        else if (escaped === '$') currentString += '$';
        else currentString += escaped;
        this.pos++;
      } else {
        currentString += this.code[this.pos++];
      }
    }

    if (this.pos >= this.code.length && this.code[this.pos - 1] !== '`') {
      throw new Error('Unterminated template literal');
    }

    // Convert parts to string concatenation
    if (parts.length === 0) {
      return { type: 'string', value: '' };
    }

    if (parts.length === 1) {
      return parts[0];
    }

    // Build a chain of binary + operations: part1 + part2 + part3...
    let result: Expression = parts[0];
    for (let i = 1; i < parts.length; i++) {
      result = {
        type: 'binary',
        op: '+',
        left: result,
        right: parts[i]
      };
    }

    return result;
  }

  private parseString(): string {
    this.skipWhitespace();
    const quote = this.code[this.pos];
    if (quote !== '"' && quote !== "'") {
      throw new Error(`Expected string at position ${this.pos}`);
    }
    this.pos++; // consume opening quote

    let str = '';
    while (this.pos < this.code.length && this.code[this.pos] !== quote) {
      if (this.code[this.pos] === '\\') {
        // Handle escape sequences
        this.pos++;
        if (this.pos >= this.code.length) {
          throw new Error('Unterminated string');
        }
        // Simple escape handling
        const escaped = this.code[this.pos];
        if (escaped === 'n') str += '\n';
        else if (escaped === 't') str += '\t';
        else if (escaped === 'r') str += '\r';
        else if (escaped === '\\') str += '\\';
        else if (escaped === quote) str += quote;
        else str += escaped;
        this.pos++;
      } else {
        str += this.code[this.pos++];
      }
    }

    if (this.pos >= this.code.length) {
      throw new Error('Unterminated string');
    }
    this.pos++; // consume closing quote
    return str;
  }

  private parseRegex(): { type: 'regex'; pattern: string; flags: string } | null {
    if (this.code[this.pos] !== '/') {
      return null;
    }
    this.pos++; // consume opening /

    let pattern = '';
    let escaped = false;

    while (this.pos < this.code.length) {
      const ch = this.code[this.pos];

      if (escaped) {
        pattern += ch;
        escaped = false;
        this.pos++;
        continue;
      }

      if (ch === '\\') {
        pattern += ch;
        escaped = true;
        this.pos++;
        continue;
      }

      if (ch === '/') {
        // End of pattern
        this.pos++; // consume closing /
        break;
      }

      // Check for invalid newline in pattern
      if (ch === '\n') {
        throw new Error('Unterminated regex at position ' + this.pos);
      }

      pattern += ch;
      this.pos++;
    }

    // Parse flags (optional)
    let flags = '';
    while (this.pos < this.code.length && /[gimsuvy]/.test(this.code[this.pos])) {
      flags += this.code[this.pos++];
    }

    return { type: 'regex', pattern, flags };
  }

  private parseImport(): void {
    // import { name1, name2 } from 'module'
    // import * as name from 'module'
    this.skipWhitespace();

    if (this.code[this.pos] === '*') {
      // Namespace import: import * as name from 'module'
      this.pos++; // consume '*'
      this.skipWhitespace();
      this.expect('as');
      const namespaceName = this.parseIdentifier();
      this.skipWhitespace();
      this.expect('from');
      const source = this.parseString();
      this.skipWhitespace();
      if (this.code[this.pos] === ';') {
        this.pos++; // consume semicolon
      }
      // Store namespace import as a single specifier
      this.imports.push({ type: 'import', specifiers: [namespaceName], source });
    } else if (this.code[this.pos] === '{') {
      // Named imports: import { name1, name2 } from 'module'
      this.pos++; // consume '{'
      const specifiers: string[] = [];
      this.skipWhitespace();
      if (this.code[this.pos] !== '}') {
        specifiers.push(this.parseIdentifier());
        while (this.match(',')) {
          specifiers.push(this.parseIdentifier());
        }
      }
      this.expect('}');
      this.skipWhitespace();
      this.expect('from');
      const source = this.parseString();
      this.skipWhitespace();
      if (this.code[this.pos] === ';') {
        this.pos++; // consume semicolon
      }
      this.imports.push({ type: 'import', specifiers, source });
    } else {
      throw new Error(`Unexpected import syntax at position ${this.pos}`);
    }
  }

  private parseExport(): void {
    // export function name() { ... } or export class Name { ... }
    if (this.match('function')) {
      const name = this.parseIdentifier();
      this.expect('(');

      // Parse parameters
      const params: string[] = [];
      this.skipWhitespace();
      if (this.code[this.pos] !== ')') {
        params.push(this.parseIdentifier());
        while (this.match(',')) {
          params.push(this.parseIdentifier());
        }
      }
      this.expect(')');
      this.expect('{');

      // Parse body as block statement
      const body = this.parseBlock();
      this.expect('}');

      // Also add to functions list for codegen
      this.exports.push({ type: 'export', declaration: { name, params, body } });
      this.functions.push({ name, params, body });
    } else if (this.match('class')) {
      const name = this.parseIdentifier();

      // Check for extends
      let extendsClass: string | undefined;
      this.skipWhitespace();
      if (this.match('extends')) {
        extendsClass = this.parseIdentifier();
      }

      this.expect('{');

      const fields: { name: string; fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' }[] = [];
      const methods: ClassMethod[] = [];
      this.skipWhitespace();
      while (this.code[this.pos] !== '}') {
        // Try to parse field declaration first
        const savedPos = this.pos;
        const identifier = this.parseIdentifier();
        this.skipWhitespace();

        // Check if this is a field declaration with type annotation
        if (this.code[this.pos] === ':') {
          this.pos++; // consume ':'
          this.skipWhitespace();

          // Parse type
          let fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' = 'double';
          if (this.match('string')) {
            // Check if it's an array type (string[])
            this.skipWhitespace();
            if (this.code[this.pos] === '[' && this.code[this.pos + 1] === ']') {
              this.pos += 2; // consume '[]'
              fieldType = 'string[]';
            } else {
              fieldType = 'string';
            }
          } else if (this.match('number')) {
            // Check if it's an array type (number[])
            this.skipWhitespace();
            if (this.code[this.pos] === '[' && this.code[this.pos + 1] === ']') {
              this.pos += 2; // consume '[]'
              fieldType = 'number[]';
            } else {
              fieldType = 'double';
            }
          } else if (this.match('boolean')) {
            // Check if it's an array type (boolean[])
            this.skipWhitespace();
            if (this.code[this.pos] === '[' && this.code[this.pos + 1] === ']') {
              this.pos += 2; // consume '[]'
              fieldType = 'boolean[]';
            } else {
              throw new Error(this.formatError(`boolean fields are not supported yet. Only string, number, and their array types are supported.`));
            }
          } else {
            throw new Error(this.formatError(`Unsupported field type. Supported types: string, number, string[], number[], boolean[]`));
          }

          this.skipWhitespace();
          this.expect(';');

          fields.push({ name: identifier, fieldType });
          this.skipWhitespace();
          continue;
        }

        // Not a field, restore and parse as method
        this.pos = savedPos;

        const isConstructor = this.match('constructor');
        const methodName = isConstructor ? 'constructor' : this.parseIdentifier();
        this.expect('(');

        const params: string[] = [];
        const paramTypes: ('string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void')[] = [];
        this.skipWhitespace();
        if (this.code[this.pos] !== ')') {
          const paramName = this.parseIdentifier();
          // Parse TypeScript type annotation if present (e.g., ": string")
          let paramType: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | null = null;
          this.skipWhitespace();
          if (this.code[this.pos] === ':') {
            this.pos++; // consume ':'
            this.skipWhitespace();
            paramType = this.parseTypeAnnotation();
          }
          params.push(paramName);
          if (paramType) paramTypes.push(paramType);

          while (this.match(',')) {
            this.skipWhitespace();
            const nextParamName = this.parseIdentifier();
            // Parse type annotation
            let nextParamType: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | null = null;
            this.skipWhitespace();
            if (this.code[this.pos] === ':') {
              this.pos++; // consume ':'
              this.skipWhitespace();
              nextParamType = this.parseTypeAnnotation();
            }
            params.push(nextParamName);
            if (nextParamType) paramTypes.push(nextParamType);
          }
        }
        this.expect(')');
        // Parse return type annotation if present (e.g., ": string")
        let returnType: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | null = null;
        this.skipWhitespace();
        if (this.code[this.pos] === ':') {
          this.pos++; // consume ':'
          this.skipWhitespace();
          returnType = this.parseTypeAnnotation();
        }
        this.expect('{');

        const body = this.parseBlock();
        this.expect('}');

        methods.push({ type: 'method', name: methodName, params, paramTypes: paramTypes.length > 0 ? paramTypes : undefined, returnType: returnType || undefined, body, isConstructor });
        this.skipWhitespace();
      }
      this.expect('}');

      this.exports.push({ type: 'export', declaration: { name, extends: extendsClass, fields, methods } });
      // Also add to classes list for codegen
      this.classes.push({ name, extends: extendsClass, fields, methods });
    } else {
      throw new Error(`Expected 'function' or 'class' after 'export' at position ${this.pos}`);
    }
  }

  private parseArrayLiteral(): ArrayNode {
    this.expect('[');
    const elements: Expression[] = [];
    this.skipWhitespace();
    if (this.code[this.pos] !== ']') {
      elements.push(this.parseExpression());
      while (this.match(',')) {
        this.skipWhitespace();
        // Allow trailing comma
        if (this.code[this.pos] === ']') break;
        elements.push(this.parseExpression());
      }
    }
    this.expect(']');
    return { type: 'array', elements };
  }

  private parseMethodCall(object: Expression, methodName: string): MethodCallNode {
    // Check for unsupported Object.* methods
    if (object.type === 'variable' && (object as any).name === 'Object') {
      if (methodName === 'keys') {
        throw new Error(formatUnsupportedFeatureError('Object.keys'));
      }
      if (methodName === 'values') {
        throw new Error(formatUnsupportedFeatureError('Object.values'));
      }
      if (methodName === 'entries') {
        throw new Error(formatUnsupportedFeatureError('Object.entries'));
      }
    }

    this.expect('(');
    const args: Expression[] = [];
    this.skipWhitespace();
    if (this.code[this.pos] !== ')') {
      args.push(this.parseExpression());
      while (this.match(',')) {
        args.push(this.parseExpression());
      }
    }
    this.expect(')');
    return { type: 'method_call', object, method: methodName, args };
  }

  private parseObjectLiteral(): ObjectNode {
    this.expect('{');
    const properties: { key: string; value: Expression }[] = [];
    this.skipWhitespace();
    if (this.code[this.pos] !== '}') {
      // Parse first property - key can be identifier or string literal
      let key: string;
      if (this.code[this.pos] === '"' || this.code[this.pos] === "'") {
        key = this.parseString();
      } else {
        key = this.parseIdentifier();
      }
      this.skipWhitespace();

      // Check for shorthand syntax (e.g., { name } instead of { name: name })
      let value: Expression;
      if (this.code[this.pos] === ':') {
        this.pos++; // consume ':'
        value = this.parseExpression();
      } else {
        // Shorthand: { key } means { key: key }
        value = { type: 'variable', name: key };
      }
      properties.push({ key, value });

      while (this.match(',')) {
        this.skipWhitespace();
        // Allow trailing comma
        if (this.code[this.pos] === '}') break;
        // Parse key - can be identifier or string literal
        if (this.code[this.pos] === '"' || this.code[this.pos] === "'") {
          key = this.parseString();
        } else {
          key = this.parseIdentifier();
        }
        this.skipWhitespace();

        // Check for shorthand syntax
        if (this.code[this.pos] === ':') {
          this.pos++; // consume ':'
          value = this.parseExpression();
        } else {
          // Shorthand: { key } means { key: key }
          value = { type: 'variable', name: key };
        }
        properties.push({ key, value });
      }
    }
    this.expect('}');
    return { type: 'object', properties };
  }

  private parsePostfixExpressions(expr: Expression): Expression {
    // Handle chained member/index/method access
    while (true) {
      this.skipWhitespace();
      if (this.code[this.pos] === '.') {
        // Member access or method call
        this.pos++; // consume '.'
        const property = this.parseIdentifier();
        this.skipWhitespace();

        // Check for generic type parameter (e.g., method<Type>())
        // Only parse as generic if followed by `(` (method call syntax)
        let typeParameter: string | undefined;
        if (this.code[this.pos] === '<') {
          // Lookahead to check if this is actually a generic (not a comparison operator)
          const savedPos = this.pos;
          this.pos++; // consume '<'
          this.skipWhitespace();

          // Try to parse as identifier
          const startPos = this.pos;
          while (this.pos < this.code.length && /[a-zA-Z0-9_]/.test(this.code[this.pos])) {
            this.pos++;
          }
          const potentialType = this.code.substring(startPos, this.pos);
          this.skipWhitespace();

          // Check if followed by '>' and then '('
          if (this.code[this.pos] === '>' && potentialType.length > 0) {
            this.pos++; // consume '>'
            this.skipWhitespace();
            if (this.code[this.pos] === '(') {
              // It's a generic! Use the parsed type
              typeParameter = potentialType;
            } else {
              // Not a generic - restore position
              this.pos = savedPos;
            }
          } else {
            // Not a valid generic syntax - restore position
            this.pos = savedPos;
          }
        }

        if (this.code[this.pos] === '(') {
          // Method call
          expr = this.parseMethodCall(expr, property);
          // Add type parameter if present
          if (typeParameter) {
            (expr as any).typeParameter = typeParameter;
          }
        } else {
          // Property access
          expr = { type: 'member_access', object: expr, property };
        }
      } else if (this.code[this.pos] === '[') {
        // Index access
        this.pos++; // consume '['
        const index = this.parseExpression();
        this.expect(']');
        expr = { type: 'index_access', object: expr, index };
      } else if (this.code[this.pos] === '(' && (expr as any).type === 'super') {
        // super() constructor call
        this.pos++; // consume '('
        const args: Expression[] = [];
        this.skipWhitespace();
        if (this.code[this.pos] !== ')') {
          args.push(this.parseExpression());
          while (this.match(',')) {
            args.push(this.parseExpression());
          }
        }
        this.expect(')');
        // Create a method call node with empty method name to signal super constructor call
        expr = { type: 'method_call', object: expr, method: '', args };
      } else if (this.code[this.pos] === '+' && this.code[this.pos + 1] === '+') {
        // Postfix increment: x++
        this.pos += 2;
        // Convert to: x = x + 1, but return the original value
        // For now, we'll treat it as a compound assignment
        if (expr.type === 'variable') {
          expr = { type: 'binary', op: '+', left: expr, right: { type: 'number', value: 1 } } as any;
        }
      } else if (this.code[this.pos] === '-' && this.code[this.pos + 1] === '-') {
        // Postfix decrement: x--
        this.pos += 2;
        // Convert to: x = x - 1
        if (expr.type === 'variable') {
          expr = { type: 'binary', op: '-', left: expr, right: { type: 'number', value: 1 } } as any;
        }
      } else {
        break;
      }
    }
    return expr;
  }
}
