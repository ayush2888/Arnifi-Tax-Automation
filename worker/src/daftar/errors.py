class CodedError(Exception):
    """A failure identified by a stable code. The message is never file contents."""

    def __init__(self, code: str, message: str | None = None):
        super().__init__(message or code)
        self.code = code
        self.message = message or code
