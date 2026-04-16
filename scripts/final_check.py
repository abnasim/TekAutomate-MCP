import json
with open('public/commands/rsa.json', encoding='utf-8') as f:
    data = json.load(f)
groups = data['groups']

# Final space check
spaces = [(k, cmd['scpi']) for k, g in groups.items() for cmd in g['commands'] if ' ' in cmd['scpi']]
print(f'SCPIs with spaces: {len(spaces)}')
for k, s in spaces:
    print(f'  [{k}] {s}')

# Check PEAK:LEF (should be fixed)
peak_lef = [cmd['scpi'] for g in groups.values() for cmd in g['commands']
            if 'PEAK:LEF' in cmd['scpi'] and 'PEAK:LEFT' not in cmd['scpi']]
print(f'\nStill-truncated PEAK (not PEAK:LEFT): {peak_lef}')

# Testable count
testable = sum(1 for g in groups.values() for cmd in g['commands']
               if cmd['_manualEntry']['commandType'] in ('write', 'both'))
print(f'\nTestable (write or both): {testable}')

meta = data['metadata']
print(f'Total commands: {meta["totalCommands"]}')
print(f'Total groups: {meta["totalGroups"]}')
