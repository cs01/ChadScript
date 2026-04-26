import {
  TreeSitterNode,
  TreeSitterTree,
  getChild,
  getNamedChild,
  getChildByFieldName,
} from "./index.js";
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
  DoWhileStatement,
  ForStatement,
  ForOfStatement,
  ThrowStatement,
  TryStatement,
  TopLevelItem,
  FunctionParameter,
  StringNode,
  NumberNode,
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
} from "../ast/types.js";

let destructureCounter = 0;

interface ExprBase {
  type: string;
}
interface NodeBase {
  nodePtr: number;
  source: string;
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  childCount: number;
  namedChildCount: number;
  isNamed: boolean;
  isNull: boolean;
}

function getExprType(expr: Expression | null | undefined): string {
  if (!expr) return "";
  return (expr as ExprBase).type;
}

let currentFile = "<input>";

export function setCurrentFile(file: string): void {
  currentFile = file;
}

function getLineFromIndex(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") line = line + 1;
  }
  return line;
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
    defaultExportName: undefined,
    topLevelStatements: [],
    topLevelExpressions: [],
    topLevelItems: [],
    topLevelItemTypes: [],
    importAliasNames: [],
    importAliasOriginals: [],
  };

  const childCount = node.namedChildCount;
  let i = 0;
  while (i < childCount) {
    const child = getNamedChild(node, i);
    if (!child) {
      i = i + 1;
      continue;
    }
    transformTopLevelNode(child, ast);
    i = i + 1;
  }

  return ast;
}

function transformTopLevelNode(node: TreeSitterNode, ast: AST): void {
  if ((node as NodeBase).type === "labeled_statement") {
    const line = getLineFromIndex((node as NodeBase).source, (node as NodeBase).startIndex);
    console.error(
      currentFile +
        ":" +
        line +
        ": error: labeled statements (e.g., 'outer: for') are not supported; use a flag variable with regular break instead",
    );
    process.exit(1);
  }
  switch (node.type) {
    case "import_statement":
      const importDecl = transformImportStatement(node);
      if (importDecl) {
        ast.imports.push(importDecl);
      }
      break;

    case "function_declaration":
      const func = transformFunctionDeclaration(node);
      if (func) {
        ast.functions.push(func);
      }
      break;

    case "class_declaration":
      const cls = transformClassDeclaration(node);
      if (cls) {
        ast.classes.push(cls);
      }
      break;

    case "interface_declaration":
      const iface = transformInterfaceDeclaration(node);
      if (iface) {
        ast.interfaces.push(iface);
      }
      break;

    case "type_alias_declaration":
      const objIface = transformObjectTypeAlias(node);
      if (objIface) {
        ast.interfaces.push(objIface);
      } else {
        const typeAlias = transformTypeAliasDeclaration(node);
        if (typeAlias) ast.typeAliases.push(typeAlias);
      }
      break;

    case "enum_declaration":
      const enumDecl = transformEnumDeclaration(node);
      if (enumDecl) {
        ast.enums.push(enumDecl);
      }
      break;

    case "lexical_declaration":
    case "variable_declaration":
      const varDecls = transformLexicalDeclaration(node);
      for (let _vdi = 0; _vdi < varDecls.length; _vdi++) {
        const varDecl = varDecls[_vdi];
        ast.topLevelStatements.push(varDecl);
        ast.topLevelItems!.push(varDecl);
        ast.topLevelItemTypes!.push("variable_declaration");
      }
      break;

    case "expression_statement":
      handleExpressionStatement(node, ast);
      break;

    case "for_statement":
      const forStmt = transformForStatement(node);
      if (forStmt) {
        ast.topLevelExpressions.push(forStmt);
        ast.topLevelItems!.push(forStmt);
        ast.topLevelItemTypes!.push("for");
      }
      break;

    case "for_in_statement":
      const forOfStmt = transformForInStatement(node);
      if (forOfStmt) {
        ast.topLevelExpressions.push(forOfStmt);
        ast.topLevelItems!.push(forOfStmt);
        ast.topLevelItemTypes!.push("for_of");
      }
      break;

    case "while_statement":
      const whileStmt = transformWhileStatement(node);
      if (whileStmt) {
        ast.topLevelExpressions.push(whileStmt);
        ast.topLevelItems!.push(whileStmt);
        ast.topLevelItemTypes!.push("while");
      }
      break;

    case "do_statement":
      const doWhileStmt = transformDoWhileStatement(node);
      if (doWhileStmt) {
        ast.topLevelExpressions.push(doWhileStmt);
        ast.topLevelItems!.push(doWhileStmt);
        ast.topLevelItemTypes!.push("do_while");
      }
      break;

    case "if_statement":
      const ifStmt = transformIfStatement(node);
      if (ifStmt) {
        ast.topLevelExpressions.push(ifStmt);
        ast.topLevelItems!.push(ifStmt);
        ast.topLevelItemTypes!.push("if");
      }
      break;

    case "try_statement":
      const tryStmt = transformTryStatement(node);
      if (tryStmt) {
        ast.topLevelExpressions.push(tryStmt);
        ast.topLevelItems!.push(tryStmt);
        ast.topLevelItemTypes!.push("try");
      }
      break;

    case "throw_statement":
      const throwStmt = transformThrowStatement(node);
      if (throwStmt) {
        ast.topLevelItems!.push(throwStmt as TopLevelItem);
        ast.topLevelItemTypes!.push("throw");
      }
      break;

    case "switch_statement":
      const switchBlock = transformSwitchStatement(node);
      for (let si = 0; si < switchBlock.statements.length; si++) {
        const s = switchBlock.statements[si];
        ast.topLevelExpressions.push(s as IfStatement);
        ast.topLevelItems!.push(s as TopLevelItem);
        ast.topLevelItemTypes!.push("if");
      }
      break;

    case "export_statement":
      handleExportStatement(node, ast);
      break;

    // `declare function foo(x: string): string` — tree-sitter wraps it in
    // ambient_declaration containing a function_signature child (same fields
    // as function_declaration minus the body).
    // NOTE: no block braces — ChadScript's switch codegen drops block-scoped cases.
    case "ambient_declaration":
      handleAmbientDeclaration(node, ast);
      break;
  }
}

// Extract declared functions from `declare function` statements.
// Uses text parsing instead of tree-sitter child navigation to avoid
// native FFI crashes with function_signature nodes.
function handleAmbientDeclaration(node: TreeSitterNode, ast: AST): void {
  const nb = node as NodeBase;
  const text = nb.text;
  const fIdx = text.indexOf("function ");
  if (fIdx === -1) return;
  const rest = text.substring(fIdx + 9);
  const openParen = rest.indexOf("(");
  if (openParen === -1) return;
  const funcName = rest.substring(0, openParen);

  const closeParen = rest.indexOf(")");
  if (closeParen === -1) return;
  const paramStr = rest.substring(openParen + 1, closeParen);

  let returnType = "void";
  const afterClose = rest.substring(closeParen + 1);
  const retColon = afterClose.indexOf(":");
  if (retColon !== -1) {
    let retStr = afterClose.substring(retColon + 1);
    retStr = retStr.trim();
    const semi = retStr.indexOf(";");
    if (semi !== -1) retStr = retStr.substring(0, semi);
    returnType = retStr;
  }

  const paramNames: string[] = [];
  const paramTypesList: string[] = [];
  if (paramStr.length > 0) {
    const parts = paramStr.split(",");
    let pi = 0;
    while (pi < parts.length) {
      const part = parts[pi].trim();
      if (part.length > 0) {
        const pColon = part.indexOf(":");
        if (pColon !== -1) {
          paramNames.push(part.substring(0, pColon).trim());
          paramTypesList.push(part.substring(pColon + 1).trim());
        }
      }
      pi = pi + 1;
    }
  }

  const func: FunctionNode = {
    name: funcName,
    params: paramNames,
    body: createEmptyBlock(),
    returnType: returnType,
    paramTypes: paramTypesList,
    async: undefined,
    parameters: undefined,
    loc: undefined,
    declare: true,
    typeParameters: undefined,
  };
  ast.functions.push(func);
}

function handleExpressionStatement(node: TreeSitterNode, ast: AST): void {
  const exprNode = getNamedChild(node, 0);
  if (!exprNode) return;

  const expr = transformExpression(exprNode);
  const e = expr as ExprBase;

  if (e.type === "member_access_assignment" || e.type === "index_access_assignment") {
    const memberExprTyped = expr as { type: string; object: Expression; property: string };
    const assignment: AssignmentStatement = {
      type: "assignment",
      name:
        e.type === "member_access_assignment"
          ? `__member_access__${memberExprTyped.property}__`
          : "__index_access__",
      value: expr,
    };
    ast.topLevelStatements.push(assignment);
    ast.topLevelItems!.push(assignment);
    ast.topLevelItemTypes!.push("assignment");
  } else if (
    e.type === "call" ||
    e.type === "new" ||
    e.type === "method_call" ||
    e.type === "await"
  ) {
    ast.topLevelExpressions.push(expr as CallNode | NewNode | MethodCallNode);
    ast.topLevelItems!.push(expr as TopLevelItem);
    ast.topLevelItemTypes!.push(e.type);
  } else if (e.type === "unary") {
    throw new Error(
      "Increment/decrement (++/--) at global scope is not supported. Use x = x + 1 instead, or wrap in a function.",
    );
  } else if (e.type === "binary") {
    const binExprTyped = expr as { type: string; op: string; left: Expression; right: Expression };
    if (binExprTyped.op === "=") {
      const leftExprBase = binExprTyped.left as ExprBase;
      const leftExprVar = binExprTyped.left as { type: string; name: string };
      const assignment: AssignmentStatement = {
        type: "assignment",
        name: leftExprBase.type === "variable" ? leftExprVar.name : "__unknown__",
        value: binExprTyped.right,
      };
      ast.topLevelStatements.push(assignment);
      ast.topLevelItems!.push(assignment);
      ast.topLevelItemTypes!.push("assignment");
    }
  }
}

