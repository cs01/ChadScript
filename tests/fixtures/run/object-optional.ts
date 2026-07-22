interface Config {
  name: string;
  timeout?: number;
  verbose?: boolean;
}
const c1: Config = { name: "server", timeout: 30 };
console.log(c1.name, c1.timeout ?? -1, c1.verbose ?? false);
const c2: Config = { name: "client" };
console.log(c2.name, c2.timeout ?? 99, c2.verbose ?? true);
