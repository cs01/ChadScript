import { readFileSync } from "fs";

declare function swc_parse_typescript(src: string): string;

export function parseFile(filePath: string): any {
  const source = readFileSync(filePath, "utf-8");
  return parseSource(source, filePath);
}

export function parseSource(source: string, _filename: string): any {
  const json = swc_parse_typescript(source);
  return JSON.parse(json);
}
