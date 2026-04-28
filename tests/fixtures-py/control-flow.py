def classify(n: int) -> int:
    if n > 0:
        return 1
    elif n < 0:
        return -1
    else:
        return 0

print(classify(42))
print(classify(-7))
print(classify(0))

total: int = 0
for i in range(10):
    total = total + i
print(total)

count: int = 0
n: int = 1
while n < 100:
    n = n * 2
    count = count + 1
print(count)
print(n)
