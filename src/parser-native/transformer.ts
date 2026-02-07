import { TreeSitterNode, TreeSitterTree, getChild, getNamedChild, getChildByFieldName } from './index.js';
import {
  AST,
  Expression,
  Statement,
  FunctionNode,
  ClassNode,
  ClassMethod,
  ClassField,
  ImportDeclaration,
  ImportSpecifier,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  EnumDeclaration,
  EnumMember,
  VariableDeclaration,
  AssignmentStatement,
  BlockStatement,
  ReturnStatement,
  IfStatement,
  WhileStatement,
  ForStatement,
  ForOfStatement,
  ThrowStatement,
  TryStatement,
  TopLevelItem,
  FunctionParameter,
  StringNode,
  BinaryNode,
  UnaryNode,
  CallNode,
  MethodCallNode,
  MemberAccessNode,
  IndexAccessNode,
  ArrayNode,
  ObjectNode,
  NewNode,
  TemplateLiteralNode,
  ArrowFunctionNode,
  ConditionalExpressionNode,
  RegexNode,
  MapNode,
  SetNode,
  TypeAssertionNode,
} from '../ast/types.js';

interface ExprBase { type: string; }
interface NodeBase { nodePtr: number; source: string; type: string; text: string; startIndex: number; endIndex: number; childCount: number; namedChildCount: number; isNamed: boolean; isNull: boolean; }

function getExprType(expr: Expression | null | undefined): string {
  if (!expr) return '';
  return (expr as ExprBase).type;
}

export function transformTree(tree: TreeSitterTree): AST {
  return transformProgram(tree.rootNode);
}

function transformProgram(node: TreeSitterNode): AST {
  const ast: AST = {
    imports: [],
    functions: [],
    classes: [],
    exports: [],
    interfaces: [],
    typeAliases: [],
    enums: [],
    topLevelStatements: [],
    topLevelExpressions: [],
    topLevelItems: [],
    topLevelItemTypes: [],
  };

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;
    transformTopLevelNode(child, ast);
  }

  return ast;
}

function transformTopLevelNode(node: TreeSitterNode, ast: AST): void {
  switch (node.type) {
    case 'import_statement':
      const importDecl = transformImportStatement(node);
      if (importDecl) {
        ast.imports.push(importDecl);
      }
      break;

    case 'function_declaration':
      const func = transformFunctionDeclaration(node);
      if (func) {
        ast.functions.push(func);
      }
      break;

    case 'class_declaration':
      const cls = transformClassDeclaration(node);
      if (cls) {
        ast.classes.push(cls);
      }
      break;

    case 'interface_declaration':
      const iface = transformInterfaceDeclaration(node);
      if (iface) {
        ast.interfaces.push(iface);
      }
      break;

    case 'type_alias_declaration':
      const typeAlias = transformTypeAliasDeclaration(node);
      if (typeAlias) {
        ast.typeAliases.push(typeAlias);
      }
      break;

    case 'enum_declaration':
      const enumDecl = transformEnumDeclaration(node);
      if (enumDecl) {
        ast.enums.push(enumDecl);
      }
      break;

    case 'lexical_declaration':
    case 'variable_declaration':
      const varDecls = transformLexicalDeclaration(node);
      for (let _vdi = 0; _vdi < varDecls.length; _vdi++) {
        const varDecl = varDecls[_vdi];
        ast.topLevelStatements.push(varDecl);
        ast.topLevelItems!.push(varDecl);
        ast.topLevelItemTypes!.push('variable_declaration');
      }
      break;

    case 'expression_statement':
      handleExpressionStatement(node, ast);
      break;

    case 'for_statement':
      const forStmt = transformForStatement(node);
      if (forStmt) {
        ast.topLevelExpressions.push(forStmt);
        ast.topLevelItems!.push(forStmt);
        ast.topLevelItemTypes!.push('for');
      }
      break;

    case 'for_in_statement':
      const forOfStmt = transformForInStatement(node);
      if (forOfStmt) {
        ast.topLevelExpressions.push(forOfStmt);
        ast.topLevelItems!.push(forOfStmt);
        ast.topLevelItemTypes!.push('for_of');
      }
      break;

    case 'while_statement':
      const whileStmt = transformWhileStatement(node);
      if (whileStmt) {
        ast.topLevelExpressions.push(whileStmt);
        ast.topLevelItems!.push(whileStmt);
        ast.topLevelItemTypes!.push('while');
      }
      break;

    case 'if_statement':
      const ifStmt = transformIfStatement(node);
      if (ifStmt) {
        ast.topLevelExpressions.push(ifStmt);
        ast.topLevelItems!.push(ifStmt);
        ast.topLevelItemTypes!.push('if');
      }
      break;

    case 'try_statement':
      const tryStmt = transformTryStatement(node);
      if (tryStmt) {
        ast.topLevelExpressions.push(tryStmt);
        ast.topLevelItems!.push(tryStmt);
        ast.topLevelItemTypes!.push('try');
      }
      break;

    case 'throw_statement':
      const throwStmt = transformThrowStatement(node);
      if (throwStmt) {
        ast.topLevelItems!.push(throwStmt as TopLevelItem);
        ast.topLevelItemTypes!.push('throw');
      }
      break;

    case 'export_statement':
      handleExportStatement(node, ast);
      break;
  }
}

function handleExpressionStatement(node: TreeSitterNode, ast: AST): void {
  const exprNode = getNamedChild(node, 0);
  if (!exprNode) return;

  const expr = transformExpression(exprNode);
  const e = expr as ExprBase;

  if (e.type === 'member_access_assignment' || e.type === 'index_access_assignment') {
    const memberExprTyped = expr as { type: string; property: string };
    const assignment: AssignmentStatement = {
      type: 'assignment',
      name: e.type === 'member_access_assignment' ? `__member_access__${memberExprTyped.property}__` : '__index_access__',
      value: expr,
    };
    ast.topLevelStatements.push(assignment);
    ast.topLevelItems!.push(assignment);
    ast.topLevelItemTypes!.push('assignment');
  } else if (e.type === 'call' || e.type === 'new' || e.type === 'method_call') {
    ast.topLevelExpressions.push(expr as CallNode | NewNode | MethodCallNode);
    ast.topLevelItems!.push(expr as TopLevelItem);
    ast.topLevelItemTypes!.push(e.type);
  } else if (e.type === 'binary') {
    const binExprTyped = expr as { type: string; op: string; left: Expression; right: Expression };
    if (binExprTyped.op === '=') {
      const leftExprBase = binExprTyped.left as ExprBase;
      const leftExprVar = binExprTyped.left as { type: string; name: string };
      const assignment: AssignmentStatement = {
        type: 'assignment',
        name: leftExprBase.type === 'variable' ? leftExprVar.name : '__unknown__',
        value: binExprTyped.right,
      };
      ast.topLevelStatements.push(assignment);
      ast.topLevelItems!.push(assignment);
      ast.topLevelItemTypes!.push('assignment');
    }
  }
}

