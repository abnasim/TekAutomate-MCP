import pdfplumber
import json
import re

# ================= CONFIGURATION =================
INPUT_PDF = "4-5-6_MSO_Programmer_077189801_RevA.pdf"
OUTPUT_JSON = "mso_commands_final.json"

# Regex to find command headers (e.g. "ACQuire:STATE" or "*IDN?")
CMD_HEADER_PATTERN = re.compile(r'^[:*]?[A-Za-z]+(?::[A-Za-z0-9<>]+)+(?:\?)?$|^[*][A-Z]{3,}\??$')

def extract_commands_robust(pdf_path):
    print(f"Opening {pdf_path}...")
    
    commands = []
    current_cmd = None
    
    # State tracking
    state = "SEARCHING"
    buffer = []

    def save_buffer_to_field():
        """Moves text from buffer to the correct field in current_cmd."""
        nonlocal buffer, state
        if not current_cmd: 
            return

        # Join lines with newlines to preserve structure
        text_content = "\n".join([line.strip() for line in buffer if line.strip()])
        
        if not text_content:
            return

        if state == "DESCRIPTION":
            current_cmd["description"] = text_content
        elif state == "CONDITIONS":
            current_cmd["conditions"] = text_content
        elif state == "GROUP":
            current_cmd["group"] = text_content.replace('\n', ' ').strip()
        elif state == "SYNTAX":
            # Syntax is a list of lines
            current_cmd["syntax"] = [line.strip() for line in buffer if line.strip()]
        elif state == "RELATED":
            # Extract command-like strings from related commands
            clean = text_content.replace(',', ' ').replace('\n', ' ')
            related_cmds = []
            for word in clean.split():
                word = word.strip()
                # Check if it looks like a command
                if CMD_HEADER_PATTERN.match(word):
                    related_cmds.append(word)
            current_cmd["relatedCommands"] = related_cmds if related_cmds else None
        elif state == "ARGUMENTS":
            current_cmd["arguments"] = text_content
        elif state == "EXAMPLES":
            current_cmd["examples"] = text_content

    def finalize_command():
        nonlocal current_cmd, state, buffer
        if current_cmd:
            save_buffer_to_field()  # Save whatever was processing
            
            # Default nulls for missing optional fields
            if not current_cmd.get("relatedCommands"): 
                current_cmd["relatedCommands"] = None
            if not current_cmd.get("conditions"): 
                current_cmd["conditions"] = None
            
            # Only add if it looks like a valid command (has a header)
            if current_cmd["scpi"]:
                commands.append(current_cmd)
            
            # Reset for next command
            current_cmd = None
            state = "SEARCHING"
            buffer = []

    with pdfplumber.open(pdf_path) as pdf:
        print(f"Processing {len(pdf.pages)} pages...")

        for i, page in enumerate(pdf.pages):
            text = page.extract_text()
            if not text: 
                continue
            
            lines = text.split('\n')
            
            for line in lines:
                line = line.strip()
                if not line: 
                    continue
                
                # Normalize for keyword check
                line_lower = line.lower()

                # 1. State Switching Keywords (Case-Insensitive)
                if line_lower.startswith("conditions"):
                    save_buffer_to_field()
                    state = "CONDITIONS"
                    buffer = []
                    continue
                elif line_lower.startswith("group"):
                    save_buffer_to_field()
                    state = "GROUP"
                    buffer = []
                    continue
                elif line_lower.startswith("syntax"):
                    save_buffer_to_field()
                    state = "SYNTAX"
                    buffer = []
                    continue
                elif line_lower.startswith("related commands") or (line_lower.startswith("related") and "command" in line_lower):
                    save_buffer_to_field()
                    state = "RELATED"
                    buffer = []
                    continue
                elif line_lower.startswith("arguments") or line_lower.startswith("args"):
                    save_buffer_to_field()
                    state = "ARGUMENTS"
                    buffer = []
                    continue
                elif line_lower.startswith("examples") or line_lower.startswith("example"):
                    save_buffer_to_field()
                    state = "EXAMPLES"
                    buffer = []
                    continue

                # 2. Check for Command Header
                # FIXED: Allow detection in more states, but be smart about it
                parts = line.split()
                if not parts:
                    continue
                    
                first_word = parts[0].strip()
                
                # Check if this could be a command header
                # Allow detection if:
                # - We're searching for a command (SEARCHING)
                # - We're in description and have content (new command after previous one)
                # - We're in EXAMPLES/SYNTAX but buffer is empty (section just started, might be new command)
                # - We're in any other state and it's clearly a standalone command line
                can_detect_command = (
                    state == "SEARCHING" or
                    (state == "DESCRIPTION" and buffer) or
                    (state in ["SYNTAX", "EXAMPLES"] and not buffer) or
                    (state not in ["SYNTAX", "EXAMPLES"] and len(parts) == 1)
                )
                
                if can_detect_command:
                    is_header = CMD_HEADER_PATTERN.match(first_word)
                    
                    # Filter out false positives
                    if is_header:
                        # Ignore if it ends with colon (likely a label "Note:")
                        if first_word.endswith(':') and len(first_word) < 15:
                            is_header = False
                        # Ignore common false positives
                        if first_word.lower() in ["table", "contents", "index", "figure", "note"]:
                            is_header = False
                        # Commands should have colons (except star commands)
                        if ':' not in first_word and not first_word.startswith('*'):
                            is_header = False
                        # If in SYNTAX/EXAMPLES, only accept if it's clearly a new command (single word, no buffer)
                        if state in ["SYNTAX", "EXAMPLES"] and (len(parts) > 1 or buffer):
                            is_header = False

                    if is_header:
                        finalize_command()  # Save previous command
                        
                        # Initialize new command
                        current_cmd = {
                            "scpi": first_word,
                            "description": "",
                            "conditions": None,
                            "group": "",
                            "syntax": [],
                            "relatedCommands": None,
                            "arguments": "",
                            "examples": ""
                        }
                        state = "DESCRIPTION"
                        buffer = []
                        continue

                # 3. Accumulate Content
                if state != "SEARCHING":
                    # Filter out obvious page numbers (1-3 digits only)
                    if not (line.isdigit() and len(line) <= 3):
                        # Filter out page headers if they're obvious
                        if "Programmer Manual" not in line or len(line) > 50:
                            buffer.append(line)

            if i % 20 == 0:
                print(f"  Processed page {i}/{len(pdf.pages)}...")

    finalize_command()  # Save the last one
    return commands

# ================= EXECUTION =================

if __name__ == "__main__":
    extracted_data = extract_commands_robust(INPUT_PDF)
    
    final_output = {
        "category": "All",
        "instruments": ["MSO4", "MSO5", "MSO6", "MSO7"],
        "commands": extracted_data
    }

    print(f"Extracted {len(extracted_data)} commands.")
    
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(final_output, f, indent=2)
    
    print(f"Saved to {OUTPUT_JSON}")










