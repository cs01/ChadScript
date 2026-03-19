interface Config {
  name: string;
  port: number;
  host: string;
}

const input = "name: myapp\nport: 8080\nhost: localhost";
const result: Config = YAML.parse<Config>(input);
if (result.name === "myapp" && result.port === 8080 && result.host === "localhost") {
  console.log("TEST_PASSED");
}
