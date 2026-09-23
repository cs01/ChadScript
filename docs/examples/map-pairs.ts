// A Map built from a literal list of [key, value] pairs keeps their order.
const ports = new Map<string, number>([
  ["http", 80],
  ["https", 443],
  ["ssh", 22],
]);
ports.set("http", 8080);
for (const name of ports.keys()) console.log(name, ports.get(name));
console.log(ports);
