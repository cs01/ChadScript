// @native-only: JSON.parse's shape check is the one deliberate divergence from Node
interface Config {
  name: string;
  port: number;
}

try {
  const bad: Config = JSON.parse('{"name":"api","port":"8080"}');
  console.log("port + 1 =", bad.port + 1);
} catch (e) {
  console.log("rejected:", e instanceof Error);
}