function handleExportStatement(node: TreeSitterNode, ast: AST): void {
  const nodeText = (node as NodeBase).text;
  const isTypeOnly = nodeText.startsWith("export type ") || nodeText.startsWith("export type{");
  const isDefault = nodeText.startsWith("export default ");

  let exportClause: TreeSitterNode | null = null;
  let sourceString: TreeSitterNode | null = null;

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;

    if (c.type === "function_declaration") {
      const func = transformFunctionDeclaration(child);
      if (func) {
        ast.functions.push(func);
        ast.exports.push({ type: "export", declaration: func });
        if (isDefault) ast.defaultExportName = func.name;
      }
    } else if (c.type === "class_declaration") {
      const cls = transformClassDeclaration(child);
      if (cls) {
        ast.classes.push(cls);
        ast.exports.push({ type: "export", declaration: cls });
        if (isDefault) ast.defaultExportName = cls.name;
      }
    } else if (c.type === "interface_declaration") {
      const iface = transformInterfaceDeclaration(child);
      if (iface) {
        ast.interfaces.push(iface);
      }
    } else if (c.type === "type_alias_declaration") {
      const objIface = transformObjectTypeAlias(child);
      if (objIface) {
        ast.interfaces.push(objIface);
      } else {
        const typeAlias = transformTypeAliasDeclaration(child);
        if (typeAlias) ast.typeAliases.push(typeAlias);
      }
    } else if (c.type === "enum_declaration") {
      const enumDecl = transformEnumDeclaration(child);
      if (enumDecl) {
        ast.enums.push(enumDecl);
      }
    } else if (c.type === "lexical_declaration") {
      const varDecls = transformLexicalDeclaration(child);
      for (let _vdi2 = 0; _vdi2 < varDecls.length; _vdi2++) {
        const varDecl = varDecls[_vdi2];
        ast.topLevelStatements.push(varDecl);
        ast.topLevelItems!.push(varDecl);
        ast.topLevelItemTypes!.push("variable_declaration");
      }
    } else if (c.type === "export_clause") {
      exportClause = child;
    } else if (c.type === "string") {
      sourceString = child;
    } else if (isDefault && c.type === "identifier") {
      // export default MyClass — just an identifier reference
      ast.defaultExportName = c.text;
    }
  }

  if (exportClause && sourceString && !isTypeOnly) {
    let source = (sourceString as NodeBase).text;
    if (
      (source.startsWith('"') && source.endsWith('"')) ||
      (source.startsWith("'") && source.endsWith("'"))
    ) {
      source = source.slice(1, -1);
    }

    const specifiers: string[] = [];
    const ec = exportClause as NodeBase;
    for (let i = 0; i < ec.namedChildCount; i++) {
      const spec = getNamedChild(exportClause, i);
      if (!spec) continue;
      const sp = spec as NodeBase;
      if (sp.type === "export_specifier") {
        const nameNode = getNamedChild(spec, 0);
        if (nameNode) {
          specifiers.push((nameNode as NodeBase).text);
        }
      }
    }

    if (specifiers.length > 0) {
      ast.imports.push({
        type: "import",
        specifiers,
        aliasedSpecifiers: [],
        source,
        defaultImport: undefined,
      });
    }
  }
}

function transformExpression(node: TreeSitterNode): Expression {
  switch (node.type) {
    case "number":
      return transformNumberNode(node);

    case "string":
      return transformStringNode(node);

    case "true":
      return { type: "boolean", value: true };

    case "false":
      return { type: "boolean", value: false };

    case "null":
      return { type: "variable", name: "null" };

    case "undefined":
      return { type: "variable", name: "undefined" };

    case "identifier":
      return { type: "variable", name: node.text };

    case "this":
      return { type: "this" };

    case "super":
      return { type: "super" };

    case "binary_expression":
      return transformBinaryExpression(node);

    case "unary_expression":
      return transformUnaryExpressionOrVoid(node);

    case "update_expression":
      return transformUpdateExpression(node);

    case "call_expression":
      return transformCallExpression(node);

    case "member_expression":
      return transformMemberExpression(node);

    case "subscript_expression":
      return transformSubscriptExpression(node);

    case "array":
      return transformArrayExpression(node);

    case "object":
      return transformObjectExpression(node);

    case "new_expression":
      return transformNewExpression(node);

    case "template_string":
      return transformTemplateString(node);

    case "arrow_function":
      return transformArrowFunction(node);

    case "function_expression":
      return transformFunctionExpression(node);

    case "parenthesized_expression":
      const inner = getNamedChild(node, 0);
      return inner ? transformExpression(inner) : { type: "variable", name: "undefined" };

    case "ternary_expression":
      return transformTernaryExpression(node);

    case "await_expression":
      return transformAwaitExpression(node);

    case "regex":
      return transformRegexNode(node);

    case "assignment_expression":
      return transformAssignmentExpression(node);

    case "augmented_assignment_expression":
      return transformAugmentedAssignmentExpression(node);

    case "as_expression":
    case "type_assertion":
      return transformTypeAssertion(node);

    case "satisfies_expression":
      const satisfiesExprChild = getNamedChild(node, 0);
      return satisfiesExprChild
        ? transformExpression(satisfiesExprChild)
        : { type: "variable", name: "undefined" };

    case "non_null_expression":
      const nnChild = getNamedChild(node, 0);
      return nnChild ? transformExpression(nnChild) : { type: "variable", name: "undefined" };

    case "typeof_expression":
      return transformTypeofExpression(node);

    // JSX desugaring — convert JSX syntax to createElement() calls
    case "jsx_element":
      return transformJsxElementNative(node);

    case "jsx_self_closing_element":
      return transformJsxSelfClosingElementNative(node);

    case "jsx_expression":
      // Bare JSX expression container — unwrap to the inner expression
      const jsxInner = getNamedChild(node, 0);
      return jsxInner ? transformExpression(jsxInner) : { type: "variable", name: "undefined" };

    default:
      return { type: "variable", name: "undefined" };
  }
}

// Extracted to a helper so the "unary_expression" switch case in
// transformExpression is a single-statement body — avoiding parser-native's
// tree-sitter iteration dropping the trailing return when a bare case body has
// [var_decl, if_no_else, return]. See #597 for diagnostic.
function transformUnaryExpressionOrVoid(node: TreeSitterNode): Expression {
  const voidOpChild = getChild(node, 0);
  if (voidOpChild && (voidOpChild as NodeBase).type === "void") {
    return { type: "variable", name: "undefined" };
  }
  return transformUnaryExpression(node);
}

// ============================================
// JSX DESUGARING (native parser)
// Mirrors the TS-API parser's JSX desugaring.
// Tree-sitter TSX grammar node types:
//   jsx_element: has open_tag (jsx_opening_element) and close_tag (jsx_closing_element)
//   jsx_self_closing_element: has name + attributes, no children
//   jsx_opening_element: has name field (absent for fragments) + attribute fields
//   jsx_text: raw text content between tags
//   jsx_expression: {expr} containers
// ============================================

function makeJsxCallNode(tagName: string, props: Expression, children: Expression): CallNode {
  // Build args with push() — the semantic analyzer treats push()-built arrays as
  // homogeneous (all Expression) whereas inline array literals with different shapes
  // trigger "mixed array types" errors during self-hosting.
  const args: Expression[] = [];
  args.push({ type: "string", value: tagName });
  args.push(props);
  args.push(children);
  return { type: "call", name: "createElement", args };
}

function transformJsxElementNative(node: TreeSitterNode): CallNode {
  const openTag = getChildByFieldName(node, "open_tag");
  let tagName = "Fragment";
  let props: Expression = { type: "object", properties: [] };

  if (openTag && !(openTag as NodeBase).isNull) {
    const nameNode = getChildByFieldName(openTag, "name");
    if (nameNode && !(nameNode as NodeBase).isNull) {
      tagName = (nameNode as NodeBase).text;
    }
    // else: no name field means this is a fragment (<>...</>)
    props = transformJsxAttributesNative(openTag);
  }

  const children = transformJsxChildrenNative(node);
  return makeJsxCallNode(tagName, props, children);
}

function transformJsxSelfClosingElementNative(node: TreeSitterNode): CallNode {
  const nameNode = getChildByFieldName(node, "name");
  const tagName =
    nameNode && !(nameNode as NodeBase).isNull ? (nameNode as NodeBase).text : "Fragment";
  const props: Expression = transformJsxAttributesNative(node);
  const emptyChildren: Expression = { type: "array", elements: [] };
  return makeJsxCallNode(tagName, props, emptyChildren);
}

function transformJsxAttributesNative(node: TreeSitterNode): ObjectNode {
  const properties: { key: string; value: Expression }[] = [];
  const childCount = node.childCount;

  for (let i = 0; i < childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const childBase = child as NodeBase;
    if (childBase.type !== "jsx_attribute") continue;

    // First named child is property_identifier (key), second is value
    const keyNode = getNamedChild(child, 0);
    if (!keyNode) continue;
    const key = (keyNode as NodeBase).text;

    const valueNode = getNamedChild(child, 1);
    let value: Expression;

    if (!valueNode || (valueNode as NodeBase).isNull) {
      // Boolean shorthand: <Input disabled /> → { disabled: true }
      value = { type: "boolean", value: true };
    } else {
      const valueBase = valueNode as NodeBase;
      if (valueBase.type === "string") {
        value = transformStringNode(valueNode);
      } else if (valueBase.type === "jsx_expression") {
        const inner = getNamedChild(valueNode, 0);
        value = inner ? transformExpression(inner) : { type: "variable", name: "undefined" };
      } else {
        value = transformExpression(valueNode);
      }
    }

    properties.push({ key, value });
  }

  return { type: "object", properties };
}

function transformJsxChildrenNative(node: TreeSitterNode): ArrayNode {
  const elements: Expression[] = [];
  const childCount = node.namedChildCount;

  for (let i = 0; i < childCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;
    const childBase = child as NodeBase;

    // Skip the open_tag and close_tag — only process content children
    if (childBase.type === "jsx_opening_element" || childBase.type === "jsx_closing_element") {
      continue;
    }

    if (childBase.type === "jsx_text") {
      const trimmed = childBase.text.trim();
      if (trimmed.length === 0) continue;
      elements.push({ type: "string", value: trimmed });
    } else if (childBase.type === "jsx_expression") {
      const inner = getNamedChild(child, 0);
      if (inner) {
        elements.push(transformExpression(inner));
      }
    } else if (childBase.type === "jsx_element") {
      elements.push(transformJsxElementNative(child));
    } else if (childBase.type === "jsx_self_closing_element") {
      elements.push(transformJsxSelfClosingElementNative(child));
    }
  }

  return { type: "array", elements };
}

function transformTypeAssertion(node: TreeSitterNode): TypeAssertionNode {
  const exprChild = getNamedChild(node, 0);
  const expression = exprChild
    ? transformExpression(exprChild)
    : { type: "variable" as const, name: "undefined" };

  let assertedType = "unknown";
  for (let i = 1; i < node.namedChildCount; i++) {
    const typeChild = getNamedChild(node, i);
    if (typeChild) {
      const tc = typeChild as NodeBase;
      if (tc.type !== "identifier" || tc.text !== "as") {
        assertedType = tc.text;
        break;
      }
    }
  }

  return {
    type: "type_assertion",
    expression,
    assertedType,
  };
}

function transformNumberNode(node: TreeSitterNode): NumberNode {
  const numText = node.text;
  const isFloat =
    numText.indexOf(".") !== -1 || numText.indexOf("e") !== -1 || numText.indexOf("E") !== -1;
  return { type: "number", value: parseFloat(numText), loc: undefined, isFloat };
}

function transformStringNode(node: TreeSitterNode): StringNode {
  let text = node.text;
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }
  let processed = "";
  let i = 0;
  while (i < text.length) {
    if (text.charAt(i) === "\\" && i + 1 < text.length) {
      const next = text.charAt(i + 1);
      if (next === "n") {
        processed += "\n";
        i += 2;
      } else if (next === "t") {
        processed += "\t";
        i += 2;
      } else if (next === "r") {
        processed += "\r";
        i += 2;
      } else if (next === "\\") {
        processed += "\\";
        i += 2;
      } else if (next === '"') {
        processed += '"';
        i += 2;
      } else if (next === "'") {
        processed += "'";
        i += 2;
      } else if (next === "x" && i + 3 < text.length) {
        // \xHH hex escape — parse two hex digits into a single character
        const hex = text.substring(i + 2, i + 4);
        const code = parseInt(hex, 16);
        if (!isNaN(code)) {
          processed += String.fromCharCode(code);
          i += 4;
        } else {
          processed += next;
          i += 2;
        }
      } else if (next === "u" && i + 5 < text.length) {
        // \uHHHH unicode escape — parse four hex digits
        const hex = text.substring(i + 2, i + 6);
        const code = parseInt(hex, 16);
        if (!isNaN(code)) {
          processed += String.fromCharCode(code);
          i += 6;
        } else {
          processed += next;
          i += 2;
        }
      } else if (next === "0") {
        processed += "\0";
        i += 2;
      } else {
        processed += next;
        i += 2;
      }
    } else {
      processed += text.charAt(i);
      i += 1;
    }
  }
  return { type: "string", value: processed };
}

