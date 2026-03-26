# tm_devices Browser - Quick Access Guide

## Two Ways to Access the tm_devices Command Browser

### 🎯 Method 1: From Builder (Add to Workflow)

**Purpose:** Add tm_devices commands to your automation workflow

**Steps:**
1. Navigate to the **Builder** tab
2. Click **+ Add Step** button
3. Select **tm_devices Command** from the palette (purple ⚡ icon)
4. In the step editor panel (right side), click **Browse Commands**
5. Navigate the tree and select a command
6. The command is added to your step
7. Continue building your workflow

**Visual Flow:**
```
Builder Tab → + Add Step → tm_devices Command → Browse Commands → Select → Added to Workflow
```

**When to use:**
- You want to add a tm_devices command to your automation
- You're building a workflow step-by-step
- You need the command to execute in your script

---

### 📚 Method 2: From Commands Tab (Add to Workflow)

**Purpose:** Browse tm_devices commands and add directly to workflow

**Steps:**
1. Navigate to the **Commands** tab
2. Click the purple **tm_devices Browser** button (with ⚡ icon)
3. Navigate the tree and explore commands
4. When you select a command, it's **added to your workflow**
5. You're automatically switched to **Builder** view
6. The new step is selected and ready to use

**Visual Flow:**
```
Commands Tab → tm_devices Browser Button → Navigate Tree → Select Method → 
Added to Workflow → Switch to Builder → Step Selected
```

**When to use:**
- You want to quickly add tm_devices commands
- You're browsing the command library
- You want to add commands without manually creating steps first
- You're exploring and building at the same time

---

## Visual Location Guide

### Builder Tab View
```
┌─────────────────────────────────────────────────────┐
│ [Builder] [Commands] [Templates] [Devices] [Layout]│
├─────────────────────────────────────────────────────┤
│                                                     │
│  Steps Flow           │  + Add Step                │
│  ┌──────────┐        │  ┌────────────────┐        │
│  │ Connect  │        │  │ Connect        │        │
│  │ Write    │        │  │ Query          │        │
│  │ Query    │        │  │ tm_devices Cmd │ ← Add │
│  └──────────┘        │  │ Python         │        │
│                      │  │ Sleep          │        │
│                      │  └────────────────┘        │
│                      │                             │
│                      │  Step Editor                │
│                      │  ┌────────────────────────┐│
│                      │  │ tm_devices Command     ││
│                      │  │ Model: MSO6B           ││
│                      │  │ [Browse Commands] ← Click│
│                      │  │ Code Preview...        ││
│                      │  └────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

### Commands Tab View
```
┌─────────────────────────────────────────────────────┐
│ [Builder] [Commands] [Templates] [Devices] [Layout]│
├─────────────────────────────────────────────────────┤
│ Categories  │ [Search...] [⚡ tm_devices Browser] ← Click │
│ ┌─────────┐│ ┌──────────────────────────────────┐│
│ │ All     ││ │ Command List                     ││
│ │ System  ││ │ ┌──────────────────────────────┐││
│ │ Acquire ││ │ │ *IDN?                        │││
│ │ Trigger ││ │ │ Query instrument ID          │││
│ │ Channel ││ │ ├──────────────────────────────┤││
│ └─────────┘│ │ │ CH1:SCALE                    │││
│            │ │ │ Set vertical scale           │││
│            │ │ └──────────────────────────────┘││
│            │ └──────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

---

## Comparison Matrix

| Aspect | Builder Access | Commands Tab Access |
|--------|---------------|-------------------|
| **Button Location** | Step editor panel | Top search bar |
| **Button Color** | Purple | Purple |
| **Button Icon** | ⚡ Zap | ⚡ Zap |
| **Button Text** | "Browse Commands" | "tm_devices Browser" |
| **Purpose** | Edit existing step | Add new step |
| **Result** | Updates selected step | Adds step + switches to Builder |
| **Workflow Impact** | Yes - updates step | Yes - adds step |
| **Best For** | Modifying commands | Quick command insertion |

---

## Usage Scenarios

### Scenario 1: Building a New Workflow
**Use:** Builder Access
1. Add tm_devices Command step
2. Browse and select: `ch[1].scale.write(1.0)`
3. Command added to workflow
4. Continue adding more steps
5. Export to Python

### Scenario 2: Quick Command Insertion from Commands Tab
**Use:** Commands Tab Access
1. Browse command library in Commands tab
2. Click tm_devices Browser button
3. Navigate: `ch[1]` → `scale` → `write(1.0)`
4. Command automatically added to workflow
5. Switched to Builder view
6. Step is selected and ready

### Scenario 3: Learning Before Building
**Use:** Commands Tab Access (Browse First)
1. Want to understand AFG frequency control
2. Open tm_devices Browser from Commands tab
3. Navigate tree to explore available commands
4. See: `source[1].frequency.write()`
5. Add command to workflow when ready
6. Continue building

### Scenario 4: Workflow Debugging
**Use:** Builder Access
1. Workflow has wrong command
2. Click the tm_devices Command step
3. Click Browse Commands
4. Navigate to correct command
5. Command is updated in step

---

## Tips

### Builder Access Tips
✅ Use this when you know you want to add a command  
✅ The selected command immediately populates the step  
✅ You can browse again to change the command  
✅ Command is ready to execute when you export  

### Commands Tab Access Tips
✅ Use this for exploration without commitment  
✅ Perfect for learning before building  
✅ No impact on your workflow  
✅ Great for quick syntax lookup  
✅ Info dialog shows model and code  

---

## Common Questions

### Q: Which access method should I use?
**A:** Use Builder access when building workflows, Commands tab access when learning or exploring.

### Q: Can I use Commands tab to add to workflow?
**A:** No, Commands tab is read-only. To add to workflow, use Builder access.

### Q: Do both methods show the same commands?
**A:** Yes, both use the same tm_devices command tree.

### Q: Can I access the browser multiple times?
**A:** Yes, browse as many times as needed from either location.

### Q: What if I pick the wrong command?
**A:** In Builder, just browse again to select a different command.

---

## Summary

**Two Access Points:**
1. **Builder → Add Step → Browse** (adds to workflow)
2. **Commands → tm_devices Browser** (explore only)

**Same Browser, Different Purpose:**
- Both use the same hierarchical tree
- Both support all instrument models
- Both generate valid Python code
- Different outcomes based on access point

**Choose Based on Intent:**
- Building workflow? Use Builder access
- Learning API? Use Commands tab access
- Both are valid and useful!
