import type { AST, SourceLocation, EnumDeclaration } from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

export function checkEnumDeclarations(ast: AST, sourceCode: string): void {
  if (!ast.enums || ast.enums.length === 0) return;
  for (let i = 0; i < ast.enums.length; i++) {
    const e = ast.enums[i] as EnumDeclaration & { loc?: SourceLocation };
    const output = formatCompileError(
      sourceCode,
      "enum declarations are not supported",
      e.loc,
      "use 'as const' objects instead: const " + e.name + " = { ... } as const",
      [
        "enums add significant complexity to native compilation",
        "const objects provide the same functionality with better type safety",
      ],
    );
    process.stderr.write(output);
    process.exit(1);
  }
}
