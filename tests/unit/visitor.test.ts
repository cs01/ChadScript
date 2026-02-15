import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RecursiveASTVisitor } from '../../src/ast/visitor.js';
import { AST, Expression, Statement, NumberNode, StringNode, BinaryNode, CallNode, MethodCallNode, VariableDeclaration, IfStatement, ForStatement, WhileStatement, ReturnStatement, FunctionNode, BlockStatement, ClassNode, ClassMethod, VariableNode, ArrayNode, ObjectNode, ArrowFunctionNode, ConditionalExpressionNode, MemberAccessNode, IndexAccessNode, UnaryNode, TemplateLiteralNode, ThrowStatement, TryStatement, SwitchStatement, ForOfStatement, AssignmentStatement } from '../../src/ast/types.js';

class CountingVisitor extends RecursiveASTVisitor {
  counts: Map<string, number> = new Map();

  private inc(key: string): void {
    const c = this.counts.get(key);
    this.counts.set(key, c !== undefined ? c + 1 : 1);
  }

  count(key: string): number {
    return this.counts.get(key) || 0;
  }

  visitNumberNode(_node: NumberNode): void { this.inc('number'); }
  visitStringNode(_node: StringNode): void { this.inc('string'); }
  visitVariableNode(_node: VariableNode): void { this.inc('variable'); }
  visitBinaryNode(node: BinaryNode): void { this.inc('binary'); super.visitBinaryNode(node); }
  visitCallNode(node: CallNode): void { this.inc('call'); super.visitCallNode(node); }
  visitMethodCallNode(node: MethodCallNode): void { this.inc('method_call'); super.visitMethodCallNode(node); }
  visitVariableDeclaration(node: VariableDeclaration): void { this.inc('variable_declaration'); super.visitVariableDeclaration(node); }
  visitAssignmentStatement(node: AssignmentStatement): void { this.inc('assignment'); super.visitAssignmentStatement(node); }
  visitIfStatement(node: IfStatement): void { this.inc('if'); super.visitIfStatement(node); }
  visitForStatement(node: ForStatement): void { this.inc('for'); super.visitForStatement(node); }
  visitWhileStatement(node: WhileStatement): void { this.inc('while'); super.visitWhileStatement(node); }
  visitReturnStatement(node: ReturnStatement): void { this.inc('return'); super.visitReturnStatement(node); }
  visitFunctionNode(node: FunctionNode): void { this.inc('function'); super.visitFunctionNode(node); }
  visitClassNode(node: ClassNode): void { this.inc('class'); super.visitClassNode(node); }
  visitClassMethod(node: ClassMethod): void { this.inc('class_method'); super.visitClassMethod(node); }
  visitArrayNode(node: ArrayNode): void { this.inc('array'); super.visitArrayNode(node); }
  visitObjectNode(node: ObjectNode): void { this.inc('object'); super.visitObjectNode(node); }
  visitArrowFunctionNode(node: ArrowFunctionNode): void { this.inc('arrow_function'); super.visitArrowFunctionNode(node); }
  visitConditionalExpressionNode(node: ConditionalExpressionNode): void { this.inc('conditional'); super.visitConditionalExpressionNode(node); }
  visitMemberAccessNode(node: MemberAccessNode): void { this.inc('member_access'); super.visitMemberAccessNode(node); }
  visitIndexAccessNode(node: IndexAccessNode): void { this.inc('index_access'); super.visitIndexAccessNode(node); }
  visitUnaryNode(node: UnaryNode): void { this.inc('unary'); super.visitUnaryNode(node); }
  visitTemplateLiteralNode(node: TemplateLiteralNode): void { this.inc('template_literal'); super.visitTemplateLiteralNode(node); }
  visitThrowStatement(node: ThrowStatement): void { this.inc('throw'); super.visitThrowStatement(node); }
  visitTryStatement(node: TryStatement): void { this.inc('try'); super.visitTryStatement(node); }
  visitSwitchStatement(node: SwitchStatement): void { this.inc('switch'); super.visitSwitchStatement(node); }
  visitForOfStatement(node: ForOfStatement): void { this.inc('for_of'); super.visitForOfStatement(node); }
}