function handleExportStatement(node: TreeSitterNode, ast: AST): void {
  const nodeText = (node as NodeBase).text;
  const isTypeOnly = nodeText.startsWith('export type ') || nodeText.startsWith('export type{');

  let exportClause: TreeSitterNode | null = null;
  let sourceString: TreeSitterNode | null = null;

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;

    if (c.type === 'function_declaration') {
      const func = transformFunctionDeclaration(child);
      if (func) {
        ast.functions.push(func);
        ast.exports.push({ type: 'export', declaration: func });
      }
    } else if (c.type === 'class_declaration') {
      const cls = transformClassDeclaration(child);
      if (cls) {
        ast.classes.push(cls);
        ast.exports.push({ type: 'export', declaration: cls });
      }
    } else if (c.type === 'interface_declaration') {
      const iface = transformInterfaceDeclaration(child);
      if (iface) {
        ast.interfaces.push(iface);
      }
    } else if (c.type === 'type_alias_declaration') {
      const typeAlias = transformTypeAliasDeclaration(child);
      if (typeAlias) {
        ast.typeAliases.push(typeAlias);
      }
    } else if (c.type === 'lexical_declaration') {
      const varDecls = transformLexicalDeclaration(child);
      for (let _vdi2 = 0; _vdi2 < varDecls.length; _vdi2++) {
        const varDecl = varDecls[_vdi2];
        ast.topLevelStatements.push(varDecl);
        ast.topLevelItems!.push(varDecl);
        ast.topLevelItemTypes!.push('variable_declaration');
      }
    } else if (c.type === 'export_clause') {
      exportClause = child;
    } else if (c.type === 'string') {
      sourceString = child;
    }
  }

  if (exportClause && sourceString && !isTypeOnly) {
    let source = (sourceString as NodeBase).text;
    if ((source.startsWith('"') && source.endsWith('"')) ||
        (source.startsWith("'") && source.endsWith("'"))) {
      source = source.slice(1, -1);
    }

    const specifiers: string[] = [];
    const ec = exportClause as NodeBase;
    for (let i = 0; i < ec.namedChildCount; i++) {
      const spec = getNamedChild(exportClause, i);
      if (!spec) continue;
      const sp = spec as NodeBase;
      if (sp.type === 'export_specifier') {
        const nameNode = getNamedChild(spec, 0);
        if (nameNode) {
          specifiers.push((nameNode as NodeBase).text);
        }
      }
    }

    if (specifiers.length > 0) {
      ast.imports.push({ type: 'import', specifiers, aliasedSpecifiers: [], source });
    }
  }
}

function transformExpression(node: TreeSitterNode): Expression {
  switch (node.type) {
    case 'number':
      return { type: 'number', value: parseFloat(node.text) };

    case 'string':
      return transformStringNode(node);

    case 'true':
      return { type: 'boolean', value: true };

    case 'false':
      return { type: 'boolean', value: false };

    case 'null':
      return { type: 'variable', name: 'null' };

    case 'undefined':
      return { type: 'variable', name: 'undefined' };

    case 'identifier':
      return { type: 'variable', name: node.text };

    case 'this':
      return { type: 'this' };

    case 'super':
      return { type: 'super' };

    case 'binary_expression':
      return transformBinaryExpression(node);

    case 'unary_expression':
      return transformUnaryExpression(node);

    case 'update_expression':
      return transformUpdateExpression(node);

    case 'call_expression':
      return transformCallExpression(node);

    case 'member_expression':
      return transformMemberExpression(node);

    case 'subscript_expression':
      return transformSubscriptExpression(node);

    case 'array':
      return transformArrayExpression(node);

    case 'object':
      return transformObjectExpression(node);

    case 'new_expression':
      return transformNewExpression(node);

    case 'template_string':
      return transformTemplateString(node);

    case 'arrow_function':
      return transformArrowFunction(node);

    case 'function_expression':
      return transformFunctionExpression(node);

    case 'parenthesized_expression':
      const inner = getNamedChild(node, 0);
      return inner ? transformExpression(inner) : { type: 'variable', name: 'undefined' };

    case 'ternary_expression':
      return transformTernaryExpression(node);

    case 'await_expression':
      return transformAwaitExpression(node);

    case 'regex':
      return transformRegexNode(node);

    case 'assignment_expression':
      return transformAssignmentExpression(node);

    case 'augmented_assignment_expression':
      return transformAugmentedAssignmentExpression(node);

    case 'as_expression':
    case 'type_assertion':
      return transformTypeAssertion(node);

    case 'satisfies_expression':
      const satisfiesExprChild = getNamedChild(node, 0);
      return satisfiesExprChild ? transformExpression(satisfiesExprChild) : { type: 'variable', name: 'undefined' };

    case 'non_null_expression':
      const nnChild = getNamedChild(node, 0);
      return nnChild ? transformExpression(nnChild) : { type: 'variable', name: 'undefined' };

    case 'typeof_expression':
      return transformTypeofExpression(node);

    default:
      return { type: 'variable', name: 'undefined' };
  }
}

function transformTypeAssertion(node: TreeSitterNode): TypeAssertionNode {
  const exprChild = getNamedChild(node, 0);
  const expression = exprChild ? transformExpression(exprChild) : { type: 'variable' as const, name: 'undefined' };

  let assertedType = 'unknown';
  for (let i = 1; i < node.namedChildCount; i++) {
    const typeChild = getNamedChild(node, i);
    if (typeChild) {
      const tc = typeChild as NodeBase;
      if (tc.type !== 'identifier' || tc.text !== 'as') {
        assertedType = tc.text;
        break;
      }
    }
  }

  return {
    type: 'type_assertion',
    expression,
    assertedType
  };
}

function transformStringNode(node: TreeSitterNode): StringNode {
  let text = node.text;
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }
  text = text.replace(/\\n/g, '\n')
             .replace(/\\t/g, '\t')
             .replace(/\\r/g, '\r')
             .replace(/\\\\/g, '\\')
             .replace(/\\"/g, '"')
             .replace(/\\'/g, "'");
  return { type: 'string', value: text };
}

function transformBinaryExpression(node: TreeSitterNode): BinaryNode {
  const left = getNamedChild(node, 0);
  const right = getNamedChild(node, 1);

  let op = '';
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (!c.isNamed) {
      const t = c.type;
      if (['+', '-', '*', '/', '%', '<', '>', '<=', '>=', '==', '===', '!=', '!==',
           '&&', '||', '??', '&', '|', '^', '<<', '>>', '>>>'].includes(t)) {
        op = t;
        break;
      }
      if (t === 'instanceof') {
        op = 'instanceof';
        break;
      }
      if (t === 'in') {
        op = 'in';
        break;
      }
    }
  }

  return {
    type: 'binary',
    op,
    left: left ? transformExpression(left) : { type: 'variable', name: 'undefined' },
    right: right ? transformExpression(right) : { type: 'variable', name: 'undefined' },
  };
}

function transformUnaryExpression(node: TreeSitterNode): UnaryNode {
  let op = '';
  let operandNode: TreeSitterNode | null = null;

  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (!c.isNamed) {
      if (['-', '+', '!', '~'].includes(c.type)) {
        op = c.type;
      }
    } else {
      operandNode = child;
    }
  }

  return {
    type: 'unary',
    op,
    operand: operandNode ? transformExpression(operandNode) : { type: 'variable', name: 'undefined' },
  };
}

function transformUpdateExpression(node: TreeSitterNode): UnaryNode {
  let op = '';
  let isPrefix = true;
  let operandNode: TreeSitterNode | null = null;

  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (!c.isNamed) {
      if (c.type === '++' || c.type === '--') {
        op = c.type;
        isPrefix = i === 0;
      }
    } else {
      operandNode = child;
    }
  }

  if (!isPrefix) {
    op = op === '++' ? 'post++' : 'post--';
  }

  return {
    type: 'unary',
    op,
    operand: operandNode ? transformExpression(operandNode) : { type: 'variable', name: 'undefined' },
  };
}

function transformCallExpression(node: TreeSitterNode): CallNode | MethodCallNode {
  const funcNode = getChildByFieldName(node, 'function');
  const argsNode = getChildByFieldName(node, 'arguments');

  const args: Expression[] = [];
  if (argsNode) {
    const an = argsNode as NodeBase;
    for (let i = 0; i < an.namedChildCount; i++) {
      const argChild = getNamedChild(argsNode, i);
      if (argChild) {
        args.push(transformExpression(argChild));
      }
    }
  }

  let typeParameter: string | undefined;
  const typeArgsNode = getChildByFieldName(node, 'type_arguments');
  if (typeArgsNode) {
    const tan = typeArgsNode as NodeBase;
    if (tan.namedChildCount > 0) {
      const firstTypeArg = getNamedChild(typeArgsNode, 0);
      if (firstTypeArg) {
        typeParameter = (firstTypeArg as NodeBase).text;
      }
    }
  }

  if (!funcNode) {
    return { type: 'call', name: '', args };
  }

  const fn = funcNode as NodeBase;
  if (fn.type === 'member_expression') {
    const objNode = getChildByFieldName(funcNode, 'object');
    const propNode = getChildByFieldName(funcNode, 'property');
    const object = objNode ? transformExpression(objNode) : { type: 'variable' as const, name: 'undefined' };
    const method = propNode ? (propNode as NodeBase).text : '';

    return {
      type: 'method_call',
      object,
      method,
      args,
      typeParameter,
      pos: 0,
    };
  } else if (fn.type === 'identifier') {
    return { type: 'call', name: fn.text, args };
  } else if (fn.type === 'super') {
    return { type: 'call', name: 'super', args };
  } else {
    const callee = transformExpression(funcNode);
    return {
      type: 'method_call',
      object: callee,
      method: '',
      args,
      typeParameter: undefined,
      pos: 0,
    };
  }
}

