# How to Upload TekAcademy.ts to Custom GPT

## Option 1: Convert TypeScript to Markdown (Recommended)

Since GPTs work best with markdown files, extract your TekAcademy content into markdown format:

### Step 1: Extract Articles to Markdown Files

If your `TekAcademy.ts` looks like this:

```typescript
export const TekAcademyArticles = [
  {
    id: "fastframe-guide",
    title: "FastFrame Setup Guide",
    category: "Acquisition",
    content: `
      # FastFrame Setup
      
      FastFrame allows capturing multiple...
      
      ## When to Use TekHSI
      - High-speed waveform capture
      - NOT for measurements
      
      ## Example
      ...
    `
  },
  {
    id: "search-operations",
    title: "Search Operations",
    category: "Analysis",
    content: `...`
  }
  // ... more articles
];
```

### Step 2: Create Individual Markdown Files

**Script to Extract** (run in Node.js):

```javascript
// extract-tekacademy.js
const fs = require('fs');
const TekAcademy = require('./TekAcademy.ts'); // or import

TekAcademy.TekAcademyArticles.forEach(article => {
  const filename = `TekAcademy/${article.category}/${article.id}.md`;
  const content = `# ${article.title}\n\nCategory: ${article.category}\n\n${article.content}`;
  
  fs.mkdirSync(`TekAcademy/${article.category}`, { recursive: true });
  fs.writeFileSync(filename, content);
  console.log(`Created: ${filename}`);
});

console.log('Done! Upload files from TekAcademy/ folder to GPT');
```

Run:
```bash
node extract-tekacademy.js
```

This creates:
```
TekAcademy/
├── Acquisition/
│   ├── fastframe-guide.md
│   ├── fastacq-setup.md
│   └── ...
├── Analysis/
│   ├── search-operations.md
│   ├── histogram-setup.md
│   └── ...
├── Backends/
│   ├── pyvisa-guide.md
│   ├── tekhsi-guide.md
│   └── tm_devices-guide.md
└── ... (all categories)
```

### Step 3: Upload to GPT

1. Go to ChatGPT → Create Custom GPT
2. Configure tab → Knowledge section
3. Click "Upload files"
4. Select **all markdown files** from `TekAcademy/` folder
5. GPT will index them automatically

---

## Option 2: Upload TypeScript Directly (Alternative)

If you want to upload the `.ts` file directly:

### Prepare the File

1. **Add comprehensive comments**:
```typescript
/**
 * TekAcademy Knowledge Base
 * 
 * This file contains all Tektronix instrument automation articles.
 * 
 * Backend Guidelines:
 * - PyVISA: Standard SCPI, measurements, search, histogram
 * - TekHSI: ONLY high-speed waveform capture (NOT for measurements)
 * - tm_devices: Modern Python API (check feature support)
 * 
 * Categories:
 * - Acquisition: FastFrame, FastAcq, waveform capture
 * - Analysis: Measurements, search, histogram
 * - Backends: PyVISA, TekHSI, tm_devices guides
 * - Workflows: Complete tested examples
 */

export const TekAcademyArticles = [
  // ... articles
];
```

2. **Upload to GPT**:
   - Configure tab → Knowledge
   - Upload `TekAcademy.ts`
   - GPT can parse TypeScript but prefers structured content

**Limitation**: GPT may struggle with complex TypeScript syntax. Markdown is more reliable.

---

## Option 3: Create Single Comprehensive Markdown (Quick)

### Combine All Articles into One File

**TekAcademy-Complete.md**:

```markdown
# TekAcademy Knowledge Base - Complete Reference

