import { parseFile } from "./parser.js";
import { lowerModule } from "./hir/lower.js";
import type { ImportAlias, BuiltinImport } from "./hir/lower.js";
import { setSourceContext } from "./errors.js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import type { HIRModule } from "./hir/types.js";
import type { Module, ModuleItem } from "@swc/core";

interface ImportSpec {
  imported: string;
  local: string;
}

interface ImportInfo {
  sourcePath: string;
  specifiers: ImportSpec[];
}

interface ReexportSpec {
  sourcePath: string;
  exported: string;
  original: string;
}

interface ParsedModule {
  ast: Module;
  source: string;
  absPath: string;
  imports: ImportInfo[];
  reexports: ReexportSpec[];
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

  qualifyAllModules(visited, moduleItems, entryItems, absEntry);

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
  const imports: ImportInfo[] = [];
  const reexports: ReexportSpec[] = [];
  visited.set(absPath, { ast, source, absPath, imports, reexports });

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

      const specs: ImportSpec[] = [];
      for (const s of item.specifiers) {
        if (s.type === "ImportSpecifier") {
          const imported = s.imported?.value || s.local.value;
          const local = s.local.value;
          specs.push({ imported, local });
          if (local !== imported) {
            aliases.push({ local, imported });
          }
        }
      }
      if (specs.length > 0) {
        imports.push({ sourcePath: resolvedPath, specifiers: specs });
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
        if (s.type === "ExportSpecifier") {
          const orig = s.orig.value;
          const exported = s.exported ? s.exported.value : orig;
          reexports.push({ sourcePath: resolvedPath, exported, original: orig });
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

function getDeclNamesFromItems(items: ModuleItem[]): Map<string, boolean> {
  const names = new Map<string, boolean>();
  for (const item of items) {
    const d = item as any;
    if (d.declare) continue;
    if (d.type === "FunctionDeclaration" && d.identifier?.type === "Identifier") {
      names.set(d.identifier.value, true);
    }
    if (d.type === "ClassDeclaration" && d.identifier?.type === "Identifier") {
      names.set(d.identifier.value, true);
    }
    if (d.type === "TsEnumDeclaration" && d.id?.type === "Identifier") {
      names.set(d.id.value, true);
    }
    if (d.type === "TsTypeAliasDeclaration" && d.id?.type === "Identifier") {
      names.set(d.id.value, true);
    }
    if (d.type === "VariableDeclaration") {
      for (const decl of d.declarations) {
        if (decl.id?.type === "Identifier") {
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
  const result = JSON.stringify(items, function (key, value) {
    if (key === "property" && this && this.type === "MemberExpression" &&
        value && typeof value === "object" && value.type === "Identifier") {
      return { ...value, __skipRename: true };
    }
    if (key === "key" && this && (this.type === "KeyValueProperty" || this.type === "ObjectProperty" || this.type === "ClassProperty" || this.type === "MethodProperty") &&
        value && typeof value === "object" && value.type === "Identifier") {
      return { ...value, __skipRename: true };
    }
    if (this && this.type === "ClassMethod" && key === "key" && value && typeof value === "object" && value.type === "Identifier") {
      return { ...value, __skipRename: true };
    }
    if (key === "value" && typeof value === "string" && this && this.type === "Identifier" && !this.__skipRename) {
      const r = renames.get(value);
      if (r !== undefined) return r;
    }
    if (key === "__skipRename") return undefined;
    return value;
  });
  const parsed = JSON.parse(result);
  items.length = 0;
  for (let i = 0; i < parsed.length; i++) items.push(parsed[i]);
}

function resolveExportedFrom(
  visited: Map<string, ParsedModule>,
  localNamesByPath: Map<string, Map<string, boolean>>,
  sourcePath: string,
  exportedName: string,
  seen: Set<string>,
): { path: string; name: string } | null {
  const key = sourcePath + "::" + exportedName;
  if (seen.has(key)) return null;
  seen.add(key);

  const localNames = localNamesByPath.get(sourcePath);
  if (localNames && localNames.has(exportedName)) {
    return { path: sourcePath, name: exportedName };
  }

  const mod = visited.get(sourcePath);
  if (!mod) return null;

  for (const r of mod.reexports) {
    if (r.exported === exportedName) {
      const resolved = resolveExportedFrom(visited, localNamesByPath, r.sourcePath, r.original, seen);
      if (resolved) return resolved;
    }
  }

  return { path: sourcePath, name: exportedName };
}

function qualifyAllModules(
  visited: Map<string, ParsedModule>,
  moduleItems: Map<string, ModuleItem[]>,
  entryItems: ModuleItem[],
  entryPath: string,
): void {
  const allModules: Array<{ path: string; items: ModuleItem[] }> = [];
  for (const [path, items] of moduleItems) allModules.push({ path, items });
  allModules.push({ path: entryPath, items: entryItems });

  const localNamesByPath = new Map<string, Map<string, boolean>>();
  for (const { path, items } of allModules) {
    localNamesByPath.set(path, getDeclNamesFromItems(items));
  }

  for (const { path, items } of allModules) {
    const prefix = modulePrefix(path);
    const renames = new Map<string, string>();

    const localNames = localNamesByPath.get(path)!;
    for (const [name, _v] of localNames) {
      renames.set(name, prefix + "__" + name);
    }

    const mod = visited.get(path);
    if (mod) {
      for (const imp of mod.imports) {
        for (const spec of imp.specifiers) {
          const target = resolveExportedFrom(visited, localNamesByPath, imp.sourcePath, spec.imported, new Set<string>());
          if (target) {
            renames.set(spec.local, modulePrefix(target.path) + "__" + target.name);
          }
        }
      }
    }

    if (renames.size > 0) {
      renameIdents(items, renames);
    }
  }
}
