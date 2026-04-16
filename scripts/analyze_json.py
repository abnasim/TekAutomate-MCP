import json

with open('public/commands/mso_commands.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

cmds = data.get('commands', [])

print(f"Total commands: {len(cmds)}")
print(f"With group: {sum(1 for c in cmds if c.get('group'))}")
print(f"With syntax: {sum(1 for c in cmds if c.get('syntax'))}")
print(f"With description: {sum(1 for c in cmds if c.get('description'))}")
print(f"With examples: {sum(1 for c in cmds if c.get('examples'))}")
print(f"With arguments: {sum(1 for c in cmds if c.get('arguments'))}")
print(f"With relatedCommands: {sum(1 for c in cmds if c.get('relatedCommands'))}")
print(f"With conditions: {sum(1 for c in cmds if c.get('conditions'))}")

# Check for issues
print("\n=== Sample Commands ===")
for i, cmd in enumerate(cmds[:10]):
    print(f"\n{i+1}. {cmd.get('scpi')}")
    print(f"   Group: {cmd.get('group')}")
    print(f"   Has syntax: {bool(cmd.get('syntax'))}")
    print(f"   Has description: {bool(cmd.get('description'))}")
    print(f"   Description preview: {str(cmd.get('description', ''))[:80]}...")










