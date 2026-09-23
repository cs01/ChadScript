// `node:fs/promises` through its namespace and default forms.
import * as fsp from "node:fs/promises";
import fspDefault from "node:fs/promises";

async function main(): Promise<void> {
  const p = "/tmp/chad-fsp-ns-" + process.pid + ".txt";
  await fsp.writeFile(p, "alpha");
  await fspDefault.appendFile(p, " beta");
  console.log(await fsp.readFile(p, "utf8"));
  await fspDefault.unlink(p);
  try {
    await fsp.unlink(p);
  } catch (e) {
    console.log("second unlink rejected");
  }
}

main();
