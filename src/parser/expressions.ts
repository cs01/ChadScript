import { Expression, BlockStatement, CallNode, MapNode, SetNode, NewNode, ThisNode, SuperNode, StringNode } from '../ast/types.js';
import { ParserContext } from './declarations.js';
import { formatUnsupportedFeatureError } from './unsupported-features.js';
import { parseBlock } from './statements.js';
import { parseTemplateLiteral, parseRegex, parseArrayLiteral, parseObjectLiteral, parsePostfixExpressions, LiteralParserContext } from './literals.js';

export interface ExpressionParserContext extends ParserContext {
  parseNumber(): number;
}

export function parseExpression(ctx: ExpressionParserContext): Expression {
  return parseConditional(ctx);
}

export function parseConditional(ctx: ExpressionParserContext): Expression {
  let expr = parseLogicalOr(ctx);

  ctx.skipWhitespace();
  if (ctx.code[ctx.pos] === '?') {
    ctx.pos++;
    const consequent = parseExpression(ctx);
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] !== ':') {
      throw new Error(`Expected ':' in conditional expression at position ${ctx.pos}`);
    }
    ctx.pos++;
    const alternate = parseExpression(ctx);
    return { type: 'conditional', condition: expr, consequent, alternate };
  }

  return expr;
}

export function parseLogicalOr(ctx: ExpressionParserContext): Expression {
  let left = parseLogicalAnd(ctx);

  while (true) {
    ctx.skipWhitespace();
    const ch = ctx.code[ctx.pos];
    const ch2 = ctx.code[ctx.pos + 1];

    if (ch === '|' && ch2 === '|') {
      ctx.pos += 2;
      const right = parseLogicalAnd(ctx);
      left = { type: 'binary', op: '||', left, right };
    } else {
      break;
    }
  }

  return left;
}

export function parseLogicalAnd(ctx: ExpressionParserContext): Expression {
  let left = parseBitwiseOr(ctx);

  while (true) {
    ctx.skipWhitespace();
    const ch = ctx.code[ctx.pos];
    const ch2 = ctx.code[ctx.pos + 1];

    if (ch === '&' && ch2 === '&') {
      ctx.pos += 2;
      const right = parseBitwiseOr(ctx);
      left = { type: 'binary', op: '&&', left, right };
    } else {
      break;
    }
  }

  return left;
}

export function parseBitwiseOr(ctx: ExpressionParserContext): Expression {
  let left = parseBitwiseXor(ctx);

  while (true) {
    ctx.skipWhitespace();
    const ch = ctx.code[ctx.pos];
    const ch2 = ctx.code[ctx.pos + 1];

    if (ch === '|' && ch2 !== '|') {
      ctx.pos++;
      const right = parseBitwiseXor(ctx);
      left = { type: 'binary', op: '|', left, right };
    } else {
      break;
    }
  }

  return left;
}

export function parseBitwiseXor(ctx: ExpressionParserContext): Expression {
  let left = parseBitwiseAnd(ctx);

  while (true) {
    ctx.skipWhitespace();
    const ch = ctx.code[ctx.pos];

    if (ch === '^') {
      ctx.pos++;
      const right = parseBitwiseAnd(ctx);
      left = { type: 'binary', op: '^', left, right };
    } else {
      break;
    }
  }

  return left;
}

export function parseBitwiseAnd(ctx: ExpressionParserContext): Expression {
  let left = parseComparison(ctx);

  while (true) {
    ctx.skipWhitespace();
    const ch = ctx.code[ctx.pos];
    const ch2 = ctx.code[ctx.pos + 1];

    if (ch === '&' && ch2 !== '&') {
      ctx.pos++;
      const right = parseComparison(ctx);
      left = { type: 'binary', op: '&', left, right };
    } else {
      break;
    }
  }

  return left;
}

export function parseComparison(ctx: ExpressionParserContext): Expression {
  let left = parseShift(ctx);

  while (true) {
    ctx.skipWhitespace();
    const ch = ctx.code[ctx.pos];
    const ch2 = ctx.code[ctx.pos + 1];
    const ch3 = ctx.code[ctx.pos + 2];

    let op = '';

    if ((ch === '=' && ch2 === '=' && ch3 === '=') ||
        (ch === '!' && ch2 === '=' && ch3 === '=')) {
      op = ch + ch2 + ch3;
      ctx.pos += 3;
    }
    else if ((ch === '<' || ch === '>' || ch === '=' || ch === '!') && ch2 === '=') {
      op = ch + ch2;
      ctx.pos += 2;
    }
    else if ((ch === '<' || ch === '>') && ch2 !== ch) {
      op = ch;
      ctx.pos++;
    }

    if (op) {
      const right = parseShift(ctx);
      left = { type: 'binary', op, left, right };
    } else {
      break;
    }
  }

  return left;
}

