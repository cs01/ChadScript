import { Expression, ArrayNode, ObjectNode, MethodCallNode, VariableNode, BinaryNode, NumberNode } from '../ast/types.js';
import { ParserContext } from './declarations.js';
import { formatUnsupportedFeatureError } from './unsupported-features.js';

export interface LiteralParserContext extends ParserContext {
  parseNumber(): number;
}

export function parseTemplateLiteral(ctx: LiteralParserContext, parseExpressionFn: (ctx: LiteralParserContext) => Expression): Expression {
  ctx.pos++;
  const parts: Expression[] = [];
  let currentString = '';

  while (ctx.pos < ctx.code.length) {
    if (ctx.code[ctx.pos] === '`') {
      if (currentString) {
        parts.push({ type: 'string', value: currentString });
      }
      ctx.pos++;
      break;
    } else if (ctx.code[ctx.pos] === '$' && ctx.code[ctx.pos + 1] === '{') {
      if (currentString) {
        parts.push({ type: 'string', value: currentString });
        currentString = '';
      }
      ctx.pos += 2;
      ctx.skipWhitespace();

      let braceDepth = 1;
      let exprCode = '';

      while (ctx.pos < ctx.code.length && braceDepth > 0) {
        if (ctx.code[ctx.pos] === '{') {
          braceDepth++;
          exprCode += ctx.code[ctx.pos++];
        } else if (ctx.code[ctx.pos] === '}') {
          braceDepth--;
          if (braceDepth > 0) {
            exprCode += ctx.code[ctx.pos++];
          } else {
            ctx.pos++;
          }
        } else if (ctx.code[ctx.pos] === '"' || ctx.code[ctx.pos] === "'") {
          const quote = ctx.code[ctx.pos];
          exprCode += ctx.code[ctx.pos++];
          while (ctx.pos < ctx.code.length && ctx.code[ctx.pos] !== quote) {
            if (ctx.code[ctx.pos] === '\\') {
              exprCode += ctx.code[ctx.pos++];
              if (ctx.pos < ctx.code.length) {
                exprCode += ctx.code[ctx.pos++];
              }
            } else {
              exprCode += ctx.code[ctx.pos++];
            }
          }
          if (ctx.pos < ctx.code.length) {
            exprCode += ctx.code[ctx.pos++];
          }
        } else {
          exprCode += ctx.code[ctx.pos++];
        }
      }

      const savedPos = ctx.pos;
      const savedCode = ctx.code;
      ctx.code = exprCode;
      ctx.pos = 0;
      const expr = parseExpressionFn(ctx);
      ctx.code = savedCode;
      ctx.pos = savedPos;

      parts.push(expr);
    } else if (ctx.code[ctx.pos] === '\\') {
      ctx.pos++;
      if (ctx.pos >= ctx.code.length) {
        throw new Error('Unterminated template literal');
      }
      const escaped = ctx.code[ctx.pos];
      if (escaped === 'n') currentString += '\n';
      else if (escaped === 't') currentString += '\t';
      else if (escaped === 'r') currentString += '\r';
      else if (escaped === '\\') currentString += '\\';
      else if (escaped === '`') currentString += '`';
      else if (escaped === '$') currentString += '$';
      else currentString += escaped;
      ctx.pos++;
    } else {
      currentString += ctx.code[ctx.pos++];
    }
  }

  if (ctx.pos >= ctx.code.length && ctx.code[ctx.pos - 1] !== '`') {
    throw new Error('Unterminated template literal');
  }

  if (parts.length === 0) {
    return { type: 'string', value: '' };
  }

  if (parts.length === 1) {
    return parts[0];
  }

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

export function parseRegex(ctx: LiteralParserContext): { type: 'regex'; pattern: string; flags: string } | null {
  if (ctx.code[ctx.pos] !== '/') {
    return null;
  }
  ctx.pos++;

  let pattern = '';
  let escaped = false;

  while (ctx.pos < ctx.code.length) {
    const ch = ctx.code[ctx.pos];

    if (escaped) {
      pattern += ch;
      escaped = false;
      ctx.pos++;
      continue;
    }

    if (ch === '\\') {
      pattern += ch;
      escaped = true;
      ctx.pos++;
      continue;
    }

    if (ch === '/') {
      ctx.pos++;
      break;
    }

    if (ch === '\n') {
      throw new Error('Unterminated regex at position ' + ctx.pos);
    }

    pattern += ch;
    ctx.pos++;
  }

  let flags = '';
  while (ctx.pos < ctx.code.length && /[gimsuvy]/.test(ctx.code[ctx.pos])) {
    flags += ctx.code[ctx.pos++];
  }

  return { type: 'regex', pattern, flags };
}

export function parseArrayLiteral(ctx: LiteralParserContext, parseExpressionFn: (ctx: LiteralParserContext) => Expression): ArrayNode {
  ctx.expect('[');
  const elements: Expression[] = [];
  ctx.skipWhitespace();
  if (ctx.code[ctx.pos] !== ']') {
    if (ctx.code[ctx.pos] === '.' && ctx.code[ctx.pos + 1] === '.' && ctx.code[ctx.pos + 2] === '.') {
      ctx.pos += 3;
      ctx.skipWhitespace();
    }
    elements.push(parseExpressionFn(ctx));
    while (ctx.match(',')) {
      ctx.skipWhitespace();
      if (ctx.code[ctx.pos] === ']') break;
      if (ctx.code[ctx.pos] === '.' && ctx.code[ctx.pos + 1] === '.' && ctx.code[ctx.pos + 2] === '.') {
        ctx.pos += 3;
        ctx.skipWhitespace();
      }
      elements.push(parseExpressionFn(ctx));
    }
  }
  ctx.expect(']');
  return { type: 'array', elements };
}

export function parseObjectLiteral(ctx: LiteralParserContext, parseExpressionFn: (ctx: LiteralParserContext) => Expression): ObjectNode {
  ctx.expect('{');
  const properties: { key: string; value: Expression; spread?: boolean }[] = [];
  ctx.skipWhitespace();
  if (ctx.code[ctx.pos] !== '}') {
    if (ctx.code[ctx.pos] === '.' && ctx.code[ctx.pos + 1] === '.' && ctx.code[ctx.pos + 2] === '.') {
      ctx.pos += 3;
      ctx.skipWhitespace();
      const spreadExpr = parseExpressionFn(ctx);
      properties.push({ key: '__spread__', value: spreadExpr, spread: true });
    } else {
      let key: string;
      if (ctx.code[ctx.pos] === '"' || ctx.code[ctx.pos] === "'") {
        key = ctx.parseString();
      } else {
        key = ctx.parseIdentifier();
      }
      ctx.skipWhitespace();

      let value: Expression;
      if (ctx.code[ctx.pos] === ':') {
        ctx.pos++;
        value = parseExpressionFn(ctx);
      } else {
        value = { type: 'variable', name: key };
      }
      properties.push({ key, value });
    }

    while (ctx.match(',')) {
      ctx.skipWhitespace();
      if (ctx.code[ctx.pos] === '}') break;
      if (ctx.code[ctx.pos] === '.' && ctx.code[ctx.pos + 1] === '.' && ctx.code[ctx.pos + 2] === '.') {
        ctx.pos += 3;
        ctx.skipWhitespace();
        const spreadExpr = parseExpressionFn(ctx);
        properties.push({ key: '__spread__', value: spreadExpr, spread: true });
      } else {
        let key: string;
        if (ctx.code[ctx.pos] === '"' || ctx.code[ctx.pos] === "'") {
          key = ctx.parseString();
        } else {
          key = ctx.parseIdentifier();
        }
        ctx.skipWhitespace();

        let value: Expression;
        if (ctx.code[ctx.pos] === ':') {
          ctx.pos++;
          value = parseExpressionFn(ctx);
        } else {
          value = { type: 'variable', name: key };
        }
        properties.push({ key, value });
      }
    }
  }
  ctx.expect('}');
  return { type: 'object', properties };
}

export function parseMethodCall(ctx: LiteralParserContext, object: Expression, methodName: string, parseExpressionFn: (ctx: LiteralParserContext) => Expression): MethodCallNode {
  if (object.type === 'variable' && (object as VariableNode).name === 'Object') {
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

  ctx.expect('(');
  const args: Expression[] = [];
  ctx.skipWhitespace();
  if (ctx.code[ctx.pos] !== ')') {
    args.push(parseExpressionFn(ctx));
    while (ctx.match(',')) {
      args.push(parseExpressionFn(ctx));
    }
  }
  ctx.expect(')');
  return { type: 'method_call', object, method: methodName, args };
}

export function parsePostfixExpressions(ctx: LiteralParserContext, expr: Expression, parseExpressionFn: (ctx: LiteralParserContext) => Expression): Expression {
  while (true) {
    ctx.skipWhitespace();
    const isOptionalChain = ctx.code[ctx.pos] === '?' && ctx.code[ctx.pos + 1] === '.';
    if (ctx.code[ctx.pos] === '.' || isOptionalChain) {
      ctx.pos += isOptionalChain ? 2 : 1;
      const property = ctx.parseIdentifier();
      ctx.skipWhitespace();

      let typeParameter: string | undefined;
      if (ctx.code[ctx.pos] === '<') {
        const savedPos = ctx.pos;
        ctx.pos++;
        ctx.skipWhitespace();

        const startPos = ctx.pos;
        while (ctx.pos < ctx.code.length && /[a-zA-Z0-9_]/.test(ctx.code[ctx.pos])) {
          ctx.pos++;
        }
        let potentialType = ctx.code.substring(startPos, ctx.pos);
        ctx.skipWhitespace();

        if (ctx.code[ctx.pos] === '[' && ctx.code[ctx.pos + 1] === ']') {
          ctx.pos += 2;
          potentialType += '[]';
          ctx.skipWhitespace();
        }

        if (ctx.code[ctx.pos] === '>' && potentialType.length > 0) {
          ctx.pos++;
          ctx.skipWhitespace();
          if (ctx.code[ctx.pos] === '(') {
            typeParameter = potentialType;
          } else {
            ctx.pos = savedPos;
          }
        } else {
          ctx.pos = savedPos;
        }
      }

      if (ctx.code[ctx.pos] === '(') {
        expr = parseMethodCall(ctx, expr, property, parseExpressionFn);
        if (typeParameter) {
          (expr as MethodCallNode).typeParameter = typeParameter;
        }
      } else {
        expr = { type: 'member_access', object: expr, property };
      }
    } else if (ctx.code[ctx.pos] === '[') {
      ctx.pos++;
      const index = parseExpressionFn(ctx);
      ctx.expect(']');
      expr = { type: 'index_access', object: expr, index };
    } else if (ctx.code[ctx.pos] === '(' && expr.type === 'super') {
      ctx.pos++;
      const args: Expression[] = [];
      ctx.skipWhitespace();
      if (ctx.code[ctx.pos] !== ')') {
        args.push(parseExpressionFn(ctx));
        while (ctx.match(',')) {
          args.push(parseExpressionFn(ctx));
        }
      }
      ctx.expect(')');
      expr = { type: 'method_call', object: expr, method: '', args };
    } else if (ctx.code[ctx.pos] === '+' && ctx.code[ctx.pos + 1] === '+') {
      ctx.pos += 2;
      if (expr.type === 'variable') {
        const one: NumberNode = { type: 'number', value: 1 };
        expr = { type: 'binary', op: '+', left: expr, right: one } as BinaryNode;
      }
    } else if (ctx.code[ctx.pos] === '-' && ctx.code[ctx.pos + 1] === '-') {
      ctx.pos += 2;
      if (expr.type === 'variable') {
        const one: NumberNode = { type: 'number', value: 1 };
        expr = { type: 'binary', op: '-', left: expr, right: one } as BinaryNode;
      }
    } else if (ctx.code[ctx.pos] === '!' && ctx.code[ctx.pos + 1] !== '=') {
      ctx.pos++;
    } else {
      ctx.skipWhitespace();
      if (ctx.code.slice(ctx.pos, ctx.pos + 3) === 'as ' && ctx.pos > 0) {
        ctx.pos += 3;
        ctx.skipWhitespace();
        const typeStart = ctx.pos;
        let braceDepth = 0;
        let angleBracketDepth = 0;
        let assertedType = '';

        if (ctx.code[ctx.pos] === '{') {
          braceDepth = 1;
          assertedType += ctx.code[ctx.pos++];
          while (ctx.pos < ctx.code.length && braceDepth > 0) {
            if (ctx.code[ctx.pos] === '{') braceDepth++;
            if (ctx.code[ctx.pos] === '}') braceDepth--;
            assertedType += ctx.code[ctx.pos++];
          }
          if (ctx.code[ctx.pos] === '[' && ctx.code[ctx.pos + 1] === ']') {
            assertedType += '[]';
            ctx.pos += 2;
          }
        } else {
          let bracketDepth = 0;
          while (ctx.pos < ctx.code.length) {
            const ch = ctx.code[ctx.pos];
            if (bracketDepth > 0 && (ch === "'" || ch === '"')) {
              const quote = ch;
              assertedType += ctx.code[ctx.pos++];
              while (ctx.pos < ctx.code.length && ctx.code[ctx.pos] !== quote) {
                if (ctx.code[ctx.pos] === '\\') {
                  assertedType += ctx.code[ctx.pos++];
                }
                assertedType += ctx.code[ctx.pos++];
              }
              if (ctx.code[ctx.pos] === quote) {
                assertedType += ctx.code[ctx.pos++];
              }
            } else if (/[a-zA-Z0-9_<>\[\],\| ]/.test(ch)) {
              if (ch === '<') angleBracketDepth++;
              if (ch === '>') angleBracketDepth--;
              if (ch === '[') bracketDepth++;
              if (ch === ']') bracketDepth--;
              assertedType += ctx.code[ctx.pos++];
              if (angleBracketDepth === 0 && bracketDepth === 0) {
                const peekAhead = ctx.code[ctx.pos];
                if (peekAhead === ';' || peekAhead === ')' || peekAhead === ',' || peekAhead === '}' || peekAhead === ']') {
                  break;
                }
                if (/\s/.test(peekAhead)) {
                  const restOfLine = ctx.code.slice(ctx.pos).trim();
                  if (restOfLine.startsWith(';') || restOfLine.startsWith(')') || restOfLine.startsWith(',') || restOfLine.startsWith('}')) {
                    break;
                  }
                }
              }
            } else {
              break;
            }
          }
        }

        if (assertedType.trim().length === 0) {
          ctx.pos = typeStart - 3;
          break;
        } else {
          expr = { type: 'type_assertion', expression: expr, assertedType: assertedType.trim() };
        }
      } else {
        break;
      }
    }
  }
  return expr;
}
