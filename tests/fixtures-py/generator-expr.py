nums = [1, 2, 3]
result = ", ".join(str(x) for x in nums)
print(result)

words = ["hello", "world"]
upper = ", ".join(w.upper() for w in words)
print(upper)

squares = [x * x for x in range(5)]
print(", ".join(str(n) for n in squares))
