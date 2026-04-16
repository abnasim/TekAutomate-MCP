"""
Debug the REAL extraction logic for PLOT:PLOT<x>:RAILNUM
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

sys.path.insert(0, SCRIPT_DIR)
from command_groups_mapping import COMMAND_GROUPS

# Copy the extraction helpers
def get_font_name(run):
    if run.font and run.font.name:
        return run.font.name
    if run.style and hasattr(run.style, 'font') and run.style.font and run.style.font.name:
        return run.style.font.name
    return None

def is_tahoma(run):
    font_name = get_font_name(run)
    if font_name:
        return "tahoma" in font_name.lower()
    return False

def is_courier_new(run):
    font_name = get_font_name(run)
    if font_name:
        font_lower = font_name.lower()
        return "courier" in font_lower and "new" in font_lower
    return False

def extract_text_by_font(paragraph, font_check_func):
    parts = []
    for run in paragraph.runs:
        if font_check_func(run):
            parts.append(run.text.strip())
    return " ".join(parts) if parts else None

def extract_tahoma_text(paragraph):
    return extract_text_by_font(paragraph, is_tahoma)

def extract_courier_new_text(paragraph):
    return extract_text_by_font(paragraph, is_courier_new)

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
        text_norm = re.sub(r'<[xn]>', '<x>', text_upper)
        cmd_norm = re.sub(r'<[xn]>', '<x>', cmd_upper)
        if text_norm == cmd_norm:
            return cmd
    return None

print("Loading document...")
doc = Document(DOCX_PATH)

START_PARA = 30490
END_PARA = 30515

state = "SEARCHING"
current_cmd = None
buffer = []
commands = {}

def clean_text(text_or_list):
    if isinstance(text_or_list, list):
        return ' '.join(text_or_list).strip()
    return text_or_list.strip() if text_or_list else ""

def save_current_section():
    global buffer
    if not current_cmd:
        return
    
    text_content = clean_text(buffer)
    
    if state == "DESCRIPTION":
        current_cmd["description"] = text_content
    elif state == "CONDITIONS":
        current_cmd["conditions"] = text_content
    elif state == "SYNTAX":
        syntax_lines = [line.strip() for line in buffer if line.strip()]
        if syntax_lines:
            if not current_cmd.get("syntax"):
                current_cmd["syntax"] = []
            current_cmd["syntax"].extend(syntax_lines)
    elif state == "ARGUMENTS":
        current_cmd["arguments"] = text_content
    
    buffer = []

def finalize_command():
    global current_cmd, state, buffer
    
    if not current_cmd:
        return
    
    save_current_section()
    
    cmd_key = current_cmd["scpi"]
    commands[cmd_key] = current_cmd
    
    current_cmd = None
    state = "SEARCHING"
    buffer = []

print(f"\nProcessing paragraphs {START_PARA} to {END_PARA}:")
print("="*80)

for para_num, paragraph in enumerate(doc.paragraphs):
    if para_num < START_PARA:
        continue
    if para_num > END_PARA:
        break
    
    line = paragraph.text.strip()
    if not line:
        continue
    
    line_lower = line.lower()
    
    print(f"\n[{para_num}] '{line[:60]}...'")
    print(f"    STATE: {state}")
    
    # Keyword checks
    if line_lower.startswith("conditions"):
        print(f"    -> KEYWORD: conditions")
        save_current_section()
        state = "CONDITIONS"
        buffer = []
        continue
    elif line_lower.startswith("group"):
        print(f"    -> KEYWORD: group")
        save_current_section()
        state = "GROUP"
        buffer = []
        continue
    elif line_lower.startswith("syntax"):
        print(f"    -> KEYWORD: syntax")
        save_current_section()
        state = "SYNTAX"
        buffer = []
        continue
    elif line_lower.startswith("arguments"):
        print(f"    -> KEYWORD: arguments")
        save_current_section()
        state = "ARGUMENTS"
        buffer = []
        continue
    elif line_lower.startswith("examples"):
        print(f"    -> KEYWORD: examples")
        save_current_section()
        state = "EXAMPLES"
        buffer = []
        continue
    
    # Check for Tahoma command header
    tahoma_text = extract_tahoma_text(paragraph)
    print(f"    Tahoma text: '{tahoma_text}'")
    
    if tahoma_text:
        tahoma_words = tahoma_text.split()
        if tahoma_words:
            first_tahoma_word = tahoma_words[0]
            matched_cmd = is_command_in_master_list(first_tahoma_word)
            print(f"    First Tahoma word: '{first_tahoma_word}', matched: {matched_cmd}")
            
            if matched_cmd:
                print(f"    -> COMMAND HEADER in Tahoma! Finalizing previous...")
                finalize_command()
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
                continue
    
    # Check for Courier New syntax
    if state == "SYNTAX" and current_cmd:
        courier_text = extract_courier_new_text(paragraph)
        print(f"    Courier text: '{courier_text}'")
        if courier_text:
            if not current_cmd.get("syntax"):
                current_cmd["syntax"] = []
            current_cmd["syntax"].append(courier_text.strip())
            print(f"    -> SYNTAX captured: {courier_text[:50]}...")
            continue
    
    # Buffer accumulation
    if state != "SEARCHING" and current_cmd:
        buffer.append(line)
        print(f"    -> BUFFERED: {line[:50]}...")

# Finalize last command
finalize_command()

print("\n" + "="*80)
print("COMMANDS CAPTURED:")
for scpi, cmd in commands.items():
    print(f"\n{scpi}:")
    print(f"  description: {cmd.get('description', 'N/A')[:50]}...")
    print(f"  conditions: {cmd.get('conditions', 'N/A')}")
    print(f"  syntax: {cmd.get('syntax', [])}")
    print(f"  arguments: {cmd.get('arguments', 'N/A')[:50] if cmd.get('arguments') else 'N/A'}...")









