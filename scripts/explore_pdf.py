"""Explore the SignalVu PDF structure to understand table layouts."""
import pdfplumber

PDF = r"C:\Users\u650455\Downloads\SignalVu-PC-Programmer-Manual_EN-US_077072122.pdf"

with pdfplumber.open(PDF) as pdf:
    total = len(pdf.pages)
    print(f"Total pages: {total}")

    # Look at pages 19-30 (where Table 8 and first command groups are)
    for page_num in range(18, 35):  # 0-indexed
        page = pdf.pages[page_num]
        tables = page.extract_tables()
        text_preview = page.extract_text()[:200] if page.extract_text() else ''
        print(f"\n=== Page {page_num+1} ===")
        print(f"  Text preview: {text_preview[:150]!r}")
        print(f"  Tables found: {len(tables)}")
        for i, t in enumerate(tables):
            if t:
                print(f"  Table {i}: {len(t)} rows x {len(t[0])} cols")
                # Show first 3 rows
                for row in t[:3]:
                    print(f"    {row}")
