// new Promise with the executor written inline and its parameters annotated.
function delay(ms: number, label: string): Promise<string> {
  return new Promise<string>(
    (resolve: (value: string) => void, reject: (reason: Error) => void): void => {
      if (ms < 0) {
        reject(new RangeError(`negative delay: ${ms}`));
        return;
      }
      setTimeout(() => resolve(label), ms);
    },
  );
}

async function main(): Promise<void> {
  console.log(await delay(20, "slow"), await delay(0, "fast"));
  try {
    await delay(-1, "never");
  } catch (e) {
    console.log(String(e));
  }
}

main();
