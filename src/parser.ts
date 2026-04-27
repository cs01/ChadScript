import { parseSync, type Module } from "@swc/core";
import { readFileSync } from "fs";

export function parseFile(filePath: string): Module {
  const source = readFileSync(filePath, "utf-8");
  return parseSource(source, filePath);
}

export function parseSource(source: string, filename = "<stdin>"): Module {
  return parseSync(source, {
    syntax: "typescript",
    target: "es2022",
    decorators: true,
  });
}
