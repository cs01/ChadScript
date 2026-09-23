// JSON.parse needs a declared target type; the parsed value has that type's fields.
// JSON.stringify works on any accepted value.
interface Config {
  name: string;
  port: number;
  tags: string[];
  debug?: boolean;
}

const good: Config = JSON.parse('{"name":"api","port":8080,"tags":["a","b"]}');
console.log(good.name, good.port + 1, good.tags.length, good.debug);

console.log(JSON.stringify(good));
console.log(JSON.stringify({ name: good.name, port: good.port, debug: true }, null, 2));
