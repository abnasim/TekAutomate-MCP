"""Debug exactly why example/relatedCommands aren't being set after enrichment."""
import sys, re, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# Import everything from the enrich script
import importlib.util, types

# Manually replicate the key parts to debug
SECTION_MARKERS = [
    'Conditions', 'Group', 'Syntax', 'Related Commands',
    'Arguments', 'Returns', 'Examples', 'Notes',
]
PAGE_HEADER_RE = re.compile(r'Command descriptions\s*\n?Command descriptions\s*\n?', re.MULTILINE)
CMD_HEADER_RE = re.compile(
    r'^([\[{*A-Z][A-Za-z0-9_:<>{}\[\]|.?*]+)'
    r'(\s*\([^)]*\))?'
    r'\s*$',
    re.MULTILINE
)

# ── Minimal sample of detail text (first 3 commands) ──────────────────────────
SAMPLE = """ABORt (No query form)
Resets the trigger system and places all trigger sequences in the idle state. Any actions related to the trigger system that are in progress,
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
ABORt resets the trigger system and stops data acquisition.
*CAL (Query only)
Conditions
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
*CAL performs an internal self-alignment and will return 1 if the alignment is successful.
CALCulate:[:SEARch|:TEST]:LIMit[:STATe]:MATCh:FILE:LOCation
Sets or queries the destination folder for search match output files.
Conditions
Measurement views: All
Group
Calculate commands
Syntax
CALCulate:[:SEARch|:TEST]:LIMit[:STATe]:MATCh:FILE:LOCation <string>
CALCulate:[:SEARch|:TEST]:LIMit[:STATe]:MATCh:FILE:LOCation?
Arguments
<string> specifies the destination folder.
Returns
<string>
Examples
CALCULATE:[:SEARCH|:TEST]:LIMIT[:STATE]:MATCH:FILE:LOCATION? might return c:\\rsamap files,
indicating the destination folder.
"""

# ── Find all command headers ──────────────────────────────────────────────────
NOT_COMMANDS = {'Command descriptions', 'Conditions', 'Group', 'Syntax',
                'Returns', 'Arguments', 'Examples', 'Related Commands'}

def looks_like_scpi(t):
    t = t.strip()
    if t in NOT_COMMANDS: return False
    if len(t) < 3: return False
    if ':' not in t and not t.startswith('*') and not t.startswith('['):
        root = re.sub(r'\d+$', '', t.rstrip('?')).upper()
        if root not in {'ABORT', 'ABORTING'}: return False
    return True

matches = list(CMD_HEADER_RE.finditer(SAMPLE))
print(f"Found {len(matches)} header matches:")
for m in matches:
    header = m.group(1).strip()
    qualifier = (m.group(2) or '').strip()
    valid = looks_like_scpi(header)
    print(f"  {repr(header):60s} valid={valid}  pos={m.start()}")

# ── Simulate block splitting ──────────────────────────────────────────────────
print("\n\n=== Blocks ===")
valid_matches = [m for m in matches if looks_like_scpi(m.group(1).strip())]
for i, m in enumerate(valid_matches):
    header = m.group(1).strip()
    qualifier = (m.group(2) or '').strip().strip('()')
    start = m.end()
    end = valid_matches[i+1].start() if i+1 < len(valid_matches) else len(SAMPLE)
    body = SAMPLE[start:end].strip()
    
    print(f"\n--- Block: {header!r} ({qualifier}) ---")
    print(f"Body ({len(body)} chars):")
    print(body[:400])
    
    # Parse sections
    sections = {}
    current_section = '__description__'
    current_lines = []
    for line in body.splitlines():
        stripped = line.strip()
        if stripped in SECTION_MARKERS:
            sections[current_section] = '\n'.join(current_lines).strip()
            current_section = stripped
            current_lines = []
        else:
            current_lines.append(line)
    sections[current_section] = '\n'.join(current_lines).strip()
    
    print("Sections found:", list(sections.keys()))
    print("Examples:", repr(sections.get('Examples', 'MISSING')))
    print("Related:", repr(sections.get('Related Commands', 'MISSING')))
