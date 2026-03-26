import json

json_path = "C:/Users/u650455/Desktop/Tek_Automator/Tek_Automator/public/commands/mso_commands_final.json"

with open(json_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Find PLOT:PLOT<x>:RAILNUM
for group_name, group_data in data.get('groups', {}).items():
    for cmd in group_data.get('commands', []):
        if 'RAILNUM' in cmd.get('scpi', ''):
            print(f"\n=== FOUND: {cmd.get('scpi')} ===")
            print(json.dumps(cmd, indent=2, default=str)[:2000])
            break
    else:
        continue
    break
else:
    print("RAILNUM command not found - searching for similar DPM command...")
    for group_name, group_data in data.get('groups', {}).items():
        for cmd in group_data.get('commands', []):
            if 'PLOT:PLOT' in cmd.get('scpi', ''):
                print(f"\n=== FOUND: {cmd.get('scpi')} ===")
                print(json.dumps(cmd, indent=2, default=str)[:2000])
                break
        else:
            continue
        break









