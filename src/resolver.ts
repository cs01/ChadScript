import { parseFile } from "./parser.js";
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

export function resolveModules(entryPath: string, substitutions?: Map<string, string>): HIRModule {
  const absEntry = resolve(entryPath);
  const visited = new Map<string, ParsedModule>();
  const typeOnlyPaths = new Set<string>();
  const aliases: ImportAlias[] = [];
  const builtinImportList: BuiltinImport[] = [];

  collectModules(absEntry, visited, aliases, typeOnlyPaths, builtinImportList, substitutions);

  const mergedBody: ModuleItem[] = [];
  const TYPE_DECLS = new Set(["TsTypeAliasDeclaration", "TsInterfaceDeclaration", "TsEnumDeclaration"]);

  const moduleItems = new Map<string, ModuleItem[]>();
  for (const [path, mod] of visited) {
    if (path === absEntry) continue;
    const isTypeOnly = typeOnlyPaths.has(path);
    const items: ModuleItem[] = [];
    for (const item of mod.ast.body) {
      if (item.type === "ImportDeclaration") continue;
      if (item.type === "ExportNamedDeclaration" && (item as any).source)
        continue;
      let decl = item;
      if ((item as any).type === "ExportDeclaration") {
        decl = (item as any).declaration;
      }
      if (isTypeOnly && !TYPE_DECLS.has((decl as any).type)) continue;
      items.push(decl as ModuleItem);
    }
    moduleItems.set(path, items);
  }

  const entry = visited.get(absEntry)!;
  const entryItems: ModuleItem[] = [];
  for (const item of entry.ast.body) {
    if (item.type === "ImportDeclaration") continue;
    if (item.type === "ExportNamedDeclaration" && (item as any).source)
      continue;
    if ((item as any).type === "ExportDeclaration") {
      entryItems.push((item as any).declaration as ModuleItem);
    } else {
      entryItems.push(item);
    }
  }

  deduplicateFunctionNames(moduleItems, entryItems, absEntry);

  for (const [, items] of moduleItems) {
    for (const item of items) mergedBody.push(item);
  }
  for (const item of entryItems) mergedBody.push(item);

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
  substitutions?: Map<string, string>,
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
            const resolvedPath = applySubstitution(resolveImportPath(specifier, absPath), substitutions);
            if (typeOnlyPaths && !visited.has(resolvedPath)) {
              typeOnlyPaths.add(resolvedPath);
            }
            collectModules(resolvedPath, visited, aliases, typeOnlyPaths, builtinImportList, substitutions);
          } catch {}
        }
        continue;
      }
      const resolvedPath = applySubstitution(resolveImportPath(item.source.value, absPath), substitutions);
      if (typeOnlyPaths) typeOnlyPaths.delete(resolvedPath);
      collectModules(resolvedPath, visited, aliases, typeOnlyPaths, builtinImportList, substitutions);

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
      const resolvedPath = applySubstitution(resolveImportPath(decl.source.value, absPath), substitutions);
      collectModules(resolvedPath, visited, aliases, typeOnlyPaths, builtinImportList, substitutions);

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

function applySubstitution(absPath: string, substitutions?: Map<string, string>): string {
  if (!substitutions) return absPath;
  return substitutions.get(absPath) ?? absPath;
}

const BUILTIN_MODULES = new Set([
  "path",
  "node:path",
  "fs",
  "node:fs",
  "process",
  "node:process",
  "child_process",
  "node:child_process",
  "crypto",
  "node:crypto",
  "http",
  "node:http",
  "os",
  "node:os",
  "url",
  "node:url",
  "@swc/core",
  "koffi",
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

function getFnNamesFromItems(items: ModuleItem[]): Map<string, boolean> {
  const names = new Map<string, boolean>();
  for (const item of items) {
    const d = item as any;
    if (d.type === "FunctionDeclaration" && d.identifier?.type === "Identifier") {
      names.set(d.identifier.value, true);
    }
    if (d.type === "VariableDeclaration") {
      for (const decl of d.declarations) {
        if (decl.id?.type === "Identifier" && decl.init &&
            (decl.init.type === "ArrowFunctionExpression" || decl.init.type === "FunctionExpression")) {
          names.set(decl.id.value, true);
        }
      }
    }
  }
  return names;
}

function modulePrefix(absPath: string): string {
  const base = absPath.replace(/.*\//, "").replace(/\.ts$/, "");
  return base.replace(/[^a-zA-Z0-9]/g, "_");
}

function renameIdents(items: ModuleItem[], renames: Map<string, string>): void {
  const result = JSON.stringify(items, function(key, value) {
    if (key === "value" && typeof value === "string" && this.type === "Identifier") {
      const r = renames.get(value);
      if (r !== undefined) return r;
    }
    return value;
  });
  const parsed = JSON.parse(result);
  items.length = 0;
  for (let i = 0; i < parsed.length; i++) items.push(parsed[i]);
}

function deduplicateFunctionNames(
  moduleItems: Map<string, ModuleItem[]>,
  entryItems: ModuleItem[],
  _entryPath: string,
): void {
  const fnCount = new Map<string, number>();
  for (const [, items] of moduleItems) {
    for (const [name, _v] of getFnNamesFromItems(items)) {
      fnCount.set(name, (fnCount.get(name) || 0) + 1);
    }
  }
  for (const [name, _ve] of getFnNamesFromItems(entryItems)) {
    fnCount.set(name, (fnCount.get(name) || 0) + 1);
  }

  const collisions = new Map<string, boolean>();
  for (const [name, count] of fnCount) {
    if (count > 1) collisions.set(name, true);
  }
  if (collisions.size === 0) return;

  for (const [path, items] of moduleItems) {
    const localNames = getFnNamesFromItems(items);
    const renames = new Map<string, string>();
    const prefix = modulePrefix(path);
    for (const [name, _lv] of localNames) {
      if (collisions.has(name)) {
        renames.set(name, prefix + "__" + name);
      }
    }
    if (renames.size > 0) {
      renameIdents(items, renames);
    }
  }

  const entryNames = getFnNamesFromItems(entryItems);
  const entryRenames = new Map<string, string>();
  const ePrefix = modulePrefix(_entryPath);
  for (const [name, _ev] of entryNames) {
    if (collisions.has(name)) {
      entryRenames.set(name, ePrefix + "__" + name);
    }
  }
  if (entryRenames.size > 0) {
    renameIdents(entryItems, entryRenames);
  }
}
