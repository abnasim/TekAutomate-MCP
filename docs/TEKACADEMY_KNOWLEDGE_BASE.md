# TekAutomate Academy — Complete Knowledge Base

> All articles from the in-app TekAutomate Academy, organized by category.  
> Use this document to give your AI assistant full context about Tektronix instrument automation.

---

## Table of Contents

1. [Connection & Hardware](#1-connection--hardware)
   - [Physical Connectivity](#11-physical-connectivity)
   - [The VISA Protocol](#12-the-visa-protocol)
   - [Instrument-Specific Quirks](#13-instrument-specific-quirks)
2. [The Engine Room](#2-the-engine-room)
   - [Driver Deep Dives](#21-driver-deep-dives)
   - [Comparison Guides](#22-comparison-guides)
3. [Measurements & Commands](#3-measurements--commands)
   - [Query vs. Write](#31-query-vs-write)
   - [Waveform Acquisition](#32-waveform-acquisition)
   - [Screenshots & Files](#33-screenshots--files)
4. [Scripting & Workflow](#4-scripting--workflow)
   - [From UI to Code](#41-from-ui-to-code)
   - [Advanced Patterns](#42-advanced-patterns)
5. [Troubleshooting](#5-troubleshooting)
   - [Connection Errors](#51-connection-errors)
   - [Data Errors](#52-data-errors)
   - [Driver Issues](#53-driver-issues)

---

## 1. Connection & Hardware

### 1.1 Physical Connectivity

---

#### Ethernet vs. USB vs. GPIB: The Hierarchy of Automation Reliability

**Why Ethernet is King**

When automating test equipment, your connection method determines reliability, speed, and ease of use.

Ethernet provides galvanic isolation between your PC and the instrument. This means electrical noise, ground loops, and potential differences won't corrupt your measurements. USB and GPIB lack this protection.

Ethernet also allows for much longer cable runs (up to 100 meters) compared to USB (5 meters) or GPIB (20 meters with extenders).

> **Tip — No Drivers Required:** Ethernet connections use standard TCP/IP protocols. No vendor-specific drivers needed — just an IP address and you're connected. USB requires driver installation and can conflict with other devices.

**Connection Reliability Ranking:**
1. Ethernet (TCP/IP) — Most reliable, driverless, long distance
2. USB — Convenient but requires drivers, limited distance
3. GPIB (IEEE-488) — Legacy standard, requires interface card, limited distance

---

#### Direct PC-to-Scope Connection: Setting Static IPs

**When You Don't Have a Network Switch**

If you don't have a network switch or router, you can connect your PC directly to the oscilloscope using an Ethernet cable. This requires setting static IP addresses on both devices.

**Step 1: Configure the Oscilloscope**
1. Navigate to Utility → I/O → Network
2. Set the IP address to a static value (e.g., `192.168.1.100`)
3. Set Subnet Mask to `255.255.255.0`
4. Disable DHCP/Auto IP

**Step 2: Configure Your PC**
1. Open Network Settings (Windows: Settings → Network & Internet)
2. Find your Ethernet adapter
3. Set IP address to `192.168.1.101` (same subnet, different address)
4. Set Subnet Mask to `255.255.255.0`
5. Leave Default Gateway empty

> **Warning:** Both devices must be on the same subnet (`192.168.1.x`) but have different IP addresses.

---

#### How to Find Your Instrument IP Address

**MSO 4/5/6/7 Series**
1. Press the Utility button on the front panel
2. Navigate to I/O → Network
3. The IP address is displayed on the screen
4. If using DHCP, the address may change. Consider setting a static IP.

**DPO7000 Series**
1. Press Utility → I/O
2. Select Network Settings
3. View the current IP address

**MDO3000 Series**
1. Press Utility → I/O
2. Select Network
3. The IP address is shown in the network configuration

**Generic Windows-Based Scopes**
1. Use the front panel menu (same as above)
2. Or connect a keyboard/mouse and check Network Settings in Windows
3. Or use the LXI Web Interface

> **Pro Tip:** If the scope is on a network, you can also find it using the LXI Discovery tool or by checking your router's connected devices list.

---

#### LXI Web Interface: The "Ping Test"

**Verify Your Instrument is Alive**

The simplest way to verify your oscilloscope is connected and responding is to open its IP address in a web browser. This is called the LXI (LAN eXtensions for Instrumentation) Web Interface.

**How to Access:**
1. Make sure your PC and scope are on the same network
2. Open any web browser (Chrome, Firefox, Edge)
3. Type the scope's IP address in the address bar (e.g., `http://192.168.1.55`)
4. Press Enter

**What You Should See:**
If the connection is working, you'll see the instrument's web interface showing:
- Instrument model and serial number
- Current settings and measurements
- Network configuration
- System information

**Troubleshooting if page doesn't load:**
- Is the IP address correct?
- Are both devices on the same network?
- Is the scope's web server enabled? (Check Utility → I/O → Network)
- Is a firewall blocking the connection?

---

#### Security Considerations: Network Security, Firewall Configuration, Secure Connections

**Securing Your Tektronix Instrument Network**

**1. Network Isolation**
- Use a dedicated switch/router for instruments
- Don't connect instruments directly to corporate networks
- Use VLANs to segment instrument traffic
- Consider a separate subnet (e.g., `192.168.100.x`)

**2. Firewall Configuration**

Ports to allow:
- Port 1024 (VXI-11) — Required for SCPI over Ethernet
- Port 4000/5025 (Raw sockets) — Optional
- Port 80 (HTTP) — Optional, for LXI web interface
- Block all other ports

**3. Static IP vs. DHCP**
- Prevents IP changes that break scripts
- Easier firewall rules (specific IPs)
- Set on instrument: Utility → I/O → Network → Static IP

**4. Authentication (MSO 4/5/6/7 Series)**
- Utility → System → Security → Enable Authentication
- Set strong passwords for Automation account

**5. Script Security**

```python
# BAD - Hardcoded credentials
scope = connect_with_password("192.168.1.50", "password123")

# GOOD - Use environment variables
import os
password = os.getenv("SCOPE_PASSWORD")
scope = connect_with_password("192.168.1.50", password)
```

> **Warning:** Never connect instruments with automation enabled directly to production networks. Always use isolated test networks or VPNs.

---

### 1.2 The VISA Protocol

---

#### What is a VISA Resource String?

**Anatomy of a Resource String**

A VISA resource string tells your software how to connect to an instrument:

```
TCPIP0::192.168.1.50::inst0::INSTR
```

Breaking it down:
- `TCPIP0` — The interface type (Ethernet) and instance number
- `192.168.1.50` — The IP address of your instrument
- `inst0` — The instrument instance (usually 0)
- `INSTR` — The resource class (uses VXI-11)

**Other Common Formats:**
```
TCPIP::192.168.1.50::5025::SOCKET  // Raw socket on port 5025
USB0::0x0699::0x0522::C012345::INSTR  // USB connection
GPIB0::5::INSTR  // GPIB at address 5
```

> **Tip:** When using `TCPIP::...::INSTR`, VISA uses port 1024 (VXI-11) by default. For raw sockets, port 4000 or 5025 is common on Tektronix instruments.

**FAQs:**

*Why is my connection timing out?*  
Common causes: wrong IP address, firewall blocking the port, instrument not powered on, or network cable disconnected. Check the IP with the LXI web interface first.

*Can I use USB instead?*  
Yes, but USB requires driver installation. Ethernet is driverless and more reliable for automation.

---

#### VXI-11 vs. Sockets: Understanding the Difference

**Three Ways to Talk Over Ethernet**

**VXI-11 via PyVISA (The Standard Way)**

When you use `TCPIP::192.168.1.50::INSTR`, PyVISA automatically uses VXI-11 under the hood.

Advantages:
- Handles message boundaries automatically
- Reliable error handling
- Works with most instruments out of the box
- No need to worry about termination characters
- Industry standard (VISA API)

```python
# VXI-11 via PyVISA (default)
import pyvisa
rm = pyvisa.ResourceManager()
scope = rm.open_resource("TCPIP::192.168.1.50::INSTR")
# PyVISA uses VXI-11 automatically when you use ::INSTR
scope.write("*IDN?")  # No \n needed!
print(scope.read())
```

**VXI-11 Standalone (The Lightweight Way)**

Using the `python-vxi11` package directly, without PyVISA.

```python
# VXI-11 standalone (python-vxi11 package)
import vxi11
instrument = vxi11.Instrument("192.168.1.50")
idn = instrument.ask("*IDN?")  # ask() = write + read
print(idn)
instrument.write(":CH1:SCAle 0.5")
instrument.close()
```

> **Info:** Both use the same VXI-11 protocol! PyVISA is a wrapper that uses VXI-11 when you specify `::INSTR`. The standalone vxi11 package talks VXI-11 directly.

**Raw Sockets (The Direct Way)**

```python
# Raw socket connection (direct TCP/IP)
import socket
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.connect(("192.168.1.50", 5025))  # Port 5025 for SCPI
sock.send(b"*IDN?\n")  # Must include \n!
data = sock.recv(4096)
print(data.decode())
sock.close()
```

> **Warning:** With raw sockets, forgetting the `\n` character is the #1 cause of timeouts. Always append `\n` to your commands.

**Which Should You Use?**
- **PyVISA (VXI-11):** Use for most automation — industry standard, reliable, well-supported
- **Standalone VXI-11:** Use when you want to avoid VISA dependencies
- **Raw Sockets:** Use only when you need maximum control or are debugging

---

#### Port Numbers: Why Port 4000?

**Common Ports for Tektronix Instruments**

- Port 1024 — VXI-11 default (used automatically with `TCPIP::...::INSTR`)
- Port 4000 — Default SCPI socket port for many Tektronix instruments
- Port 5025 — Alternative SCPI socket port (some newer instruments)
- Port 80 — HTTP (for LXI web interface)
- Port 443 — HTTPS (secure web interface, if enabled)

```
# Using port 4000 for raw socket
TCPIP::192.168.1.50::4000::SOCKET
```

> **Tip:** Check your instrument's documentation or use the LXI web interface to see which ports are enabled. Most modern Tektronix scopes support both 4000 and 5025.

---

#### Termination Characters: Why `\n` Matters

**The #1 Cause of Timeouts**

Forgetting to add a termination character (`\n`, line feed) is the most common cause of connection timeouts when using raw sockets.

SCPI commands are line-based. The instrument needs to know when a command ends. The newline character signals "end of command." Without it, the instrument waits forever.

```python
# WRONG - Missing \n
sock.send(b"*IDN?")  # Instrument waits... timeout!

# CORRECT - With \n
sock.send(b"*IDN?\n")  # Instrument responds immediately
```

**VXI-11 vs. Raw Sockets:**

```python
# VXI-11 - No \n needed
scope = rm.open_resource("TCPIP::192.168.1.50::INSTR")
scope.write("*IDN?")  # VISA adds termination automatically

# Raw socket - \n required
sock.send(b"*IDN?\n")  # You must add \n
```

> **Error:** If you're getting timeouts with raw sockets, check that every command ends with `\n`. This is the #1 debugging step.

---

### 1.3 Instrument-Specific Quirks

---

#### MSO 4/5/6/7 Series: User Account vs. Automation Permissions

**The Permission Problem**

MSO 4/5/6/7 Series oscilloscopes run Windows and have user account controls. Some operations require "Automation" permissions.

**How to Enable Automation Mode:**
1. On the scope, press Utility → System → Security
2. Enable "Automation Account" or "Remote Control"
3. You may need to set a password
4. Some scopes require a reboot after enabling

> **Warning:** Automation mode gives full control to remote connections. Only enable it in secure lab environments.

**Common Issues:**
- Commands work locally but fail remotely → Check automation permissions
- File operations fail → May need automation account
- Settings don't persist → User account limitations

---

#### Older DPO/MSO Scopes: Talk/Listen Mode

Older DPO and MSO series oscilloscopes (pre-2010) sometimes require manual enabling of "Talk/Listen" mode.

**How to Enable:**
1. Press Utility → I/O
2. Look for "Remote" or "Talk/Listen" option
3. Enable remote control
4. Some models require this to be set each power cycle

> **Info:** MSO 4/5/6/7 and newer series don't require this — remote control is enabled by default when connected via Ethernet.

---

#### Keithley SMUs: GPIB Legacy vs. Modern LAN

**Older Models (GPIB Only)**
- Require GPIB interface card in PC
- Use resource string: `GPIB0::12::INSTR`
- Limited to 20 meters cable length
- Requires NI-488.2 or similar drivers

**Modern Models (LAN Capable)**
- Support Ethernet connections
- Use resource string: `TCPIP::192.168.1.50::INSTR`
- Same reliability as Tektronix scopes
- Driverless connection

> **Tip:** Most Keithley SMUs from 2010 onwards support LAN. Check the instrument's network settings menu to confirm.

---

#### Version Compatibility: Firmware Requirements and Compatibility Matrices

**Checking Firmware Version:**

```python
# Query firmware version
idn = scope.query("*IDN?")
# Returns: "TEKTRONIX,MSO64,C012345,CF:91.1.0 FV:1.0.0"

parts = idn.split(",")
firmware = parts[3] if len(parts) > 3 else "Unknown"
print(f"Firmware: {firmware}")
```

**TekHSI Compatibility:**
- MSO 4/5/6/7 Series: Firmware 1.0.0 or later
- Requires SFP+ port (10 Gbps Ethernet)
- Windows/Linux only (not macOS)

**Backend Compatibility Matrix:**

| Backend | Compatibility |
|---------|--------------|
| PyVISA | All Tektronix instruments (all models, all firmware) |
| tm_devices | Modern Tektronix instruments (2010+) |
| TekHSI | Only MSO 4/5/6/7 Series, firmware 1.0.0+, with SFP+ |

> **Warning:** Before using advanced features (TekHSI, specific SCPI commands), verify your instrument model and firmware version support them.

---

## 2. The Engine Room

### 2.1 Driver Deep Dives

---

#### PyVISA Deep Dive: The Industry Standard

**What is PyVISA?**

PyVISA is a Python wrapper around VISA (Virtual Instrument Software Architecture). It provides a uniform API for controlling instruments regardless of connection type (Ethernet, USB, GPIB).

When you connect using `TCPIP::192.168.1.50::INSTR`, PyVISA automatically uses the VXI-11 protocol. The `::INSTR` suffix tells PyVISA to use VXI-11 instead of raw sockets.

**Installation:**
```bash
pip install pyvisa pyvisa-py
```

**Basic Usage:**
```python
import pyvisa

# Create resource manager
rm = pyvisa.ResourceManager()

# Open connection (uses VXI-11 automatically)
scope = rm.open_resource("TCPIP::192.168.1.50::INSTR")
scope.timeout = 5000  # 5 second timeout

# Send commands
scope.write("*RST")  # Reset
scope.write(":CH1:SCAle 0.5")  # Set channel 1 scale

# Query responses
idn = scope.query("*IDN?")  # Identify
print(f"Connected to: {idn}")

# Close connection
scope.close()
```

**Connection Types in PyVISA:**
```python
# VXI-11 (automatic termination)
scope = rm.open_resource("TCPIP::192.168.1.50::INSTR")
scope.write("*IDN?")  # No \n needed

# Raw socket (manual termination required)
scope = rm.open_resource("TCPIP::192.168.1.50::5025::SOCKET")
scope.write_termination = "\n"  # Must set manually!
scope.read_termination = "\n"
scope.write("*IDN?")  # Now works correctly
```

**Pros:**
- Universal compatibility (works with all instruments)
- Industry standard, well-documented
- Large community and examples
- Automatic VXI-11 support

**Cons:**
- Requires SCPI knowledge (string-based commands)
- No auto-completion or type checking
- Error-prone (typos in command strings)

> **Best For:** Generic automation, multi-vendor setups, simple scripts, and when you need maximum compatibility.

---

#### tm_devices Deep Dive: The Modern Way

**What is tm_devices?**

tm_devices is Tektronix's official Python library for controlling Tektronix instruments. It provides object-oriented, context-aware APIs with auto-completion and type safety.

**Installation:**
```bash
pip install tm-devices
```

**Basic Usage:**
```python
from tm_devices import DeviceManager

with DeviceManager() as dm:
    # Connect to scope (auto-detects model)
    scope = dm.add_scope("192.168.1.50")
    
    # Object-oriented API with auto-completion
    scope.reset()  # Instead of scope.write("*RST")
    scope.ch[1].scale = 0.5  # Instead of ":CH1:SCAle 0.5"
    
    # Still supports raw SCPI when needed
    idn = scope.query("*IDN?")
    print(f"Connected to: {idn}")
```

> **Tip — No Driver Hassle:** tm_devices works immediately after `pip install`. No need to download VISA drivers unless you want extra features. Falls back to PyVISA-py automatically.

**Supported Instruments:**

| Category | Series/Models | Status |
|----------|--------------|--------|
| Oscilloscopes | 1–7 Series MSO/DPO, 6 Series B MSO, 6 Series LPD | ✅ Full Support |
| Oscilloscopes | 7 Series DPO ⭐ NEW | ✅ Full Support |
| Oscilloscopes | MSO2000/B, DPO2000/B, MDO3000, MDO4000, MSO4000, DPO4000, MSO5000, DPO5000 | ✅ Full Support |
| Oscilloscopes | DPO7000/C, DPO70000, DSA70000, MSO70000 | ✅ Full Support |
| AFGs | AFG3000, AFG31xxx | ✅ Full Support |
| AWGs | AWG5000, AWG5200, AWG7000, AWG70000 | ✅ Full Support |
| Power Supplies | 2200, 2220, 2230, 2231, 2280S, 2281S | ✅ Full Support |
| SMUs | 24xx, 26xxB, 2636B, 2651A, 2657A | ✅ Full Support |
| DMMs | DMM6500, DMM7510, DMM7512 | ✅ Full Support |
| DAQ | DAQ6510 | ✅ Full Support |
| Switch Systems | 3706A | ✅ Full Support |
| Modular Power | MP5000 Series ⭐ NEW | ✅ Full Support |

**Pros:**
- Object-oriented, Pythonic API
- Auto-completion in IDEs
- Type checking and validation
- Context-aware (automatic cleanup)
- Device-specific command exposure
- Works without external dependencies

**Cons:**
- Tektronix-only (not for other vendors)
- Steeper learning curve initially

> **Best For:** Tektronix-only setups, robust production scripts, when you want IDE support and object-oriented code.

---

#### TekHSI Deep Dive: The Speed Demon

**What is TekHSI?**

TekHSI (Tektronix High-Speed Interface) is a protocol buffer/gRPC-based data tunnel designed for ultra-fast waveform acquisition. It can be 10x faster than traditional SCPI for large data transfers.

**Speed Comparison (10M point waveform):**
- PyVISA (SCPI): ~2–5 MB/s
- tm_devices: ~3–6 MB/s
- TekHSI: ~20–50 MB/s (10x faster!)

**Constraints:**
- Only works on Windows and Linux (not macOS)
- Requires specific scope firmware (MSO 4/5/6/7 Series, firmware 1.0.0+)
- Requires SFP+ port on scope (for 10 Gbps connection)

```python
from tekhsi import TekHSIConnect

with TekHSIConnect("192.168.1.50") as hsi:
    # Ultra-fast waveform acquisition
    waveform = hsi.acquire_waveform(channel=1, points=10000000)
    # 10M points in seconds, not minutes!
```

> **Warning:** TekHSI is optimized for data transfer, not control. Use it for waveform acquisition, but use PyVISA or tm_devices for setting knobs and configurations.

---

### 2.2 Comparison Guides

---

#### Choosing the Right Engine: PyVISA vs. tm_devices vs. TekHSI

**Decision Tree:**
1. Are you only using Tektronix instruments?
   - Yes → Consider tm_devices
   - No → Use PyVISA
2. Do you need maximum waveform transfer speed?
   - Yes → Use TekHSI (if scope supports it) or Hybrid Mode
   - No → PyVISA or tm_devices is fine
3. Do you want IDE auto-completion and type safety?
   - Yes → Use tm_devices
   - No → PyVISA is simpler

**Comparison Table:**

| Feature | PyVISA | tm_devices | TekHSI |
|---------|--------|------------|--------|
| Compatibility | All vendors | Tektronix only | MSO 4/5/6/7 only |
| Speed | Standard | Standard | 10x faster |
| Auto-completion | No | Yes | No |
| Type Safety | No | Yes | No |
| Learning Curve | Medium | Easy | Easy |
| Best For | Generic automation | Production scripts | High-speed data |

**FAQs:**

*Which backend is fastest?*  
TekHSI is fastest for data transfer (10x faster), but PyVISA and tm_devices are similar for control operations.

*Can I switch backends later?*  
Yes! The generated scripts are modular. However, TekHSI requires specific hardware.

> **Tip:** You can use multiple backends together! Use PyVISA for control and TekHSI for data. See "What is Hybrid Mode?" below.

---

#### What is Hybrid Mode?

**Control Plane vs. Data Plane**

Hybrid Mode is the architecture of using different backends for different tasks:
- **Control Plane:** Use PyVISA or tm_devices for setting knobs, configurations, and simple queries
- **Data Plane:** Use TekHSI for high-speed waveform acquisition

```python
# Hybrid Mode Example
import pyvisa
from tekhsi import TekHSIConnect

# Control via PyVISA
rm = pyvisa.ResourceManager()
scope = rm.open_resource("TCPIP::192.168.1.50::INSTR")
scope.write(":CH1:SCAle 0.5")  # Set scale
scope.write(":TRIGger:TYPe EDGE")  # Set trigger

# Data via TekHSI
with TekHSIConnect("192.168.1.50") as hsi:
    waveform = hsi.acquire_waveform(channel=1, points=10000000)
    # Fast acquisition!

scope.close()
```

> **Info:** This separation is common in networking (control plane vs. data plane) and works great for instrument automation too.

---

## 3. Measurements & Commands

### 3.1 Query vs. Write

---

#### The "Query" vs. "Write" Concept

**The Synchronization Problem**

SCPI commands come in two flavors:
- **Write:** Send a command (no response expected)
- **Query:** Send a command and wait for a response

**The Problem — Race Condition:**
```python
# WRONG - Race condition
scope.write(":ACQuire:MODe AVErage")  # Start averaging
scope.write(":ACQuire:NUMAVg 100")  # Set to 100 averages
data = scope.query(":WAVeform:DATA?")  # Try to read immediately
# Error! Acquisition not finished yet!
```

**The Solution: `*OPC?`**

`*OPC?` (Operation Complete Query) waits until the previous command finishes before returning.

```python
# CORRECT - Wait for completion
scope.write(":ACQuire:MODe AVErage")
scope.write(":ACQuire:NUMAVg 100")
scope.query("*OPC?")  # Wait for averaging to complete
data = scope.query(":WAVeform:DATA?")  # Now it's ready!
```

> **Warning:** Use `*OPC?` after any command that takes time: acquisitions, file operations, complex measurements.

---

#### Command Queues: Why Sending Too Fast Causes Errors

Instruments have a command queue. They process commands one at a time. If you send commands faster than the instrument can process them, commands get dropped or cause errors.

```python
# WRONG - Sending commands too fast
for i in range(100):
    scope.write(f":CH1:OFFSet {i * 0.01}")  # 100 commands instantly!

# CORRECT - Rate limiting
for i in range(100):
    scope.write(f":CH1:OFFSet {i * 0.01}")
    scope.query("*OPC?")  # Wait for each command
```

> **Tip:** For simple settings, 10–50ms delay is usually enough. For acquisitions or measurements, use `*OPC?` to wait for actual completion.

---

#### Setting vs. Querying: Why `HOR:SCA 40e-6` Sets It, But `HOR:SCA?` Reads It

In SCPI, the same command can both set and query values:

```python
# Setting a value (write)
scope.write(":HORizontal:SCAle 40e-6")  # Set timebase to 40 microseconds

# Querying a value (read)
scale = scope.query(":HORizontal:SCAle?")  # Read current timebase
print(scale)  # Returns "4.00000E-05"
```

**The Pattern:**
- Command without `?` = Write (set a value)
- Command with `?` = Query (read a value)

> **Tip — Trust But Verify:** After setting a value, query it back to confirm it was applied correctly.

---

#### Common SCPI Patterns: Reusable Command Patterns and Templates

**1. Setup Pattern (Reset and Configure)**
```python
def setup_scope(scope, channel=1, scale=0.5, offset=0, coupling="DC"):
    scope.write("*RST")
    scope.query("*OPC?")
    scope.write(f":CH{channel}:SCAle {scale}")
    scope.write(f":CH{channel}:OFFSet {offset}")
    scope.write(f":CH{channel}:COUPling {coupling}")
    scope.write(f":SELect:CH{channel} ON")
    actual_scale = float(scope.query(f":CH{channel}:SCAle?"))
    return actual_scale
```

**2. Acquisition Pattern**
```python
def acquire_single(scope, channel=1, num_avg=1):
    scope.write(f":DATa:SOUrce CH{channel}")
    if num_avg > 1:
        scope.write(":ACQuire:MODe AVErage")
        scope.write(f":ACQuire:NUMAVg {num_avg}")
    else:
        scope.write(":ACQuire:MODe SAMPLE")
    scope.write(":ACQuire:STOPAfter SEQUence")
    scope.write(":ACQuire:STATE RUN")
    scope.query("*OPC?")
    scope.write(":WAVeform:FORMat RIBinary")
    scope.write(":WAVeform:DATA?")
    return scope.read_raw()
```

**3. Measurement Pattern**
```python
def get_measurement(scope, measurement_type, source="CH1"):
    scope.write(f":MEASure:{measurement_type} {source}")
    scope.query("*OPC?")
    return float(scope.query(f":MEASure:{measurement_type}? {source}"))

# Usage
freq = get_measurement(scope, "FREQuency", "CH1")
amplitude = get_measurement(scope, "VOLTage:AMPLitude", "CH1")
```

**4. Trigger Setup Pattern**
```python
def setup_trigger(scope, trigger_type="EDGE", source="CH1", level=0.0, slope="RISing"):
    scope.write(f":TRIGger:TYPe {trigger_type}")
    scope.write(f":TRIGger:{trigger_type}:SOUrce {source}")
    scope.write(f":TRIGger:{trigger_type}:LEVel {level}")
    if trigger_type == "EDGE":
        scope.write(f":TRIGger:EDGE:SLOpe {slope}")
    return float(scope.query(f":TRIGger:{trigger_type}:LEVel?"))
```

**5. Screenshot Pattern**
```python
def save_screenshot(scope, filename, inksaver=True):
    if inksaver:
        scope.write("SAVe:IMAGe:INKSaver ON")
    scope.write("SAVe:IMAGe:FILEFormat PNG")
    scope.write(f"SAVe:IMAGe 'C:\\{filename}'")
    scope.query("*OPC?")
```

**6. Multi-Channel Setup**
```python
def setup_multi_channel(scope, channels_config):
    # channels_config = {1: {"scale": 0.5, "offset": 0}, 2: {"scale": 1.0, "offset": 0.1}}
    for ch, config in channels_config.items():
        scope.write(f":CH{ch}:SCAle {config['scale']}")
        scope.write(f":CH{ch}:OFFSet {config['offset']}")
        scope.write(f":SELect:CH{ch} ON")
    scope.query("*OPC?")
```

> **Tip:** Save these patterns in a reusable Python module (e.g., `tek_scpi_patterns.py`) so you can import them in all your automation scripts.

---

#### PI Command Translator: Migrating Legacy Commands to Modern Oscilloscopes

**What is the PI Command Translator?**

The Programming Interface (PI) Command Translator is a built-in feature in modern Tektronix oscilloscopes (firmware v1.30+) that automatically translates legacy SCPI commands from older oscilloscope models into commands compatible with newer platforms.

This is essential when migrating automation scripts from older scopes (DPO7000, MSO/DPO5000) to newer models (2/4/5/6 Series MSO).

> **Info — Supported Instruments:** 2 Series MSO, 4 Series MSO, 5 Series MSO, 5 Series B MSO, 6 Series MSO, 6 Series B MSO, MSO58LP, LPD64 with firmware v1.30+.

**Enabling the PI Translator:**

Method 1 — Front Panel:
1. Navigate to Utility menu at the top of the scope application
2. Select User Preferences → Other
3. Toggle "Programmatic Interface Backward Compatibility" to On

Method 2 — SCPI:
```python
scope.write("COMPatibility:ENABLE 1")
```

**Compatibility File Location:**
- Embedded Linux: `C:/PICompatibility/Compatibility.xml`
- Windows-Based Scopes: `C:\Users\Public\Tektronix\TekScope\PICompatibility\Compatibility.xml`

> **Warning:** Always copy the original `Compatibility.xml` before making modifications.

**Translation Types:**

*One-to-One Translation:*
```xml
<keyword name="MATH">
  <keyword name="DEFine" leaf="1" command="1" query="1">
    <translation header=":math:math:define"/>
  </keyword>
</keyword>
```

*One-to-Many Translation:*
```xml
<!-- Legacy: MATH<x>:NUMAVg sets averages and implicitly enables averaging -->
<!-- Modern: Requires explicit enable command -->
<keyword name="MATH">
  <keyword name="NUMAVg" leaf="1" command="1" query="1">
    <translation header=":math:math:avg:weight" reuseSuffix="1"/>
    <translation header=":math:math:avg:mode" argument="1" query="0"/>
  </keyword>
</keyword>
```

*Argument-Dependent Translation:*
```xml
<!-- Legacy: CH<x>:PRObe:INPUTMode {DEFault|DIFFerential|COMmonmode|A|B} -->
<!-- Modern: CH<x>:PRObe:INPUTMode {A|B|C|D} -->
```

**Best Practices:**
1. Test thoroughly — verify translated commands produce expected results
2. Document custom translations
3. Use version control for `Compatibility.xml`
4. Use the translator as a bridge while updating scripts to modern commands

> **Warning:** While the PI Translator is excellent for migration, consider updating scripts to use modern commands directly for better long-term maintainability.

> Source: Tektronix Technical Brief — ["Introduction to the Programming Interface Command Translator on Oscilloscopes"](https://www.tek.com/en/documents/technical-brief/pi-command-translator-on-oscilloscopes-tech-brief)

---

### 3.2 Waveform Acquisition

---

#### Why Use Binary Waveform Transfer?

**ASCII vs. Binary (RIBinary)**

**ASCII (The Slow Way):**
```python
scope.write(":WAVeform:FORMat ASCii")
data = scope.query(":WAVeform:DATA?")
# Returns: "-1.23,0.45,1.67,..." (text string)
```

Problems: 10–100x slower, truncates precision, large file sizes.

**Binary (RIBinary) — The Right Way:**
```python
scope.write(":WAVeform:FORMat RIBinary")
scope.write(":WAVeform:DATA?")
raw_data = scope.read_raw()  # Read raw bytes
```

Advantages: 10–100x faster, exact precision, smaller data size.

> **Warning:** For any serious automation, always use `RIBinary` format. ASCII is only useful for debugging.

---

#### Endianness: Big Endian vs. Little Endian

Tektronix instruments use **Big Endian** by default for binary data transfers.

```python
import struct

# Reading RIBinary data (Big Endian)
raw_data = scope.read_raw()
# Parse as Big Endian floats
waveform = struct.unpack(">f" * num_points, binary_data)  # ">" = Big Endian
```

> **Info:** Big Endian is the network standard (RFC 1700). Since instruments communicate over networks, Big Endian ensures compatibility across different systems.

---

#### Record Length vs. Transfer Time: The Math of 10M Points

**Formula:**  
`Time (seconds) = (Points × Bytes per Point) / Transfer Speed`

**Real-World Examples:**

| Points | Size | PyVISA | TekHSI |
|--------|------|--------|--------|
| 1M points | 4 MB | ~1–2 seconds | ~0.1–0.2 seconds |
| 10M points | 40 MB | ~8–16 seconds | ~0.8–1.6 seconds |
| 100M points | 400 MB | ~80–160 seconds | ~8–16 seconds |

> **Tip:** Only acquire as many points as you need. 1M points is usually enough for most measurements.

---

#### Chunk Sizes: Why Reading 100MB in One Go Crashes Python

```python
# WRONG - Reading everything at once
raw_data = scope.read_raw()  # 100MB? Crash!

# CORRECT - Chunked reading
chunk_size = 1024 * 1024  # 1MB chunks
all_data = b""
while True:
    chunk = scope.read_bytes(chunk_size)
    if not chunk:
        break
    all_data += chunk
```

> **Tip:** 1–4 MB chunks are usually optimal. Too small (64KB) adds overhead. Too large (10MB+) risks memory issues.

---

#### Waveform Save Formats: BIN vs CSV vs WFM vs MAT

**Format Comparison:**

| Format | Transport | Uses CURVE? | Metadata | Recallable on Scope |
|--------|-----------|-------------|----------|---------------------|
| BIN | PC pulls data | ✓ | None | No |
| CSV | PC pulls data | ✓ | Partial (scaled) | No |
| WFM | Scope writes file | ✗ | Full | Yes |
| MAT | Scope writes file | ✗ | Full | MATLAB only |

> **Critical Rule:** BIN and CSV use `CURVE?` — data is pulled to the PC. WFM and MAT use `SAVE:WAVEFORM` — the scope writes the file. **Never mix these!**

**Decision Flowchart:**
1. Need to recall waveform on scope later? → **WFM**
2. Analysis workflow in MATLAB? → **MAT**
3. Fastest possible transfer? → **BIN**
4. Human-readable data for Excel/sharing? → **CSV**
5. Full metadata, process in Python? → **WFM or MAT + scipy**

**SCPI Commands:**

```python
# BIN/CSV (PC Transfer)
scope.write("DATA:SOURCE CH1")
scope.write("DATA:ENCdg RIBinary")  # or ASCII for CSV
scope.write("DATA:WIDTH 1")
scope.write("DATA:START 1")
scope.write("DATA:STOP 10000")

# Query scaling parameters
x_incr = float(scope.query("WFMOUTPRE:XINCR?"))
y_mult = float(scope.query("WFMOUTPRE:YMULT?"))

# Transfer data to PC
raw_data = scope.query_binary_values("CURVE?", ...)
```

```python
# WFM/MAT (Scope Native)
# NO DATA:*, NO CURVE? — just one command!
scope.write('SAVE:WAVEFORM CH1,"C:/TekScope/data/capture.wfm"')
scope.query("*OPC?")  # Wait for save to complete

# Download from scope to PC
scope.write('FILESYSTEM:READFILE "C:/TekScope/data/capture.wfm"')
data = scope.read_raw()
with open("capture.wfm", "wb") as f:
    f.write(data)
```

**Optimized Binary Transfer:**
```python
def read_waveform_binary(instr, source='CH1', start=1, stop=None, width=1, timeout_ms=30000):
    """Fast binary waveform transfer with auto record-length detection."""
    original_timeout = instr.timeout
    instr.timeout = timeout_ms
    try:
        instr.write(f'DATA:SOURCE {source}')
        instr.write(f'DATA:ENCdg RIBinary')
        instr.write(f'WFMOutpre:BYT_Nr {width}')
        instr.write(f'DATA:START {start}')
        
        if stop is None:
            rec_len = int(instr.query('HORizontal:RECOrdlength?').strip())
            instr.write(f'DATA:STOP {rec_len}')
        else:
            instr.write(f'DATA:STOP {stop}')
        
        preamble = {
            'x_incr': float(instr.query('WFMOutpre:XINcr?').strip()),
            'x_zero': float(instr.query('WFMOutpre:XZEro?').strip()),
            'y_mult': float(instr.query('WFMOutpre:YMUlt?').strip()),
            'y_off': float(instr.query('WFMOutpre:YOFf?').strip()),
            'y_zero': float(instr.query('WFMOutpre:YZEro?').strip()),
            'num_points': int(instr.query('WFMOutpre:NR_Pt?').strip()),
        }
        
        data = instr.query_binary_values('CURVE?', datatype='b' if width == 1 else 'h',
                                          container=bytes, is_big_endian=True)
        return preamble, data
    finally:
        instr.timeout = original_timeout
```

---

#### Memory Management: Handling Large Datasets Without Crashing

**1. Chunked Reading**
```python
chunk_size = 2 * 1024 * 1024  # 2MB chunks
all_data = b""
while True:
    chunk = scope.read_bytes(chunk_size)
    if not chunk:
        break
    all_data += chunk
```

**2. Use Generators for Large Datasets**
```python
def read_waveform_generator(scope, chunk_size=1024*1024):
    """Generator that yields chunks instead of loading all at once"""
    while True:
        chunk = scope.read_bytes(chunk_size)
        if not chunk:
            break
        yield parse_binary_data(chunk)

# Use generator (memory efficient)
for chunk in read_waveform_generator(scope):
    process(chunk)
```

**3. NumPy Memory-Mapped Files**
```python
import numpy as np

# Create memory-mapped array (doesn't load all into RAM)
num_points = 100000000  # 100M points
waveform = np.memmap("waveform.dat", dtype=np.float32, mode="w+", shape=(num_points,))

# Write data in chunks
chunk_size = 1000000  # 1M points at a time
for i in range(0, num_points, chunk_size):
    chunk = scope.read_bytes(chunk_size * 4)
    waveform[i:i+chunk_size] = np.frombuffer(chunk, dtype=">f4")  # Big endian float32
```

> **Warning:** Python on 32-bit systems is limited to ~2GB RAM. Be careful with 100M+ point datasets.

---

### 3.3 Screenshots & Files

---

#### Pro-Tip: Always Use InkSaver

`SAVe:IMAGe:INKSaver ON` inverts the screen colors (white background instead of black). This saves printer toner and looks better in Word documents.

```python
# Enable InkSaver before saving image
scope.write("SAVe:IMAGe:INKSaver ON")
scope.write("SAVe:IMAGe:FILEFormat PNG")
scope.write("SAVe:IMAGe 'C:\\screenshot.png'")
```

> **Tip:** Make InkSaver part of your standard screenshot workflow. It's a simple command that makes a big difference in document quality.

---

#### Drive Mapping: Windows vs. Linux Scopes

**Windows-Based Scopes (MSO 4/5/6/7, DPO7000):**
```python
# Windows path
scope.write("SAVe:IMAGe 'C:\\screenshot.png'")
scope.write("SAVe:WAVeform 'D:\\data.wfm'")
# Note: Double backslashes in Python strings!
```

**Linux-Based Scopes (Older models):**
```python
# Linux path
scope.write("SAVe:IMAGe '/usb0/screenshot.png'")
scope.write("SAVe:WAVeform '/local/data.wfm'")
```

> **Warning:** MSO 4/5/6/7 and DPO7000 use Windows. Older DPO/MSO models may use Linux.

---

#### Hardcopy vs. Filesystem: Two Ways to Get an Image

**Method 1: Hardcopy (Stream Bytes)**
```python
# Hardcopy method
scope.write("HARDCopy:FORMat PNG")
scope.write("HARDCopy:LAYout PORTrait")
image_data = scope.query("HARDCopy:DATA?")  # Returns image bytes

# Save to file on PC
with open("screenshot.png", "wb") as f:
    f.write(image_data)
```

**Method 2: Filesystem (Save Then Download)**
```python
# Filesystem method
scope.write("SAVe:IMAGe:INKSaver ON")
scope.write("SAVe:IMAGe 'C:\\screenshot.png'")
# Then download via file transfer protocol
```

> **Tip:** Hardcopy is simpler and faster for one-off screenshots. Filesystem is better if you need to save multiple images or keep them on the scope.

---

## 4. Scripting & Workflow

### 4.1 From UI to Code

---

#### The Generated Script Structure

When you build a workflow in TekAutomate and generate Python code, the output follows a standard structure:

**1. Imports**
```python
import pyvisa
import argparse
# Or: from tm_devices import DeviceManager
```

**2. Setup (Connection)**
```python
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--visa", default="TCPIP::192.168.1.50::INSTR")
    args = p.parse_args()
    
    rm = pyvisa.ResourceManager()
    scope = rm.open_resource(args.visa)
    scope.timeout = 5000
```

**3. Action Loop (Your Workflow)**
```python
    # Your steps from the UI
    scope.write("*RST")
    scope.write(":CH1:SCAle 0.5")
    scope.write(":ACQuire:STOPAfter SEQUence")
    scope.write(":ACQuire:STATE RUN")
    scope.query("*OPC?")
    data = scope.query(":WAVeform:DATA?")
```

**4. Teardown (Cleanup)**
```python
    scope.close()
    rm.close()

if __name__ == "__main__":
    main()
```

> **Info:** Each section is clearly separated, making it easy to modify, add error handling, or wrap in loops.

---

#### How to Run the Generated Script

**Step 1: Install Python**  
Download Python 3.8+ from python.org. Check "Add Python to PATH" during installation.

**Step 2: Install Dependencies**
```bash
# Create a virtual environment (recommended)
python -m venv venv

# Activate it
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# Install required packages
pip install pyvisa pyvisa-py
# Or for tm_devices:
pip install tm-devices
```

**Step 3: Run the Script**
```bash
python tek_automation.py --visa "TCPIP::192.168.1.50::INSTR"
```

> **Tip:** Always use a virtual environment (`venv`) to avoid conflicts with other Python projects.

---

#### AI Builder: Generate Blockly Workflows with ChatGPT

**What is AI Builder?**

AI Builder is a zero-API integration that connects TekAutomate's Blockly editor to a specialized ChatGPT assistant. It helps you generate complete test workflows by describing what you want in plain English.

> **Tip — No API Keys Required:** AI Builder uses your own ChatGPT account. TekAutomate never stores, transmits, or processes your prompts through any backend.

**How It Works (5-step workflow):**
1. Click "AI Builder" in the Blockly toolbar
2. Describe your test workflow in plain English
3. Click "Generate" — a context-rich prompt is copied to your clipboard
4. TekAutomate GPT XML Builder opens — paste the prompt
5. Copy the XML output and click "Paste XML" in Blockly

**What Gets Sent to ChatGPT?**
- Your current Blockly workspace XML
- Configured instruments (names, models, IP addresses)
- Variables already in use
- Your workflow description

**Privacy & Security:**

| Concern | How AI Builder Addresses It |
|---------|----------------------------|
| API Keys | None required |
| Data Storage | Nothing stored — prompt copied to clipboard only |
| Backend Processing | None — everything is client-side JavaScript |
| Network Requests | Only opens chatgpt.com in new tab |

**Example Prompts:**

```
Connect to scope at 192.168.1.100, enable CH1, set 1V scale, 
capture single acquisition, save waveform as capture.wfm, disconnect
```

```
Connect to SMU at 192.168.1.15 and scope at 192.168.1.10.
Sweep SMU voltage from 0 to 5V in 0.5V steps.
At each step, measure CH1 amplitude and log to CSV.
```

**Tips for Better Results:**
- Be specific about IP addresses and instrument types
- Mention the format you want (CSV, WFM, BIN)
- For complex workflows, break into smaller requests
- Always review the generated XML before running

> **Warning:** AI-generated code should be reviewed before execution.

---

### 4.2 Advanced Patterns

---

#### Error Handling: Catching VISA Timeouts

```python
import pyvisa
from pyvisa import VisaIOError

try:
    rm = pyvisa.ResourceManager()
    scope = rm.open_resource("TCPIP::192.168.1.50::INSTR")
    scope.write("*IDN?")
    idn = scope.read()
    print(f"Connected: {idn}")
except VisaIOError as e:
    print(f"VISA Error: {e}")
except Exception as e:
    print(f"Unexpected error: {e}")
finally:
    if "scope" in locals():
        scope.close()
```

**Common VISA Errors:**
- `VisaIOError` — General I/O error (timeout, connection lost)
- `VI_ERROR_TMO` — Timeout (command took too long)
- `VI_ERROR_RSRC_NFOUND` — Resource not found (wrong IP, not connected)
- `VI_ERROR_CONN_LOST` — Connection lost (cable unplugged, scope powered off)

> **Warning:** Never assume a VISA operation will succeed. Always wrap connection and command operations in `try/except` blocks.

---

#### Looping/Automation: Capturing 100 Times

```python
import pyvisa
import time

rm = pyvisa.ResourceManager()
scope = rm.open_resource("TCPIP::192.168.1.50::INSTR")

# Capture 100 times
for i in range(100):
    print(f"Capture {i+1}/100")
    
    scope.write("*RST")
    scope.write(":ACQuire:STATE RUN")
    scope.query("*OPC?")
    
    # Save data with unique filename
    data = scope.query(":WAVeform:DATA?")
    with open(f"capture_{i:03d}.csv", "w") as f:
        f.write(data)
    
    time.sleep(0.1)

scope.close()
```

> **Tip:** Use formatted numbers (`i:03d`) to create sequential filenames: `capture_000.csv`, `capture_001.csv`, etc.

---

#### Data Logging: Saving Results to CSV

```python
import csv
import datetime

with open("measurements.csv", "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["Timestamp", "Voltage", "Frequency", "Amplitude"])
    
    for i in range(100):
        voltage = float(scope.query(":MEASure:VOLTage:AMPLitude? CH1"))
        freq = float(scope.query(":MEASure:FREQuency? CH1"))
        
        timestamp = datetime.datetime.now().isoformat()
        writer.writerow([timestamp, voltage, freq])
        
        time.sleep(1)  # Wait 1 second between measurements
```

---

#### Managing Multiple Tektronix Instruments Simultaneously

**Using DeviceManager (tm_devices):**
```python
from tm_devices import DeviceManager

with DeviceManager() as dm:
    scope1 = dm.add_scope("192.168.1.50", alias="scope1")
    scope2 = dm.add_scope("192.168.1.51", alias="scope2")
    awg = dm.add_awg("192.168.1.52", alias="awg1")
    
    scope1.ch[1].scale = 0.5
    scope2.ch[1].scale = 1.0
    awg.ch[1].amplitude = 2.0
    
    # Synchronize operations
    scope1.write(":ACQuire:STATE RUN")
    scope2.write(":ACQuire:STATE RUN")
    scope1.query("*OPC?")
    scope2.query("*OPC?")
    # All connections closed automatically on exit
```

**Using PyVISA for Multiple Devices:**
```python
import pyvisa

rm = pyvisa.ResourceManager()
scope1 = rm.open_resource("TCPIP::192.168.1.50::INSTR")
scope2 = rm.open_resource("TCPIP::192.168.1.51::INSTR")
awg = rm.open_resource("TCPIP::192.168.1.52::INSTR")

# Cleanup
scope1.close()
scope2.close()
awg.close()
rm.close()
```

> **Tip:** When triggering multiple scopes simultaneously, use `*OPC?` on each device to ensure they're all ready before proceeding.

---

#### Performance Optimization: Best Practices for Fast Data Acquisition

**1. Minimize Record Length**
```python
# Only acquire what you need
scope.write(":HORizontal:RECOrdlength 1000000")  # 1M points
```

**2. Use Binary Format (RIBinary)**
```python
scope.write(":WAVeform:FORMat RIBinary")  # 10-100x faster than ASCII
```

**3. Batch Commands When Possible**
```python
# SLOW - Multiple writes
scope.write(":CH1:SCAle 0.5")
scope.write(":CH1:OFFSet 0")
scope.write(":CH1:COUPling DC")

# FAST - Batched
scope.write(":CH1:SCAle 0.5;:CH1:OFFSet 0;:CH1:COUPling DC")
```

**4. Use Appropriate Timeouts**
```python
scope.timeout = 2000   # 2s for quick operations
scope.timeout = 30000  # 30s for long acquisitions
scope.timeout = 120000 # 2min for very long operations (100M points)
```

> **Tip:** Use Python's `time.time()` to measure how long operations take. Identify bottlenecks and optimize those first.

---

#### Automation Best Practices: Code Organization, Error Recovery, and Logging

**1. Production-Grade Script Structure**
```python
import pyvisa
import logging
from typing import Optional

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('automation.log'),
        logging.StreamHandler()
    ]
)

def connect_to_scope(ip: str, timeout: int = 5000) -> Optional[pyvisa.Resource]:
    try:
        rm = pyvisa.ResourceManager()
        scope = rm.open_resource(f"TCPIP::{ip}::INSTR")
        scope.timeout = timeout
        logging.info(f"Connected to scope at {ip}")
        return scope
    except Exception as e:
        logging.error(f"Failed to connect: {e}")
        return None
```

**2. Retry Logic for Transient Errors**
```python
from time import sleep

def robust_query(scope, command, max_retries=3, delay=0.1):
    for attempt in range(max_retries):
        try:
            return scope.query(command)
        except pyvisa.VisaIOError as e:
            if attempt < max_retries - 1:
                logging.warning(f"Query failed (attempt {attempt+1}/{max_retries}): {e}")
                sleep(delay)
            else:
                raise
```

**3. Configuration Management**
```python
from dataclasses import dataclass
import json

@dataclass
class ScopeConfig:
    ip: str
    timeout: int = 5000
    channel: int = 1
    scale: float = 0.5
    record_length: int = 1000000

with open("config.json") as f:
    config = ScopeConfig(**json.load(f))
```

**4. Resource Cleanup**
```python
# With context manager (recommended)
from tm_devices import DeviceManager

with DeviceManager() as dm:
    scope = dm.add_scope("192.168.1.50")
    # Automatic cleanup on exit

# Or with try/finally
scope = None
try:
    scope = connect_to_scope("192.168.1.50")
    # Your code here
finally:
    if scope:
        scope.close()
```

> **Tip — Code Review Checklist:** Before deploying scripts: 1) Error handling for all operations, 2) Logging for debugging, 3) Resource cleanup, 4) Configuration externalized, 5) Functions are testable.

---

#### Data Visualization: Tips for Processing and Visualizing Acquired Data

**1. Basic Plotting with Matplotlib**
```python
import numpy as np
import matplotlib.pyplot as plt

def plot_waveform(binary_data, x_incr, x_zero, y_incr, y_zero, y_origin):
    waveform = np.frombuffer(waveform_bytes, dtype=">f4")
    voltages = (waveform - y_origin) * y_incr + y_zero
    times = np.arange(len(voltages)) * x_incr + x_zero
    
    plt.figure(figsize=(12, 6))
    plt.plot(times, voltages)
    plt.xlabel("Time (s)")
    plt.ylabel("Voltage (V)")
    plt.title("Oscilloscope Waveform")
    plt.grid(True)
    plt.show()
    
    return times, voltages
```

**2. Time-Domain vs. Frequency-Domain**
```python
def plot_time_and_freq(times, voltages, sample_rate):
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 10))
    
    # Time domain
    ax1.plot(times, voltages)
    ax1.set_title("Time Domain")
    
    # Frequency domain (FFT)
    fft = np.fft.fft(voltages)
    freqs = np.fft.fftfreq(len(voltages), 1/sample_rate)
    positive_freqs = freqs[:len(freqs)//2]
    positive_magnitude = np.abs(fft[:len(fft)//2])
    
    ax2.plot(positive_freqs, positive_magnitude)
    ax2.set_title("Frequency Domain (FFT)")
    ax2.set_xlim(0, sample_rate/2)
    
    plt.tight_layout()
    plt.show()
```

**3. Export to Common Formats**
```python
import pandas as pd

# CSV (universal)
df = pd.DataFrame({"time": times, "voltage": voltages})
df.to_csv("waveform.csv")

# HDF5 (MATLAB, Python, LabVIEW)
import h5py
with h5py.File("waveform.h5", "w") as f:
    f.create_dataset("time", data=times)
    f.create_dataset("voltage", data=voltages)

# MATLAB .mat format
from scipy.io import savemat
savemat("waveform.mat", {"time": times, "voltage": voltages})
```

---

#### External Integration: LabVIEW, MATLAB, and Other Automation Tools

**MATLAB Integration:**
```matlab
% MATLAB code to control Tektronix scope
scope = visadev("TCPIP::192.168.1.50::INSTR");
writeline(scope, "*RST");
writeline(scope, ":CH1:SCAle 0.5");
idn = readline(scope);
clear scope
```

**Python as REST API Middleware:**
```python
from flask import Flask, request, jsonify
import pyvisa

app = Flask(__name__)

@app.route("/scope/<ip>/command", methods=["POST"])
def execute_command(ip):
    command = request.json.get("command")
    rm = pyvisa.ResourceManager()
    scope = rm.open_resource(f"TCPIP::{ip}::INSTR")
    try:
        if "?" in command:
            result = scope.query(command)
        else:
            scope.write(command)
            result = "OK"
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        scope.close()
```

> **Tip:** Use Python for flexibility and rapid development. Use LabVIEW/MATLAB when you need their specific analysis capabilities. Use TestStand for test sequencing and reporting.

---

## 5. Troubleshooting

### 5.1 Connection Errors

---

#### VI_ERROR_RSRC_NFOUND: Resource Not Found

The instrument couldn't be found at the specified address.

**Troubleshooting Checklist:**

1. **Check IP Address**
   - Verify on the scope's front panel
   - Use LXI web interface to confirm scope is alive

2. **Check Cable**
   - Is the Ethernet cable connected?
   - Try a different cable

3. **Check Network**
   - Are PC and scope on the same network?
   - Can you ping the scope? (`ping 192.168.1.50`)
   - Is a firewall blocking the connection?

4. **Check for Typos**
```python
# Common mistakes:
"TCPIP::192.168.1.50::INSTR"  # Correct
"TCPIP::192.168.1.50::INSTR " # Extra space - WRONG
"TCPIP::192.168.1.50::INST"   # Typo - WRONG
```

---

#### VI_ERROR_TMO: Timeout Error

The instrument didn't respond within the timeout period.

**Common Causes:**

1. **Missing Termination Character (`\n`)**  
   With raw sockets, you must add `\n` to every command.

2. **Trigger Not Stopped**  
   If scope is waiting for a trigger, queries may timeout.

3. **Acquisition Too Long**  
   Very long acquisitions (100M points) take minutes. Increase timeout or reduce record length.

4. **Instrument Busy**  
   Use `*OPC?` to wait for completion.

```python
# Increase timeout for long operations
scope.timeout = 30000  # 30 seconds

# Or wait for completion
scope.write(":ACQuire:STATE RUN")
scope.query("*OPC?")  # Wait for acquisition
# Now safe to query data
```

---

#### Connection Refused: Troubleshooting

The instrument is reachable but refusing the connection.

**Possible Causes:**
1. **Another PC Connected** — SCPI connections are often exclusive. Disconnect other sessions.
2. **Scope's Server Feature Turned Off** — Check Utility → I/O → Network → ensure "SCPI Server" or "Remote Control" is enabled.
3. **Wrong Port** — Try port 4000 vs. 5025 vs. 1024, or use VXI-11 (INSTR).
4. **Firewall on Scope** — Windows-based scopes may have Windows Firewall enabled.

> **Warning:** Many instruments only allow one SCPI connection at a time. Close other connections (other scripts, Tektronix software) before connecting.

---

### 5.2 Data Errors

---

#### Query Interrupted: Reading Before Completion

```python
# WRONG - Race condition
scope.write(":ACQuire:STATE RUN")
data = scope.query(":WAVeform:DATA?")  # Too soon!

# CORRECT - Wait for completion
scope.write(":ACQuire:STATE RUN")
scope.query("*OPC?")  # Wait for acquisition
data = scope.query(":WAVeform:DATA?")  # Now it's ready
```

> **Tip:** Always use `*OPC?` after: acquisitions, file operations, complex measurements, or any operation that takes time.

---

#### Truncated Data: Byte Count Mismatch

**Common Causes:**
1. **Timeout Too Short** — Large datasets need longer timeouts
2. **Incomplete Read** — `read()` may not get all data in one call. Use `read_raw()` or chunked reading
3. **Wrong Byte Count in Header** — IEEE-488.2 block format has a header (`#N...`)

```python
def read_all_data(scope, expected_size):
    data = b""
    while len(data) < expected_size:
        chunk = scope.read_bytes(min(1024, expected_size - len(data)))
        if not chunk:
            break
        data += chunk
    return data
```

---

#### Settings Not Applying: Trust But Verify

**The Problem:** You send a command to set a value, but when you query it back, it's different.

**Why This Happens:**
- Command syntax error (instrument ignored it)
- Value out of range (instrument clamped it)
- Instrument in wrong mode (setting not applicable)
- Command not supported on this model

**The Solution:**
```python
# Always verify settings
scope.write(":CH1:SCAle 0.5")
actual_scale = float(scope.query(":CH1:SCAle?"))

if abs(actual_scale - 0.5) > 0.001:
    print(f"Warning: Scale not set correctly. Expected 0.5, got {actual_scale}")
else:
    print("Scale set correctly")
```

> **Warning:** Never assume a write command succeeded. Always query the value back and verify it matches what you intended.

---

### 5.3 Driver Issues

---

#### NI-VISA vs. PyVISA-py: Which Backend to Use?

**NI-VISA (Native Backend)**
- Requires National Instruments VISA drivers
- More features and better performance
- Windows/Linux only (no macOS)
- Better for production environments

```python
import pyvisa
rm = pyvisa.ResourceManager("@ni")  # "@ni" = NI-VISA
```

**PyVISA-py (Pure Python)**
- Pure Python, no drivers needed
- Works on Windows, Linux, and macOS
- Easier installation (just pip install)
- Better for development and cross-platform

```python
import pyvisa
rm = pyvisa.ResourceManager("@py")  # "@py" = PyVISA-py
```

**When to Switch:**
- Switch to PyVISA-py if: you're on macOS, you don't want NI drivers, you're having driver conflicts
- Stick with NI-VISA if: you need maximum performance, you're using GPIB, you're in a production environment

---

#### Driver Conflicts: Multiple VISA Libraries

**The Problem:** Having multiple VISA libraries installed (Keysight IO Libraries, TekVISA, NI-VISA) can cause conflicts.

**Symptoms:**
- Instruments not found even though they're connected
- Resource strings work in one tool but not another
- One VISA library "takes over" and others can't see instruments

**Solutions:**
1. Use PyVISA-py (No Drivers) — Pure Python, avoids driver conflicts
2. Specify backend explicitly:
```python
rm = pyvisa.ResourceManager("@ni")  # Force NI-VISA
rm = pyvisa.ResourceManager("@py")  # Force PyVISA-py
```
3. Uninstall conflicting drivers — Keep only one VISA library if possible

> **Warning:** VISA driver conflicts are a common source of frustration. When in doubt, use PyVISA-py to avoid the problem entirely.

---

## Quick Reference

### Most Common SCPI Commands

| Command | Purpose |
|---------|---------|
| `*IDN?` | Identify instrument |
| `*RST` | Reset to factory defaults |
| `*OPC?` | Wait for operation complete |
| `:CH1:SCAle 0.5` | Set channel 1 scale to 0.5V/div |
| `:CH1:SCAle?` | Query channel 1 scale |
| `:CH1:OFFSet 0` | Set channel 1 offset |
| `:SELect:CH1 ON` | Enable channel 1 |
| `:HORizontal:SCAle 40e-6` | Set timebase to 40µs/div |
| `:HORizontal:RECOrdlength 1000000` | Set record length to 1M points |
| `:TRIGger:TYPe EDGE` | Set edge trigger |
| `:TRIGger:EDGE:LEVel 1.5` | Set trigger level to 1.5V |
| `:ACQuire:MODe SAMPLE` | Set acquisition mode |
| `:ACQuire:STOPAfter SEQUence` | Single acquisition mode |
| `:ACQuire:STATE RUN` | Start acquisition |
| `:WAVeform:FORMat RIBinary` | Set binary transfer format |
| `:WAVeform:DATA?` | Transfer waveform data |
| `SAVe:IMAGe:INKSaver ON` | Enable InkSaver (white background) |
| `SAVe:IMAGe:FILEFormat PNG` | Set screenshot format |

### Resource String Formats

| Connection | Format |
|-----------|--------|
| Ethernet (VXI-11) | `TCPIP::192.168.1.50::INSTR` |
| Ethernet (Raw Socket) | `TCPIP::192.168.1.50::5025::SOCKET` |
| USB | `USB0::0x0699::0x0522::C012345::INSTR` |
| GPIB | `GPIB0::5::INSTR` |

### Backend Cheat Sheet

| Need | Use |
|------|-----|
| Multi-vendor setup | PyVISA |
| Tektronix only, Pythonic API | tm_devices |
| Maximum waveform speed | TekHSI |
| Best of all worlds | Hybrid Mode |
| No drivers, cross-platform | PyVISA-py backend |

---

*Generated from TekAutomate Academy — `src/data/AcademyData.ts`*
