import { AST, Expression, FunctionNode, CallNode, MethodCallNode, BlockStatement, Statement, VariableDeclaration, AssignmentStatement, IfStatement, WhileStatement, ForStatement, ImportDeclaration, ExportDeclaration, ObjectNode, ArrayNode, MapNode, SetNode, ClassNode, ClassMethod, NewNode, ThisNode } from '../ast/types.js';

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
      } else if (this.match('let') || this.match('const')) {
        // Parse variable declaration at top level
        const savedPos = this.pos - (this.code[this.pos - 3] === 'l' ? 3 : 5);
        this.pos = savedPos;
        const varDecl = this.parseVariableDeclaration();
        // Top-level variables are parsed but not stored in AST
        // They're available for later expressions in the same parse context
        // Skip the semicolon if present
        this.skipWhitespace();
        if (this.code[this.pos] === ';') {
          this.pos++;
        }
      } else if (this.match('//')) {
        this.skipComment();
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
          // Set as entry point if it's a call, new, or method call
          if (expr.type === 'call' || expr.type === 'new' || expr.type === 'method_call') {
            this.entryPoint = expr as any;
          }
        } catch (e) {
          // If parsing fails, it's not a valid entry point
          // Just continue to next iteration
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

    // While loop
    if (this.match('while')) {
      return this.parseWhileStatement();
    }

    // For loop
    if (this.match('for')) {
      return this.parseForStatement();
    }

    // Try to parse assignment or expression statement
    // We need to look ahead to see if it's an assignment
    // This could be: identifier = expr OR this.field = expr OR instance.field = expr
    const savedPos = this.pos;
    
    // Try to parse an expression (could be identifier, this.field, etc.)
    const leftExpr = this.parseExpression();
    this.skipWhitespace();
    
    if (this.code[this.pos] === '=') {
      // It's an assignment
      this.pos++; // consume '='
      const value = this.parseExpression();
      this.expect(';');
      
      // Check if leftExpr is a simple variable
      if (leftExpr.type === 'variable') {
        return { type: 'assignment', name: leftExpr.name, value };
      } else if (leftExpr.type === 'member_access') {
        // Handle member access assignment (this.field = value or instance.field = value)
        // Store as assignment with special name format to indicate member access
        // We'll use a special format: "member_access:<property>" and store the object in a custom way
        // For now, we'll use a hack: store as assignment with empty name and check in codegen
        return { 
          type: 'assignment', 
          name: `__member_access__${(leftExpr as any).property}__`, // Special marker
          value: { type: 'member_access_assignment', object: (leftExpr as any).object, property: (leftExpr as any).property, value } as any
        } as any;
      } else {
        throw new Error(`Cannot assign to ${leftExpr.type}`);
      }
    } else {
      // It's an expression statement
      this.expect(';');
      return leftExpr;
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

    // Parse init (can be let/const declaration, assignment, or empty)
    let init: VariableDeclaration | AssignmentStatement | null = null;
    this.skipWhitespace();
    if (this.code[this.pos] !== ';') {
      if (this.match('let') || this.match('const')) {
        const savedPos = this.pos - (this.code[this.pos - 3] === 'l' ? 3 : 5);
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
    } else {
      throw new Error('Expected let or const');
    }
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

      // Special handling for Map and Set constructors
      if (className === 'Map' || className === 'Set') {
        this.expect('(');
        this.skipWhitespace();

        // For now, just expect empty constructor
        this.expect(')');

        if (className === 'Map') {
          const mapExpr: MapNode = { type: 'map', entries: [] };
          return this.parsePostfixExpressions(mapExpr);
        } else {
          const setExpr: SetNode = { type: 'set', values: [] };
          return this.parsePostfixExpressions(setExpr);
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
