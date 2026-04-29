words: list[str] = ["apple", "banana", "cherry"]
lengths: dict[str, int] = {w: len(w) for w in words}
for k in lengths.keys():
    print(k)
    print(lengths[k])

nums: list[int] = [1, 2, 3, 4, 5]
squares: dict[str, int] = {str(n): n * n for n in nums}
for k in squares.keys():
    print(k)
    print(squares[k])
