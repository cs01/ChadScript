interface Flags {
  verbose: boolean;
  count: number;
  name: string;
}

function test(): number {
  const flags: Flags = {
    verbose: false,
    count: 0,
    name: "default"
  };

  console.log("Before assignment:");
  console.log(flags.verbose);
  console.log(flags.count);
  console.log(flags.name);

  flags.verbose = true;
  flags.count = 42;
  flags.name = "updated";

  console.log("After assignment:");
  console.log(flags.verbose);
  console.log(flags.count);
  console.log(flags.name);

  if (flags.verbose) {
    return 1;
  }
  return 0;
}

const result = test();
process.exit(result);
