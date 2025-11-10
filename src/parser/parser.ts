import { AST, Expression, FunctionNode, CallNode, MethodCallNode, BlockStatement, Statement, VariableDeclaration, AssignmentStatement, ReturnStatement, IfStatement, ImportDeclaration, ExportDeclaration, ObjectNode, ArrayNode, ClassNode, ClassMethod, NewNode, ThisNode } from '../ast/types.js';

// ============================================
// PARSER
// ============================================

export class Parser {
  private code: string;
  private pos: number = 0;
  private imports: ImportDeclaration[] = [];
  private functions: FunctionNode[] = [];
  private classes: ClassNode[] = [];
  private exports: ExportDeclaration[] = [];
  private entryPoint: CallNode | NewNode | null = null;

  constructor(code: string) {
    this.code = code;
  }

  parse(): AST {
    while (this.pos < this.code.length) {
      this.skipWhitespace();
      if (this.pos >= this.code.length) break;

      if (this.match('import')) {
        this.parseImport();
      } else if (this.match('export')) {
        this.parseExport();
      } else if (this.match('class')) {
        this.parseClass();
      } else if (this.match('function')) {
        this.parseFunction();
      } else if (this.match('//')) {
        this.skipComment();
      } else {
        // Try to parse as function call or new expression (entry point)
        const savedPos = this.pos;
        if (this.match('new')) {
          // Parse new expression
          const className = this.parseIdentifier();
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
          this.entryPoint = { type: 'new', className, args };
          this.skipWhitespace();
          if (this.code[this.pos] === ';') {
            this.pos++; // consume semicolon
          }
        } else {
          // Try function call
          this.pos = savedPos;
          const call = this.parseFunctionCall();
          if (call) {
            this.entryPoint = call;
            this.skipWhitespace();
            if (this.code[this.pos] === ';') {
              this.pos++; // consume semicolon
            }
          }
        }
      }
    }

    return {
      imports: this.imports,
      functions: this.functions,
      classes: this.classes,
      exports: this.exports,
      entryPoint: this.entryPoint
    };
  }

