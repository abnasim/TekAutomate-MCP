import pdfplumber
import json
import re

# ================= CONFIGURATION =================
INPUT_PDF = "4-5-6_MSO_Programmer_077189801_RevA.pdf"
OUTPUT_JSON = "mso_commands_complete.json"

# Regex to find command headers (e.g. "ACQuire:STATE" or "BUSY?")
# Fixed: Better pattern for star commands and standard commands
CMD_HEADER_PATTERN = re.compile(
    r'^[:]?[A-Z][A-Za-z0-9<>]+(?::[A-Za-z0-9<>]+)+(?:\?)?$|'  # Standard commands
    r'^[*][A-Z]{2,}\??$'  # Star commands like *IDN?, *RST
)

# Section header patterns (case-insensitive)
GROUP_PATTERN = re.compile(r'^Group\s*$', re.IGNORECASE)
SYNTAX_PATTERN = re.compile(r'^Syntax\s*$', re.IGNORECASE)
ARGUMENTS_PATTERN = re.compile(r'^Arguments?\s*$', re.IGNORECASE)
EXAMPLES_PATTERN = re.compile(r'^Examples?\s*$', re.IGNORECASE)
CONDITIONS_PATTERN = re.compile(r'^Conditions?\s*$', re.IGNORECASE)
RELATED_PATTERN = re.compile(r'^Related\s+[Cc]ommands?\s*$', re.IGNORECASE)