function transformMemberExpression(node: TreeSitterNode): MemberAccessNode {
  const objNode = getChildByFieldName(node, 'object');
  const propNode = getChildByFieldName(node, 'property');

  return {
    type: 'member_access',
    object: objNode ? transformExpression(objNode) : { type: 'variable', name: 'undefined' },
    property: propNode ? (propNode as NodeBase).text : '',
    optional: false,
  };
}

function transformSubscriptExpression(node: TreeSitterNode): IndexAccessNode {
  const objNode = getChildByFieldName(node, 'object');
  const indexNode = getChildByFieldName(node, 'index');

  return {
    type: 'index_access',
    object: objNode ? transformExpression(objNode) : { type: 'variable', name: 'undefined' },
    index: indexNode ? transformExpression(indexNode) : { type: 'number', value: 0 },
  };
}

function transformArrayExpression(node: TreeSitterNode): ArrayNode {
  const elements: Expression[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (child) {
      elements.push(transformExpression(child));
    }
  }
  return { type: 'array', elements };
}

function transformObjectExpression(node: TreeSitterNode): ObjectNode {
  const properties: { key: string; value: Expression }[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;

    if (c.type === 'pair') {
      const keyNode = getChildByFieldName(child, 'key');
      const valueNode = getChildByFieldName(child, 'value');

      let key = '';
      if (keyNode) {
        const k = keyNode as NodeBase;
        if (k.type === 'property_identifier' || k.type === 'identifier') {
          key = k.text;
        } else if (k.type === 'string') {
          key = k.text.slice(1, -1);
        } else if (k.type === 'computed_property_name') {
          const inner = getNamedChild(keyNode, 0);
          if (inner) {
            const expr = transformExpression(inner);
            const eKey = expr as ExprBase;
            const exprStr = expr as { type: string; value: string };
            const exprVar = expr as { type: string; name: string };
            if (eKey.type === 'string') {
              key = exprStr.value || '';
            } else if (eKey.type === 'variable') {
              key = `[${exprVar.name}]`;
            } else {
              key = '[computed]';
            }
          }
        }
      }

      const value = valueNode ? transformExpression(valueNode) : { type: 'variable' as const, name: 'undefined' };
      properties.push({ key, value });
    } else if (c.type === 'shorthand_property_identifier') {
      const key = c.text;
      properties.push({ key, value: { type: 'variable', name: key } });
    } else if (c.type === 'method_definition') {
      const nameNode = getChildByFieldName(child, 'name');
      const paramsNode = getChildByFieldName(child, 'parameters');
      const bodyNode = getChildByFieldName(child, 'body');

      const key = nameNode ? (nameNode as NodeBase).text : '';
      const params = paramsNode ? extractFunctionParams(paramsNode) : [];
      const body = bodyNode ? transformStatementBlock(bodyNode) : createEmptyBlock();

      const arrowFn: ArrowFunctionNode = {
        type: 'arrow_function',
        params,
        body,
        async: undefined,
        captures: undefined,
      };
      properties.push({ key, value: arrowFn });
    }
  }

  return { type: 'object', properties };
}

function transformNewExpression(node: TreeSitterNode): NewNode | MapNode | SetNode {
  const constructorNode = getChildByFieldName(node, 'constructor');
  const argsNode = getChildByFieldName(node, 'arguments');
  const typeArgsNode = getChildByFieldName(node, 'type_arguments');

  const args: Expression[] = [];
  if (argsNode) {
    const an = argsNode as NodeBase;
    for (let i = 0; i < an.namedChildCount; i++) {
      const child = getNamedChild(argsNode, i);
      if (child) {
        args.push(transformExpression(child));
      }
    }
  }

  let typeArgs: string[] | undefined;
  if (typeArgsNode) {
    const tan = typeArgsNode as NodeBase;
    if (tan.namedChildCount > 0) {
      typeArgs = [];
      for (let ti = 0; ti < tan.namedChildCount; ti++) {
        const targ = getNamedChild(typeArgsNode, ti);
        if (targ) {
          typeArgs.push(extractTypeString(targ));
        }
      }
    }
  }

  const className = constructorNode ? (constructorNode as NodeBase).text : '';

  if (className === 'Map') {
    let keyType: string | undefined;
    let valueType: string | undefined;
    if (typeArgs && typeArgs.length >= 2) {
      keyType = typeArgs[0];
      valueType = typeArgs[1];
    }
    if (args.length > 0) {
      const firstArgType = getExprType(args[0]);
      if (firstArgType === 'array') {
        const elements = (args[0] as ArrayNode).elements;
        const entries: { key: Expression; value: Expression }[] = [];
        for (let ei = 0; ei < elements.length; ei++) {
          const elem = elements[ei];
          const elemType = getExprType(elem);
          if (elemType === 'array' && (elem as ArrayNode).elements.length === 2) {
            entries.push({ key: (elem as ArrayNode).elements[0], value: (elem as ArrayNode).elements[1] });
          } else {
            entries.push({ key: elem, value: { type: 'variable' as const, name: 'undefined' } });
          }
        }
        return { type: 'map', entries, keyType, valueType };
      }
    }
    return { type: 'map', entries: [], keyType, valueType };
  }

  if (className === 'Set') {
    let valueType: string | undefined;
    if (typeArgs && typeArgs.length >= 1) {
      valueType = typeArgs[0];
    }
    if (args.length > 0) {
      const firstArgType = getExprType(args[0]);
      if (firstArgType === 'array') {
        return { type: 'set', values: (args[0] as ArrayNode).elements, valueType };
      }
    }
    return { type: 'set', values: [], valueType };
  }

  return { type: 'new', className, args, typeArgs };
}

function transformTemplateString(node: TreeSitterNode): TemplateLiteralNode | StringNode {
  const parts: (string | Expression)[] = [];
  let hasSubstitutions = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;

    if (c.type === 'string_fragment' || c.type === 'template_content') {
      parts.push({ type: 'string', value: c.text } as Expression);
    } else if (c.type === 'template_substitution') {
      hasSubstitutions = true;
      const exprChild = getNamedChild(child, 0);
      if (exprChild) {
        parts.push(transformExpression(exprChild));
      }
    } else if (c.type === '`') {
      continue;
    } else if (c.isNamed) {
      hasSubstitutions = true;
      parts.push(transformExpression(child));
    }
  }

  if (!hasSubstitutions && parts.length <= 1) {
    let text = '';
    if (parts.length === 1) {
      const firstPart = parts[0] as { type: string; value?: string };
      if (firstPart.type === 'string') {
        text = firstPart.value || '';
      }
    }
    return { type: 'string', value: text };
  }

  return { type: 'template_literal', parts };
}

function transformArrowFunction(node: TreeSitterNode): ArrowFunctionNode {
  const paramsNode = getChildByFieldName(node, 'parameters') || getChildByFieldName(node, 'parameter');
  const bodyNode = getChildByFieldName(node, 'body');

  let params: string[] = [];
  if (paramsNode) {
    const pn = paramsNode as NodeBase;
    if (pn.type === 'identifier') {
      params = [pn.text];
    } else {
      params = extractFunctionParams(paramsNode);
    }
  }

  let body: Expression | BlockStatement;
  if (bodyNode) {
    const bn = bodyNode as NodeBase;
    if (bn.type === 'statement_block') {
      body = transformStatementBlock(bodyNode);
    } else {
      body = transformExpression(bodyNode);
    }
  } else {
    body = createEmptyBlock();
  }

  let isAsync = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (c.type === 'async') {
      isAsync = true;
      break;
    }
  }

  return {
    type: 'arrow_function',
    params,
    body,
    async: isAsync || undefined,
    captures: undefined,
  };
}

