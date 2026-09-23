// `new Promise` with annotated resolve/reject: values of several representations, rejection from a
// timer, a synchronous throw in the executor, settlement before the first await, extra resolves.
function delay(ms: number, v: number): Promise<number> {
  return new Promise<number>((resolve: (value: number) => void): void => {
    setTimeout((): void => resolve(v), ms);
  });
}

function failAfter(ms: number): Promise<string> {
  return new Promise<string>(
    (_resolve: (value: string) => void, reject: (reason: Error) => void): void => {
      setTimeout((): void => reject(new TypeError("late")), ms);
    },
  );
}

function syncThrow(): Promise<boolean> {
  return new Promise<boolean>((_resolve: (value: boolean) => void): void => {
    throw new RangeError("sync");
  });
}

interface Pt {
  x: number;
  y: number;
}

async function main(): Promise<void> {
  console.log((await delay(5, 1)) + (await delay(1, 2)));
  try {
    await failAfter(2);
  } catch (e) {
    console.log(e instanceof TypeError, String(e));
  }
  try {
    await syncThrow();
  } catch (e) {
    console.log(String(e));
  }
  const now = new Promise<string>((resolve: (value: string) => void): void => {
    resolve("now");
    resolve("ignored");
    console.log("executor ran");
  });
  console.log("before await");
  console.log(await now);
  const flag = await new Promise<boolean>((resolve: (value: boolean) => void): void => {
    resolve(true);
  });
  console.log(flag);
  const pt = await new Promise<Pt>((resolve: (value: Pt) => void): void => {
    setTimeout((): void => resolve({ x: 1, y: 2 }), 1);
  });
  console.log(pt);
  const maybe = await new Promise<string | undefined>(
    (resolve: (value: string | undefined) => void): void => {
      resolve(undefined);
    },
  );
  console.log(maybe);
  const all = await Promise.all([delay(3, 10), delay(1, 20)]);
  console.log(all);
}
main();
