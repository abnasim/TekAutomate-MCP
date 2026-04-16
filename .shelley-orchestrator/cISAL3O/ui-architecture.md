# TekAutomate UI Architecture

## useAiChat
```

```

## aiActions
```

```

## chatPanel
```

```

## appGrep
```
40:import { applyAiActionsToSteps } from './utils/aiActions';
6192:  const applyAiActionsAndRerun = useCallback(async (actions: AiAction[]) => {
6197:      const updated = applyAiActionsToSteps(snapshot as any, actions as any);
6202:      setSteps((prev) => applyAiActionsToSteps(prev as any, actions as any) as any);
8716:            onApplyAiActions={applyAiActionsAndRerun}

```

## pkg
```
{
  "name": "tek-script-generator",
  "version": "1.95",
  "description": "Tektronix Script Generator",
  "private": true,
  "main": "public/electron.js",
  "homepage": "https://abnasim.github.io/TekAutomate",
  "dependencies": {
    "@blockly/plugin-cross-tab-copy-paste": "^8.0.7",
    "@blockly/plugin-scroll-options": "^7.0.8",
    "@blockly/plugin-workspace-search": "^10.1.7",
    "@blockly/theme-modern": "^7.0.4",
    "@blockly/toolbox-search": "^3.1.8",
    "@codemirror/commands": "^6.10.1",
    "@codemirror/lang-python": "^6.2.1",
    "@codemirror/state": "^6.5.4",
    "@codemirror/theme-one-dark": "^6.1.3",
    "@codemirror/view": "^6.39.11",
    "@mit-app-inventor/blockly-plugin-workspace-multiselect": "^1.0.2",
    "@types/react-joyride": "^2.0.2",
    "blockly": "^12.3.1",
    "codemirror": "^6.0.2",
    "html5-qrcode": "^2.3.8",
    "jszip": "^3.10.1",
    "lucide-react": "^0.263.1",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-hook-form": "^7.71.2",
    "r
```

