words = ["hello", "world", "foo"]
print(", ".join(words))
print(" ".join(words))

s = "hello world  foo"
parts = s.split()
print(parts)

print("hello".count("l"))
print("hello world".count("o"))

print("123".isdigit())
print("abc".isdigit())
print("abc".isalpha())
print("123".isalpha())
print("  ".isspace())
print("a ".isspace())
