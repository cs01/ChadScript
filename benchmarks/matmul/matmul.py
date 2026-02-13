import time

N = 512
a = [(i % N) + 0.1 for i in range(N * N)]
b = [(i // N) + 0.1 for i in range(N * N)]
c = [0.0] * (N * N)

start = time.perf_counter()

for row in range(N):
    for col in range(N):
        s = 0.0
        for k in range(N):
            s += a[row * N + k] * b[k * N + col]
        c[row * N + col] = s

elapsed = time.perf_counter() - start
gflops = (2 * N * N * N) / elapsed / 1e9
print(f"Size:     {N}x{N}")
print(f"Time:     {elapsed:.3f}s")
print(f"GFLOPS:   {gflops:.2f}")