function transformBinaryExpression(node: TreeSitterNode): BinaryNode {
  const left = getNamedChild(node, 0);
  const right = getNamedChild(node, 1);

  let op = "";
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (!c.isNamed) {
      const t = c.type;
      if (
        [
          "+",
          "-",
          "*",
          "/",
          "%",
          "<",
          ">",
          "<=",
          ">=",
          "==",
          "===",
          "!=",
          "!==",
          "&&",
          "||",
          "??",
          "&",
          "|",
          "^",
          "<<",
          ">>",
          ">>>",
          "**",
        ].includes(t)
      ) {
        op = t;
        break;
      }
      if (t === "instanceof") {
        op = "instanceof";
        break;
      }
      if (t === "in") {
        op = "in";
        break;
      }
    }
  }

  return {
    type: "binary",
    op,
    left: left ? transformExpression(left) : { type: "variable", name: "undefined" },
    right: right ? transformExpression(right) : { type: "variable", name: "undefined" },
  };
}

function transformUnaryExpression(node: TreeSitterNode): UnaryNode {
  let op = "";
  let operandNode: TreeSitterNode | null = null;

  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (!c.isNamed) {
      if (["-", "+", "!", "~", "typeof"].includes(c.type)) {
        op = c.type;
      }
    } else if (c.type === "typeof") {
      op = "typeof";
    } else {
      operandNode = child;
    }
  }

  return {
    type: "unary",
    op,
    operand: operandNode
      ? transformExpression(operandNode)
      : { type: "variable", name: "undefined" },
  };
}

function transformUpdateExpression(node: TreeSitterNode): UnaryNode {
  let op = "";
  let isPrefix = true;
  let operandNode: TreeSitterNode | null = null;

  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (!c.isNamed) {
      if (c.type === "++" || c.type === "--") {
        op = c.type;
        isPrefix = i === 0;
      }
    } else {
      operandNode = child;
    }
  }

  if (!isPrefix) {
    op = op === "++" ? "post++" : "post--";
  }

  return {
    type: "unary",
    op,
    operand: operandNode
      ? transformExpression(operandNode)
      : { type: "variable", name: "undefined" },
  };
}

function transformCallExpression(node: TreeSitterNode): Expression {
  const funcNode = getChildByFieldName(node, "function");
  const argsNode = getChildByFieldName(node, "arguments");

  const args: Expression[] = [];
  if (argsNode) {
    const an = argsNode as NodeBase;
    for (let i = 0; i < an.namedChildCount; i++) {
      const argChild = getNamedChild(argsNode, i);
      if (argChild) {
        const ac = argChild as NodeBase;
        if (ac.type === "spread_element") {
          const innerArg = getNamedChild(argChild, 0);
          if (innerArg) {
            args.push(transformExpression(innerArg));
          }
        } else {
          args.push(transformExpression(argChild));
        }
      }
    }
  }

  let typeParameter: string | undefined;
  const typeArgsNode = getChildByFieldName(node, "type_arguments");
  if (typeArgsNode) {
    const ncc = typeArgsNode.namedChildCount;
    if (ncc > 0) {
      const firstTypeArg = getNamedChild(typeArgsNode, 0);
      if (firstTypeArg) {
        typeParameter = firstTypeArg.text;
      }
    }
  }

  if (!funcNode) {
    return { type: "call", name: "", args };
  }

  const fn = funcNode as NodeBase;
  if (fn.type === "member_expression") {
    const objNode = getChildByFieldName(funcNode, "object");
    const propNode = getChildByFieldName(funcNode, "property");
    const object = objNode
      ? transformExpression(objNode)
      : { type: "variable" as const, name: "undefined" };
    const method = propNode ? (propNode as NodeBase).text : "";

    let isOptional = false;
    if (objNode) {
      const objEnd = (objNode as NodeBase).endIndex;
      const propStart = propNode ? (propNode as NodeBase).startIndex : fn.endIndex;
      const operatorText = fn.source.substring(objEnd, propStart);
      if (operatorText.indexOf("?.") !== -1) {
        isOptional = true;
      }
    }

    return {
      type: "method_call",
      object: object,
      method: method,
      args: args,
      typeParameter: typeParameter,
      pos: 0,
      loc: undefined,
      optional: isOptional || undefined,
    };
  } else if (fn.type === "identifier") {
    let callTypeArgs: string[] | undefined;
    if (typeArgsNode) {
      const ncc = typeArgsNode.namedChildCount;
      if (ncc > 0) {
        callTypeArgs = [];
        for (let i = 0; i < ncc; i++) {
          const ta = getNamedChild(typeArgsNode, i);
          if (ta) callTypeArgs.push((ta as NodeBase).text);
        }
      }
    }
    return { type: "call", name: fn.text, args, typeArgs: callTypeArgs };
  } else if (fn.type === "super") {
    return { type: "call", name: "super", args };
  } else {
    const callee = transformExpression(funcNode);
    return {
      type: "method_call",
      object: callee,
      method: "",
      args,
      typeParameter: undefined,
      pos: 0,
      loc: undefined,
      optional: undefined,
    };
  }
}

function transformMemberExpression(node: TreeSitterNode): MemberAccessNode {
  const objNode = getChildByFieldName(node, "object");
  const propNode = getChildByFieldName(node, "property");

  let isOptional = false;
  if (objNode) {
    const objEnd = (objNode as NodeBase).endIndex;
    const propStart = propNode ? (propNode as NodeBase).startIndex : (node as NodeBase).endIndex;
    const operatorText = (node as NodeBase).source.substring(objEnd, propStart);
    if (operatorText.indexOf("?.") !== -1) {
      isOptional = true;
    }
  }

  return {
    type: "member_access",
    object: objNode ? transformExpression(objNode) : { type: "variable", name: "undefined" },
    property: propNode ? (propNode as NodeBase).text : "",
    optional: isOptional || undefined,
  };
}

function transformSubscriptExpression(node: TreeSitterNode): IndexAccessNode {
  const objNode = getChildByFieldName(node, "object");
  const indexNode = getChildByFieldName(node, "index");

  return {
    type: "index_access",
    object: objNode ? transformExpression(objNode) : { type: "variable", name: "undefined" },
    index: indexNode ? transformExpression(indexNode) : { type: "number", value: 0 },
  };
}

function transformArrayExpression(node: TreeSitterNode): ArrayNode {
  const elements: Expression[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (child) {
      const c = child as NodeBase;
      if (c.type === "spread_element") {
        const arg = getNamedChild(child, 0);
        if (arg) {
          const argBase = arg as NodeBase;
          if (argBase.type === "identifier") {
            elements.push({ type: "spread:" + argBase.text } as unknown as Expression);
          } else {
            const argExpr = transformExpression(arg);
            const argExprTyped = argExpr as { type: string; name?: string };
            if (argExprTyped.type === "variable" && argExprTyped.name) {
              elements.push({ type: "spread:" + argExprTyped.name } as unknown as Expression);
            } else {
              elements.push({
                type: "spread_element",
                argument: argExpr,
              } as Expression);
            }
          }
        } else {
          elements.push({ type: "spread:undefined" } as unknown as Expression);
        }
      } else {
        elements.push(transformExpression(child));
      }
    }
  }
  return { type: "array", elements };
}

function transformObjectExpression(node: TreeSitterNode): ObjectNode {
  const properties: { key: string; value: Expression }[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;

    if (c.type === "pair") {
      const keyNode = getChildByFieldName(child, "key");
      const valueNode = getChildByFieldName(child, "value");

      let key = "";
      if (keyNode) {
        const k = keyNode as NodeBase;
        if (k.type === "property_identifier" || k.type === "identifier") {
          key = k.text;
        } else if (k.type === "string") {
          key = k.text.slice(1, -1);
        } else if (k.type === "computed_property_name") {
          const inner = getNamedChild(keyNode, 0);
          if (inner) {
            const expr = transformExpression(inner);
            const eKey = expr as ExprBase;
            const exprStr = expr as { type: string; value: string };
            const exprVar = expr as { type: string; name: string };
            if (eKey.type === "string") {
              key = exprStr.value || "";
            } else if (eKey.type === "variable") {
              key = `[${exprVar.name}]`;
            } else {
              key = "[computed]";
            }
          }
        }
      }

      const value = valueNode
        ? transformExpression(valueNode)
        : { type: "variable" as const, name: "undefined" };
      properties.push({ key, value });
    } else if (c.type === "shorthand_property_identifier") {
      const key = c.text;
      properties.push({ key, value: { type: "variable", name: key } });
    } else if (c.type === "spread_element") {
      throw new Error("Object spread (...) is not yet supported in ChadScript");
    } else if (c.type === "method_definition") {
      const nameNode = getChildByFieldName(child, "name");
      const paramsNode = getChildByFieldName(child, "parameters");
      const bodyNode = getChildByFieldName(child, "body");

      const key = nameNode ? (nameNode as NodeBase).text : "";
      const params = paramsNode ? extractFunctionParams(paramsNode) : [];
      const body = bodyNode ? transformStatementBlock(bodyNode) : createEmptyBlock();

      const retTypeNode = getChildByFieldName(child, "return_type");
      let retType: string | undefined = undefined;
      if (retTypeNode) {
        retType = extractTypeString(retTypeNode);
      }

      const arrowFn: ArrowFunctionNode = {
        type: "arrow_function",
        params,
        body,
        async: undefined,
        captures: undefined,
        returnType: retType,
      };
      properties.push({ key, value: arrowFn });
    }
  }

  return { type: "object", properties };
}

function transformNewExpression(node: TreeSitterNode): Expression {
  const constructorNode = getChildByFieldName(node, "constructor");
  const argsNode = getChildByFieldName(node, "arguments");
  const typeArgsNode = getChildByFieldName(node, "type_arguments");

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

  const typeArgs: string[] = [];
  if (typeArgsNode) {
    const tan = typeArgsNode as NodeBase;
    for (let ti = 0; ti < tan.namedChildCount; ti++) {
      const targ = getNamedChild(typeArgsNode, ti);
      if (targ) {
        typeArgs.push(extractTypeString(targ));
      }
    }
  }

  const className = constructorNode ? (constructorNode as NodeBase).text : "";

  if (className === "Map") {
    return transformNewMapExpression(args, typeArgs);
  }

  if (className === "Set") {
    return transformNewSetExpression(args, typeArgs);
  }

  return transformNewClassExpression(className, args, typeArgs);
}

