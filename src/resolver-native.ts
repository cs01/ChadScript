import { parseFile } from "./parser-native.js";
import { lowerModule } from "./hir/lower.js";
import type { ImportAlias, BuiltinImport } from "./hir/lower.js";
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
  const typeOnlyPaths = new Set<string>();
  const aliases: ImportAlias[] = [];
  const builtinImportList: BuiltinImport[] = [];

  collectModules(absEntry, visited, aliases, typeOnlyPaths, builtinImportList);

  const mergedBody: ModuleItem[] = [];
  const TYPE_DECLS = new Set<string>();
  TYPE_DECLS.add("TsTypeAliasDeclaration");
  TYPE_DECLS.add("TsInterfaceDeclaration");
  TYPE_DECLS.add("TsEnumDeclaration");

  for (const [path, mod] of visited) {
    if (path === absEntry) continue;
    const isTypeOnly = typeOnlyPaths.has(path);
    for (const item of mod.ast.body) {
      if (item.type === "ImportDeclaration") continue;
      if (item.type === "ExportNamedDeclaration" && (item as any).source)
        continue;
      let decl = item;
      if ((item as any).type === "ExportDeclaration") {
        decl = (item as any).declaration;
      }
      if (isTypeOnly && !TYPE_DECLS.has((decl as any).type)) continue;
      mergedBody.push(decl as ModuleItem);
    }
  }

  const entry = visited.get(absEntry)!;
  for (const item of entry.ast.body) {
    if (item.type === "ImportDeclaration") continue;
    if (item.type === "ExportNamedDeclaration" && (item as any).source)
      continue;
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
  return lowerModule(mergedAst, entry.source, absEntry, aliases, builtinImportList);
}

function collectModules(
  absPath: string,
  visited: Map<string, ParsedModule>,
  aliases: ImportAlias[],
  typeOnlyPaths?: Set<string>,
  builtinImportList?: BuiltinImport[],
): void {
  if (visited.has(absPath)) return;

  const source = readFileSync(absPath, "utf-8");
  const ast = parseFile(absPath);
  visited.set(absPath, { ast, source, absPath });

  for (const item of ast.body) {
    if (item.type === "ImportDeclaration") {
      if (isBuiltinImport(item.source.value)) {
        if (builtinImportList && !(item as any).typeOnly) {
          const moduleName = item.source.value.replace(/^node:/, "");
          for (const s of item.specifiers) {
            if (s.type === "ImportSpecifier") {
              const imported = s.imported?.value || s.local.value;
              builtinImportList.push({ local: s.local.value, module: moduleName, imported });
            }
          }
        }
        continue;
      }
      if ((item as any).typeOnly) {
        const specifier = item.source.value;
        if (specifier.startsWith(".")) {
          try {
            const resolvedPath = resolveImportPath(specifier, absPath);
            if (typeOnlyPaths && !visited.has(resolvedPath)) {
              typeOnlyPaths.add(resolvedPath);
            }
            collectModules(resolvedPath, visited, aliases, typeOnlyPaths, builtinImportList);
          } catch {}
        }
        continue;
      }
      const resolvedPath = resolveImportPath(item.source.value, absPath);
      if (typeOnlyPaths) typeOnlyPaths.delete(resolvedPath);
      collectModules(resolvedPath, visited, aliases, typeOnlyPaths, builtinImportList);

      for (const s of item.specifiers) {
        if (s.type === "ImportSpecifier") {
          const imported = s.imported?.value || s.local.value;
          const local = s.local.value;
          if (local !== imported) {
            aliases.push({ local, imported });
          }
        }
      }
    } else if (
      item.type === "ExportNamedDeclaration" &&
      (item as any).source
    ) {
      const decl = item as any;
      if (isBuiltinImport(decl.source.value)) continue;
      const resolvedPath = resolveImportPath(decl.source.value, absPath);
      collectModules(resolvedPath, visited, aliases, typeOnlyPaths, builtinImportList);

      for (const s of decl.specifiers) {
        if (s.type === "ExportSpecifier" && s.exported) {
          const orig = s.orig.value;
          const exported = s.exported.value;
          if (orig !== exported) {
            aliases.push({ local: exported, imported: orig });
          }
        }
      }
    }
  }
}

const BUILTIN_MODULES = new Set<string>();
BUILTIN_MODULES.add("path");
BUILTIN_MODULES.add("node:path");
BUILTIN_MODULES.add("fs");
BUILTIN_MODULES.add("node:fs");
BUILTIN_MODULES.add("process");
BUILTIN_MODULES.add("node:process");
BUILTIN_MODULES.add("child_process");
BUILTIN_MODULES.add("node:child_process");
BUILTIN_MODULES.add("crypto");
BUILTIN_MODULES.add("node:crypto");
BUILTIN_MODULES.add("http");
BUILTIN_MODULES.add("node:http");
BUILTIN_MODULES.add("os");
BUILTIN_MODULES.add("node:os");
BUILTIN_MODULES.add("url");
BUILTIN_MODULES.add("node:url");
BUILTIN_MODULES.add("@swc/core");
BUILTIN_MODULES.add("koffi");

function isBuiltinImport(specifier: string): boolean {
  return BUILTIN_MODULES.has(specifier);
}

function resolveImportPath(specifier: string, fromPath: string): string {
  if (!specifier.startsWith(".")) {
    throw new Error(`non-relative imports not supported: ${specifier}`);
  }
  const dir = dirname(fromPath);
  let resolved = resolve(dir, specifier);
  if (resolved.endsWith(".js")) {
    const tsPath = resolved.slice(0, -3) + ".ts";
    if (existsSync(tsPath)) {
      return tsPath;
    }
  }
  if (!resolved.endsWith(".ts")) {
    if (existsSync(resolved + ".ts")) {
      resolved += ".ts";
    } else if (!existsSync(resolved)) {
      throw new Error(`cannot resolve import: ${specifier} from ${fromPath}`);
    }
  }
  return resolved;
}
