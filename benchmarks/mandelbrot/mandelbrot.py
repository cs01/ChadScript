import time

W = 4096
H = 4096
MAX_ITER = 100

start = time.perf_counter()
total_iter = 0

for py in range(H):
    for px in range(W):
        x0 = px * 3.5 / W - 2.5
        y0 = py * 2.0 / H - 1.0
        x, y, it = 0.0, 0.0, 0
        while it < MAX_ITER and x * x + y * y <= 4.0:
            t = x * x - y * y + x0
            y = 2.0 * x * y + y0
            x = t
            it += 1
        total_iter += it

elapsed = time.perf_counter() - start
print(f"Size:     {W}x{H}")
print(f"Time:     {elapsed:.3f}s")
print(f"Iters:    {total_iter}")
