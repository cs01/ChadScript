class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def area(self):
        return self.x * self.y

    def describe(self):
        return self.x + self.y

p = Point(3, 4)
print(p.area())
print(p.describe())