function emptyAST(): AST {
  return {
    imports: [],
    functions: [],
    classes: [],
    exports: [],
    interfaces: [],
    typeAliases: [],
    enums: [],
    topLevelStatements: [],
    topLevelExpressions: [],
  };
}

describe('RecursiveASTVisitor', () => {
  it('should count expression types in a simple function', () => {
    const ast = emptyAST();
    ast.functions.push({
      name: 'add',
      params: ['a', 'b'],
      body: {
        type: 'block',
        statements: [
          {
            type: 'return',
            value: {
              type: 'binary',
              op: '+',
              left: { type: 'variable', name: 'a' } as VariableNode,
              right: { type: 'variable', name: 'b' } as VariableNode
            } as BinaryNode
          } as ReturnStatement
        ]
      }
    });

    const visitor = new CountingVisitor();
    visitor.visitAST(ast);

    assert.strictEqual(visitor.count('function'), 1);
    assert.strictEqual(visitor.count('return'), 1);
    assert.strictEqual(visitor.count('binary'), 1);
    assert.strictEqual(visitor.count('variable'), 2);
  });

  it('should count nodes in control flow', () => {
    const ast = emptyAST();
    ast.functions.push({
      name: 'test',
      params: [],
      body: {
        type: 'block',
        statements: [
          {
            type: 'variable_declaration',
            kind: 'let',
            name: 'x',
            value: { type: 'number', value: 0 } as NumberNode
          } as VariableDeclaration,
          {
            type: 'if',
            condition: { type: 'variable', name: 'x' } as VariableNode,
            thenBlock: {
              type: 'block',
              statements: [
                {
                  type: 'assignment',
                  name: 'x',
                  value: { type: 'number', value: 1 } as NumberNode
                } as AssignmentStatement
              ]
            },
            elseBlock: {
              type: 'block',
              statements: [
                {
                  type: 'assignment',
                  name: 'x',
                  value: { type: 'number', value: 2 } as NumberNode
                } as AssignmentStatement
              ]
            }
          } as IfStatement,
          {
            type: 'for',
            init: {
              type: 'variable_declaration',
              kind: 'let',
              name: 'i',
              value: { type: 'number', value: 0 } as NumberNode
            } as VariableDeclaration,
            condition: {
              type: 'binary',
              op: '<',
              left: { type: 'variable', name: 'i' } as VariableNode,
              right: { type: 'number', value: 10 } as NumberNode
            } as BinaryNode,
            update: {
              type: 'assignment',
              name: 'i',
              value: { type: 'number', value: 0 } as NumberNode
            } as AssignmentStatement,
            body: { type: 'block', statements: [] }
          } as ForStatement
        ]
      }
    });

    const visitor = new CountingVisitor();
    visitor.visitAST(ast);

    assert.strictEqual(visitor.count('function'), 1);
    assert.strictEqual(visitor.count('variable_declaration'), 2);
    assert.strictEqual(visitor.count('if'), 1);
    assert.strictEqual(visitor.count('for'), 1);
    assert.strictEqual(visitor.count('assignment'), 3);
    assert.strictEqual(visitor.count('number'), 6);
    assert.strictEqual(visitor.count('variable'), 2);
    assert.strictEqual(visitor.count('binary'), 1);
  });

  it('should visit class methods', () => {
    const ast = emptyAST();
    ast.classes.push({
      name: 'Foo',
      fields: [],
      methods: [
        {
          type: 'method',
          name: 'bar',
          params: [],
          body: {
            type: 'block',
            statements: [
              {
                type: 'return',
                value: { type: 'number', value: 42 } as NumberNode
              } as ReturnStatement
            ]
          },
          isConstructor: false
        } as ClassMethod,
        {
          type: 'method',
          name: 'constructor',
          params: [],
          body: { type: 'block', statements: [] },
          isConstructor: true
        } as ClassMethod
      ]
    });

    const visitor = new CountingVisitor();
    visitor.visitAST(ast);

    assert.strictEqual(visitor.count('class'), 1);
    assert.strictEqual(visitor.count('class_method'), 2);
    assert.strictEqual(visitor.count('return'), 1);
    assert.strictEqual(visitor.count('number'), 1);
  });

  it('should visit nested expressions recursively', () => {
    const ast = emptyAST();
    ast.topLevelStatements.push({
      type: 'variable_declaration',
      kind: 'const',
      name: 'result',
      value: {
        type: 'method_call',
        object: {
          type: 'array',
          elements: [
            { type: 'number', value: 1 } as NumberNode,
            { type: 'number', value: 2 } as NumberNode
          ]
        } as ArrayNode,
        method: 'map',
        args: [
          {
            type: 'arrow_function',
            params: ['x'],
            body: {
              type: 'binary',
              op: '*',
              left: { type: 'variable', name: 'x' } as VariableNode,
              right: { type: 'number', value: 2 } as NumberNode
            } as BinaryNode
          } as ArrowFunctionNode
        ]
      } as MethodCallNode
    } as VariableDeclaration);

    const visitor = new CountingVisitor();
    visitor.visitAST(ast);

    assert.strictEqual(visitor.count('variable_declaration'), 1);
    assert.strictEqual(visitor.count('method_call'), 1);
    assert.strictEqual(visitor.count('array'), 1);
    assert.strictEqual(visitor.count('arrow_function'), 1);
    assert.strictEqual(visitor.count('binary'), 1);
    assert.strictEqual(visitor.count('number'), 3);
    assert.strictEqual(visitor.count('variable'), 1);
  });

  it('should visit top-level expressions', () => {
    const ast = emptyAST();
    ast.topLevelExpressions = [
      {
        type: 'call',
        name: 'main',
        args: []
      } as CallNode
    ];

    const visitor = new CountingVisitor();
    visitor.visitAST(ast);

    assert.strictEqual(visitor.count('call'), 1);
  });

  it('should visit try/catch/finally', () => {
    const ast = emptyAST();
    ast.functions.push({
      name: 'test',
      params: [],
      body: {
        type: 'block',
        statements: [
          {
            type: 'try',
            tryBlock: {
              type: 'block',
              statements: [
                {
                  type: 'throw',
                  argument: { type: 'string', value: 'error' } as Expression
                } as ThrowStatement
              ]
            },
            catchClause: {
              param: 'e',
              body: { type: 'block', statements: [] }
            },
            finallyBlock: { type: 'block', statements: [] }
          } as TryStatement
        ]
      }
    });

    const visitor = new CountingVisitor();
    visitor.visitAST(ast);

    assert.strictEqual(visitor.count('try'), 1);
    assert.strictEqual(visitor.count('throw'), 1);
    assert.strictEqual(visitor.count('string'), 1);
  });

  it('should visit switch statement', () => {
    const ast = emptyAST();
    ast.functions.push({
      name: 'test',
      params: [],
      body: {
        type: 'block',
        statements: [
          {
            type: 'switch',
            discriminant: { type: 'variable', name: 'x' } as VariableNode,
            cases: [
              {
                test: { type: 'number', value: 1 } as NumberNode,
                consequent: [
                  { type: 'return', value: { type: 'string', value: 'one' } } as ReturnStatement
                ]
              },
              {
                test: null,
                consequent: [
                  { type: 'return', value: { type: 'string', value: 'other' } } as ReturnStatement
                ]
              }
            ]
          } as SwitchStatement
        ]
      }
    });

    const visitor = new CountingVisitor();
    visitor.visitAST(ast);

    assert.strictEqual(visitor.count('switch'), 1);
    assert.strictEqual(visitor.count('variable'), 1);
    assert.strictEqual(visitor.count('number'), 1);
    assert.strictEqual(visitor.count('return'), 2);
    assert.strictEqual(visitor.count('string'), 2);
  });

  it('should handle empty AST gracefully', () => {
    const visitor = new CountingVisitor();
    visitor.visitAST(emptyAST());
    assert.strictEqual(visitor.counts.size, 0);
  });
});
