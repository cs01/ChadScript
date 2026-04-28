import { Parser, Language, type SyntaxNode } from "web-tree-sitter";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";

let parser: Parser | null = null;

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");

async function getParser(): Promise<Parser> {
  if (parser) return parser;
  await Parser.init();
  const lang = await Language.load(resolve(ROOT, "node_modules/tree-sitter-php/tree-sitter-php.wasm"));
  parser = new Parser();
  parser.setLanguage(lang);
  return parser;
}

export async function parsePhpFile(filePath: string): Promise<SyntaxNode> {
  const source = readFileSync(filePath, "utf-8");
  return parsePhpSource(source);
}

export async function parsePhpSource(source: string): Promise<SyntaxNode> {
  const p = await getParser();
  const tree = p.parse(source);
  return tree.rootNode;
}

export type { SyntaxNode };