export function parseShift(ctx: ExpressionParserContext): Expression {
  let left = parseAdditive(ctx);

  while (true) {
    ctx.skipWhitespace();
    const ch = ctx.code[ctx.pos];
    const ch2 = ctx.code[ctx.pos + 1];

    if ((ch === '<' && ch2 === '<') || (ch === '>' && ch2 === '>')) {
      const op = ch + ch2;
      ctx.pos += 2;
      const right = parseAdditive(ctx);
      left = { type: 'binary', op, left, right };
    } else {
      break;
    }
  }

  return left;
}

export function parseAdditive(ctx: ExpressionParserContext): Expression {
  let left = parseMultiplicative(ctx);

  while (true) {
    ctx.skipWhitespace();
    const op = ctx.code[ctx.pos];

    if (op === '+' || op === '-') {
      ctx.pos++;
      const right = parseMultiplicative(ctx);
      left = { type: 'binary', op, left, right };
    } else {
      break;
    }
  }

  return left;
}

export function parseMultiplicative(ctx: ExpressionParserContext): Expression {
  let left = parsePrimary(ctx);

  while (true) {
    ctx.skipWhitespace();
    const op = ctx.code[ctx.pos];

    if (op === '*' || op === '/' || op === '%') {
      ctx.pos++;
      const right = parsePrimary(ctx);
      left = { type: 'binary', op, left, right };
    } else {
      break;
    }
  }

  return left;
}

