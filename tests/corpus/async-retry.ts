// @category: async-io
// Async control flow: sleep via setTimeout promises, retry with exponential backoff against a
// deterministic flaky operation, a timeout wrapper built on Promise.race, and a concurrency-limited
// worker pool.

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

async function retry<T>(
  op: (attempt: number) => Promise<T>,
  attempts: number,
  baseDelay: number,
): Promise<T> {
  let lastError: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await op(i);
    } catch (e) {
      lastError = e;
      console.log(`  attempt ${i} failed: ${(e as Error).message}`);
      if (i < attempts) await sleep(baseDelay * 2 ** (i - 1));
    }
  }
  throw new Error(`gave up after ${attempts} attempts`, { cause: lastError });
}

function flaky(failuresBeforeSuccess: number): (attempt: number) => Promise<string> {
  return async (attempt) => {
    await sleep(1);
    if (attempt <= failuresBeforeSuccess) throw new Error(`transient failure #${attempt}`);
    return `ok on attempt ${attempt}`;
  };
}

async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let active = 0;
  let peak = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      active++;
      peak = Math.max(peak, active);
      results[i] = await work(items[i]!);
      active--;
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  console.log(`pool peak concurrency: ${peak}`);
  return results;
}

async function main(): Promise<void> {
  console.log("retry flaky(2):");
  console.log(await retry(flaky(2), 5, 2));
  console.log("retry flaky(9):");
  try {
    await retry(flaky(9), 3, 1);
  } catch (e) {
    const err = e as Error;
    console.log(`${err.message}; cause: ${(err.cause as Error).message}`);
  }
  console.log(
    await withTimeout(
      sleep(5).then(() => "fast enough"),
      50,
    ),
  );
  try {
    await withTimeout(
      sleep(60).then(() => "too slow"),
      10,
    );
  } catch (e) {
    console.log(`${(e as Error).name}: ${(e as Error).message}`);
  }
  const lengths = await pool(["alpha", "beta", "gamma", "delta", "epsilon"], 2, async (w) => {
    await sleep(w.length);
    return w.length;
  });
  console.log(lengths);
  const order: string[] = [];
  await Promise.all([
    sleep(15).then(() => order.push("slow")),
    sleep(5).then(() => order.push("fast")),
    Promise.resolve().then(() => order.push("micro")),
  ]);
  console.log(order.join(" < "));
}

void main();
