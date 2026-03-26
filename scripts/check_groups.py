import json

json_path = "C:/Users/u650455/Desktop/Tek_Automator/Tek_Automator/public/commands/mso_commands_final.json"

with open(json_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

groups = data.get('groups', {})

print('\nGroups extracted:')
for name, g in sorted(groups.items()):
    cmd_count = len(g.get("commands", []))
    print(f'  {name}: {cmd_count} commands')

total = sum(len(g.get("commands", [])) for g in groups.values())
print(f'\nTotal: {total} commands')
print(f'Expected for Power group only: ~268 commands')

if total > 500:
    print('\n[WARNING] Filter did NOT work - extracted all groups instead of Power only!')
else:
    print('\n[SUCCESS] Filter worked correctly!')