function transformFunctionExpression(node: TreeSitterNode): ArrowFunctionNode {
  const paramsNode = getChildByFieldName(node, 'parameters');
  const bodyNode = getChildByFieldName(node, 'body');

  const params = paramsNode ? extractFunctionParams(paramsNode) : [];
  const body = bodyNode ? transformStatementBlock(bodyNode) : createEmptyBlock();

  let isAsync = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (c.type === 'async') {
      isAsync = true;
      break;
    }
  }

  return {
    type: 'arrow_function',
    params,
    body,
    async: isAsync || undefined,
    captures: undefined,
  };
}

function transformTernaryExpression(node: TreeSitterNode): ConditionalExpressionNode {
  const condNode = getChildByFieldName(node, 'condition');
  const consNode = getChildByFieldName(node, 'consequence');
  const altNode = getChildByFieldName(node, 'alternative');

  return {
    type: 'conditional',
    condition: condNode ? transformExpression(condNode) : { type: 'boolean', value: false },
    consequent: consNode ? transformExpression(consNode) : { type: 'variable', name: 'undefined' },
    alternate: altNode ? transformExpression(altNode) : { type: 'variable', name: 'undefined' },
  };
}

function transformAwaitExpression(node: TreeSitterNode): Expression {
  const argNode = getNamedChild(node, 0);
  return {
    type: 'await',
    argument: argNode ? transformExpression(argNode) : { type: 'variable', name: 'undefined' },
  };
}

function transformRegexNode(node: TreeSitterNode): RegexNode {
  const text = (node as NodeBase).text;
  let lastSlash = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text.charAt(i) === '/') {
      lastSlash = i;
      break;
    }
  }
  const pattern = text.slice(1, lastSlash);
  const flags = text.slice(lastSlash + 1);
  return { type: 'regex', pattern, flags };
}

function transformAssignmentExpression(node: TreeSitterNode): Expression {
  const leftNode = getNamedChild(node, 0);
  const rightNode = getNamedChild(node, 1);

  const right = rightNode ? transformExpression(rightNode) : { type: 'variable' as const, name: 'undefined' };

  if (leftNode) {
    const ln = leftNode as NodeBase;
    if (ln.type === 'identifier') {
      return {
        type: 'binary',
        op: '=',
        left: { type: 'variable', name: ln.text },
        right,
      };
    } else if (ln.type === 'member_expression') {
      const obj = transformExpression(leftNode);
      const objBase = obj as ExprBase;
      if (objBase.type === 'member_access') {
        const objTyped = obj as { type: string; object: Expression; property: string };
        return {
          type: 'member_access_assignment',
          object: objTyped.object,
          property: objTyped.property,
          value: right,
        };
      }
    } else if (ln.type === 'subscript_expression') {
      const obj = transformExpression(leftNode);
      const objBase = obj as ExprBase;
      if (objBase.type === 'index_access') {
        const objTyped = obj as { type: string; object: Expression; index: Expression };
        return {
          type: 'index_access_assignment',
          object: objTyped.object,
          index: objTyped.index,
          value: right,
        };
      }
    }
  }

  return right;
}

function transformAugmentedAssignmentExpression(node: TreeSitterNode): Expression {
  const leftNode = getNamedChild(node, 0);
  const rightNode = getNamedChild(node, 1);

  let op = '';
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (!c.isNamed) {
      const t = c.type;
      if (['+=', '-=', '*=', '/=', '%=', '|=', '&=', '^=', '<<=', '>>='].includes(t)) {
        op = t.slice(0, -1);
        break;
      }
    }
  }

  const left = leftNode ? transformExpression(leftNode) : { type: 'variable' as const, name: 'undefined' };
  const right = rightNode ? transformExpression(rightNode) : { type: 'variable' as const, name: 'undefined' };
  const newValue: BinaryNode = { type: 'binary', op, left, right };
  const leftBase = left as ExprBase;

  if (leftNode) {
    const ln = leftNode as NodeBase;
    if (ln.type === 'identifier') {
      return {
        type: 'binary',
        op: '=',
        left,
        right: newValue,
      };
    } else if (ln.type === 'member_expression') {
      if (leftBase.type === 'member_access') {
        const leftTyped = left as { type: string; object: Expression; property: string };
        return {
          type: 'member_access_assignment',
          object: leftTyped.object,
          property: leftTyped.property,
          value: newValue,
        };
      }
    } else if (ln.type === 'subscript_expression') {
      if (leftBase.type === 'index_access') {
        const leftTyped = left as { type: string; object: Expression; index: Expression };
        return {
          type: 'index_access_assignment',
          object: leftTyped.object,
          index: leftTyped.index,
          value: newValue,
        };
      }
    }
  }

  return newValue;
}

function transformTypeofExpression(node: TreeSitterNode): UnaryNode {
  const argNode = getNamedChild(node, 0);
  return {
    type: 'unary',
    op: 'typeof',
    operand: argNode ? transformExpression(argNode) : { type: 'variable', name: 'undefined' },
  };
}

function transformStatement(node: TreeSitterNode): Statement | null {
  switch (node.type) {
    case 'lexical_declaration':
    case 'variable_declaration':
      const decls = transformLexicalDeclaration(node);
      return decls.length > 0 ? decls[0] : null;

    case 'expression_statement':
      return transformExpressionStatementNode(node);

    case 'return_statement':
      return transformReturnStatement(node);

    case 'if_statement':
      return transformIfStatement(node);

    case 'while_statement':
      return transformWhileStatement(node);

    case 'for_statement':
      return transformForStatement(node);

    case 'for_in_statement':
      return transformForInStatement(node);

    case 'break_statement':
      return { type: 'break' };

    case 'continue_statement':
      return { type: 'continue' };

    case 'throw_statement':
      return transformThrowStatement(node);

    case 'try_statement':
      return transformTryStatement(node);

    case 'switch_statement':
      return transformSwitchStatement(node);

    case 'statement_block':
      return null;

    case 'empty_statement':
      return null;

    default:
      return null;
  }
}

function transformExpressionStatementNode(node: TreeSitterNode): Statement | null {
  const exprNode = getNamedChild(node, 0);
  if (!exprNode) return null;
  const en = exprNode as NodeBase;

  const expr = transformExpression(exprNode);

  if (en.type === 'assignment_expression' || en.type === 'augmented_assignment_expression') {
    const leftNode = getNamedChild(exprNode, 0);
    const rightNode = getNamedChild(exprNode, 1);
    if (leftNode) {
      const ln = leftNode as NodeBase;
      if (ln.type === 'identifier') {
        let valueToAssign: Expression;
        if (en.type === 'augmented_assignment_expression') {
          let op = '';
          for (let opIdx = 0; opIdx < exprNode.childCount; opIdx++) {
            const opChild = getChild(exprNode, opIdx);
            if (!opChild) continue;
            const opC = opChild as NodeBase;
            if (!opC.isNamed) {
              const opT = opC.type;
              if (opT === '+=') { op = '+'; break; }
              if (opT === '-=') { op = '-'; break; }
              if (opT === '*=') { op = '*'; break; }
              if (opT === '/=') { op = '/'; break; }
              if (opT === '%=') { op = '%'; break; }
              if (opT === '|=') { op = '|'; break; }
              if (opT === '&=') { op = '&'; break; }
              if (opT === '^=') { op = '^'; break; }
              if (opT === '<<=') { op = '<<'; break; }
              if (opT === '>>=') { op = '>>'; break; }
            }
          }
          const leftExpr: Expression = { type: 'variable', name: ln.text };
          const rightExpr = rightNode ? transformExpression(rightNode) : { type: 'number' as const, value: 0 };
          valueToAssign = { type: 'binary', op, left: leftExpr, right: rightExpr };
        } else {
          valueToAssign = rightNode ? transformExpression(rightNode) : { type: 'number', value: 0 };
        }
        return {
          type: 'assignment',
          name: ln.text,
          value: valueToAssign,
        };
      } else if (ln.type === 'member_expression') {
        return {
          type: 'assignment',
          name: `__member_access__`,
          value: expr,
        };
      } else if (ln.type === 'subscript_expression') {
        return {
          type: 'assignment',
          name: `__index_access__`,
          value: expr,
        };
      }
    }
  }

  return expr;
}

