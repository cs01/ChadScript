import { FunctionNode, ClassNode, ClassMethod, ImportDeclaration, ExportDeclaration, BlockStatement, TypeAliasDeclaration, EnumDeclaration } from '../ast/types.js';
import { formatUnsupportedFeatureError } from './unsupported-features.js';

export interface ParserContext {
  code: string;
  pos: number;
  filename: string;
  functions: FunctionNode[];
  classes: ClassNode[];
  imports: ImportDeclaration[];
  exports: ExportDeclaration[];
  interfaces: any[];
  typeAliases: TypeAliasDeclaration[];
  enums: EnumDeclaration[];
  topLevelStatements: any[];
  topLevelItems: any[];
  skipWhitespace(): void;
  match(str: string): boolean;
  expect(str: string): void;
  parseIdentifier(): string;
  parseBlock(): BlockStatement;
  parseExpression(): any;
  parseVariableDeclaration(): any;
  parseString(): string;
  skipTypeAnnotation(): void;
  parseTypeAnnotation(): 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | null;
  formatError(message: string, position?: number, options?: any): string;
}

export function parseInterface(ctx: ParserContext): void {
  const name = ctx.parseIdentifier();
  ctx.expect('{');

  const fields: { name: string; type: string }[] = [];

  while (ctx.pos < ctx.code.length) {
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === '}') {
      break;
    }

    const fieldName = ctx.parseIdentifier();
    ctx.skipWhitespace();

    if (ctx.code[ctx.pos] === ':') {
      ctx.pos++;
      ctx.skipWhitespace();

      const typeStart = ctx.pos;
      ctx.skipTypeAnnotation();
      const typeEnd = ctx.pos;
      const fieldType = ctx.code.substring(typeStart, typeEnd).trim();

      fields.push({ name: fieldName, type: fieldType });
      ctx.skipWhitespace();

      if (ctx.code[ctx.pos] === ';') {
        ctx.pos++;
      }
    } else if (ctx.code[ctx.pos] === ';') {
      ctx.pos++;
    } else {
      ctx.pos++;
    }
  }

  ctx.expect('}');
  ctx.interfaces.push({ name, fields });
}

export function parseTypeAlias(ctx: ParserContext): void {
  const name = ctx.parseIdentifier();
  ctx.skipWhitespace();
  ctx.expect('=');
  ctx.skipWhitespace();

  const unionMembers: string[] = [];
  const firstMember = ctx.parseIdentifier();
  unionMembers.push(firstMember);

  ctx.skipWhitespace();
  while (ctx.code[ctx.pos] === '|') {
    ctx.pos++;
    ctx.skipWhitespace();
    const nextMember = ctx.parseIdentifier();
    unionMembers.push(nextMember);
    ctx.skipWhitespace();
  }

  if (ctx.code[ctx.pos] === ';') {
    ctx.pos++;
  }

  ctx.typeAliases.push({ name, unionMembers });
}

export function parseEnum(ctx: ParserContext): void {
  const name = ctx.parseIdentifier();
  ctx.skipWhitespace();
  ctx.expect('{');

  const members: { name: string; value: number }[] = [];
  let autoValue = 0;

  while (ctx.pos < ctx.code.length) {
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === '}') {
      break;
    }

    const memberName = ctx.parseIdentifier();
    ctx.skipWhitespace();

    let memberValue: number;
    if (ctx.code[ctx.pos] === '=') {
      ctx.pos++;
      ctx.skipWhitespace();
      let numStr = '';
      const isNegative = ctx.code[ctx.pos] === '-';
      if (isNegative) {
        numStr += '-';
        ctx.pos++;
      }
      while (ctx.pos < ctx.code.length && /[0-9]/.test(ctx.code[ctx.pos])) {
        numStr += ctx.code[ctx.pos++];
      }
      memberValue = parseInt(numStr, 10);
      autoValue = memberValue + 1;
    } else {
      memberValue = autoValue++;
    }

    members.push({ name: memberName, value: memberValue });
    ctx.skipWhitespace();

    if (ctx.code[ctx.pos] === ',') {
      ctx.pos++;
    }
  }

  ctx.expect('}');
  ctx.enums.push({ name, members });
}

