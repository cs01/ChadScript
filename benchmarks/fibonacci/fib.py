import time

def fib(n):
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)

start = time.perf_counter()
result = fib(42)
elapsed = time.perf_counter() - start
print(f"fib(42) = {result}")
print(f"Time:   {elapsed:.3f}s")
