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
  NumberNode,
  StringNode,
  BooleanNode,
  VariableNode,
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
} from '../ast/types.js';

interface ExprBase { type: string; }

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
      for (const varDecl of varDecls) {
        ast.topLevelStatements.push(varDecl);
        ast.topLevelItems!.push(varDecl);
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
      }
      break;

    case 'for_in_statement':
      const forOfStmt = transformForInStatement(node);
      if (forOfStmt) {
        ast.topLevelExpressions.push(forOfStmt);
        ast.topLevelItems!.push(forOfStmt);
      }
      break;

    case 'while_statement':
      const whileStmt = transformWhileStatement(node);
      if (whileStmt) {
        ast.topLevelExpressions.push(whileStmt);
        ast.topLevelItems!.push(whileStmt);
      }
      break;

    case 'if_statement':
      const ifStmt = transformIfStatement(node);
      if (ifStmt) {
        ast.topLevelExpressions.push(ifStmt);
        ast.topLevelItems!.push(ifStmt);
      }
      break;

    case 'try_statement':
      const tryStmt = transformTryStatement(node);
      if (tryStmt) {
        ast.topLevelExpressions.push(tryStmt);
        ast.topLevelItems!.push(tryStmt);
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
  } else if (e.type === 'call' || e.type === 'new' || e.type === 'method_call') {
    ast.topLevelExpressions.push(expr as CallNode | NewNode | MethodCallNode);
    ast.topLevelItems!.push(expr as TopLevelItem);
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
    }
  }
}

