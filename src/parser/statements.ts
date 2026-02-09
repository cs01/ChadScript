import { Expression, BlockStatement, Statement, VariableDeclaration, AssignmentStatement, IfStatement, WhileStatement, ForStatement, ForOfStatement, BinaryNode, MemberAccessNode, MemberAccessAssignmentNode, IndexAccessNode, IndexAccessAssignmentNode, SwitchStatement, SwitchCase } from '../ast/types.js';
import { ParserContext } from './declarations.js';

export function parseBlock(ctx: ParserContext): BlockStatement {
  const statements: Statement[] = [];

  while (true) {
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === '}') {
      break;
    }

    if (ctx.match('//')) {
      while (ctx.pos < ctx.code.length && ctx.code[ctx.pos] !== '\n') {
        ctx.pos++;
      }
      continue;
    }

    const stmt = parseStatement(ctx);
    statements.push(stmt);
  }

  return { type: 'block', statements };
}

function parseBlockOrStatement(ctx: ParserContext): BlockStatement {
  ctx.skipWhitespace();
  if (ctx.code[ctx.pos] === '{') {
    ctx.expect('{');
    const block = parseBlock(ctx);
    ctx.expect('}');
    return block;
  } else {
    const stmt = parseStatement(ctx);
    return { type: 'block', statements: [stmt] };
  }
}

export function parseStatement(ctx: ParserContext): Statement {
  ctx.skipWhitespace();

  if (ctx.match('let') || ctx.match('const') || ctx.match('var')) {
    const savedPos = ctx.pos - (ctx.code[ctx.pos - 3] === 'l' ? 3 : (ctx.code[ctx.pos - 3] === 'v' ? 3 : 5));
    ctx.pos = savedPos;
    return ctx.parseVariableDeclaration();
  }

  if (ctx.match('return')) {
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === ';') {
      ctx.pos++;
      return { type: 'return', value: { type: 'number', value: 0 } };
    }
    const value = ctx.parseExpression();
    ctx.expect(';');
    return { type: 'return', value };
  }

  if (ctx.match('if')) {
    return parseIfStatement(ctx);
  }

  if (ctx.match('while')) {
    return parseWhileStatement(ctx);
  }

  if (ctx.match('for')) {
    return parseForStatement(ctx);
  }

  if (ctx.match('break')) {
    ctx.expect(';');
    return { type: 'break' };
  }

  if (ctx.match('continue')) {
    ctx.expect(';');
    return { type: 'continue' };
  }

  if (ctx.match('throw')) {
    const argument = ctx.parseExpression();
    ctx.expect(';');
    return { type: 'throw', argument };
  }

  if (ctx.match('try')) {
    ctx.expect('{');
    const tryBlock = parseBlock(ctx);
    ctx.expect('}');

    let catchClause: { param: string; body: BlockStatement } | null = null;
    if (ctx.match('catch')) {
      ctx.skipWhitespace();
      let param = '__unused__';
      if (ctx.code[ctx.pos] === '(') {
        ctx.expect('(');
        ctx.skipWhitespace();
        param = ctx.parseIdentifier();
        ctx.skipWhitespace();
        if (ctx.code[ctx.pos] === ':') {
          ctx.pos++;
          ctx.skipTypeAnnotation();
        }
        ctx.expect(')');
      }
      ctx.expect('{');
      const body = parseBlock(ctx);
      ctx.expect('}');
      catchClause = { param, body };
    }

    let finallyBlock: BlockStatement | null = null;
    if (ctx.match('finally')) {
      ctx.expect('{');
      finallyBlock = parseBlock(ctx);
      ctx.expect('}');
    }

    return { type: 'try', tryBlock, catchClause, finallyBlock };
  }

  if (ctx.match('switch')) {
    return parseSwitchStatement(ctx);
  }

  if (ctx.code[ctx.pos] === '{') {
    ctx.expect('{');
    const block = parseBlock(ctx);
    ctx.expect('}');
    return block;
  }

  const savedPos = ctx.pos;

  const leftExpr = ctx.parsePrimary();
  ctx.skipWhitespace();

  const ch = ctx.code[ctx.pos];
  const ch2 = ctx.code[ctx.pos + 1];

  let compoundOp: string | null = null;
  if ((ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '|' || ch === '&') && ch2 === '=') {
    compoundOp = ch;
    ctx.pos += 2;
  } else if (ch === '=' && ch2 !== '=') {
    ctx.pos++;
  } else {
    ctx.pos = savedPos;
    const expr = ctx.parseExpression();
    ctx.expect(';');
    return expr;
  }

  const value = ctx.parseExpression();
  ctx.expect(';');

  let finalValue: Expression = value;
  if (compoundOp) {
    finalValue = {
      type: 'binary',
      op: compoundOp,
      left: leftExpr,
      right: value
    } as BinaryNode;
  }

  if (leftExpr.type === 'variable') {
    return { type: 'assignment', name: leftExpr.name, value: finalValue };
  } else if (leftExpr.type === 'member_access') {
    const memberExpr = leftExpr as MemberAccessNode;
    const memberAssignment: MemberAccessAssignmentNode = {
      type: 'member_access_assignment',
      object: memberExpr.object,
      property: memberExpr.property,
      value: finalValue
    };
    return {
      type: 'assignment',
      name: `__member_access__${memberExpr.property}__`,
      value: memberAssignment as unknown as Expression
    };
  } else if (leftExpr.type === 'index_access') {
    const indexExpr = leftExpr as IndexAccessNode;
    const indexAssignment: IndexAccessAssignmentNode = {
      type: 'index_access_assignment',
      object: indexExpr.object,
      index: indexExpr.index,
      value: finalValue
    };
    return {
      type: 'assignment',
      name: '__index_access__',
      value: indexAssignment as unknown as Expression
    };
  } else {
    throw new Error(`Cannot assign to ${leftExpr.type}`);
  }
}

