def safe_div(a: int, b: int) -> int:
    if b == 0:
        raise ValueError("division by zero")
    return a // b

try:
    print(safe_div(10, 2))
    print(safe_div(10, 0))
except ValueError as e:
    print(e)

try:
    raise RuntimeError("boom")
except RuntimeError as err:
    print(err)
