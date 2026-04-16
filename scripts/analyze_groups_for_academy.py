"""Analyze command groups for Academy content"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
exec(open('scripts/command_groups_mapping.py').read())

groups_with_desc = [(name, len(g['commands']), len(g['description'])) 
                    for name, g in COMMAND_GROUPS.items()]

print('Groups with longest descriptions (best for Academy articles):')
print('=' * 70)
for name, cmd_count, desc_len in sorted(groups_with_desc, key=lambda x: x[2], reverse=True)[:10]:
    print(f'{name:40s} - {cmd_count:4d} commands, {desc_len:5d} chars')

print('\nTotal description content available for Academy:')
total_chars = sum(desc_len for _, _, desc_len in groups_with_desc)
print(f'  Total characters: {total_chars:,}')
print(f'  Average per group: {total_chars // len(groups_with_desc):,}')

