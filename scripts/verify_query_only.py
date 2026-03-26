"""Quick script to verify query-only commands are properly tagged"""
import json
import os

script_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(script_dir)
json_path = os.path.join(parent_dir, "public", "commands", "mso_commands_final.json")

with open(json_path, encoding='utf-8') as f:
    data = json.load(f)

query_only = []
for group_name, group_data in data.get('groups', {}).items():
    for cmd in group_data.get('commands', []):
        desc = cmd.get('description', '').lower()
        manual_entry = cmd.get('_manualEntry', {})
        command_type = manual_entry.get('commandType', '')
        syntax = manual_entry.get('syntax', {})
        
        if 'query-only' in desc and command_type == 'query':
            query_only.append({
                'scpi': cmd.get('scpi'),
                'commandType': command_type,
                'has_set_syntax': 'set' in syntax,
                'has_query_syntax': 'query' in syntax
            })

print(f"Found {len(query_only)} query-only commands with commandType='query'")
print("\nSample query-only commands:")
for cmd in query_only[:10]:
    print(f"  - {cmd['scpi']}")
    print(f"    commandType: {cmd['commandType']}")
    print(f"    has_set_syntax: {cmd['has_set_syntax']}")
    print(f"    has_query_syntax: {cmd['has_query_syntax']}")
    print()





