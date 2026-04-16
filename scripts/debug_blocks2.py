"""Debug why examples/related aren't being extracted."""
import sys, re
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SECTION_MARKERS = [
    'Conditions', 'Group', 'Syntax', 'Related Commands',
    'Arguments', 'Returns', 'Examples', 'Notes',
]

# Simulate the ABORt block body
ABORT_BODY = """Resets the trigger system and places all trigger sequences in the idle state. Any actions related to the trigger system that are in progress,
such as a sweep or acquiring a measurement is also aborted.
To start data acquisition, use the INITiate commands.
Conditions
Measurement views: All
Group
Abort commands
Syntax
ABORt
Related Commands
INITiate:CONTinuous, INITiate:RESume
Arguments
None
Examples
ABORt resets the trigger system and stops data acquisition."""

print("=== Testing parse_block on ABORt ===")
sections = {}
current_section = '__description__'
current_lines = []

for line in ABORT_BODY.splitlines():
    stripped = line.strip()
    print(f"  line={repr(stripped)!r:50s}  marker={stripped in SECTION_MARKERS}")
    if stripped in SECTION_MARKERS:
        sections[current_section] = '\n'.join(current_lines).strip()
        current_section = stripped
        current_lines = []
    else:
        current_lines.append(line)
sections[current_section] = '\n'.join(current_lines).strip()

print("\nParsed sections:")
for k, v in sections.items():
    print(f"  [{k}] = {repr(v[:80])}")

# Now check the CAL block which has page break in middle
print("\n\n=== Testing *CAL with page break ===")
CAL_BODY = """Conditions
Measurement views: All
Group
IEEE common commands
Syntax
*CAL
Returns
<NR1>=1 indicates that the alignment was successful.
<NR1>=0 indicates that the alignment was unsuccessful.
SignalVu-PC Vector Analysis Software Programmer Manual 167
Command descriptions
Examples
*CAL performs an internal self-alignment and will return 1 if the alignment is successful."""

sections2 = {}
current_section = '__description__'
current_lines = []
for line in CAL_BODY.splitlines():
    stripped = line.strip()
    if stripped in SECTION_MARKERS:
        sections2[current_section] = '\n'.join(current_lines).strip()
        current_section = stripped
        current_lines = []
    else:
        current_lines.append(line)
sections2[current_section] = '\n'.join(current_lines).strip()

print("Parsed sections:")
for k, v in sections2.items():
    print(f"  [{k}] = {repr(v[:100])}")

print("\nNote: 'Examples' section contains page footer garbage!")
print("Need to strip 'SignalVu-PC...NNN' and 'Command descriptions' lines from body too.")
