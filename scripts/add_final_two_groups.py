# Read the groups
exec(open('scripts/extract_final_two_groups.py').read())

# Read the mapping file to find insertion point
with open('scripts/command_groups_mapping.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the insertion point
insert_marker = '    # More groups will be added as you share them\n}'
before_marker = content.split(insert_marker)[0]

# Format the new groups
new_groups = ''

# Wide Band Gap Analysis (WBG)
new_groups += '    "Wide Band Gap Analysis (WBG)": {\n'
new_groups += '        "description": "Use the commands in the Wide Band Gap Analysis (WBG) command group for WBG-DPT (Wide Band Gap Device Power Test) measurements. Note: Some of the following commands may not be available on your instrument model. Also, some of the following commands are only available if your instrument has the associated option installed.",\n'
new_groups += '        "commands": [\n'
for cmd in wbg:
    new_groups += f'            "{cmd}",\n'
new_groups += '        ]\n'
new_groups += '    },\n'

# Zoom
new_groups += '    "Zoom": {\n'
new_groups += '        "description": "Zoom commands let you expand and position the waveform display horizontally and vertically, without changing the time base or vertical settings. Note: Zoom commands are available once a view has been added.",\n'
new_groups += '        "commands": [\n'
for cmd in zoom:
    new_groups += f'            "{cmd}",\n'
new_groups += '        ]\n'
new_groups += '    }\n'

# Write the new content
new_content = before_marker + new_groups + insert_marker
with open('scripts/command_groups_mapping.py', 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Added 2 final groups to mapping file")
print("Total groups now complete!")