function handleExportStatement(node: TreeSitterNode, ast: AST): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;

    if (child.type === 'function_declaration') {
      const func = transformFunctionDeclaration(child);
      if (func) {
        ast.functions.push(func);
        ast.exports.push({ type: 'export', declaration: func });
      }
    } else if (child.type === 'class_declaration') {
      const cls = transformClassDeclaration(child);
      if (cls) {
        ast.classes.push(cls);
        ast.exports.push({ type: 'export', declaration: cls });
      }
    } else if (child.type === 'lexical_declaration') {
      const varDecls = transformLexicalDeclaration(child);
      for (const varDecl of varDecls) {
        ast.topLevelStatements.push(varDecl);
        ast.topLevelItems!.push(varDecl);
      }
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
    case 'satisfies_expression':
      const exprChild = getNamedChild(node, 0);
      return exprChild ? transformExpression(exprChild) : { type: 'variable', name: 'undefined' };

    case 'non_null_expression':
      const nnChild = getNamedChild(node, 0);
      return nnChild ? transformExpression(nnChild) : { type: 'variable', name: 'undefined' };

    case 'typeof_expression':
      return transformTypeofExpression(node);

    default:
      return { type: 'variable', name: 'undefined' };
  }
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
  const left = getChildByFieldName(node, 'left');
  const right = getChildByFieldName(node, 'right');

  let op = '';
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (child && !child.isNamed) {
      const t = child.type;
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
    if (!child.isNamed) {
      if (['-', '+', '!', '~'].includes(child.type)) {
        op = child.type;
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
    if (!child.isNamed) {
      if (child.type === '++' || child.type === '--') {
        op = child.type;
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
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const argChild = getNamedChild(argsNode, i);
      if (argChild) {
        args.push(transformExpression(argChild));
      }
    }
  }

  let typeParameter: string | undefined;
  const typeArgsNode = getChildByFieldName(node, 'type_arguments');
  if (typeArgsNode && typeArgsNode.namedChildCount > 0) {
    const firstTypeArg = getNamedChild(typeArgsNode, 0);
    if (firstTypeArg) {
      typeParameter = firstTypeArg.text;
    }
  }

  if (!funcNode) {
    return { type: 'call', name: '', args };
  }

  if (funcNode.type === 'member_expression') {
    const objNode = getChildByFieldName(funcNode, 'object');
    const propNode = getChildByFieldName(funcNode, 'property');
    const object = objNode ? transformExpression(objNode) : { type: 'variable' as const, name: 'undefined' };
    const method = propNode ? propNode.text : '';

    return {
      type: 'method_call',
      object,
      method,
      args,
      typeParameter,
    };
  } else if (funcNode.type === 'identifier') {
    return { type: 'call', name: funcNode.text, args };
  } else {
    const callee = transformExpression(funcNode);
    return {
      type: 'method_call',
      object: callee,
      method: '',
      args,
    };
  }
}

function transformMemberExpression(node: TreeSitterNode): MemberAccessNode {
  const objNode = getChildByFieldName(node, 'object');
  const propNode = getChildByFieldName(node, 'property');

  return {
    type: 'member_access',
    object: objNode ? transformExpression(objNode) : { type: 'variable', name: 'undefined' },
    property: propNode ? propNode.text : '',
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

    if (child.type === 'pair') {
      const keyNode = getChildByFieldName(child, 'key');
      const valueNode = getChildByFieldName(child, 'value');

      let key = '';
      if (keyNode) {
        if (keyNode.type === 'property_identifier' || keyNode.type === 'identifier') {
          key = keyNode.text;
        } else if (keyNode.type === 'string') {
          key = keyNode.text.slice(1, -1);
        } else if (keyNode.type === 'computed_property_name') {
          const inner = getNamedChild(keyNode, 0);
          if (inner) {
            const expr = transformExpression(inner);
            const eKey = expr as ExprBase;
            const exprVal = expr as { value?: string; name?: string };
            if (eKey.type === 'string') {
              key = exprVal.value || '';
            } else if (eKey.type === 'variable') {
              key = `[${exprVal.name}]`;
            } else {
              key = '[computed]';
            }
          }
        }
      }

      const value = valueNode ? transformExpression(valueNode) : { type: 'variable' as const, name: 'undefined' };
      properties.push({ key, value });
    } else if (child.type === 'shorthand_property_identifier') {
      const key = child.text;
      properties.push({ key, value: { type: 'variable', name: key } });
    } else if (child.type === 'method_definition') {
      const nameNode = getChildByFieldName(child, 'name');
      const paramsNode = getChildByFieldName(child, 'parameters');
      const bodyNode = getChildByFieldName(child, 'body');

      const key = nameNode ? nameNode.text : '';
      const params = paramsNode ? extractFunctionParams(paramsNode) : [];
      const body = bodyNode ? transformStatementBlock(bodyNode) : { type: 'block' as const, statements: [] };

      const arrowFn: ArrowFunctionNode = {
        type: 'arrow_function',
        params,
        body,
      };
      properties.push({ key, value: arrowFn });
    }
  }

  return { type: 'object', properties };
}

function transformNewExpression(node: TreeSitterNode): NewNode | MapNode | SetNode {
  const constructorNode = getChildByFieldName(node, 'constructor');
  const argsNode = getChildByFieldName(node, 'arguments');

  const args: Expression[] = [];
  if (argsNode) {
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const child = getNamedChild(argsNode, i);
      if (child) {
        args.push(transformExpression(child));
      }
    }
  }

  const className = constructorNode ? constructorNode.text : '';

  if (className === 'Map') {
    if (args.length > 0 && args[0].type === 'array') {
      const entries = (args[0] as ArrayNode).elements.map(elem => {
        if (elem.type === 'array' && (elem as ArrayNode).elements.length === 2) {
          return { key: (elem as ArrayNode).elements[0], value: (elem as ArrayNode).elements[1] };
        }
        return { key: elem, value: { type: 'variable' as const, name: 'undefined' } };
      });
      return { type: 'map', entries };
    }
    return { type: 'map', entries: [] };
  }

  if (className === 'Set') {
    if (args.length > 0 && args[0].type === 'array') {
      return { type: 'set', values: (args[0] as ArrayNode).elements };
    }
    return { type: 'set', values: [] };
  }

  return { type: 'new', className, args };
}

function transformTemplateString(node: TreeSitterNode): TemplateLiteralNode | StringNode {
  const parts: (string | Expression)[] = [];
  let hasSubstitutions = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;

    if (child.type === 'string_fragment' || child.type === 'template_content') {
      parts.push(child.text);
    } else if (child.type === 'template_substitution') {
      hasSubstitutions = true;
      const exprChild = getNamedChild(child, 0);
      if (exprChild) {
        parts.push(transformExpression(exprChild));
      }
    } else if (child.type === '`') {
      continue;
    } else if (child.isNamed) {
      hasSubstitutions = true;
      parts.push(transformExpression(child));
    }
  }

  if (!hasSubstitutions && parts.length <= 1) {
    let text = '';
    if (parts.length === 1) {
      const firstPart = parts[0] as { type: string };
      if (!firstPart.type) {
        text = parts[0] as string;
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
    if (paramsNode.type === 'identifier') {
      params = [paramsNode.text];
    } else {
      params = extractFunctionParams(paramsNode);
    }
  }

  let body: Expression | BlockStatement;
  if (bodyNode) {
    if (bodyNode.type === 'statement_block') {
      body = transformStatementBlock(bodyNode);
    } else {
      body = transformExpression(bodyNode);
    }
  } else {
    body = { type: 'block', statements: [] };
  }

  let isAsync = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (child && child.type === 'async') {
      isAsync = true;
      break;
    }
  }

  return {
    type: 'arrow_function',
    params,
    body,
    async: isAsync || undefined,
  };
}

function transformFunctionExpression(node: TreeSitterNode): ArrowFunctionNode {
  const paramsNode = getChildByFieldName(node, 'parameters');
  const bodyNode = getChildByFieldName(node, 'body');

  const params = paramsNode ? extractFunctionParams(paramsNode) : [];
  const body = bodyNode ? transformStatementBlock(bodyNode) : { type: 'block' as const, statements: [] };

  let isAsync = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (child && child.type === 'async') {
      isAsync = true;
      break;
    }
  }

  return {
    type: 'arrow_function',
    params,
    body,
    async: isAsync || undefined,
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
  const text = node.text;
  const lastSlash = text.lastIndexOf('/');
  const pattern = text.slice(1, lastSlash);
  const flags = text.slice(lastSlash + 1);
  return { type: 'regex', pattern, flags };
}

function transformAssignmentExpression(node: TreeSitterNode): Expression {
  const leftNode = getChildByFieldName(node, 'left');
  const rightNode = getChildByFieldName(node, 'right');

  const right = rightNode ? transformExpression(rightNode) : { type: 'variable' as const, name: 'undefined' };

  if (leftNode) {
    if (leftNode.type === 'identifier') {
      return {
        type: 'binary',
        op: '=',
        left: { type: 'variable', name: leftNode.text },
        right,
      };
    } else if (leftNode.type === 'member_expression') {
      const obj = transformExpression(leftNode);
      if (obj.type === 'member_access') {
        return {
          type: 'member_access_assignment',
          object: obj.object,
          property: obj.property,
          value: right,
        };
      }
    } else if (leftNode.type === 'subscript_expression') {
      const obj = transformExpression(leftNode);
      if (obj.type === 'index_access') {
        return {
          type: 'index_access_assignment',
          object: obj.object,
          index: obj.index,
          value: right,
        };
      }
    }
  }

  return right;
}

function transformAugmentedAssignmentExpression(node: TreeSitterNode): Expression {
  const leftNode = getChildByFieldName(node, 'left');
  const rightNode = getChildByFieldName(node, 'right');

  let op = '';
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (child && !child.isNamed) {
      const t = child.type;
      if (['+=', '-=', '*=', '/=', '%=', '|=', '&=', '^=', '<<=', '>>='].includes(t)) {
        op = t.slice(0, -1);
        break;
      }
    }
  }

  const left = leftNode ? transformExpression(leftNode) : { type: 'variable' as const, name: 'undefined' };
  const right = rightNode ? transformExpression(rightNode) : { type: 'variable' as const, name: 'undefined' };
  const newValue: BinaryNode = { type: 'binary', op, left, right };

  if (leftNode && leftNode.type === 'identifier') {
    return {
      type: 'binary',
      op: '=',
      left,
      right: newValue,
    };
  } else if (leftNode && leftNode.type === 'member_expression') {
    if (left.type === 'member_access') {
      return {
        type: 'member_access_assignment',
        object: left.object,
        property: left.property,
        value: newValue,
      };
    }
  } else if (leftNode && leftNode.type === 'subscript_expression') {
    if (left.type === 'index_access') {
      return {
        type: 'index_access_assignment',
        object: left.object,
        index: left.index,
        value: newValue,
      };
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

  const expr = transformExpression(exprNode);

  if (exprNode.type === 'assignment_expression' || exprNode.type === 'augmented_assignment_expression') {
    const leftNode = getChildByFieldName(exprNode, 'left');
    if (leftNode && leftNode.type === 'identifier') {
      const exprBase = expr as ExprBase;
      const exprTyped = expr as { type: string; op?: string; right?: Expression };
      return {
        type: 'assignment',
        name: leftNode.text,
        value: exprBase.type === 'binary' && exprTyped.op === '=' ? exprTyped.right! : expr,
      };
    } else if (leftNode && leftNode.type === 'member_expression') {
      return {
        type: 'assignment',
        name: `__member_access__`,
        value: expr,
      };
    } else if (leftNode && leftNode.type === 'subscript_expression') {
      return {
        type: 'assignment',
        name: `__index_access__`,
        value: expr,
      };
    }
  }

  return expr;
}

function transformLexicalDeclaration(node: TreeSitterNode): VariableDeclaration[] {
  const declarations: VariableDeclaration[] = [];

  let kind: 'let' | 'const' = 'let';
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (child && child.type === 'const') {
      kind = 'const';
      break;
    }
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (child && child.type === 'variable_declarator') {
      const decl = transformVariableDeclarator(child, kind);
      if (decl) {
        declarations.push(decl);
      }
    }
  }

  return declarations;
}

function transformVariableDeclarator(node: TreeSitterNode, kind: 'let' | 'const'): VariableDeclaration | null {
  const nameNode = getChildByFieldName(node, 'name');
  const valueNode = getChildByFieldName(node, 'value');
  const typeNode = getChildByFieldName(node, 'type');

  const name = nameNode ? nameNode.text : '';
  const value = valueNode ? transformExpression(valueNode) : null;

  let declaredType: string | undefined;
  if (typeNode) {
    declaredType = extractTypeString(typeNode);
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
    if (condNode.type === 'parenthesized_expression') {
      const inner = getNamedChild(condNode, 0);
      condition = inner ? transformExpression(inner) : { type: 'boolean', value: false };
    } else {
      condition = transformExpression(condNode);
    }
  } else {
    condition = { type: 'boolean', value: false };
  }

  const thenBlock = consNode ? wrapInBlock(consNode) : { type: 'block' as const, statements: [] };

  let elseBlock: BlockStatement | null = null;
  if (altNode) {
    if (altNode.type === 'if_statement') {
      const nestedIf = transformIfStatement(altNode);
      elseBlock = { type: 'block', statements: [nestedIf] };
    } else if (altNode.type === 'else_clause') {
      const elseBody = getNamedChild(altNode, 0);
      if (elseBody) {
        if (elseBody.type === 'if_statement') {
          const nestedIf = transformIfStatement(elseBody);
          elseBlock = { type: 'block', statements: [nestedIf] };
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
    if (condNode.type === 'parenthesized_expression') {
      const inner = getNamedChild(condNode, 0);
      condition = inner ? transformExpression(inner) : { type: 'boolean', value: true };
    } else {
      condition = transformExpression(condNode);
    }
  } else {
    condition = { type: 'boolean', value: true };
  }

  const body = bodyNode ? wrapInBlock(bodyNode) : { type: 'block' as const, statements: [] };

  return { type: 'while', condition, body };
}

function transformForStatement(node: TreeSitterNode): ForStatement {
  const initNode = getChildByFieldName(node, 'initializer');
  const condNode = getChildByFieldName(node, 'condition');
  const incrNode = getChildByFieldName(node, 'increment');
  const bodyNode = getChildByFieldName(node, 'body');

  let init: VariableDeclaration | AssignmentStatement | null = null;
  if (initNode) {
    if (initNode.type === 'lexical_declaration' || initNode.type === 'variable_declaration') {
      const decls = transformLexicalDeclaration(initNode);
      init = decls.length > 0 ? decls[0] : null;
    } else if (initNode.type === 'assignment_expression') {
      const leftNode = getChildByFieldName(initNode, 'left');
      const rightNode = getChildByFieldName(initNode, 'right');
      if (leftNode && leftNode.type === 'identifier') {
        init = {
          type: 'assignment',
          name: leftNode.text,
          value: rightNode ? transformExpression(rightNode) : { type: 'number', value: 0 },
        };
      }
    }
  }

  let condition: Expression | null = null;
  if (condNode) {
    condition = transformExpression(condNode);
  }

  let update: AssignmentStatement | Expression | null = null;
  if (incrNode) {
    if (incrNode.type === 'assignment_expression' || incrNode.type === 'augmented_assignment_expression') {
      const leftNode = getChildByFieldName(incrNode, 'left');
      if (leftNode && leftNode.type === 'identifier') {
        update = {
          type: 'assignment',
          name: leftNode.text,
          value: transformExpression(incrNode),
        };
      } else {
        update = transformExpression(incrNode);
      }
    } else {
      update = transformExpression(incrNode);
    }
  }

  const body = bodyNode ? wrapInBlock(bodyNode) : { type: 'block' as const, statements: [] };

  return { type: 'for', init, condition, update, body };
}

function transformForInStatement(node: TreeSitterNode): ForOfStatement {
  let variableName = '';
  let destructuredNames: string[] | undefined;
  let variableKind: 'let' | 'const' | 'var' = 'const';
  let isForOf = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (child) {
      if (child.type === 'of') {
        isForOf = true;
      } else if (child.type === 'const') {
        variableKind = 'const';
      } else if (child.type === 'let') {
        variableKind = 'let';
      } else if (child.type === 'var') {
        variableKind = 'var';
      }
    }
  }

  const leftNode = getChildByFieldName(node, 'left');
  const rightNode = getChildByFieldName(node, 'right');
  const bodyNode = getChildByFieldName(node, 'body');

  if (leftNode) {
    if (leftNode.type === 'identifier') {
      variableName = leftNode.text;
    } else if (leftNode.type === 'array_pattern') {
      destructuredNames = [];
      for (let i = 0; i < leftNode.childCount; i++) {
        const child = getChild(leftNode, i);
        if (child && child.type === 'identifier') {
          destructuredNames.push(child.text);
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
    };
  }

  const body = bodyNode ? wrapInBlock(bodyNode) : { type: 'block' as const, statements: [] };

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

  const tryBlock = bodyNode ? transformStatementBlock(bodyNode) : { type: 'block' as const, statements: [] };

  let catchClause: { param: string; body: BlockStatement } | null = null;
  if (handlerNode) {
    const paramNode = getChildByFieldName(handlerNode, 'parameter');
    const catchBodyNode = getChildByFieldName(handlerNode, 'body');

    const param = paramNode ? paramNode.text : 'e';
    const body = catchBodyNode ? transformStatementBlock(catchBodyNode) : { type: 'block' as const, statements: [] };
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

  if (bodyNode) {
    for (let i = 0; i < bodyNode.namedChildCount; i++) {
      const clause = getNamedChild(bodyNode, i);
      if (!clause) continue;

      if (clause.type === 'switch_case') {
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
          for (let j = 0; j < clause.namedChildCount; j++) {
            const stmtNode = getNamedChild(clause, j);
            if (stmtNode && stmtNode !== valueNode && stmtNode.type !== 'break_statement') {
              const stmt = transformStatement(stmtNode);
              if (stmt) statements.push(stmt);
            }
          }

          const ifStmt: IfStatement = {
            type: 'if',
            condition,
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
      } else if (clause.type === 'switch_default') {
        const statements: Statement[] = [];
        for (let j = 0; j < clause.namedChildCount; j++) {
          const stmtNode = getNamedChild(clause, j);
          if (stmtNode && stmtNode.type !== 'break_statement') {
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
    thenBlock: { type: 'block', statements: [] },
    elseBlock: null,
  };
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
  if (node.type === 'statement_block') {
    return transformStatementBlock(node);
  }
  const stmt = transformStatement(node);
  return { type: 'block', statements: stmt ? [stmt] : [] };
}

function transformFunctionDeclaration(node: TreeSitterNode): FunctionNode | null {
  const nameNode = getChildByFieldName(node, 'name');
  const paramsNode = getChildByFieldName(node, 'parameters');
  const bodyNode = getChildByFieldName(node, 'body');
  const returnTypeNode = getChildByFieldName(node, 'return_type');
  const typeParamsNode = getChildByFieldName(node, 'type_parameters');

  if (!nameNode) return null;

  const name = nameNode.text;
  const params = paramsNode ? extractFunctionParams(paramsNode) : [];
  const body = bodyNode ? transformStatementBlock(bodyNode) : { type: 'block' as const, statements: [] };

  let returnType: string | undefined;
  if (returnTypeNode) {
    returnType = extractTypeString(returnTypeNode);
  }

  let typeParameters: string[] | undefined;
  if (typeParamsNode) {
    typeParameters = [];
    for (let i = 0; i < typeParamsNode.namedChildCount; i++) {
      const tp = getNamedChild(typeParamsNode, i);
      if (tp && tp.type === 'type_parameter') {
        const tpName = getChildByFieldName(tp, 'name');
        if (tpName) {
          typeParameters.push(tpName.text);
        }
      }
    }
  }

  let isAsync = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (child && child.type === 'async') {
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
  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = getNamedChild(paramsNode, i);
    if (param) {
      if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
        const patternNode = getChildByFieldName(param, 'pattern');
        if (patternNode && patternNode.type === 'identifier') {
          params.push(patternNode.text);
        }
      } else if (param.type === 'identifier') {
        params.push(param.text);
      }
    }
  }
  return params;
}

function extractParamTypes(paramsNode: TreeSitterNode): string[] | undefined {
  const types: string[] = [];
  let hasTypes = false;

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = getNamedChild(paramsNode, i);
    if (param && (param.type === 'required_parameter' || param.type === 'optional_parameter')) {
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
    if (param && (param.type === 'required_parameter' || param.type === 'optional_parameter')) {
      const patternNode = getChildByFieldName(param, 'pattern');
      const typeNode = getChildByFieldName(param, 'type');
      const valueNode = getChildByFieldName(param, 'value');

      const name = patternNode && patternNode.type === 'identifier' ? patternNode.text : '';
      const type = typeNode ? extractTypeString(typeNode) : undefined;
      const optional = param.type === 'optional_parameter';
      const defaultValue = valueNode ? transformExpression(valueNode) : undefined;

      params.push({ name, type, optional, defaultValue });
    }
  }

  return params.length > 0 ? params : undefined;
}

function extractTypeString(typeNode: TreeSitterNode): string {
  if (typeNode.type === 'type_annotation') {
    const inner = getNamedChild(typeNode, 0);
    return inner ? extractTypeString(inner) : 'any';
  }

  if (typeNode.type === 'predefined_type') {
    return typeNode.text;
  }

  if (typeNode.type === 'type_identifier') {
    return typeNode.text;
  }

  if (typeNode.type === 'generic_type') {
    const nameNode = getChildByFieldName(typeNode, 'name');
    const argsNode = getChildByFieldName(typeNode, 'type_arguments');
    const name = nameNode ? nameNode.text : '';
    if (argsNode) {
      const args: string[] = [];
      for (let i = 0; i < argsNode.namedChildCount; i++) {
        const arg = getNamedChild(argsNode, i);
        if (arg) {
          args.push(extractTypeString(arg));
        }
      }
      return `${name}<${args.join(', ')}>`;
    }
    return name;
  }

  if (typeNode.type === 'array_type') {
    const elemNode = getNamedChild(typeNode, 0);
    const elem = elemNode ? extractTypeString(elemNode) : 'any';
    return `${elem}[]`;
  }

  if (typeNode.type === 'union_type') {
    const types: string[] = [];
    for (let i = 0; i < typeNode.namedChildCount; i++) {
      const t = getNamedChild(typeNode, i);
      if (t) {
        types.push(extractTypeString(t));
      }
    }
    return types.join(' | ');
  }

  if (typeNode.type === 'function_type') {
    return 'Function';
  }

  return typeNode.text;
}

function transformClassDeclaration(node: TreeSitterNode): ClassNode | null {
  const nameNode = getChildByFieldName(node, 'name');
  if (!nameNode) return null;

  const name = nameNode.text;

  let extendsClause: string | undefined;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (child && child.type === 'class_heritage') {
      for (let j = 0; j < child.namedChildCount; j++) {
        const clause = getNamedChild(child, j);
        if (clause && clause.type === 'extends_clause') {
          const valueNode = getChildByFieldName(clause, 'value');
          if (valueNode) {
            extendsClause = valueNode.text;
          }
        }
      }
    }
  }

  const fields: ClassField[] = [];
  const methods: ClassMethod[] = [];

  const bodyNode = getChildByFieldName(node, 'body');
  if (bodyNode) {
    for (let i = 0; i < bodyNode.namedChildCount; i++) {
      const member = getNamedChild(bodyNode, i);
      if (!member) continue;

      if (member.type === 'public_field_definition' || member.type === 'property_definition') {
        const field = transformClassField(member);
        if (field) {
          fields.push(field);
        }
      } else if (member.type === 'method_definition') {
        const method = transformClassMethod(member);
        if (method) {
          methods.push(method);
        }
      }
    }
  }

  return { name, extends: extendsClause, fields, methods };
}

function transformClassField(node: TreeSitterNode): ClassField | null {
  const nameNode = getChildByFieldName(node, 'name');
  const typeNode = getChildByFieldName(node, 'type');

  if (!nameNode) return null;

  const name = nameNode.text;
  let fieldType: ClassField['fieldType'] = 'double';
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

  const name = nameNode ? nameNode.text : '';
  const isConstructor = name === 'constructor';

  const params = paramsNode ? extractFunctionParams(paramsNode) : [];
  const body = bodyNode ? transformStatementBlock(bodyNode) : { type: 'block' as const, statements: [] };

  let returnType: ClassMethod['returnType'];
  if (returnTypeNode) {
    const typeStr = extractTypeString(returnTypeNode);
    returnType = mapToClassMethodType(typeStr);
  }

  const paramTypes = paramsNode ? extractClassParamTypes(paramsNode) : undefined;

  return {
    type: 'method',
    name,
    params,
    paramTypes,
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

function extractClassParamTypes(paramsNode: TreeSitterNode): ClassMethod['paramTypes'] {
  const types: ClassMethod['paramTypes'] = [];
  let hasTypes = false;

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = getNamedChild(paramsNode, i);
    if (param && (param.type === 'required_parameter' || param.type === 'optional_parameter')) {
      const typeNode = getChildByFieldName(param, 'type');
      if (typeNode) {
        const typeStr = extractTypeString(typeNode);
        const mapped = mapToClassMethodType(typeStr);
        if (mapped) {
          types.push(mapped);
          hasTypes = true;
        }
      }
    }
  }

  return hasTypes ? types : undefined;
}

function transformInterfaceDeclaration(node: TreeSitterNode): InterfaceDeclaration | null {
  const nameNode = getChildByFieldName(node, 'name');
  const bodyNode = getChildByFieldName(node, 'body');

  if (!nameNode) return null;

  const name = nameNode.text;
  const fields: { name: string; type: string }[] = [];

  if (bodyNode) {
    for (let i = 0; i < bodyNode.namedChildCount; i++) {
      const member = getNamedChild(bodyNode, i);
      if (member && member.type === 'property_signature') {
        const propNameNode = getChildByFieldName(member, 'name');
        const propTypeNode = getChildByFieldName(member, 'type');

        const fieldName = propNameNode ? propNameNode.text : '';
        const fieldType = propTypeNode ? extractTypeString(propTypeNode) : 'any';
        fields.push({ name: fieldName, type: fieldType });
      }
    }
  }

  return { name, fields };
}

function transformTypeAliasDeclaration(node: TreeSitterNode): TypeAliasDeclaration | null {
  const nameNode = getChildByFieldName(node, 'name');
  const valueNode = getChildByFieldName(node, 'value');

  if (!nameNode) return null;

  const name = nameNode.text;
  const unionMembers: string[] = [];

  if (valueNode) {
    if (valueNode.type === 'union_type') {
      for (let i = 0; i < valueNode.namedChildCount; i++) {
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

  const name = nameNode.text;
  const members: EnumMember[] = [];

  let currentValue = 0;
  if (bodyNode) {
    for (let i = 0; i < bodyNode.namedChildCount; i++) {
      const member = getNamedChild(bodyNode, i);
      if (member) {
        const memberNameNode = getChildByFieldName(member, 'name');
        const memberValueNode = getChildByFieldName(member, 'value');

        const memberName = memberNameNode ? memberNameNode.text : '';
        let value = currentValue;

        if (memberValueNode && memberValueNode.type === 'number') {
          value = parseInt(memberValueNode.text, 10);
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

  let source = sourceNode.text;
  if ((source.startsWith('"') && source.endsWith('"')) ||
      (source.startsWith("'") && source.endsWith("'"))) {
    source = source.slice(1, -1);
  }

  const specifiers: string[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;

    if (child.type === 'import_clause') {
      for (let j = 0; j < child.namedChildCount; j++) {
        const clause = getNamedChild(child, j);
        if (!clause) continue;

        if (clause.type === 'identifier') {
          specifiers.push(clause.text);
        } else if (clause.type === 'named_imports') {
          for (let k = 0; k < clause.namedChildCount; k++) {
            const spec = getNamedChild(clause, k);
            if (spec && spec.type === 'import_specifier') {
              const nameNode = getChildByFieldName(spec, 'name');
              if (nameNode) {
                specifiers.push(nameNode.text);
              }
            }
          }
        } else if (clause.type === 'namespace_import') {
          const nameNode = getNamedChild(clause, 0);
          if (nameNode) {
            specifiers.push(`* as ${nameNode.text}`);
          }
        }
      }
    }
  }

  return { type: 'import', specifiers, source };
}
