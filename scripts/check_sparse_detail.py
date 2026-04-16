"""Check original STATus/SYSTem commands + search PDF for real ones."""
import json, re, sys
import pdfplumber

PDF = r"C:\Users\u650455\Downloads\SignalVu-PC-Programmer-Manual_EN-US_077072122.pdf"

# ── Check original rsa.json for STATus/SYSTem/UNIT ──────────────
# Re-read the backup (it's been overwritten, so re-examine via the 506-group original)
# Actually let's just look at pages 130-175 in the PDF for command tables

print("=== Scanning pages 120-180 for STATus/SYSTem/UNIT/CALibration tables ===\n")

with pdfplumber.open(PDF) as pdf:
    for page_idx in range(119, 180):
        page = pdf.pages[page_idx]
        text = page.extract_text() or ''
        text_u = text.upper()
        
        # Check if page has relevant commands
        if any(x in text_u for x in ['STATUS:', 'SYSTEM:', 'UNIT:', 'CALIBRAT']):
            tables = page.extract_tables()
            print(f"--- Page {page_idx+1} ---")
            print(text[:200])
            for i, t in enumerate(tables):
                if not t: continue
                print(f"  Table {i}: {len(t)} rows, header={t[0]}")
                for row in t[1:5]:
                    print(f"    {row}")
            print()
