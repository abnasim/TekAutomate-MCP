"""
Analyze root cause of data misalignment in extracted commands
"""
import json

with open('public/commands/mso_commands_final.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

groups = data.get('groups', {})
all_cmds = []
for group_name, group_data in groups.items():
    for cmd in group_data.get('commands', []):
        all_cmds.append(cmd)

# Find *CLS - why does it have CONFIGuration:ANALOg:BANDWidth? in syntax?
print('=== ANALYZING *CLS MISALIGNMENT ===')
for i, cmd in enumerate(all_cmds):
    scpi = cmd.get('scpi')
    if scpi == '*CLS':
        print(f'Index: {i}')
        print(f'SCPI: {scpi}')
        print(f'Syntax: {cmd.get("syntax")}')
        # Check nearby commands
        if i > 0:
            prev = all_cmds[i-1]
            print(f'Previous command: {prev.get("scpi")}')
        if i < len(all_cmds) - 1:
            next_cmd = all_cmds[i+1]
            print(f'Next command: {next_cmd.get("scpi")}')

# Count commands with multiple syntax entries where second one is wrong
print()
print('=== COMMANDS WITH MULTIPLE SYNTAX ENTRIES ===')
multi_syntax = []
for cmd in all_cmds:
    syntax = cmd.get('syntax', [])
    if len(syntax) > 1:
        multi_syntax.append(cmd)

print(f'Commands with 2+ syntax entries: {len(multi_syntax)}')
print()
# Show some examples
for cmd in multi_syntax[:5]:
    print(f'SCPI: {cmd.get("scpi")}')
    for i, syn in enumerate(cmd.get('syntax', [])):
        s = syn[:70] + '...' if len(syn) > 70 else syn
        print(f'  Syntax[{i}]: {s}')
    print()

# Check the misaligned commands - are they star commands?
print('=== STAR COMMANDS WITH SYNTAX ISSUES ===')
star_cmds = [cmd for cmd in all_cmds if cmd.get('scpi', '').startswith('*')]
for cmd in star_cmds:
    syntax = cmd.get('syntax', [])
    scpi = cmd.get('scpi')
    # Check if any syntax doesn't start with *
    for syn in syntax:
        if syn and not syn.startswith('*'):
            print(f'SCPI: {scpi}')
            print(f'  Wrong syntax: {syn[:80]}')
            break

# Check FPAnel:PRESS
print()
print('=== FPAnel:PRESS ANALYSIS ===')
for cmd in all_cmds:
    if cmd.get('scpi') == 'FPAnel:PRESS':
        print(f'SCPI: {cmd.get("scpi")}')
        print(f'Syntax: {cmd.get("syntax")}')
        print(f'Arguments: {cmd.get("arguments", "")[:200] if cmd.get("arguments") else "None"}')
        break

# Check if the issue is with syntax lines containing arguments
print()
print('=== SYNTAX ENTRIES THAT LOOK LIKE ARGUMENTS ===')
count = 0
for cmd in all_cmds:
    syntax = cmd.get('syntax', [])
    for syn in syntax:
        # If syntax contains | but no command prefix, it might be arguments
        if '|' in syn and ':' not in syn.split()[0] if syn.split() else False:
            print(f'SCPI: {cmd.get("scpi")}')
            print(f'  Suspicious syntax: {syn[:80]}')
            count += 1
            if count >= 5:
                break
    if count >= 5:
        break








