nums: list[int] = [1, 2, 3, 4, 5]
doubled: list[int] = [x * 2 for x in nums]
for n in doubled:
    print(n)

evens: list[int] = [x for x in nums if x % 2 == 0]
for n in evens:
    print(n)

squares: list[int] = [x * x for x in nums]
print(sum(squares))
print(min(squares))
print(max(squares))
