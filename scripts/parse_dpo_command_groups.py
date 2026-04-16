"""
Parse Command_groups_DPOx.txt to extract command-to-group mappings
"""
import re
import json
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
INPUT_FILE = os.path.join(PROJECT_ROOT, "Command_groups_DPOx.txt")
OUTPUT_FILE = os.path.join(SCRIPT_DIR, "command_groups_mapping_DPO.py")

def parse_command_groups(file_path):
    """Parse the DPO command groups text file"""
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    command_to_group = {}
    current_group = None
    in_table = False
    table_has_commands = False
    
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        
        # Check for group header (ends with "command group")
        group_match = re.search(r'^(.+?)\s+command\s+group$', line, re.IGNORECASE)
        if group_match:
            current_group = group_match.group(1).strip()
            in_table = False
            table_has_commands = False
            continue
        
        # Check for table header (starts with "Table" and contains "commands")
        if re.match(r'^Table\s+\d+[-:]?\d*:\s+.+commands', line, re.IGNORECASE):
            in_table = True
            table_has_commands = True
            continue
        
        # Check for table continuation
        if in_table and re.match(r'^Table\s+\d+[-:]?\d*:\s+.+commands\s+\(cont\.\)', line, re.IGNORECASE):
            continue
        
        # Check for "Command	Description" header row
        if in_table and re.match(r'^Command\s+Description', line, re.IGNORECASE):
            continue
        
        # If we're in a table and have a current group, try to extract commands
        if in_table and current_group and table_has_commands:
            # Commands are typically tab-separated: COMMAND<TAB>Description
            # Or space-separated: COMMAND Description
            # Commands usually start with uppercase letters and contain colons
            parts = line.split('\t')
            if len(parts) >= 2:
                # Tab-separated
                cmd = parts[0].strip()
                desc = parts[1].strip()
            else:
                # Try space-separated - find where description starts
                # Commands are usually all caps with colons, descriptions start with lowercase or "Sets"
                match = re.match(r'^([A-Z*][A-Z0-9:<>?*]+(?:\s+[A-Z0-9:<>?*]+)*)\s+(.+)$', line)
                if match:
                    cmd = match.group(1).strip()
                    desc = match.group(2).strip()
                else:
                    # Check if entire line is a command (no description)
                    if re.match(r'^[A-Z*][A-Z0-9:<>?*]+(?:\s+[A-Z0-9:<>?*]+)*$', line):
                        cmd = line
                        desc = ""
                    else:
                        continue
            
            # Validate command format
            if cmd and ':' in cmd and re.match(r'^[A-Z*][A-Z0-9:<>?*]+', cmd):
                # Clean up command (remove trailing spaces, normalize)
                cmd = cmd.strip()
                # Remove query mark for mapping (we want base command)
                base_cmd = cmd.replace('?', '').strip()
                
                # Map both with and without query mark
                if base_cmd:
                    command_to_group[base_cmd] = current_group
                    if cmd != base_cmd:
                        command_to_group[cmd] = current_group
    
    return command_to_group

def generate_mapping_file(command_to_group, output_path):
    """Generate a Python file with the command-to-group mapping"""
    # Group commands by group name
    groups_dict = {}
    for cmd, group in command_to_group.items():
        if group not in groups_dict:
            groups_dict[group] = []
        groups_dict[group].append(cmd)
    
    # Generate Python code
    lines = [
        '"""',
        'Command-to-Group Mapping for DPO Series',
        'Generated from Command_groups_DPOx.txt',
        '"""',
        '',
        'COMMAND_TO_GROUP = {'
    ]
    
    # Sort commands for readability
    sorted_commands = sorted(command_to_group.items())
    for cmd, group in sorted_commands:
        lines.append(f'    "{cmd}": "{group}",')
    
    lines.append('}')
    lines.append('')
    lines.append('# Group descriptions (if available)')
    lines.append('COMMAND_GROUPS = {')
    
    # Add group descriptions
    for group in sorted(groups_dict.keys()):
        lines.append(f'    "{group}": {{')
        lines.append(f'        "name": "{group}",')
        lines.append(f'        "description": "",  # Add description if available')
        lines.append(f'        "commands": {len(groups_dict[group])}  # Number of commands')
        lines.append('    },')
    
    lines.append('}')
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    
    print(f"Generated mapping file: {output_path}")
    print(f"Total commands mapped: {len(command_to_group)}")
    print(f"Total groups: {len(groups_dict)}")
    print(f"\nGroups:")
    for group in sorted(groups_dict.keys()):
        print(f"  {group}: {len(groups_dict[group])} commands")

if __name__ == "__main__":
    print(f"Parsing {INPUT_FILE}...")
    command_to_group = parse_command_groups(INPUT_FILE)
    
    if command_to_group:
        generate_mapping_file(command_to_group, OUTPUT_FILE)
    else:
        print("No commands found!")



