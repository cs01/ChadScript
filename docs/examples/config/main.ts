// @args: docs/examples/config/config.json
import { existsSync, readFileSync } from "node:fs";

interface Route {
  path: string;
  target: string;
}

interface Config {
  name: string;
  port: number;
  debug?: boolean;
  routes: Route[];
}

function loadConfig(path: string): Config {
  if (!existsSync(path)) throw new Error(`no config file at ${path}`);
  // The annotation is the schema: a document that does not match Config throws here.
  const config: Config = JSON.parse(readFileSync(path, "utf8"));
  return config;
}

function loadOrExit(path: string): Config {
  try {
    return loadConfig(path);
  } catch (e) {
    console.log(`bad config: ${String(e)}`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const config = loadOrExit(args[0] ?? "config.json");
console.log(`${config.name} on port ${config.port}, debug ${config.debug ?? false}`);
for (const route of config.routes) {
  console.log(`  ${route.path.padEnd(10)} -> ${route.target}`);
}