export function parsePrimary(ctx: ExpressionParserContext): Expression {
  ctx.skipWhitespace();

  if (ctx.match('new')) {
    const className = ctx.parseIdentifier();

    if (className === 'Map' || className === 'Set') {
      ctx.expect('(');
      ctx.skipWhitespace();
      ctx.expect(')');

      if (className === 'Map') {
        return parsePostfixExpressions(ctx, { type: 'map', entries: [] } as MapNode, parseExpression);
      } else {
        return parsePostfixExpressions(ctx, { type: 'set', values: [] } as SetNode, parseExpression);
      }
    }

    ctx.expect('(');
    const args: Expression[] = [];
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] !== ')') {
      args.push(parseExpression(ctx));
      while (ctx.match(',')) {
        args.push(parseExpression(ctx));
      }
    }
    ctx.expect(')');
    return parsePostfixExpressions(ctx, { type: 'new', className, args } as NewNode, parseExpression);
  }

  if (ctx.match('this')) {
    return parsePostfixExpressions(ctx, { type: 'this' } as ThisNode, parseExpression);
  }

  if (ctx.match('super')) {
    return parsePostfixExpressions(ctx, { type: 'super' } as SuperNode, parseExpression);
  }

  if (ctx.match('void')) {
    parsePrimary(ctx);
    return { type: 'number', value: 0 };
  }

  if (ctx.match('await')) {
    throw new Error(formatUnsupportedFeatureError('await'));
  }

  if (ctx.match('typeof')) {
    throw new Error(formatUnsupportedFeatureError('typeof'));
  }

  if (ctx.match('instanceof')) {
    throw new Error(formatUnsupportedFeatureError('instanceof'));
  }

  if (ctx.code[ctx.pos] === '!') {
    ctx.pos++;
    const operand = parsePrimary(ctx);
    return { type: 'unary', op: '!', operand };
  }

  if (ctx.code[ctx.pos] === '+' || ctx.code[ctx.pos] === '-') {
    const op = ctx.code[ctx.pos];
    ctx.pos++;
    const operand = parsePrimary(ctx);
    return { type: 'unary', op, operand };
  }

  if (ctx.code[ctx.pos] === '(') {
    const savedPos = ctx.pos;
    ctx.pos++;
    ctx.skipWhitespace();

    const params: string[] = [];
    let isArrowFunction = false;

    if (ctx.code[ctx.pos] === ')') {
      ctx.pos++;
      ctx.skipWhitespace();
      if (ctx.code[ctx.pos] === '=' && ctx.code[ctx.pos + 1] === '>') {
        isArrowFunction = true;
      }
    } else {
      try {
        params.push(ctx.parseIdentifier());
        ctx.skipWhitespace();
        while (ctx.code[ctx.pos] === ',') {
          ctx.pos++;
          ctx.skipWhitespace();
          params.push(ctx.parseIdentifier());
          ctx.skipWhitespace();
        }
        if (ctx.code[ctx.pos] === ')') {
          ctx.pos++;
          ctx.skipWhitespace();
          if (ctx.code[ctx.pos] === '=' && ctx.code[ctx.pos + 1] === '>') {
            isArrowFunction = true;
          }
        }
      } catch (e) {
      }
    }

    if (isArrowFunction) {
      ctx.pos += 2;
      ctx.skipWhitespace();
      let body: Expression | BlockStatement;
      if (ctx.code[ctx.pos] === '{') {
        ctx.pos++;
        body = parseBlock(ctx);
        ctx.expect('}');
      } else {
        body = parseExpression(ctx);
      }
      return { type: 'arrow_function', params, body };
    } else {
      ctx.pos = savedPos;
      ctx.pos++;
      const expr = parseExpression(ctx);
      ctx.skipWhitespace();
      if (ctx.match('as')) {
        ctx.skipWhitespace();
        ctx.parseIdentifier();
        ctx.skipWhitespace();
        while (ctx.code[ctx.pos] === '|' || ctx.code[ctx.pos] === '&') {
          ctx.pos++;
          ctx.skipWhitespace();
          ctx.parseIdentifier();
          ctx.skipWhitespace();
        }
      }
      ctx.expect(')');
      return parsePostfixExpressions(ctx, expr, parseExpression);
    }
  }

  if (ctx.code[ctx.pos] === '[') {
    let expr: Expression = parseArrayLiteral(ctx, parseExpression);
    return parsePostfixExpressions(ctx, expr, parseExpression);
  }

  if (ctx.code[ctx.pos] === '{') {
    let expr: Expression = parseObjectLiteral(ctx, parseExpression);
    return parsePostfixExpressions(ctx, expr, parseExpression);
  }

  if (ctx.match('function')) {
    ctx.skipWhitespace();
    ctx.expect('(');

    const params: string[] = [];
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] !== ')') {
      params.push(ctx.parseIdentifier());
      while (ctx.match(',')) {
        params.push(ctx.parseIdentifier());
      }
    }
    ctx.expect(')');
    ctx.skipWhitespace();
    ctx.expect('{');

    const body = parseBlock(ctx);
    ctx.expect('}');

    return { type: 'arrow_function', params, body };
  }

  if (ctx.code[ctx.pos] === '`') {
    return parseTemplateLiteral(ctx, parseExpression);
  }

  if (ctx.code[ctx.pos] === '"' || ctx.code[ctx.pos] === "'") {
    return parsePostfixExpressions(ctx, { type: 'string', value: ctx.parseString() } as StringNode, parseExpression);
  }

  if (ctx.code[ctx.pos] === '/') {
    const savedPos = ctx.pos;
    try {
      const regex = parseRegex(ctx);
      if (regex) {
        return parsePostfixExpressions(ctx, regex, parseExpression);
      }
    } catch (e) {
      ctx.pos = savedPos;
    }
  }

  if (ctx.match('true')) {
    return { type: 'boolean', value: true };
  }
  if (ctx.match('false')) {
    return { type: 'boolean', value: false };
  }

  if (ctx.match('null')) {
    return { type: 'number', value: 0 };
  }

  if (ctx.match('undefined')) {
    return { type: 'number', value: 0 };
  }

  if (ctx.code[ctx.pos] === '-') {
    const nextChar = ctx.code[ctx.pos + 1];
    if (nextChar && /[0-9]/.test(nextChar)) {
      ctx.pos++;
      return { type: 'number', value: -ctx.parseNumber() };
    }
  }

  if (/[0-9]/.test(ctx.code[ctx.pos])) {
    return { type: 'number', value: ctx.parseNumber() };
  }

  const name = ctx.parseIdentifier();
  if (!name) {
    throw new Error(ctx.formatError(`Unexpected character '${ctx.code[ctx.pos]}'`));
  }
  ctx.skipWhitespace();

  if (ctx.code[ctx.pos] === '=' && ctx.code[ctx.pos + 1] === '>') {
    ctx.pos += 2;
    ctx.skipWhitespace();
    let body: Expression | BlockStatement;
    if (ctx.code[ctx.pos] === '{') {
      ctx.pos++;
      body = parseBlock(ctx);
      ctx.expect('}');
    } else {
      body = parseExpression(ctx);
    }
    return { type: 'arrow_function', params: [name], body };
  }

  if (ctx.code[ctx.pos] === '(') {
    const savedPos = ctx.pos;
    ctx.pos++;
    ctx.skipWhitespace();

    const params: string[] = [];
    if (ctx.code[ctx.pos] !== ')') {
      params.push(ctx.parseIdentifier());
      while (ctx.match(',')) {
        params.push(ctx.parseIdentifier());
      }
    }
    ctx.skipWhitespace();

    if (ctx.code[ctx.pos] === ')' && ctx.code[ctx.pos + 1] === '=' && ctx.code[ctx.pos + 2] === '>') {
      ctx.pos += 3;
      ctx.skipWhitespace();
      let body: Expression | BlockStatement;
      if (ctx.code[ctx.pos] === '{') {
        ctx.pos++;
        body = parseBlock(ctx);
        ctx.expect('}');
      } else {
        body = parseExpression(ctx);
      }
      return { type: 'arrow_function', params, body };
    } else {
      ctx.pos = savedPos;
      return parseFunctionCallWithName(ctx, name);
    }
  } else {
    let expr: Expression = { type: 'variable', name };
    return parsePostfixExpressions(ctx, expr, parseExpression);
  }
}

export function parseFunctionCallWithName(ctx: ExpressionParserContext, name: string): CallNode {
  if (name === 'eval') {
    throw new Error(formatUnsupportedFeatureError('eval'));
  }

  ctx.expect('(');

  const args: Expression[] = [];
  ctx.skipWhitespace();
  if (ctx.code[ctx.pos] !== ')') {
    args.push(parseExpression(ctx));
    while (ctx.match(',')) {
      args.push(parseExpression(ctx));
    }
  }
  ctx.expect(')');

  return { type: 'call', name, args };
}