export function parseIfStatement(ctx: ParserContext): IfStatement {
  ctx.expect('(');
  const condition = ctx.parseExpression();
  ctx.expect(')');

  const thenBlock = parseBlockOrStatement(ctx);

  let elseBlock: BlockStatement | null = null;
  if (ctx.match('else')) {
    elseBlock = parseBlockOrStatement(ctx);
  }

  return { type: 'if', condition, thenBlock, elseBlock };
}

export function parseWhileStatement(ctx: ParserContext): WhileStatement {
  ctx.expect('(');
  const condition = ctx.parseExpression();
  ctx.expect(')');
  const body = parseBlockOrStatement(ctx);

  return { type: 'while', condition, body };
}

export function parseForStatement(ctx: ParserContext): ForStatement | ForOfStatement {
  ctx.expect('(');

  ctx.skipWhitespace();
  const savedPos = ctx.pos;

  let kind: 'let' | 'const' | 'var' | null = null;
  if (ctx.match('const')) {
    kind = 'const';
  } else if (ctx.match('let')) {
    kind = 'let';
  } else if (ctx.match('var')) {
    kind = 'var';
  }

  if (kind) {
    ctx.skipWhitespace();

    if (ctx.code[ctx.pos] === '[') {
      ctx.pos++;
      const destructuredVars: string[] = [];
      ctx.skipWhitespace();
      if (ctx.code[ctx.pos] !== ']') {
        destructuredVars.push(ctx.parseIdentifier());
        while (ctx.match(',')) {
          destructuredVars.push(ctx.parseIdentifier());
        }
      }
      ctx.expect(']');
      ctx.skipWhitespace();
      if (ctx.match('of')) {
        ctx.skipWhitespace();
        const iterable = ctx.parseExpression();
        ctx.expect(')');
        const body = parseBlockOrStatement(ctx);
        return {
          type: 'for_of',
          variableKind: kind,
          variableName: destructuredVars[0] || '__unused__',
          destructuredNames: destructuredVars,
          iterable,
          body
        };
      }
      ctx.pos = savedPos;
    }

    const varName = ctx.parseIdentifier();
    ctx.skipWhitespace();

    if (ctx.code[ctx.pos] === '=' && ctx.code[ctx.pos + 1] !== '=') {
      ctx.pos = savedPos;
    } else if (ctx.match('of')) {
      ctx.skipWhitespace();
      const iterable = ctx.parseExpression();
      ctx.expect(')');
      const body = parseBlockOrStatement(ctx);
      return {
        type: 'for_of',
        variableKind: kind,
        variableName: varName,
        iterable,
        body
      };
    } else {
      ctx.pos = savedPos;
    }
  }

  let init: VariableDeclaration | AssignmentStatement | null = null;
  ctx.skipWhitespace();
  if (ctx.code[ctx.pos] !== ';') {
    if (ctx.match('let') || ctx.match('const') || ctx.match('var')) {
      const savedPos2 = ctx.pos - (ctx.code[ctx.pos - 3] === 'l' ? 3 : (ctx.code[ctx.pos - 3] === 'v' ? 3 : 5));
      ctx.pos = savedPos2;
      init = ctx.parseVariableDeclaration();
    } else {
      const leftExpr = ctx.parseExpression();
      ctx.skipWhitespace();
      if (ctx.code[ctx.pos] === '=') {
        ctx.pos++;
        const value = ctx.parseExpression();
        if (leftExpr.type === 'variable') {
          init = { type: 'assignment', name: leftExpr.name, value };
        } else {
          throw new Error(`Cannot assign to ${leftExpr.type} in for loop init`);
        }
      }
      ctx.expect(';');
    }
  } else {
    ctx.expect(';');
  }

  let condition: Expression | null = null;
  ctx.skipWhitespace();
  if (ctx.code[ctx.pos] !== ';') {
    condition = ctx.parseExpression();
  }
  ctx.expect(';');

  let update: AssignmentStatement | Expression | null = null;
  ctx.skipWhitespace();
  if (ctx.code[ctx.pos] !== ')') {
    const leftExpr = ctx.parseExpression();
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === '=') {
      ctx.pos++;
      const value = ctx.parseExpression();
      if (leftExpr.type === 'variable') {
        update = { type: 'assignment', name: leftExpr.name, value };
      } else {
        throw new Error(`Cannot assign to ${leftExpr.type} in for loop update`);
      }
    } else {
      update = leftExpr;
    }
  }
  ctx.expect(')');

  const body = parseBlockOrStatement(ctx);

  return { type: 'for', init, condition, update, body };
}

