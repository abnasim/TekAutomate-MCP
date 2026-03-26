"""
Trace extraction for PLOT:PLOT<x>:RAILNUM to find the bug
"""
import os
import sys
import re

try:
    from docx import Document
except ImportError:
    print("ERROR: python-docx not installed")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DOCX_PATH = os.path.join(PROJECT_ROOT, "4-5-6_MSO_Programmer_077189801_RevA (1).docx")

# Import the extraction helpers
sys.path.insert(0, SCRIPT_DIR)
from command_groups_mapping import COMMAND_GROUPS

# Build command lookup
ALL_COMMANDS = []
COMMAND_TO_GROUP = {}
for group_name, group_data in COMMAND_GROUPS.items():
    for cmd in group_data.get("commands", []):
        ALL_COMMANDS.append(cmd)
        COMMAND_TO_GROUP[cmd] = group_name

def is_command_in_master_list(text):
    if not text:
        return None
    text_upper = text.upper().replace('?', '')
    for cmd in ALL_COMMANDS:
        cmd_upper = cmd.upper().replace('?', '')
        # Normalize <x> patterns
        text_norm = re.sub(r'<[xn]>', '<x>', text_upper)
        cmd_norm = re.sub(r'<[xn]>', '<x>', cmd_upper)
        if text_norm == cmd_norm:
            return cmd
    return None

print(f"Loading document...")
doc = Document(DOCX_PATH)

# Find paragraph 30492 and process 20 paragraphs
START_PARA = 30492
END_PARA = 30512

state = "SEARCHING"
current_cmd = None
buffer = []

def clean_text(text_or_list):
    if isinstance(text_or_list, list):
        return ' '.join(text_or_list).strip()
    return text_or_list.strip() if text_or_list else ""

def save_current_section():
    global buffer, state
    if not current_cmd:
        print(f"    [save_current_section] No current_cmd, skipping")
        return
    
    text_content = clean_text(buffer)
    print(f"    [save_current_section] state={state}, buffer={buffer[:2]}..., text_content={text_content[:50]}...")
    
    if state == "DESCRIPTION":
        current_cmd["description"] = text_content
        print(f"    -> Saved description: {text_content[:50]}...")
    elif state == "CONDITIONS":
        current_cmd["conditions"] = text_content
        print(f"    -> Saved conditions: {text_content[:50]}...")
    elif state == "SYNTAX":
        current_cmd["syntax"].extend([line.strip() for line in buffer if line.strip()])
        print(f"    -> Saved syntax: {current_cmd['syntax']}")
    elif state == "ARGUMENTS":
        current_cmd["arguments"] = text_content
        print(f"    -> Saved arguments: {text_content[:50]}...")
    elif state == "EXAMPLES":
        print(f"    -> Examples handled separately")
    
    buffer = []

print(f"\nProcessing paragraphs {START_PARA} to {END_PARA}:")
print("="*80)

for i, para in enumerate(doc.paragraphs):
    if i < START_PARA:
        continue
    if i > END_PARA:
        break
    
    line = para.text.strip()
    if not line:
        print(f"\n[{i}] (empty line)")
        continue
    
    line_lower = line.lower()
    print(f"\n[{i}] TEXT: {line[:60]}...")
    print(f"    STATE before: {state}")
    
    # Check for section keywords
    if line_lower.startswith("conditions"):
        print(f"    -> Keyword 'conditions' detected!")
        save_current_section()
        state = "CONDITIONS"
        buffer = []
        print(f"    STATE after: {state}")
        continue
    
    if line_lower.startswith("group"):
        print(f"    -> Keyword 'group' detected!")
        save_current_section()
        state = "GROUP"
        buffer = []
        print(f"    STATE after: {state}")
        continue
    
    if line_lower.startswith("syntax"):
        print(f"    -> Keyword 'syntax' detected!")
        save_current_section()
        state = "SYNTAX"
        buffer = []
        print(f"    STATE after: {state}")
        continue
    
    if line_lower.startswith("arguments"):
        print(f"    -> Keyword 'arguments' detected!")
        save_current_section()
        state = "ARGUMENTS"
        buffer = []
        print(f"    STATE after: {state}")
        continue
    
    if line_lower.startswith("examples"):
        print(f"    -> Keyword 'examples' detected!")
        save_current_section()
        state = "EXAMPLES"
        buffer = []
        print(f"    STATE after: {state}")
        continue
    
    # Check for command header
    words = line.split()
    if words:
        first_word = words[0]
        matched_cmd = is_command_in_master_list(first_word)
        if matched_cmd:
            print(f"    -> Command header detected: {matched_cmd}")
            save_current_section()
            current_cmd = {
                "scpi": matched_cmd,
                "description": None,
                "conditions": None,
                "group": COMMAND_TO_GROUP.get(matched_cmd),
                "syntax": [],
                "arguments": None,
                "examples": None,
            }
            state = "DESCRIPTION"
            buffer = []
            print(f"    STATE after: {state}, current_cmd created")
            continue
    
    # Accumulate content
    if state != "SEARCHING" and current_cmd:
        buffer.append(line)
        print(f"    -> Added to buffer: {line[:50]}...")
    else:
        print(f"    -> NOT added to buffer (state={state}, current_cmd={current_cmd is not None})")

print("\n" + "="*80)
print("FINAL RESULT:")
if current_cmd:
    import json
    print(json.dumps(current_cmd, indent=2, default=str))
else:
    print("No command captured!")

