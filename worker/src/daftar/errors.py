class CodedError(Exception):
    """A failure identified by a stable code. The message is the code, never file contents."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code
