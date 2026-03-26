# Mock PyVISA for regression tests (no hardware).
# Run generated script with: PYTHONPATH=scripts/mock_pyvisa python generated_script.py

class MockResource:
    def __init__(self):
        self.timeout = 5000
        self.write_termination = "\n"
        self.read_termination = None

    def write(self, cmd):
        pass

    def query(self, cmd):
        return "MOCK"

    def read_raw(self):
        return b""

    def close(self):
        pass

class ResourceManager:
    def open_resource(self, resource):
        return MockResource()

    def close(self):
        pass
