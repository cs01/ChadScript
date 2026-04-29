nums: list[int] = [1, 2, 3, 4, 5]
total: int = 0
for n in nums:
    total += n
print(total)
print(len(nums))
print(nums[0])
print(nums[4])
nums.append(6)
print(len(nums))

words: list[str] = ["hello", "world", "foo"]
print(len(words))
print(words[1])
for w in words:
    print(w)
