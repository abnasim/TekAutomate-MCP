import json

with open('public/commands/MSO_DPO_5k_7k_70K.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

for group in data['groups'].values():
    for cmd in group['commands']:
        if cmd['scpi'] == 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:CONDition':
            print(f"Command: {cmd['scpi']}")
            print(f"Arguments: {cmd['arguments']}")
            print(f"Examples: {[ex['scpi'] for ex in cmd['examples']]}")
            break
