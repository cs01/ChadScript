import { Expression, BlockStatement, Statement, VariableDeclaration, AssignmentStatement, IfStatement, WhileStatement, ForStatement, ForOfStatement, BinaryNode, MemberAccessNode, MemberAccessAssignmentNode } from '../ast/types.js';
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
      ctx.expect('(');
      ctx.skipWhitespace();
      const param = ctx.parseIdentifier();
      ctx.expect(')');
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
  } else {
    throw new Error(`Cannot assign to ${leftExpr.type}`);
  }
}

export function parseIfStatement(ctx: ParserContext): IfStatement {
  ctx.expect('(');
  const condition = ctx.parseExpression();
  ctx.expect(')');

  let thenBlock: BlockStatement;
  ctx.skipWhitespace();
  if (ctx.code[ctx.pos] === '{') {
    ctx.expect('{');
    thenBlock = parseBlock(ctx);
    ctx.expect('}');
  } else {
    const stmt = parseStatement(ctx);
    thenBlock = { type: 'block', statements: [stmt] };
  }

  let elseBlock: BlockStatement | null = null;
  if (ctx.match('else')) {
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === '{') {
      ctx.expect('{');
      elseBlock = parseBlock(ctx);
      ctx.expect('}');
    } else {
      const stmt = parseStatement(ctx);
      elseBlock = { type: 'block', statements: [stmt] };
    }
  }

  return { type: 'if', condition, thenBlock, elseBlock };
}

export function parseWhileStatement(ctx: ParserContext): WhileStatement {
  ctx.expect('(');
  const condition = ctx.parseExpression();
  ctx.expect(')');
  ctx.expect('{');
  const body = parseBlock(ctx);
  ctx.expect('}');

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
    const varName = ctx.parseIdentifier();
    ctx.skipWhitespace();

    if (ctx.code[ctx.pos] === '=' && ctx.code[ctx.pos + 1] !== '=') {
      ctx.pos = savedPos;
    } else if (ctx.match('of')) {
      ctx.skipWhitespace();
      const iterable = ctx.parseExpression();
      ctx.expect(')');
      ctx.expect('{');
      const body = parseBlock(ctx);
      ctx.expect('}');
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

  ctx.expect('{');
  const body = parseBlock(ctx);
  ctx.expect('}');

  return { type: 'for', init, condition, update, body };
}

export function parseVariableDeclaration(ctx: ParserContext): VariableDeclaration {
  let kind: 'let' | 'const';
  if (ctx.match('let')) {
    kind = 'let';
  } else if (ctx.match('const')) {
    kind = 'const';
  } else if (ctx.match('var')) {
    kind = 'let';
  } else {
    throw new Error('Expected let, const, or var');
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
  const tryBlock = parseBlock(ctx);
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
    const catchBlock = parseBlock(ctx);
    ctx.expect('}');
  }
}
