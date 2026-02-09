import { AST, Expression, FunctionNode, CallNode, MethodCallNode, BlockStatement, VariableDeclaration, ClassNode, NewNode, TypeAliasDeclaration, EnumDeclaration, ImportDeclaration, ExportDeclaration, InterfaceDeclaration, TopLevelItem, AssignmentStatement, TryStatement, ForStatement, ForOfStatement, WhileStatement, IfStatement, VariableNode, MemberAccessNode, IndexAccessNode, BinaryNode } from '../ast/types.js';
import { parseFunction, parseClass, parseInterface, parseImport, parseExport, parseTypeAlias, parseEnum } from './declarations.js';
import { parseBlock, parseIfStatement, parseWhileStatement, parseForStatement, parseVariableDeclaration } from './statements.js';
import { parseExpression as parseExpressionFn, parsePrimary as parsePrimaryFn, ExpressionParserContext } from './expressions.js';

export class Parser implements ExpressionParserContext {
  code: string;
  filename: string;
  pos = 0;
  functions: FunctionNode[] = [];
  classes: ClassNode[] = [];
  imports: ImportDeclaration[] = [];
  exports: ExportDeclaration[] = [];
  interfaces: InterfaceDeclaration[] = [];
  typeAliases: TypeAliasDeclaration[] = [];
  enums: EnumDeclaration[] = [];
  topLevelStatements: (VariableDeclaration | AssignmentStatement)[] = [];
  topLevelExpressions: (CallNode | NewNode | MethodCallNode | ForStatement | ForOfStatement | WhileStatement | IfStatement | TryStatement)[] = [];
  topLevelItems: TopLevelItem[] = [];
  topLevelItemTypes: string[] = [];

  constructor(code: string, filename: string = '<input>') {
    this.code = code;
    this.filename = filename;
  }

  formatError(message: string, position: number = -1, options?: {
    help?: string;
    note?: string;
    suggestion?: string;
    contextLines?: number;
  }): string {
    const pos = position >= 0 ? position : this.pos;
    const lines = this.code.substring(0, pos).split('\n');
    const lineNum = lines.length;
    const col = lines[lines.length - 1].length;

    const allLines = this.code.split('\n');

    const lineNumStr = String(lineNum);
    const lineNumWidth = lineNumStr.length > 2 ? lineNumStr.length : 2;

    const line1 = `${this.filename}:${lineNum}:${col + 1}: \x1b[31m\x1b[1merror:\x1b[0m ${message}\n`;
    const line2 = `\x1b[36m\x1b[1m${' '.repeat(lineNumWidth)} |\x1b[0m\n`;

    let contextOutput = '';
    const numContextLines = options?.contextLines || 1;
    const startLine = Math.max(1, lineNum - numContextLines);
    const endLine = Math.min(allLines.length, lineNum + numContextLines);

    for (let i = startLine; i <= endLine; i++) {
      const currentLineContent = allLines[i - 1] || '';
      const currentLineNumStr = String(i);
      contextOutput += `\x1b[36m\x1b[1m${currentLineNumStr.padStart(lineNumWidth)} |\x1b[0m ${currentLineContent}\n`;

      if (i === lineNum) {
        contextOutput += `\x1b[36m\x1b[1m${' '.repeat(lineNumWidth)} |\x1b[0m ${' '.repeat(col)}\x1b[31m\x1b[1m^\x1b[0m \x1b[31mhere\x1b[0m\n`;
      }
    }

    let result = line1.concat(line2, contextOutput);

    if (options?.suggestion) {
      result += `\x1b[36m\x1b[1m${' '.repeat(lineNumWidth)} |\x1b[0m\n`;
      result += `\x1b[36mFix:\x1b[0m ${options.suggestion}\n`;
    }

    if (options?.note) {
      result += `\x1b[36mNote:\x1b[0m ${options.note}\n`;
    }

    return result;
  }

