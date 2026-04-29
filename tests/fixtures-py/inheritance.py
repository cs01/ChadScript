class Animal:
    name: str
    sound: str

    def __init__(self, name: str, sound: str) -> None:
        self.name = name
        self.sound = sound

    def speak(self) -> str:
        return self.name + " says " + self.sound

    def get_name(self) -> str:
        return self.name


class Dog(Animal):
    def __init__(self, name: str) -> None:
        super().__init__(name, "woof")


class Cat(Animal):
    def __init__(self, name: str) -> None:
        super().__init__(name, "meow")

    def speak(self) -> str:
        return self.name + " says " + self.sound + "!"


d: Dog = Dog("Rex")
c: Cat = Cat("Whiskers")
print(d.speak())
print(c.speak())
print(d.get_name())
print(c.get_name())