export function parseVariableDeclaration(ctx: ParserContext): VariableDeclaration {
  let kind: 'let' | 'const' = 'let';
  if (ctx.match('let')) {
    kind = 'let';
  } else if (ctx.match('const')) {
    kind = 'const';
  } else if (ctx.match('var')) {
    kind = 'let';
  } else {
    throw new Error('Expected let, const, or var');
  }

  ctx.skipWhitespace();

  if (ctx.code[ctx.pos] === '{') {
    ctx.pos++;
    ctx.skipWhitespace();
    let depth = 1;
    while (ctx.pos < ctx.code.length && depth > 0) {
      if (ctx.code[ctx.pos] === '{') depth++;
      else if (ctx.code[ctx.pos] === '}') depth--;
      ctx.pos++;
    }
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === '=') {
      ctx.pos++;
      ctx.parseExpression();
    }
    ctx.skipWhitespace();
    ctx.expect(';');
    return { type: 'variable_declaration', kind, name: '__destructured__', value: null, declaredType: undefined };
  }

  if (ctx.code[ctx.pos] === '[') {
    ctx.pos++;
    ctx.skipWhitespace();
    let depth = 1;
    while (ctx.pos < ctx.code.length && depth > 0) {
      if (ctx.code[ctx.pos] === '[') depth++;
      else if (ctx.code[ctx.pos] === ']') depth--;
      ctx.pos++;
    }
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === '=') {
      ctx.pos++;
      ctx.parseExpression();
    }
    ctx.skipWhitespace();
    ctx.expect(';');
    return { type: 'variable_declaration', kind, name: '__destructured__', value: null, declaredType: undefined };
  }

  const name = ctx.parseIdentifier();
  ctx.skipWhitespace();

  let declaredType: string | undefined;
  if (ctx.code[ctx.pos] === ':') {
    ctx.pos++;
    ctx.skipWhitespace();
    const typeStart = ctx.pos;
    ctx.skipTypeAnnotation();
    const typeEnd = ctx.pos;
    declaredType = ctx.code.substring(typeStart, typeEnd).trim();
    ctx.skipWhitespace();
  }

  let value: Expression | null = null;
  if (ctx.code[ctx.pos] === '=') {
    ctx.pos++;
    value = ctx.parseExpression();
    ctx.skipWhitespace();
  }

  while (ctx.code[ctx.pos] === ',') {
    ctx.pos++;
    ctx.skipWhitespace();
    ctx.parseIdentifier();
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === '=') {
      ctx.pos++;
      ctx.parseExpression();
      ctx.skipWhitespace();
    }
  }

  ctx.expect(';');

  return { type: 'variable_declaration', kind, name, value, declaredType };
}

export function parseTryStatementTopLevel(ctx: ParserContext): void {
  ctx.expect('{');
  parseBlock(ctx);
  ctx.expect('}');

  if (ctx.match('catch')) {
    ctx.expect('(');
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] !== ')') {
      ctx.parseIdentifier();
      ctx.skipWhitespace();
      if (ctx.match('as')) {
        ctx.skipWhitespace();
        ctx.parseIdentifier();
      }
    }
    ctx.expect(')');
    ctx.expect('{');
    parseBlock(ctx);
    ctx.expect('}');
  }
}

function parseSwitchStatement(ctx: ParserContext): SwitchStatement {
  ctx.expect('(');
  ctx.skipWhitespace();
  const discriminant = ctx.parseExpression();
  ctx.expect(')');
  ctx.expect('{');

  const cases: SwitchCase[] = [];

  while (true) {
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === '}') {
      break;
    }

    if (ctx.match('case')) {
      ctx.skipWhitespace();
      const test = ctx.parseExpression();
      ctx.expect(':');
      const consequent: Statement[] = [];

      while (true) {
        ctx.skipWhitespace();
        if (ctx.code[ctx.pos] === '}') break;
        if (ctx.match('case')) {
          ctx.pos -= 4;
          break;
        }
        if (ctx.match('default')) {
          ctx.pos -= 7;
          break;
        }
        const stmt = parseStatement(ctx);
        consequent.push(stmt);
      }

      cases.push({ test, consequent });
    } else if (ctx.match('default')) {
      ctx.expect(':');
      const consequent: Statement[] = [];

      while (true) {
        ctx.skipWhitespace();
        if (ctx.code[ctx.pos] === '}') break;
        if (ctx.match('case')) {
          ctx.pos -= 4;
          break;
        }
        const stmt = parseStatement(ctx);
        consequent.push(stmt);
      }

      cases.push({ test: null, consequent });
    } else {
      throw new Error(`Unexpected token in switch statement at position ${ctx.pos}`);
    }
  }

  ctx.expect('}');
  return { type: 'switch', discriminant, cases };
}