export function parseFunction(ctx: ParserContext, isAsync: boolean = false): void {
  const name = ctx.parseIdentifier();
  ctx.skipWhitespace();

  let typeParameters: string[] | undefined;
  if (ctx.code[ctx.pos] === '<') {
    typeParameters = [];
    ctx.pos++;
    ctx.skipWhitespace();
    const firstParam = ctx.parseIdentifier();
    typeParameters.push(firstParam);
    ctx.skipWhitespace();
    while (ctx.code[ctx.pos] === ',') {
      ctx.pos++;
      ctx.skipWhitespace();
      const nextParam = ctx.parseIdentifier();
      typeParameters.push(nextParam);
      ctx.skipWhitespace();
    }
    ctx.expect('>');
  }

  ctx.expect('(');

  const params: string[] = [];
  const paramTypes: string[] = [];
  ctx.skipWhitespace();
  if (ctx.code[ctx.pos] !== ')') {
    const paramName = ctx.parseIdentifier();
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === ':') {
      ctx.pos++;
      ctx.skipWhitespace();
      const typeStart = ctx.pos;
      ctx.skipTypeAnnotation();
      const paramType = ctx.code.substring(typeStart, ctx.pos).trim();
      paramTypes.push(paramType);
    }
    params.push(paramName);
    while (ctx.match(',')) {
      ctx.skipWhitespace();
      const nextParamName = ctx.parseIdentifier();
      ctx.skipWhitespace();
      if (ctx.code[ctx.pos] === ':') {
        ctx.pos++;
        ctx.skipWhitespace();
        const typeStart = ctx.pos;
        ctx.skipTypeAnnotation();
        const paramType = ctx.code.substring(typeStart, ctx.pos).trim();
        paramTypes.push(paramType);
      }
      params.push(nextParamName);
    }
  }
  ctx.expect(')');

  let returnType: string | undefined;
  ctx.skipWhitespace();
  if (ctx.code[ctx.pos] === ':') {
    ctx.pos++;
    ctx.skipWhitespace();
    const typeStart = ctx.pos;
    ctx.skipTypeAnnotation();
    returnType = ctx.code.substring(typeStart, ctx.pos).trim();
  }

  ctx.expect('{');

  const body = ctx.parseBlock();
  ctx.expect('}');

  ctx.functions.push({ name, params, paramTypes: paramTypes.length > 0 ? paramTypes : undefined, body, returnType, typeParameters, async: isAsync || undefined });
}