function transformLexicalDeclaration(node: TreeSitterNode): VariableDeclaration[] {
  const declarations: VariableDeclaration[] = [];

  let kind: 'let' | 'const' = 'let';
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (c.type === 'const') {
      kind = 'const';
      break;
    }
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (c.type === 'variable_declarator') {
      const decl = transformVariableDeclarator(child, kind);
      if (decl) {
        declarations.push(decl);
      }
    }
  }

  return declarations;
}

function transformVariableDeclarator(node: TreeSitterNode, kind: 'let' | 'const'): VariableDeclaration | null {
  const nameNode = getNamedChild(node, 0);
  const name = nameNode ? (nameNode as NodeBase).text : '';

  let declaredType: string | undefined;
  let value: Expression | null = null;

  const child1 = getNamedChild(node, 1);
  if (child1) {
    const c1 = child1 as NodeBase;
    if (c1.type === 'type_annotation') {
      declaredType = extractTypeString(child1);
      const child2 = getNamedChild(node, 2);
      if (child2) {
        value = transformExpression(child2);
      }
    } else {
      value = transformExpression(child1);
    }
  }

  return { type: 'variable_declaration', kind, name, value, declaredType };
}

function transformReturnStatement(node: TreeSitterNode): ReturnStatement {
  const exprNode = getNamedChild(node, 0);
  const value = exprNode ? transformExpression(exprNode) : { type: 'variable' as const, name: 'undefined' };
  return { type: 'return', value };
}

function transformIfStatement(node: TreeSitterNode): IfStatement {
  const condNode = getChildByFieldName(node, 'condition');
  const consNode = getChildByFieldName(node, 'consequence');
  const altNode = getChildByFieldName(node, 'alternative');

  let condition: Expression;
  if (condNode) {
    const cn = condNode as NodeBase;
    if (cn.type === 'parenthesized_expression') {
      const inner = getNamedChild(condNode, 0);
      condition = inner ? transformExpression(inner) : { type: 'boolean', value: false };
    } else {
      condition = transformExpression(condNode);
    }
  } else {
    condition = { type: 'boolean', value: false };
  }

  const thenBlock = consNode ? wrapInBlock(consNode) : createEmptyBlock();

  let elseBlock: BlockStatement | null = null;
  if (altNode) {
    const an = altNode as NodeBase;
    if (an.type === 'if_statement') {
      const nestedIf = transformIfStatement(altNode);
      const stmts: Statement[] = [nestedIf];
      elseBlock = { type: 'block', statements: stmts };
    } else if (an.type === 'else_clause') {
      const elseBody = getNamedChild(altNode, 0);
      if (elseBody) {
        const eb = elseBody as NodeBase;
        if (eb.type === 'if_statement') {
          const nestedIf = transformIfStatement(elseBody);
          const stmts: Statement[] = [nestedIf];
          elseBlock = { type: 'block', statements: stmts };
        } else {
          elseBlock = wrapInBlock(elseBody);
        }
      }
    } else {
      elseBlock = wrapInBlock(altNode);
    }
  }

  return { type: 'if', condition, thenBlock, elseBlock };
}

function transformWhileStatement(node: TreeSitterNode): WhileStatement {
  const condNode = getChildByFieldName(node, 'condition');
  const bodyNode = getChildByFieldName(node, 'body');

  let condition: Expression;
  if (condNode) {
    const cn = condNode as NodeBase;
    if (cn.type === 'parenthesized_expression') {
      const inner = getNamedChild(condNode, 0);
      condition = inner ? transformExpression(inner) : { type: 'boolean', value: true };
    } else {
      condition = transformExpression(condNode);
    }
  } else {
    condition = { type: 'boolean', value: true };
  }

  const body = bodyNode ? wrapInBlock(bodyNode) : createEmptyBlock();

  return { type: 'while', condition, body };
}

function transformForStatement(node: TreeSitterNode): ForStatement {
  const initNode = getChildByFieldName(node, 'initializer');
  const condNode = getChildByFieldName(node, 'condition');
  const incrNode = getChildByFieldName(node, 'increment');
  const bodyNode = getChildByFieldName(node, 'body');

  let init: VariableDeclaration | AssignmentStatement | null = null;
  if (initNode) {
    const inn = initNode as NodeBase;
    if (inn.type === 'lexical_declaration' || inn.type === 'variable_declaration') {
      const decls = transformLexicalDeclaration(initNode);
      init = decls.length > 0 ? decls[0] : null;
    } else if (inn.type === 'assignment_expression') {
      const leftNode = getNamedChild(initNode, 0);
      const rightNode = getNamedChild(initNode, 1);
      if (leftNode) {
        const ln = leftNode as NodeBase;
        if (ln.type === 'identifier') {
          init = {
            type: 'assignment',
            name: ln.text,
            value: rightNode ? transformExpression(rightNode) : { type: 'number', value: 0 },
          };
        }
      }
    }
  }

  let condition: Expression | null = null;
  if (condNode) {
    condition = transformExpression(condNode);
  }

  let update: AssignmentStatement | Expression | null = null;
  if (incrNode) {
    const incn = incrNode as NodeBase;
    if (incn.type === 'assignment_expression' || incn.type === 'augmented_assignment_expression') {
      const leftNode = getNamedChild(incrNode, 0);
      const rightNode = getNamedChild(incrNode, 1);
      if (leftNode) {
        const ln = leftNode as NodeBase;
        if (ln.type === 'identifier') {
          let valueToAssign: Expression;
          if (incn.type === 'augmented_assignment_expression') {
            let op = '';
            for (let opIdx = 0; opIdx < incrNode.childCount; opIdx++) {
              const opChild = getChild(incrNode, opIdx);
              if (!opChild) continue;
              const opC = opChild as NodeBase;
              if (!opC.isNamed) {
                const opT = opC.type;
                if (opT === '+=') { op = '+'; break; }
                if (opT === '-=') { op = '-'; break; }
                if (opT === '*=') { op = '*'; break; }
                if (opT === '/=') { op = '/'; break; }
                if (opT === '%=') { op = '%'; break; }
                if (opT === '|=') { op = '|'; break; }
                if (opT === '&=') { op = '&'; break; }
                if (opT === '^=') { op = '^'; break; }
                if (opT === '<<=') { op = '<<'; break; }
                if (opT === '>>=') { op = '>>'; break; }
              }
            }
            const leftExpr: Expression = { type: 'variable', name: ln.text };
            const rightExpr = rightNode ? transformExpression(rightNode) : { type: 'number' as const, value: 0 };
            valueToAssign = { type: 'binary', op, left: leftExpr, right: rightExpr };
          } else {
            valueToAssign = rightNode ? transformExpression(rightNode) : { type: 'number', value: 0 };
          }
          update = {
            type: 'assignment',
            name: ln.text,
            value: valueToAssign,
          };
        } else {
          update = transformExpression(incrNode);
        }
      } else {
        update = transformExpression(incrNode);
      }
    } else {
      update = transformExpression(incrNode);
    }
  }

  const body = bodyNode ? wrapInBlock(bodyNode) : createEmptyBlock();

  return { type: 'for', init, condition, update, body };
}

function transformForInStatement(node: TreeSitterNode): ForOfStatement {
  let variableName = '';
  let destructuredNames: string[] | undefined;
  let variableKind: 'let' | 'const' | 'var' = 'const';
  let isForOf = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (c.type === 'of') {
      isForOf = true;
    } else if (c.type === 'const') {
      variableKind = 'const';
    } else if (c.type === 'let') {
      variableKind = 'let';
    } else if (c.type === 'var') {
      variableKind = 'var';
    }
  }

  const leftNode = getNamedChild(node, 0);
  const rightNode = getNamedChild(node, 1);
  const bodyNode = getNamedChild(node, 2);

  if (leftNode) {
    const ln = leftNode as NodeBase;
    if (ln.type === 'identifier') {
      variableName = ln.text;
    } else if (ln.type === 'array_pattern') {
      destructuredNames = [];
      for (let i = 0; i < ln.childCount; i++) {
        const child = getChild(leftNode, i);
        if (!child) continue;
        const c = child as NodeBase;
        if (c.type === 'identifier') {
          destructuredNames.push(c.text);
        }
      }
      variableName = destructuredNames[0] || '';
    }
  }

  let iterable: Expression;
  if (rightNode) {
    iterable = transformExpression(rightNode);
  } else {
    iterable = { type: 'array', elements: [] };
  }

  if (!isForOf) {
    iterable = {
      type: 'method_call',
      object: { type: 'variable', name: 'Object' },
      method: 'keys',
      args: [iterable],
      typeParameter: undefined,
      pos: 0,
    };
  }

  const body = bodyNode ? wrapInBlock(bodyNode) : createEmptyBlock();

  return { type: 'for_of', variableKind, variableName, destructuredNames, iterable, body };
}

