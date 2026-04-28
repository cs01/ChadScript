import { parseFile } from "./parser.js";
import { lowerModule } from "./hir/lower.js";
import type { ImportAlias } from "./hir/lower.js";
import { setSourceContext } from "./errors.js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import type { HIRModule } from "./hir/types.js";
import type { Module, ModuleItem } from "@swc/core";

interface ParsedModule {
  ast: Module;
  source: string;
  absPath: string;
}

export function resolveModules(entryPath: string): HIRModule {
  const absEntry = resolve(entryPath);
  const visited = new Map<string, ParsedModule>();
  const aliases: ImportAlias[] = [];

  collectModules(absEntry, visited, aliases);

  const mergedBody: ModuleItem[] = [];

  for (const [path, mod] of visited) {
    if (path === absEntry) continue;
    for (const item of mod.ast.body) {
      if (item.type === "ImportDeclaration") continue;
      if ((item as any).type === "ExportDeclaration") {
        mergedBody.push((item as any).declaration as ModuleItem);
      } else {
        mergedBody.push(item);
      }
    }
  }

  const entry = visited.get(absEntry)!;
  for (const item of entry.ast.body) {
    if (item.type === "ImportDeclaration") continue;
    if ((item as any).type === "ExportDeclaration") {
      mergedBody.push((item as any).declaration as ModuleItem);
    } else {
      mergedBody.push(item);
    }
  }

  const mergedAst: Module = {
    type: "Module",
    span: entry.ast.span,
    body: mergedBody,
    interpreter: entry.ast.interpreter,
  };

  setSourceContext(entry.source, absEntry);
  return lowerModule(mergedAst, entry.source, absEntry, aliases);
}

function collectModules(
  absPath: string,
  visited: Map<string, ParsedModule>,
  aliases: ImportAlias[],
): void {
  if (visited.has(absPath)) return;

  const source = readFileSync(absPath, "utf-8");
  const ast = parseFile(absPath);
  visited.set(absPath, { ast, source, absPath });

  for (const item of ast.body) {
    if (item.type === "ImportDeclaration") {
      if (isBuiltinImport(item.source.value)) continue;
      const resolvedPath = resolveImportPath(item.source.value, absPath);
      collectModules(resolvedPath, visited, aliases);

      for (const s of item.specifiers) {
        if (s.type === "ImportSpecifier") {
          const imported = s.imported?.value || s.local.value;
          const local = s.local.value;
          if (local !== imported) {
            aliases.push({ local, imported });
          }
        }
      }
    }
  }
}

const BUILTIN_MODULES = new Set([
  "path", "node:path", "fs", "node:fs", "process", "node:process",
  "child_process", "node:child_process", "crypto", "node:crypto",
  "http", "node:http", "os", "node:os", "url", "node:url",
]);

function isBuiltinImport(specifier: string): boolean {
  return BUILTIN_MODULES.has(specifier);
}

function resolveImportPath(specifier: string, fromPath: string): string {
  if (!specifier.startsWith(".")) {
    throw new Error(`non-relative imports not supported: ${specifier}`);
  }
  const dir = dirname(fromPath);
  let resolved = resolve(dir, specifier);
  if (!resolved.endsWith(".ts")) {
    if (existsSync(resolved + ".ts")) {
      resolved += ".ts";
    } else if (!existsSync(resolved)) {
      throw new Error(`cannot resolve import: ${specifier} from ${fromPath}`);
    }
  }
  return resolved;
}