export function parseClass(ctx: ParserContext): void {
  const className = ctx.parseIdentifier();

  let extendsClass: string | undefined;
  ctx.skipWhitespace();
  if (ctx.match('extends')) {
    extendsClass = ctx.parseIdentifier();
  }

  ctx.expect('{');

  const fields: { name: string; fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean' }[] = [];
  const methods: ClassMethod[] = [];

  while (true) {
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === '}') {
      break;
    }

    if (ctx.match('private') || ctx.match('public') || ctx.match('protected')) {
      ctx.skipWhitespace();
    }

    const savedPos = ctx.pos;
    const identifier = ctx.parseIdentifier();
    ctx.skipWhitespace();

    if (ctx.code[ctx.pos] === ':') {
      ctx.pos++;
      ctx.skipWhitespace();

      let fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean' = 'double';

      if (ctx.match('string')) {
        ctx.skipWhitespace();
        if (ctx.code[ctx.pos] === '[' && ctx.code[ctx.pos + 1] === ']') {
          ctx.pos += 2;
          fieldType = 'string[]';
        } else {
          fieldType = 'string';
        }
      } else if (ctx.match('number')) {
        ctx.skipWhitespace();
        if (ctx.code[ctx.pos] === '[' && ctx.code[ctx.pos + 1] === ']') {
          ctx.pos += 2;
          fieldType = 'number[]';
        } else {
          fieldType = 'double';
        }
      } else if (ctx.match('boolean')) {
        ctx.skipWhitespace();
        if (ctx.code[ctx.pos] === '[' && ctx.code[ctx.pos + 1] === ']') {
          ctx.pos += 2;
          fieldType = 'boolean[]';
        } else {
          fieldType = 'boolean';
        }
      } else {
        throw new Error(ctx.formatError(`Unsupported field type. Supported types: string, number, string[], number[], boolean[]`));
      }

      ctx.skipWhitespace();
      ctx.expect(';');

      fields.push({ name: identifier, fieldType });
      continue;
    }

    ctx.pos = savedPos;

    const isConstructor = ctx.match('constructor');
    let methodName: string;

    if (isConstructor) {
      methodName = 'constructor';
    } else {
      methodName = ctx.parseIdentifier();
    }

    ctx.expect('(');

    const params: string[] = [];
    const paramTypes: ('string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void')[] = [];
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] !== ')') {
      const paramName = ctx.parseIdentifier();
      let paramType: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | null = null;
      ctx.skipWhitespace();
      if (ctx.code[ctx.pos] === ':') {
        ctx.pos++;
        ctx.skipWhitespace();
        paramType = ctx.parseTypeAnnotation();
      }
      params.push(paramName);
      if (paramType) paramTypes.push(paramType);

      while (ctx.match(',')) {
        ctx.skipWhitespace();
        const nextParamName = ctx.parseIdentifier();
        let nextParamType: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | null = null;
        ctx.skipWhitespace();
        if (ctx.code[ctx.pos] === ':') {
          ctx.pos++;
          ctx.skipWhitespace();
          nextParamType = ctx.parseTypeAnnotation();
        }
        params.push(nextParamName);
        if (nextParamType) paramTypes.push(nextParamType);
      }
    }
    ctx.expect(')');
    let returnType: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | null = null;
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === ':') {
      ctx.pos++;
      ctx.skipWhitespace();
      returnType = ctx.parseTypeAnnotation();
    }
    ctx.expect('{');

    const body = ctx.parseBlock();
    ctx.expect('}');

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

  ctx.expect('}');
  ctx.classes.push({ name: className, extends: extendsClass, fields, methods });
}

export function parseImport(ctx: ParserContext): void {
  ctx.skipWhitespace();

  if (ctx.code[ctx.pos] === '*') {
    ctx.pos++;
    ctx.skipWhitespace();
    ctx.expect('as');
    const namespaceName = ctx.parseIdentifier();
    ctx.skipWhitespace();
    ctx.expect('from');
    const source = ctx.parseString();
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === ';') {
      ctx.pos++;
    }
    ctx.imports.push({ type: 'import', specifiers: [namespaceName], source });
  } else if (ctx.code[ctx.pos] === '{') {
    ctx.pos++;
    const specifiers: string[] = [];
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] !== '}') {
      specifiers.push(ctx.parseIdentifier());
      while (ctx.match(',')) {
        specifiers.push(ctx.parseIdentifier());
      }
    }
    ctx.expect('}');
    ctx.skipWhitespace();
    ctx.expect('from');
    const source = ctx.parseString();
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === ';') {
      ctx.pos++;
    }
    ctx.imports.push({ type: 'import', specifiers, source });
  } else {
    throw new Error(`Unexpected import syntax at position ${ctx.pos}`);
  }
}