  private skipWhitespace(): void {
    while (this.pos < this.code.length && /\s/.test(this.code[this.pos])) {
      this.pos++;
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
      throw new Error(`Expected '${str}' at position ${this.pos}`);
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
    while (this.pos < this.code.length && /[0-9]/.test(this.code[this.pos])) {
      num += this.code[this.pos++];
    }
    return parseInt(num);
  }

  private parseFunction(): void {
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

    this.functions.push({ name, params, body });
  }

  private parseClass(): void {
    const className = this.parseIdentifier();
    this.expect('{');

    const methods: ClassMethod[] = [];

    while (true) {
      this.skipWhitespace();
      if (this.code[this.pos] === '}') {
        break;
      }

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
      this.skipWhitespace();
      if (this.code[this.pos] !== ')') {
        params.push(this.parseIdentifier());
        while (this.match(',')) {
          params.push(this.parseIdentifier());
        }
      }
      this.expect(')');
      this.expect('{');

      // Parse body
      const body = this.parseBlock();
      this.expect('}');

      methods.push({
        type: 'method',
        name: methodName,
        params,
        body,
        isConstructor
      });
    }

    this.expect('}');
    this.classes.push({ name: className, methods });
  }

  private parseBlock(): BlockStatement {
    const statements: Statement[] = [];

    while (true) {
      this.skipWhitespace();
      if (this.code[this.pos] === '}') {
        break;
      }

      const stmt = this.parseStatement();
      statements.push(stmt);
    }

    return { type: 'block', statements };
  }

  private parseStatement(): Statement {
    this.skipWhitespace();

    // Variable declaration
    if (this.match('let') || this.match('const')) {
      const savedPos = this.pos - (this.code[this.pos - 3] === 'l' ? 3 : 5);
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

    // Try to parse assignment or expression statement
    // We need to look ahead to see if it's an assignment (identifier = expr)
    const savedPos = this.pos;
    const identifier = this.parseIdentifier();
    this.skipWhitespace();

    if (identifier && this.code[this.pos] === '=') {
      // It's an assignment
      this.pos++; // consume '='
      const value = this.parseExpression();
      this.expect(';');
      return { type: 'assignment', name: identifier, value };
    } else {
      // It's an expression statement, backtrack
      this.pos = savedPos;
      const expr = this.parseExpression();
      this.expect(';');
      return expr;
    }
  }

  private parseIfStatement(): IfStatement {
    this.expect('(');
    const condition = this.parseExpression();
    this.expect(')');
    this.expect('{');
    const thenBlock = this.parseBlock();
    this.expect('}');

    let elseBlock: BlockStatement | null = null;
    if (this.match('else')) {
      this.expect('{');
      elseBlock = this.parseBlock();
      this.expect('}');
    }

    return { type: 'if', condition, thenBlock, elseBlock };
  }

  private parseVariableDeclaration(): VariableDeclaration {
    const kind = this.match('let') ? 'let' : (this.match('const'), 'const');
    const name = this.parseIdentifier();
    this.expect('=');
    const value = this.parseExpression();
    this.expect(';');

    return { type: 'variable_declaration', kind, name, value };
  }

  private parseExpression(): Expression {
    return this.parseLogicalOr();
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
    let left = this.parseComparison();

    while (true) {
      this.skipWhitespace();
      const ch = this.code[this.pos];
      const ch2 = this.code[this.pos + 1];

      if (ch === '&' && ch2 === '&') {
        this.pos += 2;
        const right = this.parseComparison();
        left = { type: 'binary', op: '&&', left, right };
      } else {
        break;
      }
    }

    return left;
  }

  private parseComparison(): Expression {
    let left = this.parseAdditive();

    while (true) {
      this.skipWhitespace();
      const ch = this.code[this.pos];
      const ch2 = this.code[this.pos + 1];

      let op = '';

      // Two-character operators
      if ((ch === '<' || ch === '>' || ch === '=' || ch === '!') && ch2 === '=') {
        op = ch + ch2;
        this.pos += 2;
      }
      // Single-character operators
      else if (ch === '<' || ch === '>') {
        op = ch;
        this.pos++;
      }

      if (op) {
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

      if (op === '*' || op === '/') {
        this.pos++;
        const right = this.parsePrimary();
        left = { type: 'binary', op, left, right };
      } else {
        break;
      }
    }

    return left;
  }

  private parsePrimary(): Expression {
    this.skipWhitespace();

    // Check for 'new' keyword
    if (this.match('new')) {
      const className = this.parseIdentifier();
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
      const newExpr: NewNode = { type: 'new', className, args };
      // Handle member access on new expression
      return this.parsePostfixExpressions(newExpr);
    }

    // Check for 'this' keyword
    if (this.match('this')) {
      const thisExpr: ThisNode = { type: 'this' };
      return this.parsePostfixExpressions(thisExpr);
    }

    // Check for unary ! operator
    if (this.code[this.pos] === '!') {
      this.pos++;
      const operand = this.parsePrimary();
      return { type: 'unary', op: '!', operand };
    }

    // Check for parentheses
    if (this.code[this.pos] === '(') {
      this.pos++;
      const expr = this.parseExpression();
      this.expect(')');
      return expr;
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

    // Check for string literal
    if (this.code[this.pos] === '"' || this.code[this.pos] === "'") {
      return { type: 'string', value: this.parseString() };
    }

    // Check for number
    if (/[0-9]/.test(this.code[this.pos])) {
      return { type: 'number', value: this.parseNumber() };
    }

    // Check for identifier (variable or function call)
    const name = this.parseIdentifier();
    this.skipWhitespace();

    if (this.code[this.pos] === '(') {
      // Function call
      return this.parseFunctionCallWithName(name);
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
      this.pos = savedPos;
      return null;
    }
  }

  private parseFunctionCallWithName(name: string): CallNode {
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

  private parseImport(): void {
    // import { name1, name2 } from 'module'
    this.expect('{');

    const specifiers: string[] = [];
    this.skipWhitespace();
    if (this.code[this.pos] !== '}') {
      specifiers.push(this.parseIdentifier());
      while (this.match(',')) {
        specifiers.push(this.parseIdentifier());
      }
    }
    this.expect('}');
    this.expect('from');

    const source = this.parseString();
    this.skipWhitespace();
    if (this.code[this.pos] === ';') {
      this.pos++; // consume semicolon
    }

    this.imports.push({ type: 'import', specifiers, source });
  }

  private parseExport(): void {
    // export function name() { ... }
    if (!this.match('function')) {
      throw new Error(`Expected 'function' after 'export' at position ${this.pos}`);
    }

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

    const func: FunctionNode = { name, params, body };
    this.exports.push({ type: 'export', declaration: func });
    // Also add to functions list for codegen
    this.functions.push(func);
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
      // Parse first property
      const key = this.parseIdentifier();
      this.expect(':');
      const value = this.parseExpression();
      properties.push({ key, value });

      while (this.match(',')) {
        this.skipWhitespace();
        // Allow trailing comma
        if (this.code[this.pos] === '}') break;
        const key = this.parseIdentifier();
        this.expect(':');
        const value = this.parseExpression();
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
        if (this.code[this.pos] === '(') {
          // Method call
          expr = this.parseMethodCall(expr, property);
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
      } else {
        break;
      }
    }
    return expr;
  }
}
