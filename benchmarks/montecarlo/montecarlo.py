import time

SAMPLES = 100000000

seed = 42
inside = 0

start = time.perf_counter()

for _ in range(SAMPLES):
    seed = (seed * 16807) % 2147483647
    x = seed / 2147483647
    seed = (seed * 16807) % 2147483647
    y = seed / 2147483647
    if x * x + y * y <= 1.0:
        inside += 1

elapsed = time.perf_counter() - start
pi = 4.0 * inside / SAMPLES

print(f"Samples:  {SAMPLES}")
print(f"Pi:       {pi}")
print(f"Time:     {elapsed:.3f}s")
