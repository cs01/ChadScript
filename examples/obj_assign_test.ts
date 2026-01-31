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

  if (flags.verbose && flags.count === 42 && flags.name === "updated") {
    return 0;
  }
  return 1;
}

const result = test();
if (result === 0) {
  console.log("TEST_PASSED");
} else {
  console.log("TEST_FAILED");
}
process.exit(result);
