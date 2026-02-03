import * as ts from 'typescript';
import {
  AST,
  Expression,
  Statement,
  ImportDeclaration,
  VariableDeclaration,
  AssignmentStatement,
  CallNode,
  NewNode,
  MethodCallNode,
  ForStatement,
  ForOfStatement,
  WhileStatement,
  IfStatement,
  TryStatement,
  BlockStatement,
  TopLevelItem,
} from '../ast/types.js';

import { transformExpression } from './handlers/expressions.js';
import { transformStatement } from './handlers/statements.js';
import { transformFunctionDeclaration, transformClassDeclaration, transformInterfaceDeclaration, transformEnumDeclaration, transformTypeAliasDeclaration, transformImportDeclaration } from './handlers/declarations.js';

export function transformSourceFile(sourceFile: ts.SourceFile, checker: ts.TypeChecker | undefined): AST {
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

  for (const statement of sourceFile.statements) {
    transformTopLevelStatement(statement, ast, checker);
  }

  return ast;
}

function transformTopLevelStatement(node: ts.Statement, ast: AST, checker: ts.TypeChecker | undefined): void {
  switch (node.kind) {
    case ts.SyntaxKind.ImportDeclaration: {
      const importDecl = transformImportDeclaration(node as ts.ImportDeclaration);
      if (importDecl) {
        ast.imports.push(importDecl);
      }
      break;
    }

    case ts.SyntaxKind.FunctionDeclaration: {
      const funcDecl = node as ts.FunctionDeclaration;
      const isDeclare = funcDecl.modifiers?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword);
      if (isDeclare) {
        break;
      }
      const func = transformFunctionDeclaration(funcDecl, checker);
      if (func) {
        ast.functions.push(func);
      }
      break;
    }

    case ts.SyntaxKind.ClassDeclaration: {
      const classDecl = node as ts.ClassDeclaration;
      const cls = transformClassDeclaration(classDecl, checker);
      if (cls) {
        ast.classes.push(cls);
      }
      break;
    }

    case ts.SyntaxKind.InterfaceDeclaration: {
      const interfaceDecl = transformInterfaceDeclaration(node as ts.InterfaceDeclaration);
      if (interfaceDecl) {
        ast.interfaces.push(interfaceDecl);
      }
      break;
    }

    case ts.SyntaxKind.TypeAliasDeclaration: {
      const typeAlias = transformTypeAliasDeclaration(node as ts.TypeAliasDeclaration);
      if (typeAlias) {
        ast.typeAliases.push(typeAlias);
      }
      break;
    }

    case ts.SyntaxKind.EnumDeclaration: {
      const enumDecl = transformEnumDeclaration(node as ts.EnumDeclaration);
      if (enumDecl) {
        ast.enums.push(enumDecl);
      }
      break;
    }

    case ts.SyntaxKind.ExportDeclaration: {
      const exportDecl = node as ts.ExportDeclaration;
      if (exportDecl.isTypeOnly) {
        break;
      }
      if (exportDecl.moduleSpecifier && ts.isStringLiteral(exportDecl.moduleSpecifier)) {
        const source = exportDecl.moduleSpecifier.text;
        const specifiers: string[] = [];
        if (exportDecl.exportClause && ts.isNamedExports(exportDecl.exportClause)) {
          for (const element of exportDecl.exportClause.elements) {
            specifiers.push(element.name.text);
          }
        }
        const syntheticImport: ImportDeclaration = { type: 'import', specifiers, source };
        ast.imports.push(syntheticImport);
      }
      break;
    }
    case ts.SyntaxKind.ExportAssignment: {
      break;
    }

    case ts.SyntaxKind.VariableStatement: {
      const varStmt = node as ts.VariableStatement;

      for (const decl of varStmt.declarationList.declarations) {
        const varDecl = transformVariableDeclaration(decl, varStmt.declarationList.flags, checker);
        ast.topLevelStatements.push(varDecl);
        ast.topLevelItems!.push(varDecl);
      }
      break;
    }

    case ts.SyntaxKind.ExpressionStatement: {
      const exprStmt = node as ts.ExpressionStatement;
      const expr = transformExpression(exprStmt.expression, checker);

      if (expr.type === 'member_access_assignment' || expr.type === 'index_access_assignment') {
        const assignment: AssignmentStatement = {
          type: 'assignment',
          name: expr.type === 'member_access_assignment' ? `__member_access__${expr.property}__` : '__index_access__',
          value: expr,
        };
        ast.topLevelStatements.push(assignment);
        ast.topLevelItems!.push(assignment);
      } else if (expr.type === 'call' || expr.type === 'new' || expr.type === 'method_call') {
        ast.topLevelExpressions.push(expr as CallNode | NewNode | MethodCallNode);
        ast.topLevelItems!.push(expr as TopLevelItem);
      } else if (isAssignmentExpression(exprStmt.expression)) {
        const binExpr = exprStmt.expression as ts.BinaryExpression;
        const assignment = transformAssignmentExpression(binExpr, checker);
        if (assignment) {
          ast.topLevelStatements.push(assignment);
          ast.topLevelItems!.push(assignment);
        }
      }
      break;
    }

    case ts.SyntaxKind.ForStatement: {
      const forStmt = transformStatement(node, checker) as ForStatement;
      ast.topLevelExpressions.push(forStmt);
      ast.topLevelItems!.push(forStmt);
      break;
    }

    case ts.SyntaxKind.ForOfStatement: {
      const forOfStmt = transformStatement(node, checker) as ForOfStatement;
      ast.topLevelExpressions.push(forOfStmt);
      ast.topLevelItems!.push(forOfStmt);
      break;
    }

    case ts.SyntaxKind.WhileStatement: {
      const whileStmt = transformStatement(node, checker) as WhileStatement;
      ast.topLevelExpressions.push(whileStmt);
      ast.topLevelItems!.push(whileStmt);
      break;
    }

    case ts.SyntaxKind.IfStatement: {
      const ifStmt = transformStatement(node, checker) as IfStatement;
      ast.topLevelExpressions.push(ifStmt);
      ast.topLevelItems!.push(ifStmt);
      break;
    }

    case ts.SyntaxKind.TryStatement: {
      const tryStmt = transformStatement(node, checker) as TryStatement;
      ast.topLevelExpressions.push(tryStmt);
      ast.topLevelItems!.push(tryStmt);
      break;
    }

    default:
      break;
  }

  if (ts.isExportDeclaration(node) || hasExportModifier(node)) {
    handleExportedDeclaration(node, ast, checker);
  }
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) || false;
}

