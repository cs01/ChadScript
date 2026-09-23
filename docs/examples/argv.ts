// @args: ada lin
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log("usage: greet <name>...");
  process.exit(2);
}
for (const name of args) console.log(`hello ${name}`);
