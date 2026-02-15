import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DiagnosticEngine, DiagnosticSeverity } from '../../src/diagnostics/engine.js';
import { SourceLocation } from '../../src/ast/types.js';

describe('DiagnosticEngine', () => {
  it('should track errors and warnings separately', () => {
    const engine = new DiagnosticEngine();
    engine.error('undefined variable');
    engine.warning('unused import');
    engine.note('consider using const');

    assert.strictEqual(engine.hasErrors(), true);
    assert.strictEqual(engine.hasWarnings(), true);
    assert.strictEqual(engine.getDiagnostics().length, 3);
    assert.strictEqual(engine.getErrors().length, 1);
    assert.strictEqual(engine.getWarnings().length, 1);
  });

  it('should report no errors when only warnings exist', () => {
    const engine = new DiagnosticEngine();
    engine.warning('unused variable');
    engine.note('info message');

    assert.strictEqual(engine.hasErrors(), false);
    assert.strictEqual(engine.hasWarnings(), true);
  });

  it('should format errors without source location', () => {
    const engine = new DiagnosticEngine();
    engine.error('type mismatch');

    const output = engine.format();
    assert.ok(output.includes('error: type mismatch'));
  });

  it('should format errors with suggestion', () => {
    const engine = new DiagnosticEngine();
    engine.error('unknown function foo', undefined, 'did you mean fooBar?');

    const output = engine.format();
    assert.ok(output.includes('error: unknown function foo'));
    assert.ok(output.includes('help: did you mean fooBar?'));
  });

  it('should format errors with source location and code context', () => {
    const engine = new DiagnosticEngine();
    engine.setSourceCode('const x = 10;\nconst y = x + z;\nconst w = 0;');
    engine.setFilename('test.ts');

    const loc: SourceLocation = { file: 'test.ts', line: 2, column: 14, offset: 28 };
    engine.error('undefined variable z', loc);

    const output = engine.format();
    assert.ok(output.includes('test.ts:2:15: error: undefined variable z'));
    assert.ok(output.includes('const y = x + z;'));
    assert.ok(output.includes('^'));
  });

  it('should format warnings with source location and suggestion', () => {
    const engine = new DiagnosticEngine();
    engine.setSourceCode('let x = 5;\nreturn x;\nconsole.log("unreachable");');
    engine.setFilename('warn.ts');

    const loc: SourceLocation = { file: 'warn.ts', line: 3, column: 0, offset: 22 };
    engine.warning('unreachable code after return', loc, 'remove this statement');

    const output = engine.format();
    assert.ok(output.includes('warn.ts:3:1: warning: unreachable code after return'));
    assert.ok(output.includes('help: remove this statement'));
  });

  it('should clear diagnostics', () => {
    const engine = new DiagnosticEngine();
    engine.error('some error');
    engine.warning('some warning');
    assert.strictEqual(engine.getDiagnostics().length, 2);

    engine.clear();
    assert.strictEqual(engine.getDiagnostics().length, 0);
    assert.strictEqual(engine.hasErrors(), false);
  });

  it('should format location without source code', () => {
    const engine = new DiagnosticEngine();
    engine.setFilename('nosrc.ts');

    const loc: SourceLocation = { file: 'nosrc.ts', line: 5, column: 10, offset: 50 };
    engine.error('something failed', loc);

    const output = engine.format();
    assert.ok(output.includes('nosrc.ts:5:11: error: something failed'));
  });

  it('should use correct severity constants', () => {
    assert.strictEqual(DiagnosticSeverity.Error, 0);
    assert.strictEqual(DiagnosticSeverity.Warning, 1);
    assert.strictEqual(DiagnosticSeverity.Note, 2);
  });
});
