import { Parser, Language, type SyntaxNode } from "web-tree-sitter";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";

let parser: Parser | null = null;

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");

async function getParser(): Promise<Parser> {
  if (parser) return parser;
  await Parser.init();
  const lang = await Language.load(resolve(ROOT, "node_modules/tree-sitter-python/tree-sitter-python.wasm"));
  parser = new Parser();
  parser.setLanguage(lang);
  return parser;
}

export async function parsePythonFile(filePath: string): Promise<SyntaxNode> {
  const source = readFileSync(filePath, "utf-8");
  return parsePythonSource(source);
}

export async function parsePythonSource(source: string): Promise<SyntaxNode> {
  const p = await getParser();
  const tree = p.parse(source);
  return tree.rootNode;
}

export type { SyntaxNode };
