# Read the groups
exec(open('scripts/extract_save_search_groups.py').read())

# Read the mapping file to find insertion point
with open('scripts/command_groups_mapping.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the insertion point
insert_marker = '    # More groups will be added as you share them\n}'
before_marker = content.split(insert_marker)[0]

# Format the new groups
new_groups = ''

# Save and Recall
new_groups += '    "Save and Recall": {\n'
new_groups += '        "description": "Use the commands in the Save and Recall Command Group to store and retrieve internal waveforms and settings. When you save a setup, you save all the settings of the instrument. When you recall a setup, the instrument restores itself to the state that it was in when you originally saved that setting.",\n'
new_groups += '        "commands": [\n'
for cmd in save_recall:
    new_groups += f'            "{cmd}",\n'
new_groups += '        ]\n'
new_groups += '    },\n'

# Save on
new_groups += '    "Save on": {\n'
new_groups += '        "description": "Use this group of commands to program the instrument to save images, measurements, waveforms, or the instrument setup, on triggers that you select. These commands still function, however the Act On Event commands are preferred. Please see the Act On Event section for continued development and enhancements.",\n'
new_groups += '        "commands": [\n'
for cmd in save_on:
    new_groups += f'            "{cmd}",\n'
new_groups += '        ]\n'
new_groups += '    },\n'

# Search and Mark
new_groups += '    "Search and Mark": {\n'
new_groups += '        "description": "Use search and mark commands to seek out and identify information in waveform records that warrant further investigation.",\n'
new_groups += '        "commands": [\n'
for cmd in search_mark:
    new_groups += f'            "{cmd}",\n'
new_groups += '        ]\n'
new_groups += '    }\n'

# Write the new content
new_content = before_marker + new_groups + insert_marker
with open('scripts/command_groups_mapping.py', 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Added 3 new groups to mapping file")










