class Tokenizer:
    def __init__(self, string: str):
        if not str.isascii:
            string = string.encode("latin1")
        self.decoded_string = string
        self.string = string
        self.index = 0
        self.next = None
        self._advance()

    def _advance(self):
        try:
            char = self.decoded_string[self.index]
        except IndexError:
            self.next = None
            return

        if char == "\\":
            self.index += 1
            try:
                char += self.decoded_string[self.index]
            except IndexError:
                raise ValueError(f"Bad escape at index {self.index}")

        self.next = char
        self.index += 1

    def step(self):
        current = self.next
        self._advance()
        return current


class Foo:
    def __init__(self):
        self.index = 0
        self.decoded_string = "Hello, Debugger!"
        self.next = "x"
        self.items = [1, 2, 3, 4, 5]

    def step(self):
        self.index += 1
        if self.index < len(self.items):
            self.next = str(self.items[self.index])
        else:
            self.next = None


def main():
    foo = Foo()
    foo.step()
    foo.step()

    tok = Tokenizer("abc\\ndef")

    # Set a breakpoint on the next line to test the Evaluate panel
    print(f"foo.index = {foo.index}, foo.next = {foo.next}")  # <-- breakpoint here

    for _ in range(3):
        tok.step()

    result = {
        "foo_index": foo.index,
        "foo_next": foo.next,
        "tok_next": tok.next,
        "tok_index": tok.index,
    }
    print(f"Result: {result}")


if __name__ == "__main__":
    main()