function handleExportedDeclaration(node: ts.Statement, ast: AST, checker: ts.TypeChecker | undefined): void {
  if (ts.isFunctionDeclaration(node) && hasExportModifier(node)) {
    const func = transformFunctionDeclaration(node, checker);
    if (func) {
      ast.exports.push({ type: 'export', declaration: func });
    }
  } else if (ts.isClassDeclaration(node) && hasExportModifier(node)) {
    const cls = transformClassDeclaration(node, checker);
    if (cls) {
      ast.exports.push({ type: 'export', declaration: cls });
    }
  }
}

function isAssignmentExpression(node: ts.Node): boolean {
  if (!ts.isBinaryExpression(node)) return false;
  const op = node.operatorToken.kind;
  return op === ts.SyntaxKind.EqualsToken ||
         op === ts.SyntaxKind.PlusEqualsToken ||
         op === ts.SyntaxKind.MinusEqualsToken ||
         op === ts.SyntaxKind.AsteriskEqualsToken ||
         op === ts.SyntaxKind.SlashEqualsToken;
}

function transformAssignmentExpression(node: ts.BinaryExpression, checker: ts.TypeChecker | undefined): AssignmentStatement | null {
  const left = node.left;
  const right = transformExpression(node.right, checker);

  let value: Expression = right;
  const op = node.operatorToken.kind;
  if (op !== ts.SyntaxKind.EqualsToken) {
    const leftExpr = transformExpression(left, checker);
    const opStr = getCompoundOperator(op);
    if (opStr) {
      value = { type: 'binary', op: opStr, left: leftExpr, right };
    }
  }

  if (ts.isIdentifier(left)) {
    return { type: 'assignment', name: left.text, value };
  } else if (ts.isPropertyAccessExpression(left)) {
    const leftExpr = transformExpression(left, checker);
    return {
      type: 'assignment',
      name: `__member_access__${left.name.text}__`,
      value: {
        type: 'member_access_assignment',
        object: (leftExpr as any).object,
        property: left.name.text,
        value,
      },
    };
  } else if (ts.isElementAccessExpression(left)) {
    const obj = transformExpression(left.expression, checker);
    const idx = transformExpression(left.argumentExpression, checker);
    return {
      type: 'assignment',
      name: '__index_access__',
      value: {
        type: 'index_access_assignment',
        object: obj,
        index: idx,
        value,
      },
    };
  }

  return null;
}

function getCompoundOperator(op: ts.SyntaxKind): string | null {
  switch (op) {
    case ts.SyntaxKind.PlusEqualsToken: return '+';
    case ts.SyntaxKind.MinusEqualsToken: return '-';
    case ts.SyntaxKind.AsteriskEqualsToken: return '*';
    case ts.SyntaxKind.SlashEqualsToken: return '/';
    default: return null;
  }
}

export function transformVariableDeclaration(
  decl: ts.VariableDeclaration,
  flags: ts.NodeFlags,
  checker: ts.TypeChecker | undefined
): VariableDeclaration {
  const name = ts.isIdentifier(decl.name) ? decl.name.text : '';
  const kind: 'let' | 'const' = (flags & ts.NodeFlags.Const) ? 'const' : 'let';

  let declaredType: string | undefined;
  if (decl.type) {
    declaredType = extractTypeString(decl.type);
  }

  let value: Expression | null = null;
  if (decl.initializer) {
    value = transformExpression(decl.initializer, checker);
  }

  return { type: 'variable_declaration', kind, name, value, declaredType };
}

function extractTypeString(typeNode: ts.TypeNode): string {
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = ts.isIdentifier(typeNode.typeName)
      ? typeNode.typeName.text
      : typeNode.typeName.getText();

    if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
      const args = typeNode.typeArguments.map(extractTypeString).join(', ');
      return `${typeName}<${args}>`;
    }
    return typeName;
  } else if (ts.isArrayTypeNode(typeNode)) {
    const elem = extractTypeString(typeNode.elementType);
    return `${elem}[]`;
  } else if (typeNode.kind === ts.SyntaxKind.StringKeyword) {
    return 'string';
  } else if (typeNode.kind === ts.SyntaxKind.NumberKeyword) {
    return 'number';
  } else if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) {
    return 'boolean';
  } else if (typeNode.kind === ts.SyntaxKind.VoidKeyword) {
    return 'void';
  } else if (typeNode.kind === ts.SyntaxKind.AnyKeyword) {
    return 'any';
  } else if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types.map(extractTypeString).join(' | ');
  } else if (ts.isTypeLiteralNode(typeNode)) {
    return 'object';
  }
  return typeNode.getText();
}

export function transformBlock(block: ts.Block, checker: ts.TypeChecker | undefined): BlockStatement {
  const statements: Statement[] = [];
  for (const stmt of block.statements) {
    const transformed = transformStatement(stmt, checker);
    if (transformed) {
      statements.push(transformed);
    }
  }
  return { type: 'block', statements };
}