function transformThrowStatement(node: TreeSitterNode): ThrowStatement {
  const argNode = getNamedChild(node, 0);
  const argument = argNode ? transformExpression(argNode) : { type: 'string' as const, value: 'Error' };
  return { type: 'throw', argument };
}

function transformTryStatement(node: TreeSitterNode): TryStatement {
  const bodyNode = getChildByFieldName(node, 'body');
  const handlerNode = getChildByFieldName(node, 'handler');
  const finalizerNode = getChildByFieldName(node, 'finalizer');

  const tryBlock = bodyNode ? transformStatementBlock(bodyNode) : createEmptyBlock();

  let catchClause: { param: string; body: BlockStatement } | null = null;
  if (handlerNode) {
    const paramNode = getChildByFieldName(handlerNode, 'parameter');
    const catchBodyNode = getChildByFieldName(handlerNode, 'body');

    const param = paramNode ? (paramNode as NodeBase).text : 'e';
    const body = catchBodyNode ? transformStatementBlock(catchBodyNode) : createEmptyBlock();
    catchClause = { param, body };
  }

  let finallyBlock: BlockStatement | null = null;
  if (finalizerNode) {
    const finallyBodyNode = getNamedChild(finalizerNode, 0);
    if (finallyBodyNode) {
      finallyBlock = transformStatementBlock(finallyBodyNode);
    }
  }

  return { type: 'try', tryBlock, catchClause, finallyBlock };
}

function transformSwitchStatement(node: TreeSitterNode): IfStatement {
  const exprNode = getChildByFieldName(node, 'value');
  const bodyNode = getChildByFieldName(node, 'body');

  const switchExpr = exprNode ? transformExpression(exprNode) : { type: 'variable' as const, name: 'undefined' };

  let result: IfStatement | null = null;
  let current: IfStatement | null = null;
  let pendingConditions: Expression[] = [];

  if (bodyNode) {
    const bn = bodyNode as NodeBase;
    for (let i = 0; i < bn.namedChildCount; i++) {
      const clause = getNamedChild(bodyNode, i);
      if (!clause) continue;
      const cl = clause as NodeBase;

      if (cl.type === 'switch_case') {
        const valueNode = getChildByFieldName(clause, 'value');
        if (valueNode) {
          const caseExpr = transformExpression(valueNode);
          const condition: Expression = {
            type: 'binary',
            op: '===',
            left: switchExpr,
            right: caseExpr,
          };

          const statements: Statement[] = [];
          for (let j = 0; j < cl.namedChildCount; j++) {
            const stmtNode = getNamedChild(clause, j);
            if (!stmtNode) continue;
            const sn = stmtNode as NodeBase;
            if (stmtNode !== valueNode && sn.type !== 'break_statement') {
              const stmt = transformStatement(stmtNode);
              if (stmt) statements.push(stmt);
            }
          }

          if (statements.length === 0) {
            pendingConditions.push(condition);
          } else {
            let finalCondition: Expression = condition;
            for (let k = pendingConditions.length - 1; k >= 0; k--) {
              finalCondition = {
                type: 'binary',
                op: '||',
                left: pendingConditions[k],
                right: finalCondition,
              };
            }
            pendingConditions = [];

            const ifStmt: IfStatement = {
              type: 'if',
              condition: finalCondition,
              thenBlock: { type: 'block', statements },
              elseBlock: null,
            };

            if (!result) {
              result = ifStmt;
              current = ifStmt;
            } else if (current) {
              current.elseBlock = { type: 'block', statements: [ifStmt] };
              current = ifStmt;
            }
          }
        }
      } else if (cl.type === 'switch_default') {
        const statements: Statement[] = [];
        for (let j = 0; j < cl.namedChildCount; j++) {
          const stmtNode = getNamedChild(clause, j);
          if (!stmtNode) continue;
          const sn = stmtNode as NodeBase;
          if (sn.type !== 'break_statement') {
            const stmt = transformStatement(stmtNode);
            if (stmt) statements.push(stmt);
          }
        }

        if (current) {
          current.elseBlock = { type: 'block', statements };
        }
      }
    }
  }

  return result || {
    type: 'if',
    condition: { type: 'boolean', value: false },
    thenBlock: createEmptyBlock(),
    elseBlock: null,
  };
}

function createEmptyBlock(): BlockStatement {
  const statements: Statement[] = [];
  return { type: 'block', statements };
}

function transformStatementBlock(node: TreeSitterNode): BlockStatement {
  const statements: Statement[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (child) {
      const stmt = transformStatement(child);
      if (stmt) {
        statements.push(stmt);
      }
    }
  }
  return { type: 'block', statements };
}

function wrapInBlock(node: TreeSitterNode): BlockStatement {
  const n = node as NodeBase;
  if (n.type === 'statement_block') {
    return transformStatementBlock(node);
  }
  const stmt = transformStatement(node);
  if (stmt) {
    const statements: Statement[] = [stmt];
    return { type: 'block', statements };
  }
  return createEmptyBlock();
}

function transformFunctionDeclaration(node: TreeSitterNode): FunctionNode | null {
  const nameNode = getChildByFieldName(node, 'name');
  const paramsNode = getChildByFieldName(node, 'parameters');
  const bodyNode = getChildByFieldName(node, 'body');
  const returnTypeNode = getChildByFieldName(node, 'return_type');
  const typeParamsNode = getChildByFieldName(node, 'type_parameters');

  if (!nameNode) return null;

  const nn = nameNode as NodeBase;
  const name = nn.text;
  const params = paramsNode ? extractFunctionParams(paramsNode) : [];
  const body = bodyNode ? transformStatementBlock(bodyNode) : createEmptyBlock();

  let returnType: string | undefined = '';
  if (returnTypeNode) {
    const rtn = returnTypeNode as NodeBase;
    if (!rtn.isNull) {
      returnType = extractTypeString(returnTypeNode);
    }
  }

  let typeParameters: string[] | undefined;
  if (typeParamsNode) {
    typeParameters = [];
    const tpn = typeParamsNode as NodeBase;
    for (let i = 0; i < tpn.namedChildCount; i++) {
      const tp = getNamedChild(typeParamsNode, i);
      if (!tp) continue;
      const tpBase = tp as NodeBase;
      if (tpBase.type === 'type_parameter') {
        const tpName = getChildByFieldName(tp, 'name');
        if (tpName) {
          typeParameters.push((tpName as NodeBase).text);
        }
      }
    }
  }

  let isAsync = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (c.type === 'async') {
      isAsync = true;
      break;
    }
  }

  const paramTypes = paramsNode ? extractParamTypes(paramsNode) : undefined;
  const parameters = paramsNode ? extractFunctionParameters(paramsNode) : undefined;

  return {
    name,
    params,
    body,
    returnType,
    paramTypes,
    typeParameters,
    async: isAsync || undefined,
    parameters,
  };
}

function extractFunctionParams(paramsNode: TreeSitterNode): string[] {
  const params: string[] = [];
  const namedChildCount = paramsNode.namedChildCount;
  for (let i = 0; i < namedChildCount; i++) {
    const param = getNamedChild(paramsNode, i);
    if (!param) {
      continue;
    }
    const p = param as NodeBase;
    if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
      const patternNode = getChildByFieldName(param, 'pattern');
      if (patternNode) {
        const pn = patternNode as NodeBase;
        if (pn.type === 'identifier') {
          params.push(pn.text);
        }
      }
    } else if (p.type === 'identifier') {
      params.push(p.text);
    }
  }
  return params;
}

