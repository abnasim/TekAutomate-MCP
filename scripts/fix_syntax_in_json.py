#!/usr/bin/env python3
"""
Fix syntax extraction in existing JSON file.
Updates _manualEntry.syntax for commands that have combined set/query syntax.
"""

import json
import re
import sys
import os

def extract_syntax_fixed(syntax_lines, cmd_key, desc=""):
    """
    Extract set and query syntax from syntax lines (same logic as extract_fast.py)
    """
    desc_lower = desc.lower() if desc else ""
    is_query_only = (
        "query-only" in desc_lower or 
        "(query only)" in desc_lower or 
        "(Query Only)" in desc or
        (cmd_key.endswith("?") and not any("?" not in s for s in syntax_lines if s.strip()))
    )
    
    set_syntax = ""
    query_syntax = ""
    
    for s in syntax_lines:
        s = s.strip()
        if not s:
            continue
            
        if "?" in s:
            # First, try the alternative pattern: Split on the command header that appears twice
            header = cmd_key.split(" ")[0].split("?")[0]
            if header and s.count(header) >= 2:
                # Find the second occurrence which is the query
                first_pos = s.find(header)
                second_pos = s.find(header, first_pos + len(header))
                if second_pos > 0:
                    potential_set = s[:second_pos].strip()
                    potential_query = s[second_pos:].strip()
                    if potential_set and not set_syntax:
                        set_syntax = potential_set
                    if potential_query and not query_syntax:
                        query_syntax = potential_query
                    continue
            
            # Try regex pattern
            query_match = re.search(r'\s+([A-Za-z:]+(?:<x>)?[A-Za-z:]*\?)\s*$', s)
            if query_match:
                potential_set = s[:query_match.start()].strip()
                potential_query = query_match.group(1).strip()
                
                if potential_set and ('{' in potential_set or '<NR' in potential_set or '<QString' in potential_set):
                    if not set_syntax:
                        set_syntax = potential_set
                    if not query_syntax:
                        query_syntax = potential_query
                    continue
            
            # Simple case: just a query line
            if not query_syntax:
                query_syntax = s
        else:
            # No "?" means this is a SET syntax line
            if not set_syntax:
                set_syntax = s
    
    # For query-only commands, don't create a set syntax
    if is_query_only:
        set_syntax = None
        if not query_syntax:
            query_syntax = cmd_key if cmd_key.endswith("?") else cmd_key + "?"
    else:
        # For non-query-only commands, ensure both syntaxes exist if needed
        if not set_syntax and not cmd_key.endswith("?"):
            set_syntax = cmd_key.replace("?", "")
        if not query_syntax:
            query_syntax = cmd_key if cmd_key.endswith("?") else cmd_key + "?"
    
    return {
        "set": set_syntax,
        "query": query_syntax
    }


def fix_command_syntax(cmd):
    """
    Fix the _manualEntry.syntax for a single command
    """
    if not cmd.get("_manualEntry"):
        return False
    
    manual_entry = cmd["_manualEntry"]
    syntax_lines = cmd.get("syntax", [])
    cmd_key = cmd.get("scpi", "")
    desc = cmd.get("description", "")
    
    if not syntax_lines or not cmd_key:
        return False
    
    # Check if syntax needs fixing (has combined format)
    combined_pattern = False
    for s in syntax_lines:
        s = s.strip()
        if "?" in s and cmd_key.split(" ")[0].split("?")[0] in s:
            # Check if it appears twice (combined format)
            header = cmd_key.split(" ")[0].split("?")[0]
            if header and s.count(header) >= 2:
                combined_pattern = True
                break
    
    if not combined_pattern:
        return False
    
    # Extract fixed syntax
    fixed_syntax = extract_syntax_fixed(syntax_lines, cmd_key, desc)
    
    # Update _manualEntry.syntax
    if fixed_syntax["set"] or fixed_syntax["query"]:
        manual_entry["syntax"] = {
            "set": fixed_syntax["set"],
            "query": fixed_syntax["query"]
        }
        return True
    
    return False


def fix_json_file(input_path, output_path=None):
    """
    Fix all commands in a JSON file
    """
    if output_path is None:
        output_path = input_path
    
    print(f"Loading JSON file: {input_path}")
    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    total_fixed = 0
    total_commands = 0
    
    # Process all groups
    if "groups" in data:
        for group_name, group_data in data["groups"].items():
            commands = group_data.get("commands", [])
            for cmd in commands:
                total_commands += 1
                if fix_command_syntax(cmd):
                    total_fixed += 1
                    print(f"  Fixed: {cmd.get('scpi', 'unknown')}")
    
    print(f"\nFixed {total_fixed} out of {total_commands} commands")
    
    print(f"\nSaving to: {output_path}")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print("Done!")


if __name__ == "__main__":
    # Default paths
    script_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(script_dir)
    default_input = os.path.join(parent_dir, "public", "commands", "mso_commands_final.json")
    
    if len(sys.argv) > 1:
        input_path = sys.argv[1]
    else:
        input_path = default_input
    
    if len(sys.argv) > 2:
        output_path = sys.argv[2]
    else:
        output_path = input_path  # Overwrite by default
    
    if not os.path.exists(input_path):
        print(f"ERROR: File not found: {input_path}")
        sys.exit(1)
    
    fix_json_file(input_path, output_path)