function transformNewMapExpression(args: Expression[], typeArgs: string[]): MapNode {
  let keyType: string | undefined;
  let valueType: string | undefined;
  if (typeArgs.length >= 2) {
    keyType = typeArgs[0];
    valueType = typeArgs[1];
  }
  if (args.length > 0) {
    const firstArgType = getExprType(args[0]);
    if (firstArgType === "array") {
      const elements = (args[0] as ArrayNode).elements;
      const entries: { key: Expression; value: Expression }[] = [];
      for (let ei = 0; ei < elements.length; ei++) {
        const elem = elements[ei];
        const elemType = getExprType(elem);
        if (elemType === "array" && (elem as ArrayNode).elements.length === 2) {
          entries.push({
            key: (elem as ArrayNode).elements[0],
            value: (elem as ArrayNode).elements[1],
          });
        } else {
          const undefinedVal: Expression = { type: "variable" as const, name: "undefined" };
          entries.push({ key: elem, value: undefinedVal });
        }
      }
      return { type: "map", entries, keyType, valueType };
    }
  }
  const emptyEntries: { key: Expression; value: Expression }[] = [];
  return { type: "map", entries: emptyEntries, keyType, valueType };
}

function transformNewSetExpression(args: Expression[], typeArgs: string[]): SetNode {
  let valueType: string | undefined;
  if (typeArgs.length >= 1) {
    valueType = typeArgs[0];
  }
  if (args.length > 0) {
    const firstArgType = getExprType(args[0]);
    if (firstArgType === "array") {
      const setValues = (args[0] as ArrayNode).elements;
      return { type: "set", values: setValues, valueType };
    }
  }
  const emptyValues: Expression[] = [];
  return { type: "set", values: emptyValues, valueType };
}

function transformNewClassExpression(
  className: string,
  args: Expression[],
  typeArgs: string[],
): NewNode {
  return { type: "new", className, args, typeArgs };
}

function transformTemplateString(node: TreeSitterNode): Expression {
  const parts: (string | Expression)[] = [];
  let hasSubstitutions = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;

    if (c.type === "string_fragment" || c.type === "template_content") {
      parts.push({ type: "string", value: c.text } as Expression);
    } else if (c.type === "escape_sequence") {
      let decoded = c.text;
      if (decoded === "\\n") decoded = "\n";
      else if (decoded === "\\t") decoded = "\t";
      else if (decoded === "\\r") decoded = "\r";
      else if (decoded === "\\\\") decoded = "\\";
      else if (decoded === "\\`") decoded = "`";
      else if (decoded === "\\$") decoded = "$";
      else if (decoded === "\\0") decoded = "\0";
      else if (decoded.length === 4 && decoded.startsWith("\\x")) {
        // \xHH hex escape
        const code = parseInt(decoded.substring(2, 4), 16);
        decoded = !isNaN(code) ? String.fromCharCode(code) : decoded.charAt(1);
      } else if (decoded.length === 6 && decoded.startsWith("\\u")) {
        // \uHHHH unicode escape
        const code = parseInt(decoded.substring(2, 6), 16);
        decoded = !isNaN(code) ? String.fromCharCode(code) : decoded.charAt(1);
      } else if (decoded.length === 2 && decoded.charAt(0) === "\\") decoded = decoded.charAt(1);
      parts.push({ type: "string", value: decoded } as Expression);
    } else if (c.type === "template_substitution") {
      hasSubstitutions = true;
      const exprChild = getNamedChild(child, 0);
      if (exprChild) {
        parts.push(transformExpression(exprChild));
      }
    } else if (c.type === "`") {
      continue;
    } else if (c.isNamed) {
      hasSubstitutions = true;
      parts.push(transformExpression(child));
    }
  }

  if (!hasSubstitutions && parts.length <= 1) {
    let text = "";
    if (parts.length === 1) {
      const firstPart = parts[0] as { type: string; value?: string };
      if (firstPart.type === "string") {
        text = firstPart.value || "";
      }
    }
    return { type: "string", value: text };
  }

  return { type: "template_literal", parts };
}

function transformArrowFunction(node: TreeSitterNode): ArrowFunctionNode {
  const paramsNode =
    getChildByFieldName(node, "parameters") || getChildByFieldName(node, "parameter");
  const bodyNode = getChildByFieldName(node, "body");

  let params: string[] = [];
  if (paramsNode) {
    const pn = paramsNode as NodeBase;
    if (pn.type === "identifier") {
      params = [pn.text];
    } else {
      params = extractFunctionParams(paramsNode);
    }
  }

  let body: Expression | BlockStatement;
  if (bodyNode) {
    const bn = bodyNode as NodeBase;
    if (bn.type === "statement_block") {
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
    if (c.type === "async") {
      isAsync = true;
      break;
    }
  }

  const returnTypeNode = getChildByFieldName(node, "return_type");
  let returnType: string | undefined = undefined;
  if (returnTypeNode) {
    returnType = extractTypeString(returnTypeNode);
  }

  return {
    type: "arrow_function",
    params,
    body,
    async: isAsync || undefined,
    captures: undefined,
    returnType,
  };
}

function transformFunctionExpression(node: TreeSitterNode): ArrowFunctionNode {
  const paramsNode = getChildByFieldName(node, "parameters");
  const bodyNode = getChildByFieldName(node, "body");

  const params = paramsNode ? extractFunctionParams(paramsNode) : [];
  const body = bodyNode ? transformStatementBlock(bodyNode) : createEmptyBlock();

  let isAsync = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (c.type === "async") {
      isAsync = true;
      break;
    }
  }

  const returnTypeNode = getChildByFieldName(node, "return_type");
  let returnType: string | undefined = undefined;
  if (returnTypeNode) {
    returnType = extractTypeString(returnTypeNode);
  }

  return {
    type: "arrow_function",
    params,
    body,
    async: isAsync || undefined,
    captures: undefined,
    returnType,
  };
}

function transformTernaryExpression(node: TreeSitterNode): ConditionalExpressionNode {
  const condNode = getChildByFieldName(node, "condition");
  const consNode = getChildByFieldName(node, "consequence");
  const altNode = getChildByFieldName(node, "alternative");

  return {
    type: "conditional",
    condition: condNode ? transformExpression(condNode) : { type: "boolean", value: false },
    consequent: consNode ? transformExpression(consNode) : { type: "variable", name: "undefined" },
    alternate: altNode ? transformExpression(altNode) : { type: "variable", name: "undefined" },
  };
}

function transformAwaitExpression(node: TreeSitterNode): Expression {
  const argNode = getNamedChild(node, 0);
  return {
    type: "await",
    argument: argNode ? transformExpression(argNode) : { type: "variable", name: "undefined" },
  };
}

function transformRegexNode(node: TreeSitterNode): RegexNode {
  const text = (node as NodeBase).text;
  let lastSlash: number = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text.charAt(i) === "/") {
      lastSlash = i;
      break;
    }
  }
  const pattern = text.slice(1, lastSlash);
  const flags = text.slice(lastSlash + 1);
  return { type: "regex", pattern, flags };
}

