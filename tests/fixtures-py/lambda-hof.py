nums: list[int] = [3, 1, 4, 1, 5, 9, 2, 6]

doubled: list[int] = list(map(lambda x: x * 2, nums))
for n in doubled:
    print(n)

evens: list[int] = list(filter(lambda x: x % 2 == 0, nums))
for n in evens:
    print(n)

desc: list[int] = sorted(nums, key=lambda x: -x)
for n in desc:
    print(n)

asc: list[int] = sorted(nums, reverse=True)
for n in asc:
    print(n)
