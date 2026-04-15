#!/usr/bin/env python3
"""
build_mso2_json.py
──────────────────
Builds mso2.json by filtering mso_2_4_5_6_7.json to only the commands
listed in MSO2_HEADERS below.

Usage:
    python scripts/build_mso2_json.py

Output:
    mso2.json  (same schema as mso_2_4_5_6_7.json)
    mso2_missing.txt  (headers in the list that were NOT found in source)
"""

import json, re, sys
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1: Paste the full SCPI command header list from the MSO2 manual here.
# Format: one header per line, e.g. "ACQuire:MODe" or "TRIGger:A:EDGE:SOUrce"
# Capitalisation doesn't matter — matching is case-insensitive.
# ─────────────────────────────────────────────────────────────────────────────
MSO2_HEADERS = """
ACQuire
ACQuire?
ACQuire:MODe
ACQuire:MODe?
ACQuire:NUMACq?
ACQuire:NUMAvg
ACQuire:NUMAvg?
ACQuire:STATE
ACQuire:STATE?
ACQuire:STOPAfter
ACQuire:STOPAfter?
""".strip().splitlines()

# ─────────────────────────────────────────────────────────────────────────────
# Paths  (edit if your layout differs)
# ─────────────────────────────────────────────────────────────────────────────
ROOT        = Path(__file__).resolve().parent.parent
SOURCE_JSON = ROOT.parent / "mso_2_4_5_6_7.json"          # one level up from project
OUTPUT_JSON = ROOT.parent / "mso2.json"
MISSING_TXT = ROOT.parent / "mso2_missing.txt"

# ─────────────────────────────────────────────────────────────────────────────

def normalise(header: str) -> str:
    """Lower-case, strip trailing ?, collapse whitespace."""
    return re.sub(r"\s+", "", header.strip().lower().rstrip("?"))


def main():
    if not SOURCE_JSON.exists():
        print(f"ERROR: source not found: {SOURCE_JSON}")
        sys.exit(1)

    print(f"Loading {SOURCE_JSON} …")
    with open(SOURCE_JSON, encoding="utf-8", errors="replace") as f:
        source = json.load(f)

    # Build a lookup: normalised_header -> command object
    lookup: dict[str, list] = {}
    for grp in source.get("groups", {}).values():
        for cmd in grp.get("commands", []):
            scpi = cmd.get("scpi", "")
            key  = normalise(scpi)
            lookup.setdefault(key, []).append(cmd)

    # Also index by _manualEntry.header
    for grp in source.get("groups", {}).values():
        for cmd in grp.get("commands", []):
            me = cmd.get("_manualEntry") or {}
            h  = me.get("header", "")
            if h:
                lookup.setdefault(normalise(h), []).append(cmd)

    # Match requested headers
    want       = [h.strip() for h in MSO2_HEADERS if h.strip()]
    found_cmds = []
    missing    = []

    for header in want:
        key = normalise(header)
        if key in lookup:
            # de-dup: same cmd may be indexed under multiple keys
            for c in lookup[key]:
                if c not in found_cmds:
                    found_cmds.append(c)
        else:
            missing.append(header)

    # Re-group found commands by their group field
    out_groups: dict[str, dict] = {}
    for cmd in found_cmds:
        grp_name = cmd.get("group", "Miscellaneous")
        if grp_name not in out_groups:
            out_groups[grp_name] = {"name": grp_name, "description": "", "commands": []}
        out_groups[grp_name]["commands"].append(cmd)

    output = {
        "version": "2.0",
        "manual":  "MSO2 Series Programmer Manual",
        "metadata": {
            "total_commands": len(found_cmds),
            "total_groups":   len(out_groups),
            "source":         "filtered from mso_2_4_5_6_7.json",
        },
        "groups": out_groups,
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nOK  Written {len(found_cmds)} commands across {len(out_groups)} groups -> {OUTPUT_JSON}")

    if missing:
        with open(MISSING_TXT, "w", encoding="utf-8") as f:
            f.write("\n".join(missing))
        print(f"WARN   {len(missing)} headers NOT found in source -> {MISSING_TXT}")
        print("    These need to be added manually (MSO2-exclusive commands not in MSO 4/5/6/7).")
    else:
        print("OK  All headers matched — no missing commands.")

    # Summary by group
    print("\nGroup breakdown:")
    for gname, grp in out_groups.items():
        print(f"  {gname}: {len(grp['commands'])} commands")


if __name__ == "__main__":
    main()