  parse(): AST {
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
        parseImport(this);
      } else if (this.match('export')) {
        parseExport(this);
      } else if (this.match('interface')) {
        parseInterface(this);
      } else if (this.match('type')) {
        parseTypeAlias(this);
      } else if (this.match('enum')) {
        parseEnum(this);
      } else if (this.match('class')) {
        parseClass(this);
      } else if (this.match('async')) {
        if (this.match('function')) {
          parseFunction(this, true);
        } else {
          throw new Error(this.formatError('Expected "function" after "async"'));
        }
      } else if (this.match('function')) {
        parseFunction(this);
      } else if (this.match('let') || this.match('const') || this.match('var')) {
        const savedPos = this.pos - (this.code[this.pos - 3] === 'l' ? 3 : (this.code[this.pos - 3] === 'v' ? 3 : 5));
        this.pos = savedPos;
        const varDecl = this.parseVariableDeclaration();
        this.topLevelStatements.push(varDecl);
        this.topLevelItems.push(varDecl);
        this.topLevelItemTypes.push('variable_declaration');
        this.skipWhitespace();
        if (this.code[this.pos] === ';') {
          this.pos++;
        }
      } else if (this.match('//')) {
        this.skipComment();
      } else if (this.match('for')) {
        const forStmt = parseForStatement(this);
        this.topLevelExpressions.push(forStmt);
        this.topLevelItems.push(forStmt);
        this.topLevelItemTypes.push('for');
      } else if (this.match('while')) {
        const whileStmt = parseWhileStatement(this);
        this.topLevelExpressions.push(whileStmt);
        this.topLevelItems.push(whileStmt);
        this.topLevelItemTypes.push('while');
      } else if (this.match('if')) {
        const ifStmt = parseIfStatement(this);
        this.topLevelExpressions.push(ifStmt);
        this.topLevelItems.push(ifStmt);
        this.topLevelItemTypes.push('if');
      } else if (this.match('try')) {
        const tryStmt = this.parseTryStatement();
        this.topLevelExpressions.push(tryStmt);
        this.topLevelItems.push(tryStmt);
        this.topLevelItemTypes.push('try');
      } else if (this.match('declare')) {
        this.skipDeclareStatement();
      } else {
        const savedPos = this.pos;
        try {
          const leftExpr = this.parsePrimary();
          this.skipWhitespace();

          const ch = this.code[this.pos];
          const ch2 = this.code[this.pos + 1];

          let compoundOp: string | null = null;
          if ((ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '|' || ch === '&') && ch2 === '=') {
            compoundOp = ch;
            this.pos += 2;
          } else if (ch === '=' && ch2 !== '=') {
            this.pos++;
          } else {
            this.pos = savedPos;
            const expr = this.parseExpression();
            this.skipWhitespace();
            if (this.code[this.pos] === ';') {
              this.pos++;
            }
            if (expr.type === 'call' || expr.type === 'new' || expr.type === 'method_call') {
              this.topLevelExpressions.push(expr as CallNode | NewNode | MethodCallNode);
              this.topLevelItems.push(expr);
              this.topLevelItemTypes.push(expr.type);
            }
            continue;
          }

          const value = this.parseExpression();
          this.skipWhitespace();
          if (this.code[this.pos] === ';') {
            this.pos++;
          }

          let finalValue: Expression = value;
          if (compoundOp) {
            finalValue = {
              type: 'binary',
              op: compoundOp,
              left: leftExpr,
              right: value
            } as BinaryNode;
          }

          let assignment: AssignmentStatement;
          if (leftExpr.type === 'variable') {
            assignment = { type: 'assignment', name: (leftExpr as VariableNode).name, value: finalValue };
          } else if (leftExpr.type === 'member_access') {
            const memberExpr = leftExpr as MemberAccessNode;
            assignment = {
              type: 'assignment',
              name: `__member_access__${memberExpr.property}__`,
              value: { type: 'member_access_assignment', object: memberExpr.object, property: memberExpr.property, value: finalValue }
            };
          } else if (leftExpr.type === 'index_access') {
            const indexExpr = leftExpr as IndexAccessNode;
            assignment = {
              type: 'assignment',
              name: '__index_access__',
              value: { type: 'index_access_assignment', object: indexExpr.object, index: indexExpr.index, value: finalValue }
            };
          } else {
            throw new Error(`Cannot assign to ${leftExpr.type}`);
          }

          this.topLevelStatements.push(assignment);
          this.topLevelItems.push(assignment);
          this.topLevelItemTypes.push('assignment');
        } catch (e) {
          const errorMsg = (e as Error).message;
          if (errorMsg && errorMsg.includes('is not supported in ChadScript')) {
            throw e;
          }
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
      interfaces: this.interfaces,
      typeAliases: this.typeAliases,
      enums: this.enums,
      topLevelStatements: this.topLevelStatements,
      topLevelExpressions: this.topLevelExpressions,
      topLevelItems: this.topLevelItems,
      topLevelItemTypes: this.topLevelItemTypes
    };
  }

