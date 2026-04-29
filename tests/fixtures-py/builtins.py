import math

nums: list[int] = [3, 1, 4, 1, 5, 9, 2, 6]
print(min(nums))
print(max(nums))
print(sum(nums))

s: list[int] = sorted(nums)
print(s[0])
print(s[7])

words: list[str] = ["banana", "apple", "cherry"]
ws: list[str] = sorted(words)
print(ws[0])

for i, x in enumerate(nums):
    if i < 3:
        print(x)

a: list[int] = [1, 2, 3]
b: list[int] = [4, 5, 6]
for x, y in zip(a, b):
    print(x + y)

print(math.floor(3.7))
print(math.ceil(3.2))
