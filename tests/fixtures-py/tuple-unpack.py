a: int
b: int
a, b = 1, 2
print(a)
print(b)

x: int
y: int
x, y = 10, 20
print(x + y)

def swap(p: int, q: int) -> int:
    return p + q

c: int
d: int
c, d = 3, 4
print(swap(c, d))
