"""Debug the block parsing to see why examples/related aren't extracted."""
import pdfplumber, re, json, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

PDF = r"C:\Users\u650455\Downloads\SignalVu-PC-Programmer-Manual_EN-US_077072122.pdf"
DETAIL_START = 166

PAGE_HEADER_RE = re.compile(r'Command descriptions\s*\n?Command descriptions\s*\n?', re.MULTILINE)

# Extract pages 167-175 (ABORt + first few CALCulate commands)
with pdfplumber.open(PDF) as pdf:
    text = ''
    for i in range(DETAIL_START, DETAIL_START + 10):
        page = pdf.pages[i]
        t = page.extract_text() or ''
        t = PAGE_HEADER_RE.sub('', t)
        text += t + '\n'

print("=== RAW TEXT (first 3000 chars) ===")
print(repr(text[:3000]))

print("\n\n=== LINES ===")
for i, line in enumerate(text.splitlines()[:80]):
    print(f"{i:3d}: {repr(line)}")
