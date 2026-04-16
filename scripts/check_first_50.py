"""
Check first 50 commands - simple quality check
"""
import json

json_path = "C:/Users/u650455/Desktop/Tek_Automator/Tek_Automator/public/commands/mso_commands_final.json"

with open(json_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Flatten all commands
all_cmds = []
for group_name, group_data in data.get('groups', {}).items():
    for cmd in group_data.get('commands', []):
        cmd['_group'] = group_name
        all_cmds.append(cmd)

print(f"Total commands: {len(all_cmds)}")
print(f"\n{'='*80}")
print("FIRST 50 COMMANDS - QUALITY CHECK")
print(f"{'='*80}\n")

for i, cmd in enumerate(all_cmds[:50]):
    scpi = cmd.get('scpi', 'N/A')
    desc = cmd.get('description', '')
    params = cmd.get('params', [])
    notes = cmd.get('notes', [])
    syntax = cmd.get('syntax', [])
    arguments = cmd.get('arguments', '')
    example = cmd.get('example', '')
    group = cmd.get('_group', '')
    
    print(f"\n--- [{i+1}] {scpi} ---")
    print(f"  Group: {group}")
    print(f"  Description: {desc[:80] if desc else 'MISSING'}{'...' if desc and len(desc) > 80 else ''}")
    print(f"  Syntax: {syntax if syntax else 'MISSING'}")
    print(f"  Params: {len(params)} params")
    for p in params:
        pname = p.get('name', '?')
        ptype = p.get('type', '?')
        opts = p.get('options', [])
        if opts:
            print(f"    - {pname}: {ptype} -> options: {opts[:5]}{'...' if len(opts) > 5 else ''}")
        else:
            pmin = p.get('min')
            pmax = p.get('max')
            if pmin is not None or pmax is not None:
                print(f"    - {pname}: {ptype} (min={pmin}, max={pmax})")
            else:
                print(f"    - {pname}: {ptype}")
    print(f"  Notes: {len(notes)} notes")
    for n in notes[:2]:
        print(f"    - {n[:60]}...")
    print(f"  Arguments: {'YES' if arguments else 'NO'}")
    print(f"  Example: {'YES' if example else 'NO'}")

# Summary
print(f"\n{'='*80}")
print("SUMMARY OF FIRST 50")
print(f"{'='*80}")

with_desc = sum(1 for c in all_cmds[:50] if c.get('description'))
with_syntax = sum(1 for c in all_cmds[:50] if c.get('syntax'))
with_params = sum(1 for c in all_cmds[:50] if c.get('params'))
with_notes = sum(1 for c in all_cmds[:50] if c.get('notes'))
with_args = sum(1 for c in all_cmds[:50] if c.get('arguments'))
with_example = sum(1 for c in all_cmds[:50] if c.get('example'))

print(f"  With description: {with_desc}/50")
print(f"  With syntax: {with_syntax}/50")
print(f"  With params: {with_params}/50")
print(f"  With notes: {with_notes}/50")
print(f"  With arguments: {with_args}/50")
print(f"  With example: {with_example}/50")