function extractParamTypes(paramsNode: TreeSitterNode): string[] | undefined {
  const types: string[] = [];
  let hasTypes = false;

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = getNamedChild(paramsNode, i);
    if (!param) continue;
    const p = param as NodeBase;
    if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
      const typeNode = getChildByFieldName(param, 'type');
      if (typeNode) {
        types.push(extractTypeString(typeNode));
        hasTypes = true;
      } else {
        types.push('any');
      }
    }
  }

  return hasTypes ? types : undefined;
}

function extractFunctionParameters(paramsNode: TreeSitterNode): FunctionParameter[] | undefined {
  const params: FunctionParameter[] = [];

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = getNamedChild(paramsNode, i);
    if (!param) continue;
    const p = param as NodeBase;
    if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
      const patternNode = getChildByFieldName(param, 'pattern');
      const typeNode = getChildByFieldName(param, 'type');
      const valueNode = getChildByFieldName(param, 'value');

      const name = patternNode ? ((patternNode as NodeBase).type === 'identifier' ? (patternNode as NodeBase).text : '') : '';
      const type = typeNode ? extractTypeString(typeNode) : undefined;
      const optional = p.type === 'optional_parameter';
      const defaultValue = valueNode ? transformExpression(valueNode) : undefined;

      params.push({ name, type, optional, defaultValue });
    }
  }

  return params.length > 0 ? params : undefined;
}

function extractTypeString(typeNode: TreeSitterNode): string {
  const tn = typeNode as NodeBase;
  if (tn.type === 'type_annotation') {
    const inner = getNamedChild(typeNode, 0);
    return inner ? extractTypeString(inner) : 'any';
  }

  if (tn.type === 'predefined_type') {
    return tn.text;
  }

  if (tn.type === 'type_identifier') {
    return tn.text;
  }

  if (tn.type === 'generic_type') {
    const nameNode = getChildByFieldName(typeNode, 'name');
    const argsNode = getChildByFieldName(typeNode, 'type_arguments');
    const name = nameNode ? (nameNode as NodeBase).text : '';
    if (argsNode) {
      const an = argsNode as NodeBase;
      const args: string[] = [];
      for (let i = 0; i < an.namedChildCount; i++) {
        const arg = getNamedChild(argsNode, i);
        if (arg) {
          args.push(extractTypeString(arg));
        }
      }
      return `${name}<${args.join(', ')}>`;
    }
    return name;
  }

  if (tn.type === 'array_type') {
    const elemNode = getNamedChild(typeNode, 0);
    const elem = elemNode ? extractTypeString(elemNode) : 'any';
    return `${elem}[]`;
  }

  if (tn.type === 'union_type') {
    const types: string[] = [];
    for (let i = 0; i < typeNode.namedChildCount; i++) {
      const t = getNamedChild(typeNode, i);
      if (t) {
        types.push(extractTypeString(t));
      }
    }
    return types.join(' | ');
  }

  if (tn.type === 'function_type') {
    return 'Function';
  }

  return tn.text;
}

function transformClassDeclaration(node: TreeSitterNode): ClassNode | null {
  const nameNode = getChildByFieldName(node, 'name');
  if (!nameNode) return null;

  const name = (nameNode as NodeBase).text;

  let extendsClause: string | undefined;
  const implementsClause: string[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (c.type === 'class_heritage') {
      for (let j = 0; j < c.namedChildCount; j++) {
        const clause = getNamedChild(child, j);
        if (!clause) continue;
        const cl = clause as NodeBase;
        if (cl.type === 'extends_clause') {
          const valueNode = getChildByFieldName(clause, 'value');
          if (valueNode) {
            extendsClause = (valueNode as NodeBase).text;
          }
        } else if (cl.type === 'implements_clause') {
          for (let k = 0; k < cl.namedChildCount; k++) {
            const typeNode = getNamedChild(clause, k);
            if (typeNode) {
              const tn = typeNode as NodeBase;
              if (tn.type === 'type_identifier' || tn.type === 'generic_type') {
                implementsClause.push(extractTypeString(typeNode));
              }
            }
          }
        }
      }
    }
  }

  const fields: ClassField[] = [];
  const methods: ClassMethod[] = [];

  const bodyNode = getChildByFieldName(node, 'body');
  if (bodyNode) {
    const bn = bodyNode as NodeBase;
    for (let i = 0; i < bn.namedChildCount; i++) {
      const member = getNamedChild(bodyNode, i);
      if (!member) continue;
      const m = member as NodeBase;

      if (m.type === 'public_field_definition' || m.type === 'property_definition') {
        const field = transformClassField(member);
        if (field) {
          fields.push(field);
        }
      } else if (m.type === 'method_definition') {
        const method = transformClassMethod(member);
        if (method) {
          methods.push(method);
          if (method.isConstructor && method.parameterProperties) {
            const paramTypes = method.paramTypes || [];
            const params = method.params;
            for (let pi = 0; pi < method.parameterProperties.length; pi++) {
              const propName = method.parameterProperties[pi];
              let propIdx = -1;
              for (let k = 0; k < params.length; k++) {
                if (params[k] === propName) {
                  propIdx = k;
                  break;
                }
              }
              let fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean' = 'double';
              let tsType: string | undefined;
              if (propIdx !== -1 && propIdx < paramTypes.length) {
                const pt = paramTypes[propIdx];
                if (pt === 'string') fieldType = 'string';
                else if (pt === 'number') fieldType = 'double';
                else if (pt === 'boolean') fieldType = 'boolean';
                else if (pt === 'string[]') fieldType = 'string[]';
                else if (pt === 'number[]') fieldType = 'number[]';
                else if (pt === 'boolean[]') fieldType = 'boolean[]';
                else if (pt) tsType = pt;
              }
              let alreadyExists = false;
              for (let fi = 0; fi < fields.length; fi++) {
                if (fields[fi].name === propName) {
                  alreadyExists = true;
                  break;
                }
              }
              if (alreadyExists === false) {
                const newField: ClassField = { name: propName, fieldType, tsType };
                fields.push(newField);
              }
            }
          }
        }
      }
    }
  }

  return { name, extends: extendsClause, implements: implementsClause, fields, methods };
}

function transformClassField(node: TreeSitterNode): ClassField | null {
  const nameNode = getChildByFieldName(node, 'name');
  const typeNode = getChildByFieldName(node, 'type');

  if (!nameNode) return null;

  const name = (nameNode as NodeBase).text;
  let fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean' = 'double';
  let tsType: string | undefined;

  if (typeNode) {
    const typeStr = extractTypeString(typeNode);
    if (typeStr === 'string') fieldType = 'string';
    else if (typeStr === 'number') fieldType = 'double';
    else if (typeStr === 'boolean') fieldType = 'boolean';
    else if (typeStr === 'string[]') fieldType = 'string[]';
    else if (typeStr === 'number[]') fieldType = 'number[]';
    else if (typeStr === 'boolean[]') fieldType = 'boolean[]';
    else {
      tsType = typeStr;
    }
  }

  return { name, fieldType, tsType };
}

function transformClassMethod(node: TreeSitterNode): ClassMethod | null {
  const nameNode = getChildByFieldName(node, 'name');
  const paramsNode = getChildByFieldName(node, 'parameters');
  const bodyNode = getChildByFieldName(node, 'body');
  const returnTypeNode = getChildByFieldName(node, 'return_type');

  const name = nameNode ? (nameNode as NodeBase).text : '';
  const isConstructor = name === 'constructor';

  const params = paramsNode ? extractFunctionParams(paramsNode) : [];
  const body = bodyNode ? transformStatementBlock(bodyNode) : createEmptyBlock();

  let returnType: string | undefined;
  if (returnTypeNode) {
    const rtn = returnTypeNode as NodeBase;
    if (!rtn.isNull) {
      returnType = extractTypeString(returnTypeNode);
    }
  }

  const paramTypes = paramsNode ? extractClassParamTypes(paramsNode) : undefined;
  const parameterProperties = isConstructor && paramsNode ? extractParameterProperties(paramsNode) : undefined;

  return {
    type: 'method',
    name,
    params,
    paramTypes,
    parameterProperties,
    returnType,
    body,
    isConstructor,
  };
}