## Table of Contents
1. [Backend Guides](#backend-guides)
2. [Acquisition](#acquisition)
3. [Analysis](#analysis)
4. [Workflow Examples](#workflow-examples)

---

## Backend Guides

### PyVISA Backend

**When to Use:**
- Standard SCPI commands
- Measurements (MEASU:)
- Search operations (SEARCH:)
- Histogram analysis
- Results tables
- Maximum compatibility

**When NOT to Use:**
- High-speed waveform capture (use TekHSI)

**Example:**
```json
{
  "backend": "pyvisa",
  "steps": [
    {"type": "connect", "params": {}},
    {"type": "scpi_write", "params": {"command": "MEASU:MEAS1:TYPE FREQ"}},
    {"type": "disconnect", "params": {}}
  ]
}
```

---

### TekHSI Backend

**When to Use:**
- ⚠️ ONLY high-speed waveform data capture
- FastFrame acquisition
- FastAcq mode
- Bulk waveform transfer

**When NOT to Use:**
- ❌ Measurements
- ❌ Search operations
- ❌ Histogram
- ❌ Results tables
- ❌ General SCPI configuration

**Example:**
```json
{
  "backend": "tekhsi",
  "steps": [
    {"type": "connect", "params": {}},
    {"type": "python", "params": {
      "code": "scope.horizontal.fastframe.state = True\nscope.horizontal.fastframe.count = 50"
    }},
    {"type": "disconnect", "params": {}}
  ]
}
```

---

## Acquisition

### FastFrame Setup and Capture

[Your FastFrame article content here]

---

### FastAcq Mode

[Your FastAcq article content here]

---

## Analysis

### Search Operations

**Backend Required:** PyVISA (NOT TekHSI)

[Your search article content here]

---

### Histogram Analysis

**Backend Required:** PyVISA

[Your histogram article content here]

---

## Workflow Examples

### Example 1: FastFrame 50 Frames with Search Analysis

**Scenario:** Capture 50 FastFrame frames, open Search 1 & 2 results tables, check for hits over 400

**Backend:** PyVISA (because search requires SCPI commands)

**Complete Workflow:**
```json
{
  "name": "FastFrame + Search Analysis",
  "backend": "pyvisa",
  "deviceType": "SCOPE",
  "steps": [
    {
      "id": "1",
      "type": "connect",
      "label": "Connect to MSO6B",
      "params": {"printIdn": true}
    },
    {
      "id": "2",
      "type": "scpi_write",
      "label": "Enable FastFrame",
      "params": {"command": "HORizontal:FASTframe:STATE ON"}
    },
    {
      "id": "3",
      "type": "scpi_write",
      "label": "Set Frame Count",
      "params": {"command": "HORizontal:FASTframe:COUNt 50"}
    },
    {
      "id": "4",
      "type": "scpi_write",
      "label": "Enable Search 1",
      "params": {"command": "SEARCH:SEARCH1:STATE ON"}
    },
    {
      "id": "5",
      "type": "scpi_write",
      "label": "Open Search 1 Results Table",
      "params": {"command": "SEARCH:SEARCH1:RESULTSTABle:STATE ON"}
    },
    {
      "id": "6",
      "type": "scpi_write",
      "label": "Enable Search 2",
      "params": {"command": "SEARCH:SEARCH2:STATE ON"}
    },
    {
      "id": "7",
      "type": "scpi_write",
      "label": "Open Search 2 Results Table",
      "params": {"command": "SEARCH:SEARCH2:RESULTSTABle:STATE ON"}
    },
    {
      "id": "8",
      "type": "scpi_query",
      "label": "Get Search 1 Hit Count",
      "params": {
        "command": "SEARCH:SEARCH1:TOTal?",
        "saveAs": "search1_hits"
      }
    },
    {
      "id": "9",
      "type": "scpi_query",
      "label": "Get Search 2 Hit Count",
      "params": {
        "command": "SEARCH:SEARCH2:TOTal?",
        "saveAs": "search2_hits"
      }
    },
    {
      "id": "10",
      "type": "python",
      "label": "Check Hit Threshold",
      "params": {
        "code": "# Check if either search has over 400 hits\nif int(search1_hits) > 400:\n    print(f'⚠️ Search 1: {search1_hits} hits (threshold: 400)')\nif int(search2_hits) > 400:\n    print(f'⚠️ Search 2: {search2_hits} hits (threshold: 400)')"
      }
    },
    {
      "id": "11",
      "type": "disconnect",
      "label": "Disconnect",
      "params": {}
    }
  ]
}
```

[Continue with more examples...]

---

[Add all your other TekAcademy content here]
```

Then upload **one file** to GPT.

---

## 📤 Upload Process

1. **Open ChatGPT** → https://chat.openai.com
2. **Create Custom GPT** → "Explore GPTs" → "Create"
3. **Configure Tab**:
   - Paste system instructions from `CUSTOM_GPT_SYSTEM_PROMPT.md`
   - Enable "File Uploads" capability
4. **Knowledge Section**:
   - Click "Upload files"
   - Upload all markdown files OR single comprehensive markdown
5. **Test**:
   ```
   "Create a FastFrame 50 frames workflow with search analysis"
   ```
   Should now suggest PyVISA correctly!

---

## ✅ Verification

After upload, the GPT should:
- ✅ Suggest PyVISA for search/measurement workflows
- ✅ Reserve TekHSI for waveform capture only
- ✅ Provide tested examples from TekAcademy
- ✅ Reference best practices without naming files
- ✅ Explain backend choices correctly

---

## 🎯 Recommendation

**Best approach**: Option 1 (Extract to markdown files)
- Most reliable for GPT indexing
- Better searchability
- Easier to update individual articles
- GPT can reference specific topics precisely

Run the extraction script, upload all markdown files, and you're done! 🚀