def clean_text(text):
    """Clean extracted PDF text."""
    if not text:
        return ""
    # Remove form feeds and excessive whitespace
    text = re.sub(r'\x0c', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def extract_commands(pdf_path):
    print(f"Opening {pdf_path}...")
    
    commands = []
    current_cmd = None
    
    # State tracking
    # States: SEARCHING, DESCRIPTION, CONDITIONS, GROUP, SYNTAX, RELATED, ARGUMENTS, EXAMPLES
    state = "SEARCHING"
    buffer = []

    def finalize_command():
        """Saves the current command to the list and resets."""
        nonlocal current_cmd, buffer, state
        if current_cmd:
            # Save whatever was in the last buffer
            if buffer and state != "SEARCHING":
                save_buffer_to_field()
            
            # Post-processing checks - set empty fields to None
            if not current_cmd.get("relatedCommands"):
                current_cmd["relatedCommands"] = None
            if not current_cmd.get("conditions"):
                current_cmd["conditions"] = None
            if not current_cmd.get("arguments"):
                current_cmd["arguments"] = None
            if not current_cmd.get("examples"):
                current_cmd["examples"] = None
            
            # Add to list
            commands.append(current_cmd)
            current_cmd = None
            state = "SEARCHING"
            buffer = []

    def save_buffer_to_field():
        """Moves text from buffer to the correct field in current_cmd."""
        nonlocal buffer, state
        if not current_cmd: 
            return

        text_content = "\n".join([line.strip() for line in buffer if line.strip()])
        
        if state == "DESCRIPTION":
            # Filter out any lines that look like section headers
            filtered_lines = []
            for line in buffer:
                line_stripped = line.strip()
                if not line_stripped:
                    continue
                # Check if line is a section header
                is_section = (GROUP_PATTERN.match(line_stripped) or 
                             SYNTAX_PATTERN.match(line_stripped) or
                             ARGUMENTS_PATTERN.match(line_stripped) or
                             EXAMPLES_PATTERN.match(line_stripped) or
                             CONDITIONS_PATTERN.match(line_stripped) or
                             RELATED_PATTERN.match(line_stripped))
                if not is_section:
                    filtered_lines.append(line_stripped)
            current_cmd["description"] = "\n".join(filtered_lines)
            
        elif state == "CONDITIONS":
            current_cmd["conditions"] = text_content if text_content else None
            
        elif state == "GROUP":
            current_cmd["group"] = text_content
            
        elif state == "SYNTAX":
            # Split syntax lines into a list
            # Handle multi-line syntax by checking if line starts with command pattern
            syntax_lines = []
            for line in buffer:
                line_stripped = line.strip()
                if not line_stripped:
                    continue
                # If line looks like a command, it's a new syntax line
                if CMD_HEADER_PATTERN.match(line_stripped.split()[0] if line_stripped.split() else ""):
                    syntax_lines.append(line_stripped)
                elif syntax_lines:
                    # Continuation of previous syntax line
                    syntax_lines[-1] += " " + line_stripped
                else:
                    syntax_lines.append(line_stripped)
            current_cmd["syntax"] = syntax_lines if syntax_lines else []
            
        elif state == "RELATED":
            # Clean up related commands list
            # Usually they are comma separated or newlines
            clean_text = text_content.replace(',', ' ').replace('\n', ' ')
            # Extract command-like strings
            related_cmds = []
            for part in clean_text.split():
                part = part.strip()
                if CMD_HEADER_PATTERN.match(part):
                    related_cmds.append(part)
            current_cmd["relatedCommands"] = related_cmds if related_cmds else None
            
        elif state == "ARGUMENTS":
            current_cmd["arguments"] = text_content
            
        elif state == "EXAMPLES":
            current_cmd["examples"] = text_content

    # Open PDF
    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)
        print(f"Processing {total_pages} pages...")

        for i, page in enumerate(pdf.pages):
            text = page.extract_text()
            if not text: 
                continue
            
            # Clean the text
            text = clean_text(text)
            lines = text.split('\n')
            
            for line in lines:
                line = line.strip()
                if not line: 
                    continue

                # 1. Detect Keywords that trigger state changes
                # Check for section headers (case-insensitive)
                if CONDITIONS_PATTERN.match(line):
                    save_buffer_to_field()
                    state = "CONDITIONS"
                    buffer = []
                    continue
                elif GROUP_PATTERN.match(line):
                    save_buffer_to_field()
                    state = "GROUP"
                    buffer = []
                    continue
                elif SYNTAX_PATTERN.match(line):
                    save_buffer_to_field()
                    state = "SYNTAX"
                    buffer = []
                    continue
                elif RELATED_PATTERN.match(line):
                    save_buffer_to_field()
                    state = "RELATED"
                    buffer = []
                    continue
                elif ARGUMENTS_PATTERN.match(line):
                    save_buffer_to_field()
                    state = "ARGUMENTS"
                    buffer = []
                    continue
                elif EXAMPLES_PATTERN.match(line):
                    save_buffer_to_field()
                    state = "EXAMPLES"
                    buffer = []
                    continue

                # 2. Detect New Command Header
                # Fixed: Only check for headers when in appropriate states
                # Allow detection in SEARCHING, DESCRIPTION, or when buffer is empty in other states
                first_word = line.split(' ')[0] if line.split() else ""
                header_match = CMD_HEADER_PATTERN.match(first_word)
                
                # Check if this looks like a new command header
                is_header = (header_match and 
                            len(line.split()) < 3 and  # Command header should be short
                            ':' in first_word or first_word.startswith('*'))  # Must have colon or be star command
                
                # Only treat as new command if:
                # - We're searching for a command, OR
                # - We're in description and this is clearly a new command, OR
                # - We're in a section but haven't accumulated content yet
                if is_header and (state == "SEARCHING" or 
                                  (state == "DESCRIPTION" and buffer) or
                                  (state in ["CONDITIONS", "GROUP", "SYNTAX", "RELATED", "ARGUMENTS", "EXAMPLES"] and not buffer)):
                    finalize_command()  # Save the previous command
                    
                    # Start New Command
                    current_cmd = {
                        "scpi": first_word,  # The header
                        "description": "",
                        "conditions": None,
                        "group": "",
                        "syntax": [],
                        "relatedCommands": None,  # Will remain None if not found
                        "arguments": "",
                        "examples": ""
                    }
                    state = "DESCRIPTION"
                    buffer = []
                    # Don't add the command header itself to description
                    continue
                
                # 3. Accumulate Content
                else:
                    # Ignore page numbers or headers repeated on pages
                    if state != "SEARCHING":
                        buffer.append(line)
            
            if i % 20 == 0:
                print(f"  Processed page {i}...")

    # Save the very last command
    finalize_command()
    
    return commands

# ================= EXECUTION =================

data = extract_commands(INPUT_PDF)

# Wrap in the final structure
final_output = {
    "category": "All",
    "instruments": ["MSO4", "MSO5", "MSO6", "MSO7"],
    "commands": data
}

print(f"Extracted {len(data)} commands.")
print(f"Saving to {OUTPUT_JSON}...")

with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
    json.dump(final_output, f, indent=2)

print("Extraction Complete.")










