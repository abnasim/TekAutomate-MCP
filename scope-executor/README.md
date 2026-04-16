# Tek Automate Scope Executor (Windows)

Run this on the PC connected to the scope so the Tek Automate app can connect and execute scripts there.

Double-click `run.bat`. The first run creates `.venv`, installs dependencies, and opens the QR/server window. Enter this PC's IP and port `8765` in the app, or scan the QR code.

## Python 3.11 requirement

`run.bat` requires Python 3.11, but it does not require PATH or environment-variable changes.

It tries these in order:

1. `py -3.11`
2. `%LocalAppData%\Programs\Python\Python311\python.exe`
3. `%ProgramFiles%\Python311\python.exe`
4. `%ProgramFiles(x86)%\Python311\python.exe`

The launcher only accepts the interpreter if it is actually Python 3.11.

If Python 3.11 is not already installed, `run.bat` will use the bundled `python-3.11.0-amd64.exe` installer and install it to `%LocalAppData%\Programs\Python\Python311`.

## Scope has no internet

1. On a PC with internet, run `download_wheels.bat`. It downloads all packages into `offline_wheels\`.
2. Copy the entire `scope-executor` folder, including `offline_wheels`, to the scope PC.
3. On the scope PC, double-click `run.bat`. It installs from `offline_wheels` and does not need internet.

- `executor.py` - QR window and HTTP server in one.
- `run.bat` - creates `.venv`, installs deps, and runs the executor.
- `download_wheels.bat` - fills `offline_wheels` for offline install on the scope.
- `requirements.txt` - pyvisa, tm_devices, tekhsi, qrcode, Pillow, and related deps.
