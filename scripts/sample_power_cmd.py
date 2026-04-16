import json

json_path = "C:/Users/u650455/Desktop/Tek_Automator/Tek_Automator/public/commands/mso_commands_final.json"

with open(json_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

groups = data.get('groups', {})

# Count commands with notes
cmds_with_notes = 0
cmds_with_enum_params = 0
all_cmds = []

for group_name, group_data in groups.items():
    for cmd in group_data.get('commands', []):
        all_cmds.append(cmd)
        if cmd.get('notes') and len(cmd.get('notes', [])) > 0:
            cmds_with_notes += 1
        # Check if any param has options (enum type)
        for param in cmd.get('params', []):
            if param.get('options') and len(param.get('options', [])) > 1:
                cmds_with_enum_params += 1
                break

print(f"\n=== EXTRACTION QUALITY CHECK ===")
print(f"Total commands: {len(all_cmds)}")
print(f"Commands with notes: {cmds_with_notes}")
print(f"Commands with enum params (options): {cmds_with_enum_params}")

# Find commands with enum params
print(f"\n=== COMMANDS WITH ENUM PARAMS ===")
count = 0
for cmd in all_cmds:
    for param in cmd.get('params', []):
        if param.get('options') and len(param.get('options', [])) > 1:
            print(f"\nSCPI: {cmd.get('scpi')}")
            print(f"  Param: {param}")
            count += 1
            if count >= 5:
                break
    if count >= 5:
        break

# Find any command with Notes
print(f"\n=== COMMANDS WITH NOTES ===")
count = 0
for cmd in all_cmds:
    if cmd.get('notes') and len(cmd.get('notes', [])) > 0:
        print(f"\nSCPI: {cmd.get('scpi')}")
        print(f"  Notes: {cmd.get('notes')}")
        count += 1
        if count >= 3:
            break

# Sample Power command with {CH<x>|MATH<x>|REF<x>}
print(f"\n=== POWER COMMAND WITH CH/MATH/REF SYNTAX ===")
power_group = groups.get('Power', {})
for cmd in power_group.get('commands', []):
    syntax = cmd.get('syntax', [])
    for s in syntax:
        if 'CH<x>' in s and 'MATH' in s:
            print(f"\nSCPI: {cmd.get('scpi')}")
            print(f"  Syntax: {syntax}")
            print(f"  Params: {json.dumps(cmd.get('params', []), indent=4)}")
            print(f"  Notes: {cmd.get('notes', [])}")
            # Print manualEntry if it exists
            if cmd.get('_manualEntry'):
                me = cmd.get('_manualEntry', {})
                print(f"  _manualEntry.notes: {me.get('notes', [])}")
                print(f"  _manualEntry.syntax: {me.get('syntax', {})}")
            break
    else:
        continue
    break

# Check what {True|False} or {ON|OFF} params look like
print(f"\n=== COMMAND WITH ON/OFF OR TRUE/FALSE ENUM ===")
for cmd in all_cmds[:500]:
    for param in cmd.get('params', []):
        opts = param.get('options', [])
        if 'ON' in opts and 'OFF' in opts:
            print(f"\nSCPI: {cmd.get('scpi')}")
            print(f"  Param: {param}")
            break
    else:
        continue
    break