function mapToClassMethodType(typeStr: string): 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void' | undefined {
  switch (typeStr) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'string[]': return 'string[]';
    case 'number[]': return 'number[]';
    case 'boolean[]': return 'boolean[]';
    case 'void': return 'void';
    default: return undefined;
  }
}

function extractClassParamTypes(paramsNode: TreeSitterNode): string[] | undefined {
  const types: string[] = [];
  let hasTypes = false;

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = getNamedChild(paramsNode, i);
    if (!param) continue;
    const p = param as NodeBase;
    if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
      const typeNode = getChildByFieldName(param, 'type');
      if (typeNode) {
        const typeStr = extractTypeString(typeNode);
        const mapped = mapToClassMethodType(typeStr);
        if (mapped) {
          types.push(mapped);
        } else {
          types.push(typeStr);
        }
        hasTypes = true;
      } else {
        types.push('any');
      }
    }
  }

  return hasTypes ? types : undefined;
}

function extractParameterProperties(paramsNode: TreeSitterNode): string[] | undefined {
  const properties: string[] = [];

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = getNamedChild(paramsNode, i);
    if (!param) continue;
    const p = param as NodeBase;
    if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
      let hasAccessibility = false;
      for (let j = 0; j < p.childCount; j++) {
        const child = getChild(param, j);
        if (child) {
          const c = child as NodeBase;
          if (c.type === 'accessibility_modifier') {
            hasAccessibility = true;
            break;
          }
        }
      }
      if (hasAccessibility) {
        const patternNode = getChildByFieldName(param, 'pattern');
        if (patternNode) {
          const pn = patternNode as NodeBase;
          if (pn.type === 'identifier') {
            properties.push(pn.text);
          }
        }
      }
    }
  }

  return properties.length > 0 ? properties : undefined;
}

function transformInterfaceDeclaration(node: TreeSitterNode): InterfaceDeclaration | null {
  const nameNode = getChildByFieldName(node, 'name');
  const bodyNode = getChildByFieldName(node, 'body');

  if (!nameNode) return null;

  const name = (nameNode as NodeBase).text;
  const fields: { name: string; type: string }[] = [];
  const methods: { name: string; params: string[]; paramTypes: string[]; returnType: string }[] = [];
  const extendsArr: string[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (c.type === 'extends_type_clause') {
      for (let j = 0; j < c.namedChildCount; j++) {
        const typeNode = getNamedChild(child, j);
        if (typeNode) {
          extendsArr.push(extractTypeString(typeNode));
        }
      }
    }
  }

  if (bodyNode) {
    const bn = bodyNode as NodeBase;
    for (let i = 0; i < bn.namedChildCount; i++) {
      const member = getNamedChild(bodyNode, i);
      if (!member) continue;
      const m = member as NodeBase;
      if (m.type === 'property_signature') {
        const propNameNode = getChildByFieldName(member, 'name');
        const propTypeNode = getChildByFieldName(member, 'type');

        const fieldName = propNameNode ? (propNameNode as NodeBase).text : '';
        const fieldType = propTypeNode ? extractTypeString(propTypeNode) : 'any';
        fields.push({ name: fieldName, type: fieldType });
      } else if (m.type === 'method_signature') {
        const methodNameNode = getChildByFieldName(member, 'name');
        if (!methodNameNode) continue;
        const methodName = (methodNameNode as NodeBase).text;
        const paramsNode = getChildByFieldName(member, 'parameters');
        const params = paramsNode ? extractFunctionParams(paramsNode) : [];
        const paramTypes = paramsNode ? (extractParamTypes(paramsNode) || []) : [];
        const returnTypeNode = getChildByFieldName(member, 'return_type');
        let returnType = 'void';
        if (returnTypeNode) {
          returnType = extractTypeString(returnTypeNode);
        }
        methods.push({ name: methodName, params, paramTypes, returnType });
      }
    }
  }

  return {
    name,
    extends: extendsArr,
    fields,
    methods
  };
}

function transformTypeAliasDeclaration(node: TreeSitterNode): TypeAliasDeclaration | null {
  const nameNode = getChildByFieldName(node, 'name');
  const valueNode = getChildByFieldName(node, 'value');

  if (!nameNode) return null;

  const name = (nameNode as NodeBase).text;
  const unionMembers: string[] = [];

  if (valueNode) {
    const vn = valueNode as NodeBase;
    if (vn.type === 'union_type') {
      for (let i = 0; i < vn.namedChildCount; i++) {
        const t = getNamedChild(valueNode, i);
        if (t) {
          unionMembers.push(extractTypeString(t));
        }
      }
    } else {
      unionMembers.push(extractTypeString(valueNode));
    }
  }

  return { name, unionMembers };
}

function transformEnumDeclaration(node: TreeSitterNode): EnumDeclaration | null {
  const nameNode = getChildByFieldName(node, 'name');
  const bodyNode = getChildByFieldName(node, 'body');

  if (!nameNode) return null;

  const name = (nameNode as NodeBase).text;
  const members: EnumMember[] = [];

  let currentValue = 0;
  if (bodyNode) {
    const bn = bodyNode as NodeBase;
    for (let i = 0; i < bn.namedChildCount; i++) {
      const member = getNamedChild(bodyNode, i);
      if (member) {
        const memberNameNode = getChildByFieldName(member, 'name');
        const memberValueNode = getChildByFieldName(member, 'value');

        const memberName = memberNameNode ? (memberNameNode as NodeBase).text : '';
        let value = currentValue;

        if (memberValueNode) {
          const mvn = memberValueNode as NodeBase;
          if (mvn.type === 'number') {
            value = parseInt(mvn.text, 10);
          }
        }

        members.push({ name: memberName, value });
        currentValue = value + 1;
      }
    }
  }

  return { name, members };
}

function transformImportStatement(node: TreeSitterNode): ImportDeclaration | null {
  const sourceNode = getChildByFieldName(node, 'source');
  if (!sourceNode) return null;

  const nodeText = (node as NodeBase).text;
  const isTypeOnly = nodeText.startsWith('import type ') || nodeText.startsWith('import type{');
  if (isTypeOnly) {
    return null;
  }

  let source = (sourceNode as NodeBase).text;
  if ((source.startsWith('"') && source.endsWith('"')) ||
      (source.startsWith("'") && source.endsWith("'"))) {
    source = source.slice(1, -1);
  }

  const specifiers: string[] = [];
  const aliasedSpecifiers: ImportSpecifier[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;

    if (c.type === 'import_clause') {
      for (let j = 0; j < c.namedChildCount; j++) {
        const clause = getNamedChild(child, j);
        if (!clause) continue;
        const cl = clause as NodeBase;

        if (cl.type === 'identifier') {
          specifiers.push(cl.text);
          aliasedSpecifiers.push({ name: cl.text });
        } else if (cl.type === 'named_imports') {
          for (let k = 0; k < cl.namedChildCount; k++) {
            const spec = getNamedChild(clause, k);
            if (!spec) continue;
            const sp = spec as NodeBase;
            if (sp.type === 'import_specifier') {
              const nameNode = getChildByFieldName(spec, 'name');
              const aliasNode = getChildByFieldName(spec, 'alias');
              if (nameNode) {
                const originalName = (nameNode as NodeBase).text;
                if (aliasNode) {
                  const localName = (aliasNode as NodeBase).text;
                  specifiers.push(localName);
                  aliasedSpecifiers.push({ name: localName, original: originalName });
                } else {
                  specifiers.push(originalName);
                  aliasedSpecifiers.push({ name: originalName });
                }
              }
            }
          }
        } else if (cl.type === 'namespace_import') {
          const nameNode = getNamedChild(clause, 0);
          if (nameNode) {
            const nsName = `* as ${(nameNode as NodeBase).text}`;
            specifiers.push(nsName);
            aliasedSpecifiers.push({ name: nsName });
          }
        }
      }
    }
  }

  return { type: 'import', specifiers, aliasedSpecifiers, source };
}