function transformAssignmentExpression(node: TreeSitterNode): Expression {
  const leftNode = getNamedChild(node, 0);
  const rightNode = getNamedChild(node, 1);

  const right = rightNode
    ? transformExpression(rightNode)
    : { type: "variable" as const, name: "undefined" };

  if (leftNode) {
    const ln = leftNode as NodeBase;
    if (ln.type === "identifier") {
      return {
        type: "binary",
        op: "=",
        left: { type: "variable", name: ln.text },
        right,
      };
    } else if (ln.type === "member_expression") {
      const obj = transformExpression(leftNode);
      const objBase = obj as ExprBase;
      if (objBase.type === "member_access") {
        const objTyped = obj as { type: string; object: Expression; property: string };
        return {
          type: "member_access_assignment",
          object: objTyped.object,
          property: objTyped.property,
          value: right,
        };
      }
    } else if (ln.type === "subscript_expression") {
      const obj = transformExpression(leftNode);
      const objBase = obj as ExprBase;
      if (objBase.type === "index_access") {
        const objTyped = obj as { type: string; object: Expression; index: Expression };
        return {
          type: "index_access_assignment",
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

  let op = "";
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (!c.isNamed) {
      const t = c.type;
      if (
        ["+=", "-=", "*=", "/=", "%=", "|=", "&=", "^=", "<<=", ">>=", ">>>=", "**="].includes(t)
      ) {
        op = t.slice(0, t.length - 1);
        break;
      }
    }
  }

  const left = leftNode
    ? transformExpression(leftNode)
    : { type: "variable" as const, name: "undefined" };
  const right = rightNode
    ? transformExpression(rightNode)
    : { type: "variable" as const, name: "undefined" };
  const newValue: BinaryNode = { type: "binary", op, left, right };
  const leftBase = left as ExprBase;

  if (leftNode) {
    const ln = leftNode as NodeBase;
    if (ln.type === "identifier") {
      return {
        type: "binary",
        op: "=",
        left,
        right: newValue,
      };
    } else if (ln.type === "member_expression") {
      if (leftBase.type === "member_access") {
        const leftTyped = left as { type: string; object: Expression; property: string };
        return {
          type: "member_access_assignment",
          object: leftTyped.object,
          property: leftTyped.property,
          value: newValue,
        };
      }
    } else if (ln.type === "subscript_expression") {
      if (leftBase.type === "index_access") {
        const leftTyped = left as { type: string; object: Expression; index: Expression };
        return {
          type: "index_access_assignment",
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
    type: "unary",
    op: "typeof",
    operand: argNode ? transformExpression(argNode) : { type: "variable", name: "undefined" },
  };
}

function transformStatement(node: TreeSitterNode): Statement | null {
  if ((node as NodeBase).type === "labeled_statement") {
    const line = getLineFromIndex((node as NodeBase).source, (node as NodeBase).startIndex);
    console.error(
      currentFile +
        ":" +
        line +
        ": error: labeled statements (e.g., 'outer: for') are not supported; use a flag variable with regular break instead",
    );
    process.exit(1);
  }
  switch (node.type) {
    case "lexical_declaration":
    case "variable_declaration":
      const decls = transformLexicalDeclaration(node);
      return decls.length > 0 ? decls[0] : null;

    case "expression_statement":
      return transformExpressionStatementNode(node);

    case "return_statement":
      return transformReturnStatement(node);

    case "if_statement":
      return transformIfStatement(node);

    case "while_statement":
      return transformWhileStatement(node);

    case "do_statement":
      return transformDoWhileStatement(node);

    case "for_statement":
      return transformForStatement(node);

    case "for_in_statement":
      return transformForInStatement(node);

    case "break_statement":
      return { type: "break" };

    case "continue_statement":
      return { type: "continue" };

    case "throw_statement":
      return transformThrowStatement(node);

    case "try_statement":
      return transformTryStatement(node);

    case "switch_statement":
      return transformSwitchStatement(node);

    case "statement_block":
      return null;

    case "empty_statement":
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

  if (en.type === "assignment_expression" || en.type === "augmented_assignment_expression") {
    const leftNode = getNamedChild(exprNode, 0);
    const rightNode = getNamedChild(exprNode, 1);
    if (leftNode) {
      const ln = leftNode as NodeBase;
      if (ln.type === "identifier") {
        let valueToAssign: Expression;
        if (en.type === "augmented_assignment_expression") {
          let op = "";
          for (let opIdx = 0; opIdx < exprNode.childCount; opIdx++) {
            const opChild = getChild(exprNode, opIdx);
            if (!opChild) continue;
            const opC = opChild as NodeBase;
            if (!opC.isNamed) {
              const opT = opC.type;
              if (opT === "+=") {
                op = "+";
                break;
              }
              if (opT === "-=") {
                op = "-";
                break;
              }
              if (opT === "*=") {
                op = "*";
                break;
              }
              if (opT === "/=") {
                op = "/";
                break;
              }
              if (opT === "%=") {
                op = "%";
                break;
              }
              if (opT === "|=") {
                op = "|";
                break;
              }
              if (opT === "&=") {
                op = "&";
                break;
              }
              if (opT === "^=") {
                op = "^";
                break;
              }
              if (opT === "<<=") {
                op = "<<";
                break;
              }
              if (opT === ">>=") {
                op = ">>";
                break;
              }
            }
          }
          const leftExpr: Expression = { type: "variable", name: ln.text };
          const rightExpr = rightNode
            ? transformExpression(rightNode)
            : { type: "number" as const, value: 0 };
          valueToAssign = { type: "binary", op, left: leftExpr, right: rightExpr };
        } else {
          valueToAssign = rightNode ? transformExpression(rightNode) : { type: "number", value: 0 };
        }
        return {
          type: "assignment",
          name: ln.text,
          value: valueToAssign,
        };
      } else if (ln.type === "member_expression") {
        return {
          type: "assignment",
          name: `__member_access__`,
          value: expr,
        };
      } else if (ln.type === "subscript_expression") {
        return {
          type: "assignment",
          name: `__index_access__`,
          value: expr,
        };
      }
    }
  }

  return expr;
}

function transformLexicalDeclaration(node: TreeSitterNode): VariableDeclaration[] {
  if ((node as NodeBase).type === "variable_declaration") {
    console.error("error: 'var' is not allowed; use 'let' or 'const'");
    process.exit(1);
  }
  const declarations: VariableDeclaration[] = [];

  let kind: "let" | "const" = "let";
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (c.type === "const") {
      kind = "const";
      break;
    }
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (c.type === "variable_declarator") {
      const nameNode = getNamedChild(child, 0);
      if (!nameNode) continue;
      const nn = nameNode as NodeBase;

      if (nn.type === "object_pattern" || nn.type === "array_pattern") {
        const desugared = desugarDestructuring(child, kind);
        for (let j = 0; j < desugared.length; j++) {
          declarations.push(desugared[j]);
        }
      } else {
        const decl = transformVariableDeclarator(child, kind);
        if (decl) {
          declarations.push(decl);
        }
      }
    }
  }

  return declarations;
}

function desugarDestructuring(
  declaratorNode: TreeSitterNode,
  kind: "let" | "const",
): VariableDeclaration[] {
  const nameNode = getNamedChild(declaratorNode, 0);
  if (!nameNode) return [];
  const nn = nameNode as NodeBase;

  let rhsExpr: Expression | null = null;
  const child1 = getNamedChild(declaratorNode, 1);
  if (child1) {
    const c1 = child1 as NodeBase;
    if (c1.type === "type_annotation") {
      const child2 = getNamedChild(declaratorNode, 2);
      if (child2) {
        rhsExpr = transformExpression(child2);
      }
    } else {
      rhsExpr = transformExpression(child1);
    }
  }
  if (!rhsExpr) return [];

  const results: VariableDeclaration[] = [];

  let objectRef: Expression = rhsExpr;
  const rhsBase = rhsExpr as ExprBase;
  if (rhsBase.type !== "variable") {
    const tempName = "__destructure_" + String(destructureCounter);
    destructureCounter = destructureCounter + 1;
    results.push({
      type: "variable_declaration",
      kind: "const",
      name: tempName,
      value: rhsExpr,
      declaredType: undefined,
      loc: undefined,
    });
    objectRef = { type: "variable", name: tempName } as Expression;
  }

  if (nn.type === "object_pattern") {
    for (let i = 0; i < nameNode.namedChildCount; i++) {
      const prop = getNamedChild(nameNode, i);
      if (!prop) continue;
      const p = prop as NodeBase;

      if (p.type === "shorthand_property_identifier_pattern") {
        const propName = p.text;
        results.push({
          type: "variable_declaration",
          kind,
          name: propName,
          value: { type: "member_access", object: objectRef, property: propName } as Expression,
          declaredType: undefined,
          loc: undefined,
        });
      } else if (p.type === "pair_pattern") {
        const keyNode = getNamedChild(prop, 0);
        const valueNode = getNamedChild(prop, 1);
        if (keyNode && valueNode) {
          const keyName = (keyNode as NodeBase).text;
          const aliasName = (valueNode as NodeBase).text;
          results.push({
            type: "variable_declaration",
            kind,
            name: aliasName,
            value: { type: "member_access", object: objectRef, property: keyName } as Expression,
            declaredType: undefined,
            loc: undefined,
          });
        }
      }
    }
  } else if (nn.type === "array_pattern") {
    let idx = 0;
    for (let i = 0; i < nameNode.namedChildCount; i++) {
      const elem = getNamedChild(nameNode, i);
      if (!elem) {
        idx++;
        continue;
      }
      const e = elem as NodeBase;
      if (e.type === "identifier") {
        results.push({
          type: "variable_declaration",
          kind,
          name: e.text,
          value: {
            type: "index_access",
            object: objectRef,
            index: { type: "number", value: idx },
          } as Expression,
          declaredType: undefined,
          loc: undefined,
        });
        idx++;
      }
    }
  }

  return results;
}

function transformVariableDeclarator(
  node: TreeSitterNode,
  kind: "let" | "const",
): VariableDeclaration | null {
  const nameNode = getNamedChild(node, 0);
  const name = nameNode ? (nameNode as NodeBase).text : "";

  let declaredType: string | undefined;
  let value: Expression | null = null;

  const child1 = getNamedChild(node, 1);
  if (child1) {
    const c1 = child1 as NodeBase;
    if (c1.type === "type_annotation") {
      declaredType = extractTypeString(child1);
      const child2 = getNamedChild(node, 2);
      if (child2) {
        value = transformExpression(child2);
      }
    } else {
      value = transformExpression(child1);
    }
  }

  return { type: "variable_declaration", kind, name, value, declaredType, loc: undefined };
}

function transformReturnStatement(node: TreeSitterNode): ReturnStatement {
  const exprNode = getNamedChild(node, 0);
  const value = exprNode
    ? transformExpression(exprNode)
    : { type: "variable" as const, name: "undefined" };
  return { type: "return", value };
}

function transformIfStatement(node: TreeSitterNode): IfStatement {
  const condNode = getChildByFieldName(node, "condition");
  const consNode = getChildByFieldName(node, "consequence");
  const altNode = getChildByFieldName(node, "alternative");

  let condition: Expression;
  if (condNode) {
    const cn = condNode as NodeBase;
    if (cn.type === "parenthesized_expression") {
      const inner = getNamedChild(condNode, 0);
      condition = inner ? transformExpression(inner) : { type: "boolean", value: false };
    } else {
      condition = transformExpression(condNode);
    }
  } else {
    condition = { type: "boolean", value: false };
  }

  const thenBlock = consNode ? wrapInBlock(consNode) : createEmptyBlock();

  let elseBlock: BlockStatement | null = null;
  if (altNode) {
    const an = altNode as NodeBase;
    if (an.type === "if_statement") {
      const nestedIf = transformIfStatement(altNode);
      const stmts: Statement[] = [nestedIf];
      elseBlock = { type: "block", statements: stmts };
    } else if (an.type === "else_clause") {
      const elseBody = getNamedChild(altNode, 0);
      if (elseBody) {
        const eb = elseBody as NodeBase;
        if (eb.type === "if_statement") {
          const nestedIf = transformIfStatement(elseBody);
          const stmts: Statement[] = [nestedIf];
          elseBlock = { type: "block", statements: stmts };
        } else {
          elseBlock = wrapInBlock(elseBody);
        }
      }
    } else {
      elseBlock = wrapInBlock(altNode);
    }
  }

  return { type: "if", condition, thenBlock, elseBlock };
}

function transformWhileStatement(node: TreeSitterNode): WhileStatement {
  const condNode = getChildByFieldName(node, "condition");
  const bodyNode = getChildByFieldName(node, "body");

  let condition: Expression;
  if (condNode) {
    const cn = condNode as NodeBase;
    if (cn.type === "parenthesized_expression") {
      const inner = getNamedChild(condNode, 0);
      condition = inner ? transformExpression(inner) : { type: "boolean", value: true };
    } else {
      condition = transformExpression(condNode);
    }
  } else {
    condition = { type: "boolean", value: true };
  }

  const body = bodyNode ? wrapInBlock(bodyNode) : createEmptyBlock();

  return { type: "while", condition, body };
}

function transformDoWhileStatement(node: TreeSitterNode): DoWhileStatement {
  const condNode = getChildByFieldName(node, "condition");
  const bodyNode = getChildByFieldName(node, "body");

  let condition: Expression;
  if (condNode) {
    const cn = condNode as NodeBase;
    if (cn.type === "parenthesized_expression") {
      const inner = getNamedChild(condNode, 0);
      condition = inner ? transformExpression(inner) : { type: "boolean", value: true };
    } else {
      condition = transformExpression(condNode);
    }
  } else {
    condition = { type: "boolean", value: true };
  }

  const body = bodyNode ? wrapInBlock(bodyNode) : createEmptyBlock();

  return { type: "do_while", condition, body };
}

function transformForStatement(node: TreeSitterNode): ForStatement {
  const initNode = getChildByFieldName(node, "initializer");
  const condNode = getChildByFieldName(node, "condition");
  const incrNode = getChildByFieldName(node, "increment");
  const bodyNode = getChildByFieldName(node, "body");

  let init: VariableDeclaration | AssignmentStatement | null = null;
  if (initNode) {
    const inn = initNode as NodeBase;
    if (inn.type === "lexical_declaration" || inn.type === "variable_declaration") {
      const decls = transformLexicalDeclaration(initNode);
      init = decls.length > 0 ? decls[0] : null;
    } else if (inn.type === "assignment_expression") {
      const leftNode = getNamedChild(initNode, 0);
      const rightNode = getNamedChild(initNode, 1);
      if (leftNode) {
        const ln = leftNode as NodeBase;
        if (ln.type === "identifier") {
          init = {
            type: "assignment",
            name: ln.text,
            value: rightNode ? transformExpression(rightNode) : { type: "number", value: 0 },
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
    if (incn.type === "assignment_expression" || incn.type === "augmented_assignment_expression") {
      const leftNode = getNamedChild(incrNode, 0);
      const rightNode = getNamedChild(incrNode, 1);
      if (leftNode) {
        const ln = leftNode as NodeBase;
        if (ln.type === "identifier") {
          let valueToAssign: Expression;
          if (incn.type === "augmented_assignment_expression") {
            let op = "";
            for (let opIdx = 0; opIdx < incrNode.childCount; opIdx++) {
              const opChild = getChild(incrNode, opIdx);
              if (!opChild) continue;
              const opC = opChild as NodeBase;
              if (!opC.isNamed) {
                const opT = opC.type;
                if (opT === "+=") {
                  op = "+";
                  break;
                }
                if (opT === "-=") {
                  op = "-";
                  break;
                }
                if (opT === "*=") {
                  op = "*";
                  break;
                }
                if (opT === "/=") {
                  op = "/";
                  break;
                }
                if (opT === "%=") {
                  op = "%";
                  break;
                }
                if (opT === "|=") {
                  op = "|";
                  break;
                }
                if (opT === "&=") {
                  op = "&";
                  break;
                }
                if (opT === "^=") {
                  op = "^";
                  break;
                }
                if (opT === "<<=") {
                  op = "<<";
                  break;
                }
                if (opT === ">>=") {
                  op = ">>";
                  break;
                }
              }
            }
            const leftExpr: Expression = { type: "variable", name: ln.text };
            const rightExpr = rightNode
              ? transformExpression(rightNode)
              : { type: "number" as const, value: 0 };
            valueToAssign = { type: "binary", op, left: leftExpr, right: rightExpr };
          } else {
            valueToAssign = rightNode
              ? transformExpression(rightNode)
              : { type: "number", value: 0 };
          }
          update = {
            type: "assignment",
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

  return { type: "for", init, condition, update, body };
}

function transformForInStatement(node: TreeSitterNode): ForOfStatement {
  let variableName = "";
  let destructuredNames: string[] | undefined;
  let variableKind: "let" | "const" | "var" = "const";
  let isForOf = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (c.type === "of") {
      isForOf = true;
    } else if (c.type === "const") {
      variableKind = "const";
    } else if (c.type === "let") {
      variableKind = "let";
    } else if (c.type === "var") {
      console.error("error: 'var' is not allowed; use 'let' or 'const'");
      process.exit(1);
    }
  }

  const leftNode = getNamedChild(node, 0);
  const rightNode = getNamedChild(node, 1);
  const bodyNode = getNamedChild(node, 2);

  if (leftNode) {
    const ln = leftNode as NodeBase;
    if (ln.type === "identifier") {
      variableName = ln.text;
    } else if (ln.type === "array_pattern") {
      destructuredNames = [];
      for (let i = 0; i < ln.childCount; i++) {
        const child = getChild(leftNode, i);
        if (!child) continue;
        const c = child as NodeBase;
        if (c.type === "identifier") {
          destructuredNames.push(c.text);
        }
      }
      variableName = destructuredNames[0] || "";
    }
  }

  let iterable: Expression;
  if (rightNode) {
    iterable = transformExpression(rightNode);
  } else {
    iterable = { type: "array", elements: [] };
  }

  if (!isForOf) {
    iterable = {
      type: "method_call",
      object: { type: "variable", name: "Object" },
      method: "keys",
      args: [iterable],
      typeParameter: undefined,
      pos: 0,
      loc: undefined,
      optional: undefined,
    };
  }

  const body = bodyNode ? wrapInBlock(bodyNode) : createEmptyBlock();

  return { type: "for_of", variableKind, variableName, destructuredNames, iterable, body };
}

function transformThrowStatement(node: TreeSitterNode): ThrowStatement {
  const argNode = getNamedChild(node, 0);
  const argument = argNode
    ? transformExpression(argNode)
    : { type: "string" as const, value: "Error" };
  return { type: "throw", argument };
}

function transformTryStatement(node: TreeSitterNode): TryStatement {
  const bodyNode = getChildByFieldName(node, "body");
  const handlerNode = getChildByFieldName(node, "handler");
  const finalizerNode = getChildByFieldName(node, "finalizer");

  const tryBlock = bodyNode ? transformStatementBlock(bodyNode) : createEmptyBlock();

  let catchParam: string | null = null;
  let catchBody: BlockStatement | null = null;
  if (handlerNode) {
    const paramNode = getChildByFieldName(handlerNode, "parameter");
    const catchBodyNode = getChildByFieldName(handlerNode, "body");

    catchParam = paramNode ? (paramNode as NodeBase).text : "e";
    catchBody = catchBodyNode ? transformStatementBlock(catchBodyNode) : createEmptyBlock();
  }

  let finallyBlock: BlockStatement | null = null;
  if (finalizerNode) {
    const finallyBodyNode = getNamedChild(finalizerNode, 0);
    if (finallyBodyNode) {
      finallyBlock = transformStatementBlock(finallyBodyNode);
    }
  }

  return { type: "try", tryBlock, catchParam, catchBody, finallyBlock };
}

function transformSwitchStatement(node: TreeSitterNode): BlockStatement {
  const exprNode = getChildByFieldName(node, "value");
  const bodyNode = getChildByFieldName(node, "body");

  const switchExpr = exprNode
    ? transformExpression(exprNode)
    : { type: "variable" as const, name: "undefined" };

  let pendingConditions: Expression[] = [];
  let defaultStatements: Statement[] | null = null;
  const caseIfNodes: object[] = [];

  if (bodyNode) {
    const bn = bodyNode as NodeBase;
    for (let i = 0; i < bn.namedChildCount; i++) {
      const clause = getNamedChild(bodyNode, i);
      if (!clause) continue;
      const cl = clause as NodeBase;

      if (cl.type === "switch_case") {
        const valueNode = getChildByFieldName(clause, "value");
        if (valueNode) {
          const caseExpr = transformExpression(valueNode);
          const condition: Expression = {
            type: "binary",
            op: "===",
            left: switchExpr,
            right: caseExpr,
          };

          const caseStatements: Statement[] = [];
          for (let j = 0; j < cl.namedChildCount; j++) {
            const stmtNode = getNamedChild(clause, j);
            if (!stmtNode) continue;
            const sn = stmtNode as NodeBase;
            if (stmtNode !== valueNode && sn.type !== "break_statement") {
              if (sn.type === "lexical_declaration" || sn.type === "variable_declaration") {
                const decls = transformLexicalDeclaration(stmtNode);
                for (let dk = 0; dk < decls.length; dk++) {
                  caseStatements.push(decls[dk]);
                }
              } else {
                const stmt = transformStatement(stmtNode);
                if (stmt) caseStatements.push(stmt);
              }
            }
          }

          if (caseStatements.length === 0) {
            pendingConditions.push(condition);
          } else {
            let finalCondition: Expression = condition;
            for (let k = pendingConditions.length - 1; k >= 0; k--) {
              finalCondition = {
                type: "binary",
                op: "||",
                left: pendingConditions[k],
                right: finalCondition,
              };
            }
            pendingConditions = [];

            const thenBlock: BlockStatement = { type: "block", statements: caseStatements };
            const ifStmt: IfStatement = {
              type: "if",
              condition: finalCondition,
              thenBlock: thenBlock,
              elseBlock: null,
            };
            caseIfNodes.push(ifStmt);
          }
        }
      } else if (cl.type === "switch_default") {
        defaultStatements = [];
        for (let j = 0; j < cl.namedChildCount; j++) {
          const stmtNode = getNamedChild(clause, j);
          if (!stmtNode) continue;
          const sn = stmtNode as NodeBase;
          if (sn.type !== "break_statement") {
            if (sn.type === "lexical_declaration" || sn.type === "variable_declaration") {
              const decls = transformLexicalDeclaration(stmtNode);
              for (let dk = 0; dk < decls.length; dk++) {
                defaultStatements.push(decls[dk]);
              }
            } else {
              const stmt = transformStatement(stmtNode);
              if (stmt) defaultStatements.push(stmt);
            }
          }
        }
      }
    }
  }

  if (caseIfNodes.length === 0) {
    const statements: Statement[] = [];
    if (defaultStatements) {
      for (let ds = 0; ds < defaultStatements.length; ds++) {
        statements.push(defaultStatements[ds]);
      }
    }
    return { type: "block", statements: statements };
  }

  let chainedIf = caseIfNodes[caseIfNodes.length - 1] as IfStatement;
  if (defaultStatements) {
    chainedIf = {
      type: "if",
      condition: chainedIf.condition,
      thenBlock: chainedIf.thenBlock,
      elseBlock: { type: "block", statements: defaultStatements },
    };
  }
  for (let ci = caseIfNodes.length - 2; ci >= 0; ci--) {
    const prev = caseIfNodes[ci] as IfStatement;
    const elseWrapper: BlockStatement = { type: "block", statements: [chainedIf] };
    chainedIf = {
      type: "if",
      condition: prev.condition,
      thenBlock: prev.thenBlock,
      elseBlock: elseWrapper,
    };
  }

  const statements: Statement[] = [];
  statements.push(chainedIf);
  return { type: "block", statements: statements };
}

function createEmptyBlock(): BlockStatement {
  const statements: Statement[] = [];
  return { type: "block", statements };
}

function transformStatementBlock(node: TreeSitterNode): BlockStatement {
  const statements: Statement[] = [];
  const ncc = node.namedChildCount;
  for (let i = 0; i < ncc; i++) {
    const child = getNamedChild(node, i);
    if (child) {
      const cn = child as NodeBase;
      if (cn.type === "lexical_declaration" || cn.type === "variable_declaration") {
        const decls = transformLexicalDeclaration(child);
        for (let j = 0; j < decls.length; j++) {
          statements.push(decls[j]);
        }
      } else {
        const stmt = transformStatement(child);
        if (stmt) {
          statements.push(stmt);
        }
      }
    }
  }
  return { type: "block", statements };
}

function wrapInBlock(node: TreeSitterNode): BlockStatement {
  const n = node as NodeBase;
  if (n.type === "statement_block") {
    return transformStatementBlock(node);
  }
  const stmt = transformStatement(node);
  if (stmt) {
    const statements: Statement[] = [stmt];
    return { type: "block", statements };
  }
  return createEmptyBlock();
}

function transformFunctionDeclaration(node: TreeSitterNode): FunctionNode | null {
  const nameNode = getChildByFieldName(node, "name");
  const paramsNode = getChildByFieldName(node, "parameters");
  const bodyNode = getChildByFieldName(node, "body");
  const returnTypeNode = getChildByFieldName(node, "return_type");
  const typeParamsNode = getChildByFieldName(node, "type_parameters");

  if (!nameNode) return null;

  const nn = nameNode as NodeBase;
  const name = nn.text;
  const params = paramsNode ? extractFunctionParams(paramsNode) : [];
  const body = bodyNode ? transformStatementBlock(bodyNode) : createEmptyBlock();

  let returnType: string | undefined = "";
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
      if (tpBase.type === "type_parameter") {
        const tpName = getChildByFieldName(tp, "name");
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
    if (c.type === "async") {
      isAsync = true;
      break;
    }
  }

  const paramTypes = paramsNode ? extractParamTypes(paramsNode) : undefined;
  const parameters = paramsNode ? extractFunctionParameters(paramsNode) : undefined;

  // All creation sites for FunctionNode must include every field from the interface
  // definition in the same order. The native compiler uses the interface field list
  // to compute GEP indices (declare = index 9), but determines struct size from
  // object literals. Omitting `loc` puts `declare` at index 8 in memory while the
  // codegen accesses index 9 — an out-of-bounds read that segfaults.
  // IMPORTANT: `declare` must be `false` not `undefined` — native codegen may skip
  // the field slot entirely for `undefined`, causing struct size mismatch.
  return {
    name,
    params,
    body,
    returnType,
    paramTypes,
    async: isAsync || undefined,
    parameters,
    loc: undefined,
    declare: false,
    typeParameters,
  };
}

function extractParams(paramsNode: TreeSitterNode, outNames: string[], outTypes: string[]): void {
  const namedChildCount = paramsNode.namedChildCount;
  for (let i = 0; i < namedChildCount; i++) {
    const param = getNamedChild(paramsNode, i);
    if (!param) {
      continue;
    }
    const p = param as NodeBase;
    if (p.type === "required_parameter" || p.type === "optional_parameter") {
      const patternNode = getChildByFieldName(param, "pattern");
      const typeNode = getChildByFieldName(param, "type");
      let paramName = "";
      if (patternNode) {
        const pn = patternNode as NodeBase;
        if (pn.type === "identifier") {
          paramName = pn.text;
        }
      }
      if (paramName === "") {
        const nodeText = p.text;
        if (nodeText.indexOf("...") !== -1) {
          const afterDots = nodeText.substr(nodeText.indexOf("...") + 3);
          const colonIdx = afterDots.indexOf(":");
          if (colonIdx !== -1) {
            paramName = afterDots.substr(0, colonIdx);
          } else {
            paramName = afterDots;
          }
        }
      }
      outNames.push(paramName);
      outTypes.push(typeNode ? extractTypeString(typeNode) : "");
    } else if (p.type === "identifier") {
      outNames.push(p.text);
      outTypes.push("");
    } else {
      let restName = "";
      let restType = "number[]";
      let hasDots = false;
      for (let ci = 0; ci < param.childCount; ci++) {
        const ch = getChild(param, ci);
        if (!ch) continue;
        const chb = ch as NodeBase;
        if (!chb.isNamed && chb.text === "...") {
          hasDots = true;
        }
        if (chb.isNamed && chb.type === "identifier" && hasDots) {
          restName = chb.text;
        }
        if (chb.isNamed && chb.type === "type_annotation") {
          restType = extractTypeString(ch);
        }
      }
      if (!hasDots) {
        const pText = p.text;
        if (pText.indexOf("...") !== -1) {
          hasDots = true;
          const afterDots = pText.substr(pText.indexOf("...") + 3);
          const colonIdx = afterDots.indexOf(":");
          if (colonIdx !== -1) {
            restName = afterDots.substr(0, colonIdx);
          } else {
            const parenIdx = afterDots.indexOf(")");
            if (parenIdx !== -1) {
              restName = afterDots.substr(0, parenIdx);
            } else {
              restName = afterDots;
            }
          }
        }
      }
      if (hasDots && restName !== "") {
        outNames.push(restName);
        outTypes.push(restType);
      }
    }
  }
}

function extractFunctionParams(paramsNode: TreeSitterNode): string[] {
  const names: string[] = [];
  const types: string[] = [];
  extractParams(paramsNode, names, types);
  return names;
}

function extractParamTypes(paramsNode: TreeSitterNode): string[] {
  const names: string[] = [];
  const types: string[] = [];
  extractParams(paramsNode, names, types);
  return types;
}

function extractFunctionParameters(paramsNode: TreeSitterNode): FunctionParameter[] {
  const params: FunctionParameter[] = [];
  const extractedNames: string[] = [];
  const extractedTypes: string[] = [];
  extractParams(paramsNode, extractedNames, extractedTypes);
  let extractedIdx = 0;

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = getNamedChild(paramsNode, i);
    if (!param) continue;
    const p = param as NodeBase;
    if (p.type === "required_parameter" || p.type === "optional_parameter") {
      const valueNode = getChildByFieldName(param, "value");
      const name = extractedIdx < extractedNames.length ? extractedNames[extractedIdx] : "";
      const type = extractedIdx < extractedTypes.length ? extractedTypes[extractedIdx] : undefined;
      const optional = p.type === "optional_parameter";
      const defaultValue = valueNode ? transformExpression(valueNode) : undefined;
      extractedIdx = extractedIdx + 1;
      params.push({ name, type, optional, defaultValue });
    } else if (p.type === "identifier") {
      extractedIdx = extractedIdx + 1;
    } else {
      let hasDots = false;
      for (let ci = 0; ci < param.childCount; ci++) {
        const ch = getChild(param, ci);
        if (!ch) continue;
        const chb = ch as NodeBase;
        if (!chb.isNamed && chb.text === "...") {
          hasDots = true;
          break;
        }
      }
      if (hasDots) {
        const name = extractedIdx < extractedNames.length ? extractedNames[extractedIdx] : "";
        const type =
          extractedIdx < extractedTypes.length ? extractedTypes[extractedIdx] : undefined;
        extractedIdx = extractedIdx + 1;
        params.push({ name, type });
      }
    }
  }

  return params;
}

function extractTypeString(typeNode: TreeSitterNode): string {
  const tn = typeNode as NodeBase;
  if (tn.type === "type_annotation") {
    const inner = getNamedChild(typeNode, 0);
    return inner ? extractTypeString(inner) : "any";
  }

  if (tn.type === "predefined_type") {
    return tn.text;
  }

  if (tn.type === "type_identifier") {
    return tn.text;
  }

  if (tn.type === "generic_type") {
    const nameNode = getChildByFieldName(typeNode, "name");
    const argsNode = getChildByFieldName(typeNode, "type_arguments");
    const name = nameNode ? (nameNode as NodeBase).text : "";
    if (argsNode) {
      const an = argsNode as NodeBase;
      const args: string[] = [];
      for (let i = 0; i < an.namedChildCount; i++) {
        const arg = getNamedChild(argsNode, i);
        if (arg) {
          args.push(extractTypeString(arg));
        }
      }
      return `${name}<${args.join(", ")}>`;
    }
    return name;
  }

  if (tn.type === "array_type") {
    const elemNode = getNamedChild(typeNode, 0);
    const elem = elemNode ? extractTypeString(elemNode) : "any";
    return `${elem}[]`;
  }

  if (tn.type === "union_type") {
    const types: string[] = [];
    for (let i = 0; i < typeNode.namedChildCount; i++) {
      const t = getNamedChild(typeNode, i);
      if (t) {
        types.push(extractTypeString(t));
      }
    }
    return types.join(" | ");
  }

  if (tn.type === "function_type") {
    const paramsNode = getChildByFieldName(typeNode, "parameters");
    const returnTypeNode = getChildByFieldName(typeNode, "return_type");
    const parts: string[] = [];
    if (paramsNode) {
      const pn = paramsNode as NodeBase;
      for (let i = 0; i < pn.namedChildCount; i++) {
        const param = getNamedChild(paramsNode, i);
        if (!param) continue;
        const p = param as NodeBase;
        if (p.type === "required_parameter" || p.type === "optional_parameter") {
          const patternNode = getChildByFieldName(param, "pattern");
          const typeAnnotationNode = getChildByFieldName(param, "type");
          const paramName = patternNode ? (patternNode as NodeBase).text : "";
          const paramType = typeAnnotationNode ? extractTypeString(typeAnnotationNode) : "any";
          parts.push(paramName + ": " + paramType);
        }
      }
    }
    const returnType = returnTypeNode ? extractTypeString(returnTypeNode) : "void";
    return "(" + parts.join(", ") + ") => " + returnType;
  }

  return tn.text;
}

function transformClassDeclaration(node: TreeSitterNode): ClassNode | null {
  const nameNode = getChildByFieldName(node, "name");
  if (!nameNode) return null;

  const name = (nameNode as NodeBase).text;

  let extendsClause: string | undefined;
  const implementsClause: string[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (c.type === "class_heritage") {
      for (let j = 0; j < c.namedChildCount; j++) {
        const clause = getNamedChild(child, j);
        if (!clause) continue;
        const cl = clause as NodeBase;
        if (cl.type === "extends_clause") {
          const valueNode = getChildByFieldName(clause, "value");
          if (valueNode) {
            extendsClause = (valueNode as NodeBase).text;
          }
        } else if (cl.type === "implements_clause") {
          for (let k = 0; k < cl.namedChildCount; k++) {
            const typeNode = getNamedChild(clause, k);
            if (typeNode) {
              const tn = typeNode as NodeBase;
              if (tn.type === "type_identifier" || tn.type === "generic_type") {
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

  const bodyNode = getChildByFieldName(node, "body");
  if (bodyNode) {
    const bn = bodyNode as NodeBase;
    for (let i = 0; i < bn.namedChildCount; i++) {
      const member = getNamedChild(bodyNode, i);
      if (!member) continue;
      const m = member as NodeBase;

      if (m.type === "public_field_definition" || m.type === "property_definition") {
        const field = transformClassField(member);
        if (field) {
          fields.push(field);
        }
      } else if (m.type === "method_definition") {
        const method = transformClassMethod(member);
        if (method) {
          methods.push(method);
          if (method.isConstructor && method.parameterProperties) {
            const paramTypes = method.paramTypes || [];
            const params = method.params;
            for (let pi = 0; pi < method.parameterProperties.length; pi++) {
              const propName = method.parameterProperties[pi];
              let propIdx: number = -1;
              for (let k = 0; k < params.length; k++) {
                if (params[k] === propName) {
                  propIdx = k;
                  break;
                }
              }
              let fieldType:
                | "double"
                | "string"
                | "string[]"
                | "number[]"
                | "boolean[]"
                | "boolean" = "double";
              let tsType: string | undefined;
              if (propIdx !== -1 && propIdx < paramTypes.length) {
                const pt = paramTypes[propIdx];
                if (pt === "string") fieldType = "string";
                else if (pt === "number") fieldType = "double";
                else if (pt === "boolean") fieldType = "boolean";
                else if (pt === "string[]") fieldType = "string[]";
                else if (pt === "number[]") fieldType = "number[]";
                else if (pt === "boolean[]") fieldType = "boolean[]";
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
                const newField: ClassField = {
                  name: propName,
                  fieldType,
                  tsType,
                  initializer: undefined,
                  isStatic: false,
                };
                fields.push(newField);
              }
            }
          }
        }
      }
    }
  }

  let typeParameters: string[] | undefined;
  const typeParamsNode = getChildByFieldName(node, "type_parameters");
  if (typeParamsNode) {
    const tpn = typeParamsNode as NodeBase;
    const tps: string[] = [];
    for (let i = 0; i < tpn.namedChildCount; i++) {
      const tp = getNamedChild(typeParamsNode, i);
      if (!tp) continue;
      const tpBase = tp as NodeBase;
      if (tpBase.type === "type_parameter") {
        const tpName = getChildByFieldName(tp, "name");
        if (tpName) {
          tps.push((tpName as NodeBase).text);
        }
      }
    }
    if (tps.length > 0) {
      typeParameters = tps;
    }
  }

  return {
    name,
    extends: extendsClause,
    implements: implementsClause,
    fields,
    methods,
    loc: undefined,
    typeParameters,
  };
}

function transformClassField(node: TreeSitterNode): ClassField | null {
  const nameNode = getChildByFieldName(node, "name");
  const typeNode = getChildByFieldName(node, "type");
  const valueNode = getChildByFieldName(node, "value");

  if (!nameNode) return null;

  // Detect static keyword (unnamed child)
  let isStatic = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (child && !(child as NodeBase).isNamed && (child as NodeBase).type === "static") {
      isStatic = true;
      break;
    }
  }

  const name = (nameNode as NodeBase).text;
  let fieldType: "double" | "string" | "string[]" | "number[]" | "boolean[]" | "boolean" = "double";
  let tsType: string | undefined;

  if (typeNode) {
    const typeStr = extractTypeString(typeNode);
    if (typeStr === "string") fieldType = "string";
    else if (typeStr === "number") fieldType = "double";
    else if (typeStr === "boolean") fieldType = "boolean";
    else if (typeStr === "string[]") fieldType = "string[]";
    else if (typeStr === "number[]") fieldType = "number[]";
    else if (typeStr === "boolean[]") fieldType = "boolean[]";
    else {
      tsType = typeStr;
    }
  }

  const initializer = valueNode ? transformExpression(valueNode) : undefined;
  const result: ClassField = { name, fieldType, tsType, initializer, isStatic };
  return result;
}

function transformClassMethod(node: TreeSitterNode): ClassMethod | null {
  const nameNode = getChildByFieldName(node, "name");
  const paramsNode = getChildByFieldName(node, "parameters");
  const bodyNode = getChildByFieldName(node, "body");
  const returnTypeNode = getChildByFieldName(node, "return_type");

  let isStatic = false;
  let accessorKind = "";
  for (let i = 0; i < node.childCount; i++) {
    const child = getChild(node, i);
    if (child && !(child as NodeBase).isNamed) {
      const childType = (child as NodeBase).type;
      if (childType === "static") isStatic = true;
      else if (childType === "get" || childType === "set") accessorKind = childType;
    }
  }

  if (accessorKind !== "") {
    const nameText = nameNode ? (nameNode as NodeBase).text : "?";
    const line = getLineFromIndex((node as NodeBase).source, (node as NodeBase).startIndex);
    console.error(
      currentFile +
        ":" +
        line +
        ": error: '" +
        accessorKind +
        " " +
        nameText +
        "()' is not supported; use a regular public method instead",
    );
    process.exit(1);
  }

  const name = nameNode ? (nameNode as NodeBase).text : "";
  const isConstructor = name === "constructor";

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
  const parameterProperties =
    isConstructor && paramsNode ? extractParameterProperties(paramsNode) : undefined;

  let methodParameters: FunctionParameter[] | undefined;
  if (paramsNode) {
    const fpList = extractFunctionParameters(paramsNode);
    const hasOptional = fpList.some(
      (fp: FunctionParameter) => fp.optional === true || fp.defaultValue !== undefined,
    );
    if (hasOptional) {
      methodParameters = fpList;
    }
  }

  const result: ClassMethod = {
    type: "method",
    name,
    params,
    paramTypes,
    parameterProperties,
    returnType,
    body,
    isConstructor,
  };
  if (isStatic) result.isStatic = true;
  if (methodParameters) result.parameters = methodParameters;
  return result;
}

function mapToClassMethodType(
  typeStr: string,
): "string" | "number" | "boolean" | "string[]" | "number[]" | "boolean[]" | "void" | undefined {
  switch (typeStr) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "string[]":
      return "string[]";
    case "number[]":
      return "number[]";
    case "boolean[]":
      return "boolean[]";
    case "void":
      return "void";
    default:
      return undefined;
  }
}

function extractClassParamTypes(paramsNode: TreeSitterNode): string[] {
  const types: string[] = [];

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = getNamedChild(paramsNode, i);
    if (!param) continue;
    const p = param as NodeBase;
    if (p.type === "required_parameter" || p.type === "optional_parameter") {
      const typeNode = getChildByFieldName(param, "type");
      if (typeNode) {
        const typeStr = extractTypeString(typeNode);
        const mapped = mapToClassMethodType(typeStr);
        if (mapped) {
          types.push(mapped);
        } else {
          types.push(typeStr);
        }
      } else {
        types.push("any");
      }
    }
  }

  return types;
}

function extractParameterProperties(paramsNode: TreeSitterNode): string[] {
  const properties: string[] = [];

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = getNamedChild(paramsNode, i);
    if (!param) continue;
    const p = param as NodeBase;
    if (p.type === "required_parameter" || p.type === "optional_parameter") {
      let hasAccessibility = false;
      for (let j = 0; j < p.childCount; j++) {
        const child = getChild(param, j);
        if (child) {
          const c = child as NodeBase;
          if (c.type === "accessibility_modifier") {
            hasAccessibility = true;
            break;
          }
        }
      }
      if (hasAccessibility) {
        const patternNode = getChildByFieldName(param, "pattern");
        if (patternNode) {
          const pn = patternNode as NodeBase;
          if (pn.type === "identifier") {
            properties.push(pn.text);
          }
        }
      }
    }
  }

  return properties;
}

function transformInterfaceDeclaration(node: TreeSitterNode): InterfaceDeclaration | null {
  const nameNode = getChildByFieldName(node, "name");
  const bodyNode = getChildByFieldName(node, "body");

  if (!nameNode) return null;

  const name = (nameNode as NodeBase).text;
  const fields: { name: string; type: string }[] = [];
  const methods: { name: string; params: string[]; paramTypes: string[]; returnType: string }[] =
    [];
  const extendsArr: string[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;
    if (c.type === "extends_type_clause") {
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
      if (m.type === "property_signature") {
        const propNameNode = getChildByFieldName(member, "name");
        const propTypeNode = getChildByFieldName(member, "type");

        const fieldName = propNameNode ? (propNameNode as NodeBase).text : "";
        const fieldType = propTypeNode ? extractTypeString(propTypeNode) : "any";
        fields.push({ name: fieldName, type: fieldType });
      } else if (m.type === "method_signature") {
        const methodNameNode = getChildByFieldName(member, "name");
        if (!methodNameNode) continue;
        const methodName = (methodNameNode as NodeBase).text;
        const paramsNode = getChildByFieldName(member, "parameters");
        const params = paramsNode ? extractFunctionParams(paramsNode) : [];
        const paramTypes = paramsNode ? extractParamTypes(paramsNode) || [] : [];
        const returnTypeNode = getChildByFieldName(member, "return_type");
        let returnType = "void";
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
    methods,
  };
}

function transformObjectTypeAlias(node: TreeSitterNode): InterfaceDeclaration | null {
  const nameNode = getChildByFieldName(node, "name");
  const valueNode = getChildByFieldName(node, "value");
  if (!nameNode || !valueNode) return null;
  if ((valueNode as NodeBase).type !== "object_type") return null;
  const name = (nameNode as NodeBase).text;
  const fields: { name: string; type: string }[] = [];
  const methods: { name: string; params: string[]; paramTypes: string[]; returnType: string }[] =
    [];
  const vn = valueNode as NodeBase;
  for (let i = 0; i < vn.namedChildCount; i++) {
    const member = getNamedChild(valueNode, i);
    if (!member) continue;
    const m = member as NodeBase;
    if (m.type === "property_signature") {
      const propNameNode = getChildByFieldName(member, "name");
      const propTypeNode = getChildByFieldName(member, "type");
      const fieldName = propNameNode ? (propNameNode as NodeBase).text : "";
      const fieldType = propTypeNode ? extractTypeString(propTypeNode) : "any";
      fields.push({ name: fieldName, type: fieldType });
    } else if (m.type === "method_signature") {
      const methodNameNode = getChildByFieldName(member, "name");
      if (!methodNameNode) continue;
      const methodName = (methodNameNode as NodeBase).text;
      const paramsNode = getChildByFieldName(member, "parameters");
      const params = paramsNode ? extractFunctionParams(paramsNode) : [];
      const paramTypes = paramsNode ? extractParamTypes(paramsNode) || [] : [];
      const returnTypeNode = getChildByFieldName(member, "return_type");
      let returnType = "void";
      if (returnTypeNode) {
        returnType = extractTypeString(returnTypeNode);
      }
      methods.push({ name: methodName, params, paramTypes, returnType });
    }
  }
  return { name, extends: [], fields, methods };
}

function transformTypeAliasDeclaration(node: TreeSitterNode): TypeAliasDeclaration | null {
  const nameNode = getChildByFieldName(node, "name");
  const valueNode = getChildByFieldName(node, "value");

  if (!nameNode) return null;

  const name = (nameNode as NodeBase).text;
  const unionMembers: string[] = [];

  if (valueNode) {
    const vn = valueNode as NodeBase;
    if (vn.type === "union_type") {
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
  const nameNode = getChildByFieldName(node, "name");
  const bodyNode = getChildByFieldName(node, "body");

  if (!nameNode) return null;

  const name = (nameNode as NodeBase).text;
  const members: EnumMember[] = [];

  let currentValue = 0;
  let isString = false;
  if (bodyNode) {
    const bn = bodyNode as NodeBase;
    for (let i = 0; i < bn.namedChildCount; i++) {
      const member = getNamedChild(bodyNode, i);
      if (member) {
        const memberNameNode = getChildByFieldName(member, "name");
        const memberValueNode = getChildByFieldName(member, "value");

        let memberName = "";
        if (memberNameNode) {
          memberName = (memberNameNode as NodeBase).text;
        } else {
          memberName = (member as NodeBase).text;
        }
        let value = currentValue;
        let stringValue: string | undefined;

        if (memberValueNode) {
          const mvn = memberValueNode as NodeBase;
          if (mvn.type === "number") {
            value = parseInt(mvn.text, 10);
          } else if (mvn.type === "string") {
            // Strip surrounding quotes from the string literal
            const raw = mvn.text;
            stringValue = raw.substring(1, raw.length - 1);
            isString = true;
          }
        }

        members.push({ name: memberName, value, stringValue });
        currentValue = value + 1;
      }
    }
  }

  return { name, members, isString: isString || undefined };
}

function transformImportStatement(node: TreeSitterNode): ImportDeclaration | null {
  const sourceNode = getChildByFieldName(node, "source");
  if (!sourceNode) return null;

  const nodeText = (node as NodeBase).text;
  const isTypeOnly = nodeText.startsWith("import type ") || nodeText.startsWith("import type{");
  if (isTypeOnly) {
    return null;
  }

  let source = (sourceNode as NodeBase).text;
  if (
    (source.startsWith('"') && source.endsWith('"')) ||
    (source.startsWith("'") && source.endsWith("'"))
  ) {
    source = source.slice(1, -1);
  }

  const specifiers: string[] = [];
  const aliasedSpecifiers: ImportSpecifier[] = [];
  let defaultImport: string | undefined;

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = getNamedChild(node, i);
    if (!child) continue;
    const c = child as NodeBase;

    if (c.type === "import_clause") {
      for (let j = 0; j < c.namedChildCount; j++) {
        const clause = getNamedChild(child, j);
        if (!clause) continue;
        const cl = clause as NodeBase;

        if (cl.type === "identifier") {
          // Default import: `import Foo from './bar'`
          defaultImport = cl.text;
          specifiers.push(cl.text);
          aliasedSpecifiers.push({ name: cl.text, original: undefined });
        } else if (cl.type === "named_imports") {
          for (let k = 0; k < cl.namedChildCount; k++) {
            const spec = getNamedChild(clause, k);
            if (!spec) continue;
            const sp = spec as NodeBase;
            if (sp.type === "import_specifier") {
              const nameNode = getChildByFieldName(spec, "name");
              const aliasNode = getChildByFieldName(spec, "alias");
              if (nameNode) {
                const originalName = (nameNode as NodeBase).text;
                if (aliasNode) {
                  const localName = (aliasNode as NodeBase).text;
                  specifiers.push(localName);
                  aliasedSpecifiers.push({ name: localName, original: originalName });
                } else {
                  specifiers.push(originalName);
                  aliasedSpecifiers.push({ name: originalName, original: undefined });
                }
              }
            }
          }
        } else if (cl.type === "namespace_import") {
          const nameNode = getNamedChild(clause, 0);
          if (nameNode) {
            const nsName = `* as ${(nameNode as NodeBase).text}`;
            specifiers.push(nsName);
            aliasedSpecifiers.push({ name: nsName, original: undefined });
          }
        }
      }
    }
  }

  return { type: "import", specifiers, aliasedSpecifiers, source, defaultImport };
}
