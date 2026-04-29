import random

random.seed(42)

x = random.random()
print(x >= 0.0 and x < 1.0)

n = random.randint(1, 10)
print(n >= 1 and n <= 10)

u = random.uniform(2.5, 5.5)
print(u >= 2.5 and u <= 5.5)

nums = [1.0, 2.0, 3.0, 4.0, 5.0]
c = random.choice(nums)
print(c >= 1.0 and c <= 5.0)

words = ["a", "b", "c"]
w = random.choice(words)
print(w == "a" or w == "b" or w == "c")

random.shuffle(nums)
total = 0.0
for v in nums:
    total = total + v
print(total)
