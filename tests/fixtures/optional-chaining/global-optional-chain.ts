interface Config {
  db: DbConfig | null;
}
interface DbConfig {
  host: string;
  port: number;
}
const config: Config = { db: null };
const host = config.db?.host;
if (host === null || host === undefined) {
  console.log("null case works");
}

const config2: Config = { db: { host: "localhost", port: 5432 } };
const host2 = config2.db?.host;
if (host2 !== null && host2 !== undefined) {
  console.log(host2);
}
console.log("TEST_PASSED");