  skipWhitespace(): void {
    while (this.pos < this.code.length) {
      if (/\s/.test(this.code[this.pos])) {
        this.pos++;
      } else if (this.code[this.pos] === '/' && this.code[this.pos + 1] === '/') {
        this.pos += 2;
        while (this.pos < this.code.length && this.code[this.pos] !== '\n') {
          this.pos++;
        }
      } else if (this.code[this.pos] === '/' && this.code[this.pos + 1] === '*') {
        this.pos += 2;
        while (this.pos < this.code.length - 1 && !(this.code[this.pos] === '*' && this.code[this.pos + 1] === '/')) {
          this.pos++;
        }
        if (this.pos < this.code.length - 1) {
          this.pos += 2;
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

  private skipDeclareStatement(): void {
    this.skipWhitespace();
    if (this.match('function')) {
      while (this.pos < this.code.length && this.code[this.pos] !== ';') {
        this.pos++;
      }
      if (this.code[this.pos] === ';') {
        this.pos++;
      }
    } else if (this.match('const') || this.match('let') || this.match('var') || this.match('class')) {
      this.skipWhitespace();
      this.parseIdentifier();
      this.skipWhitespace();
      if (this.code[this.pos] === ':') {
        this.pos++;
        this.skipWhitespace();
        let braceDepth = 0;
        while (this.pos < this.code.length) {
          const ch = this.code[this.pos];
          if (ch === '{') {
            braceDepth++;
            this.pos++;
          } else if (ch === '}') {
            braceDepth--;
            this.pos++;
            if (braceDepth === 0) {
              this.skipWhitespace();
              if (this.code[this.pos] === ';') {
                this.pos++;
              }
              break;
            }
          } else if (ch === ';' && braceDepth === 0) {
            this.pos++;
            break;
          } else {
            this.pos++;
          }
        }
      } else if (this.code[this.pos] === ';') {
        this.pos++;
      }
    } else {
      while (this.pos < this.code.length && this.code[this.pos] !== ';') {
        this.pos++;
      }
      if (this.code[this.pos] === ';') {
        this.pos++;
      }
    }
  }

  match(str: string): boolean {
    this.skipWhitespace();
    if (this.code.substr(this.pos, str.length) === str) {
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

  expect(str: string): void {
    if (!this.match(str)) {
      let options = { contextLines: 1, help: '', note: '', suggestion: '' };

      if (str === ';') {
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

      throw new Error(this.formatError(`Expected '${str}'`, this.pos, options));
    }
  }

  parseIdentifier(): string {
    this.skipWhitespace();
    let name = '';
    while (this.pos < this.code.length && /[a-zA-Z0-9_]/.test(this.code[this.pos])) {
      name += this.code[this.pos++];
    }
    return name;
  }

  parseNumber(): number {
    this.skipWhitespace();
    let num = '';
    if (this.code[this.pos] === '0' && (this.code[this.pos + 1] === 'x' || this.code[this.pos + 1] === 'X')) {
      num += this.code[this.pos++];
      num += this.code[this.pos++];
      while (this.pos < this.code.length && /[0-9a-fA-F]/.test(this.code[this.pos])) {
        num += this.code[this.pos++];
      }
      return parseInt(num, 16);
    }
    while (this.pos < this.code.length && /[0-9.]/.test(this.code[this.pos])) {
      num += this.code[this.pos++];
    }
    return parseFloat(num);
  }

  parseTypeAnnotation(): 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | null {
    this.skipWhitespace();

    if (this.match('string')) {
      this.skipWhitespace();
      if (this.code[this.pos] === '[' && this.code[this.pos + 1] === ']') {
        this.pos += 2;
        return 'string[]';
      }
      return 'string';
    } else if (this.match('number')) {
      this.skipWhitespace();
      if (this.code[this.pos] === '[' && this.code[this.pos + 1] === ']') {
        this.pos += 2;
        return 'number[]';
      }
      return 'number';
    } else if (this.match('boolean')) {
      this.skipWhitespace();
      if (this.code[this.pos] === '[' && this.code[this.pos + 1] === ']') {
        this.pos += 2;
        return 'boolean[]';
      }
      return 'boolean';
    } else if (this.match('void')) {
      return 'void';
    }

    this.skipTypeAnnotation();
    return null;
  }

  skipTypeAnnotation(): void {
    this.skipWhitespace();

    if (this.match('keyof')) {
      this.skipWhitespace();
      this.skipTypeAnnotation();
      return;
    }

    if (this.match('typeof')) {
      this.skipWhitespace();
      this.skipTypeAnnotation();
      return;
    }

    if (this.code[this.pos] === '{') {
      this.pos++;
      this.skipWhitespace();
      while (this.pos < this.code.length && this.code[this.pos] !== '}') {
        if (this.code[this.pos] === '[') {
          this.pos++;
          this.skipWhitespace();
          this.parseIdentifier();
          this.skipWhitespace();
          if (this.code[this.pos] === ':') {
            this.pos++;
            this.skipWhitespace();
            this.skipTypeAnnotation();
          }
          this.skipWhitespace();
          if (this.code[this.pos] === ']') {
            this.pos++;
          }
          this.skipWhitespace();
          if (this.code[this.pos] === ':') {
            this.pos++;
            this.skipWhitespace();
            this.skipTypeAnnotation();
          }
          this.skipWhitespace();
          if (this.code[this.pos] === ';' || this.code[this.pos] === ',') {
            this.pos++;
          }
          this.skipWhitespace();
          continue;
        }
        if (/[a-zA-Z_]/.test(this.code[this.pos])) {
          this.parseIdentifier();
        }
        this.skipWhitespace();
        if (this.code[this.pos] === '?') {
          this.pos++;
          this.skipWhitespace();
        }
        if (this.code[this.pos] === ':') {
          this.pos++;
          this.skipWhitespace();
          this.skipTypeAnnotation();
        }
        this.skipWhitespace();
        if (this.code[this.pos] === ';' || this.code[this.pos] === ',') {
          this.pos++;
        }
        this.skipWhitespace();
      }
      if (this.code[this.pos] === '}') {
        this.pos++;
      }
      this.skipWhitespace();
      while (this.code[this.pos] === '[') {
        this.pos++;
        this.skipWhitespace();
        if (this.code[this.pos] === "'" || this.code[this.pos] === '"') {
          const quote = this.code[this.pos];
          this.pos++;
          while (this.pos < this.code.length && this.code[this.pos] !== quote) {
            if (this.code[this.pos] === '\\') {
              this.pos++;
            }
            this.pos++;
          }
          if (this.code[this.pos] === quote) {
            this.pos++;
          }
          this.skipWhitespace();
        }
        if (this.code[this.pos] === ']') {
          this.pos++;
        }
      }
    } else if (this.code[this.pos] === '(') {
      this.pos++;
      this.skipWhitespace();
      const afterParen = this.pos;
      let isGroupedType = false;
      if (/[a-zA-Z_]/.test(this.code[this.pos])) {
        this.parseIdentifier();
        this.skipWhitespace();
        if (this.code[this.pos] === '|' || this.code[this.pos] === '&' || this.code[this.pos] === ')' || this.code[this.pos] === '[' || this.code[this.pos] === '<') {
          isGroupedType = true;
          this.pos = afterParen;
        } else {
          this.pos = afterParen;
        }
      } else if (this.code[this.pos] === "'" || this.code[this.pos] === '"') {
        isGroupedType = true;
      }
      if (isGroupedType) {
        this.skipTypeAnnotation();
        this.skipWhitespace();
      }
      while (this.pos < this.code.length && this.code[this.pos] !== ')') {
        if (this.code[this.pos] === '|' || this.code[this.pos] === '&') {
          this.pos++;
          this.skipWhitespace();
          this.skipTypeAnnotation();
          this.skipWhitespace();
          continue;
        }
        if (this.code[this.pos] === "'" || this.code[this.pos] === '"') {
          const quote = this.code[this.pos];
          this.pos++;
          while (this.pos < this.code.length && this.code[this.pos] !== quote) {
            if (this.code[this.pos] === '\\') {
              this.pos++;
            }
            this.pos++;
          }
          if (this.code[this.pos] === quote) {
            this.pos++;
          }
          this.skipWhitespace();
          continue;
        }
        if (/[a-zA-Z_]/.test(this.code[this.pos])) {
          this.parseIdentifier();
        }
        this.skipWhitespace();
        if (this.code[this.pos] === '?') {
          this.pos++;
          this.skipWhitespace();
        }
        if (this.code[this.pos] === ':') {
          this.pos++;
          this.skipWhitespace();
          this.skipTypeAnnotation();
        }
        this.skipWhitespace();
        if (this.code[this.pos] === ',') {
          this.pos++;
        }
        this.skipWhitespace();
      }
      if (this.code[this.pos] === ')') {
        this.pos++;
      }
      this.skipWhitespace();
      if (this.code[this.pos] === '=' && this.code[this.pos + 1] === '>') {
        this.pos += 2;
        this.skipWhitespace();
        this.skipTypeAnnotation();
      }
      this.skipWhitespace();
      while (this.code[this.pos] === '[') {
        this.pos++;
        this.skipWhitespace();
        if (this.code[this.pos] === "'" || this.code[this.pos] === '"') {
          const quote = this.code[this.pos];
          this.pos++;
          while (this.pos < this.code.length && this.code[this.pos] !== quote) {
            if (this.code[this.pos] === '\\') {
              this.pos++;
            }
            this.pos++;
          }
          if (this.code[this.pos] === quote) {
            this.pos++;
          }
          this.skipWhitespace();
        }
        if (this.code[this.pos] === ']') {
          this.pos++;
        }
      }
    } else if (this.code[this.pos] === "'" || this.code[this.pos] === '"') {
      const quote = this.code[this.pos];
      this.pos++;
      while (this.pos < this.code.length && this.code[this.pos] !== quote) {
        if (this.code[this.pos] === '\\') {
          this.pos++;
        }
        this.pos++;
      }
      if (this.code[this.pos] === quote) {
        this.pos++;
      }
    } else if (/[a-zA-Z_]/.test(this.code[this.pos])) {
      this.parseIdentifier();
      while (this.code[this.pos] === '.') {
        this.pos++;
        this.parseIdentifier();
      }
      this.skipWhitespace();
      if (this.match('is')) {
        this.skipTypeAnnotation();
        return;
      }
      if (this.code[this.pos] === '<') {
        this.pos++;
        this.skipTypeAnnotation();
        this.skipWhitespace();
        while (this.code[this.pos] === ',') {
          this.pos++;
          this.skipWhitespace();
          this.skipTypeAnnotation();
        }
        this.skipWhitespace();
        if (this.code[this.pos] === '>') {
          this.pos++;
        }
      }
      this.skipWhitespace();
      while (this.code[this.pos] === '[') {
        this.pos++;
        this.skipWhitespace();
        if (this.code[this.pos] === "'" || this.code[this.pos] === '"') {
          const quote = this.code[this.pos];
          this.pos++;
          while (this.pos < this.code.length && this.code[this.pos] !== quote) {
            if (this.code[this.pos] === '\\') {
              this.pos++;
            }
            this.pos++;
          }
          if (this.code[this.pos] === quote) {
            this.pos++;
          }
          this.skipWhitespace();
        }
        if (this.code[this.pos] === ']') {
          this.pos++;
        }
      }
    }

    this.skipWhitespace();
    while (this.code[this.pos] === '|' || this.code[this.pos] === '&') {
      this.pos++;
      this.skipWhitespace();
      this.skipTypeAnnotation();
      this.skipWhitespace();
    }
  }

  parseBlock(): BlockStatement {
    return parseBlock(this);
  }

  parseExpression(): Expression {
    return parseExpressionFn(this);
  }

  parseVariableDeclaration(): VariableDeclaration {
    return parseVariableDeclaration(this);
  }

  parsePrimary(): Expression {
    return parsePrimaryFn(this);
  }

  parseString(): string {
    this.skipWhitespace();
    const quote = this.code[this.pos];
    if (quote !== '"' && quote !== "'") {
      throw new Error(`Expected string at position ${this.pos}`);
    }
    this.pos++;

    let str = '';
    while (this.pos < this.code.length && this.code[this.pos] !== quote) {
      if (this.code[this.pos] === '\\') {
        this.pos++;
        if (this.pos >= this.code.length) {
          throw new Error('Unterminated string');
        }
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
    this.pos++;
    return str;
  }

  private parseTryStatement(): TryStatement {
    this.expect('{');
    const tryBlock = this.parseBlock();
    this.expect('}');

    let catchClause: { param: string; body: BlockStatement } | null = null;
    if (this.match('catch')) {
      this.expect('(');
      this.skipWhitespace();
      const param = this.parseIdentifier();
      this.expect(')');
      this.expect('{');
      const body = this.parseBlock();
      this.expect('}');
      catchClause = { param, body };
    }

    let finallyBlock: BlockStatement | null = null;
    if (this.match('finally')) {
      this.expect('{');
      finallyBlock = this.parseBlock();
      this.expect('}');
    }

    return { type: 'try', tryBlock, catchClause, finallyBlock };
  }
}