export function parseExport(ctx: ParserContext): void {
  if (ctx.match('interface')) {
    parseInterface(ctx);
    return;
  }

  if (ctx.match('const') || ctx.match('let') || ctx.match('var')) {
    const savedPos = ctx.pos - (ctx.code[ctx.pos - 3] === 'l' ? 3 : (ctx.code[ctx.pos - 3] === 'v' ? 3 : 5));
    ctx.pos = savedPos;
    const varDecl = ctx.parseVariableDeclaration();
    ctx.topLevelStatements.push(varDecl);
    ctx.topLevelItems.push(varDecl);
    ctx.skipWhitespace();
    if (ctx.code[ctx.pos] === ';') {
      ctx.pos++;
    }
    return;
  }

  if (ctx.match('function')) {
    const name = ctx.parseIdentifier();
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
    ctx.expect('{');

    const body = ctx.parseBlock();
    ctx.expect('}');

    ctx.exports.push({ type: 'export', declaration: { name, params, body } });
    ctx.functions.push({ name, params, body });
  } else if (ctx.match('class')) {
    const name = ctx.parseIdentifier();

    let extendsClass: string | undefined;
    ctx.skipWhitespace();
    if (ctx.match('extends')) {
      extendsClass = ctx.parseIdentifier();
    }

    ctx.expect('{');

    const fields: { name: string; fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean' }[] = [];
    const methods: ClassMethod[] = [];
    ctx.skipWhitespace();
    while (ctx.code[ctx.pos] !== '}') {
      if (ctx.match('private') || ctx.match('public') || ctx.match('protected')) {
        ctx.skipWhitespace();
      }

      const savedPos = ctx.pos;
      const identifier = ctx.parseIdentifier();
      ctx.skipWhitespace();

      if (ctx.code[ctx.pos] === ':') {
        ctx.pos++;
        ctx.skipWhitespace();

        let fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean' = 'double';
        if (ctx.match('string')) {
          ctx.skipWhitespace();
          if (ctx.code[ctx.pos] === '[' && ctx.code[ctx.pos + 1] === ']') {
            ctx.pos += 2;
            fieldType = 'string[]';
          } else {
            fieldType = 'string';
          }
        } else if (ctx.match('number')) {
          ctx.skipWhitespace();
          if (ctx.code[ctx.pos] === '[' && ctx.code[ctx.pos + 1] === ']') {
            ctx.pos += 2;
            fieldType = 'number[]';
          } else {
            fieldType = 'double';
          }
        } else if (ctx.match('boolean')) {
          ctx.skipWhitespace();
          if (ctx.code[ctx.pos] === '[' && ctx.code[ctx.pos + 1] === ']') {
            ctx.pos += 2;
            fieldType = 'boolean[]';
          } else {
            throw new Error(ctx.formatError(`boolean fields are not supported yet. Only string, number, and their array types are supported.`));
          }
        } else {
          throw new Error(ctx.formatError(`Unsupported field type. Supported types: string, number, string[], number[], boolean[]`));
        }

        ctx.skipWhitespace();
        ctx.expect(';');

        fields.push({ name: identifier, fieldType });
        ctx.skipWhitespace();
        continue;
      }

      ctx.pos = savedPos;

      const isConstructor = ctx.match('constructor');
      const methodName = isConstructor ? 'constructor' : ctx.parseIdentifier();
      ctx.expect('(');

      const params: string[] = [];
      const paramTypes: ('string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void')[] = [];
      ctx.skipWhitespace();
      if (ctx.code[ctx.pos] !== ')') {
        const paramName = ctx.parseIdentifier();
        let paramType: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | null = null;
        ctx.skipWhitespace();
        if (ctx.code[ctx.pos] === ':') {
          ctx.pos++;
          ctx.skipWhitespace();
          paramType = ctx.parseTypeAnnotation();
        }
        params.push(paramName);
        if (paramType) paramTypes.push(paramType);

        while (ctx.match(',')) {
          ctx.skipWhitespace();
          const nextParamName = ctx.parseIdentifier();
          let nextParamType: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | null = null;
          ctx.skipWhitespace();
          if (ctx.code[ctx.pos] === ':') {
            ctx.pos++;
            ctx.skipWhitespace();
            nextParamType = ctx.parseTypeAnnotation();
          }
          params.push(nextParamName);
          if (nextParamType) paramTypes.push(nextParamType);
        }
      }
      ctx.expect(')');
      let returnType: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | null = null;
      ctx.skipWhitespace();
      if (ctx.code[ctx.pos] === ':') {
        ctx.pos++;
        ctx.skipWhitespace();
        returnType = ctx.parseTypeAnnotation();
      }
      ctx.expect('{');

      const body = ctx.parseBlock();
      ctx.expect('}');

      methods.push({ type: 'method', name: methodName, params, paramTypes: paramTypes.length > 0 ? paramTypes : undefined, returnType: returnType || undefined, body, isConstructor });
      ctx.skipWhitespace();
    }
    ctx.expect('}');

    ctx.exports.push({ type: 'export', declaration: { name, extends: extendsClass, fields, methods } });
    ctx.classes.push({ name, extends: extendsClass, fields, methods });
  } else {
    throw new Error(`Expected 'function' or 'class' after 'export' at position ${ctx.pos}`);
  }
}
