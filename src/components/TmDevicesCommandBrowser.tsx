/* ===================== tm_devices Command Browser ===================== */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Search, X, ChevronRight, Hash, Code2, AlertCircle, BookOpen } from 'lucide-react';
import { getDocstring, ensureDocstringsLoaded, CommandDocstring } from './docstrings';
import { publicAssetUrl } from '../utils/publicUrl';

// Path node types
type PathNodeType = 'attr' | 'index' | 'method';

interface PathNode {
  type: PathNodeType;
  value: string | number;
}

// JSON tree node types
// Methods are represented as the string 'METHOD' in the tree
type TreeNodeValue = TreeNode | 'METHOD';
interface TreeNode {
  cmd_syntax?: string;
  [key: string]: any;
}

// Explicit node classification - deterministic, structure-based
enum NodeKind {
  NORMAL = 'NORMAL',          // non-indexed, has children
  FACTORY = 'FACTORY',        // indexed and has children (ch[x], math[x], meas[x], …)
  INDEXED_LEAF = 'INDEXED_LEAF',  // indexed but terminal (slot[x], plot[x], …)
  LEAF = 'LEAF'              // terminal, non-indexed
}

// Generated command
export interface TmDeviceCommand {
  code: string;
  model: string;
  path: PathNode[];
  description?: string;
  method?: string; // 'write', 'query', 'verify', etc.
  value?: string; // The value entered for write/verify methods
}

// Model info
interface ModelInfo {
  id: string;
  label: string;
  rootKey: string; // Key in the JSON tree
}

// Available models - Comprehensive list from tm_devices
const MODELS: ModelInfo[] = [
  // Oscilloscopes - MSO/DPO Series
  { id: 'MSO6B', label: 'MSO6B Series', rootKey: 'mso6b_commands.MSO6BCommands' },
  { id: 'MSO5B', label: 'MSO5B Series', rootKey: 'mso5b_commands.MSO5BCommands' },
  { id: 'MSO4B', label: 'MSO4B Series', rootKey: 'mso4b_commands.MSO4BCommands' },
  { id: 'MSO5', label: 'MSO5 Series', rootKey: 'mso5_commands.MSO5Commands' },
  { id: 'MSO4', label: 'MSO4 Series', rootKey: 'mso4_commands.MSO4Commands' },
  { id: 'MSO2', label: 'MSO2 Series', rootKey: 'mso2_commands.MSO2Commands' },
  { id: 'DPO7K', label: 'DPO7000 Series', rootKey: 'dpo7k_commands.DPO7KCommands' },
  { id: 'DPO5K', label: 'DPO5000 Series', rootKey: 'dpo5k_commands.DPO5KCommands' },
  { id: 'DPO4K', label: 'DPO4000 Series', rootKey: 'dpo4k_commands.DPO4KCommands' },
  { id: 'DPO2K', label: 'DPO2000 Series', rootKey: 'dpo2k_commands.DPO2KCommands' },
  { id: 'MDO3K', label: 'MDO3000 Series', rootKey: 'mdo3k_commands.MDO3KCommands' },
  { id: 'MDO4K', label: 'MDO4000 Series', rootKey: 'mdo4k_commands.MDO4KCommands' },
  { id: 'TekScopePC', label: 'TekScope PC', rootKey: 'tekscopepc_commands.TekScopePCCommands' },
  
  // Arbitrary Function Generators
  { id: 'AFG3K', label: 'AFG3000 Series', rootKey: 'afg3k_commands.AFG3KCommands' },
  { id: 'AFG31K', label: 'AFG31000 Series', rootKey: 'afg31k_commands.AFG31KCommands' },
  { id: 'AFG3KB', label: 'AFG3000B Series', rootKey: 'afg3kb_commands.AFG3KBCommands' },
  { id: 'AFG3KC', label: 'AFG3000C Series', rootKey: 'afg3kc_commands.AFG3KCCommands' },
  
  // Arbitrary Waveform Generators
  { id: 'AWG5K', label: 'AWG5000 Series', rootKey: 'awg5k_commands.AWG5KCommands' },
  { id: 'AWG5200', label: 'AWG5200 Series', rootKey: 'awg5200_commands.AWG5200Commands' },
  { id: 'AWG7K', label: 'AWG7000 Series', rootKey: 'awg7k_commands.AWG7KCommands' },
  { id: 'AWG70KA', label: 'AWG70000A Series', rootKey: 'awg70ka_commands.AWG70KACommands' },
  { id: 'AWG70KB', label: 'AWG70000B Series', rootKey: 'awg70kb_commands.AWG70KBCommands' },
  
  // Source Measure Units (SMU)
  { id: 'SMU2450', label: 'SMU2450', rootKey: 'smu2450_commands.SMU2450Commands' },
  { id: 'SMU2460', label: 'SMU2460', rootKey: 'smu2460_commands.SMU2460Commands' },
  { id: 'SMU2461', label: 'SMU2461', rootKey: 'smu2461_commands.SMU2461Commands' },
  { id: 'SMU2470', label: 'SMU2470', rootKey: 'smu2470_commands.SMU2470Commands' },
  { id: 'SMU2601B', label: 'SMU2601B', rootKey: 'smu2601b_commands.SMU2601BCommands' },
  { id: 'SMU2602B', label: 'SMU2602B', rootKey: 'smu2602b_commands.SMU2602BCommands' },
  { id: 'SMU2604B', label: 'SMU2604B', rootKey: 'smu2604b_commands.SMU2604BCommands' },
  { id: 'SMU2606B', label: 'SMU2606B', rootKey: 'smu2606b_commands.SMU2606BCommands' },
  { id: 'SMU2611B', label: 'SMU2611B', rootKey: 'smu2611b_commands.SMU2611BCommands' },
  { id: 'SMU2612B', label: 'SMU2612B', rootKey: 'smu2612b_commands.SMU2612BCommands' },
  { id: 'SMU2614B', label: 'SMU2614B', rootKey: 'smu2614b_commands.SMU2614BCommands' },
  { id: 'SMU2634B', label: 'SMU2634B', rootKey: 'smu2634b_commands.SMU2634BCommands' },
  { id: 'SMU2635B', label: 'SMU2635B', rootKey: 'smu2635b_commands.SMU2635BCommands' },
  { id: 'SMU2636B', label: 'SMU2636B', rootKey: 'smu2636b_commands.SMU2636BCommands' },
  { id: 'SMU2651A', label: 'SMU2651A', rootKey: 'smu2651a_commands.SMU2651ACommands' },
  { id: 'SMU2657A', label: 'SMU2657A', rootKey: 'smu2657a_commands.SMU2657ACommands' },
  
  // Digital Multimeters (DMM)
  { id: 'DMM6500', label: 'DMM6500', rootKey: 'dmm6500_commands.DMM6500Commands' },
  { id: 'DMM7510', label: 'DMM7510', rootKey: 'dmm7510_commands.DMM7510Commands' },
  { id: 'DMM7512', label: 'DMM7512', rootKey: 'dmm7512_commands.DMM7512Commands' },
  
  // Data Acquisition Systems (DAQ)
  { id: 'DAQ6510', label: 'DAQ6510', rootKey: 'daq6510_commands.DAQ6510Commands' },
  
  // Systems Switch/Mainframes
  { id: 'SS3706A', label: 'SS3706A', rootKey: 'ss3706a_commands.SS3706ACommands' },
];

// Props
export interface TmDevicesCommandBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (command: TmDeviceCommand) => void;
  selectedModel?: string;
  deviceAlias?: string;
  scpiCommandLibrary?: Array<any>;
  title?: string;
  buttonText?: string;
  initialPath?: string; // Path to navigate to when opening (e.g., "autoset.horizontal.enable")
}

export const TmDevicesCommandBrowser: React.FC<TmDevicesCommandBrowserProps> = ({
  isOpen,
  onClose,
  onSelect,
  selectedModel: initialModel,
  deviceAlias: initialDeviceAlias,
  scpiCommandLibrary = [],
  title = 'Browse tm_devices Commands',
  buttonText = 'Add Command',
  initialPath
}) => {
  const [treeData, setTreeData] = useState<Record<string, TreeNode> | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(initialModel || 'MSO6B');
  const [pathStack, setPathStack] = useState<PathNode[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [nodeSearch, setNodeSearch] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [indexInput, setIndexInput] = useState<string>('');
  const [showIndexPrompt, setShowIndexPrompt] = useState<string | null>(null);
  const [methodArgs, setMethodArgs] = useState<Record<string, string>>({});
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [docstringsLoading, setDocstringsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toPythonIdentifier = useCallback((raw: string | undefined): string => {
    const s = (raw || '').trim();
    if (!s) return '';
    const normalized = s
      .replace(/[^A-Za-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    return /^[A-Za-z_]/.test(normalized) ? normalized : `dev_${normalized}`;
  }, []);

  // Keep UI target alias in sync with code generation alias resolution
  const targetDeviceVar = useMemo(() => {
    const modelInfo = MODELS.find(m => m.id === selectedModel);
    const modelDefault = modelInfo?.id.toLowerCase().replace(/\d+/g, '') || 'device';
    return toPythonIdentifier(initialDeviceAlias) || toPythonIdentifier(modelDefault) || 'device';
  }, [selectedModel, initialDeviceAlias, toPythonIdentifier]);

  const availableModels = useMemo(() => {
    if (!treeData) return MODELS;
    return MODELS.filter((m) => !!treeData[m.rootKey]);
  }, [treeData]);

  // Load JSON tree on mount
  useEffect(() => {
    const loadTree = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(publicAssetUrl('commands/tm_devices_full_tree.json'));
        if (!response.ok) {
          throw new Error(`Failed to load tm_devices tree: ${response.statusText}`);
        }
        const data = await response.json();
        setTreeData(data);
      } catch (err) {
        console.error('Error loading tm_devices tree:', err);
        setError(err instanceof Error ? err.message : 'Failed to load command tree');
      } finally {
        setLoading(false);
      }
    };

    if (isOpen) {
      loadTree();
    }
  }, [isOpen]);

  // Load docstrings lazily (kept out of the main JS bundle)
  useEffect(() => {
    let cancelled = false;
    if (!isOpen) return () => { cancelled = true; };
    setDocstringsLoading(true);
    ensureDocstringsLoaded()
      .catch((err) => {
        console.error('Error loading tm_devices docstrings:', err);
      })
      .finally(() => {
        if (!cancelled) setDocstringsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Reset state when modal opens or model changes
  useEffect(() => {
    if (isOpen) {
      if (initialModel) setSelectedModel(initialModel);
      setPathStack([]);
      setExpandedNodes(new Set());
      setModelSearch('');
      setNodeSearch('');
      setIndexInput('');
      setShowIndexPrompt(null);
      setMethodArgs({});
      setSelectedMethod(null);
    }
  }, [isOpen, initialModel]);

  // If selected model isn't in the loaded tree, switch to first available model.
  useEffect(() => {
    if (!treeData || !availableModels.length) return;
    if (!availableModels.some((m) => m.id === selectedModel)) {
      setSelectedModel(availableModels[0].id);
    }
  }, [treeData, availableModels, selectedModel]);

  // Navigate to initial path when provided and tree is loaded
  useEffect(() => {
    if (isOpen && initialPath && treeData && !loading) {
      // Parse the initial path and build the path stack
      // Example: "autoset.horizontal.enable" -> navigate to "autoset.horizontal" so user sees "enable" as a child
      // Example: "ch[1].scale" -> navigate to "ch[1]" so user sees "scale" as a child
      const parsedPath: PathNode[] = [];
      const parts = initialPath.split('.');
      
      // Navigate to parent level (one step before the leaf) so user can see the command
      // If path is "autoset.horizontal.enable", navigate to "autoset.horizontal"
      const partsToNavigate = parts.length > 1 ? parts.slice(0, -1) : [];
      
      for (const part of partsToNavigate) {
        // Check for indexed part like "ch[1]"
        const indexMatch = part.match(/^(\w+)\[(\d+)\]$/);
        if (indexMatch) {
          parsedPath.push({ type: 'attr', value: indexMatch[1] });
          parsedPath.push({ type: 'index', value: indexMatch[2] });
        } else if (part) {
          parsedPath.push({ type: 'attr', value: part });
        }
      }
      
      if (parsedPath.length > 0) {
        setPathStack(parsedPath);
        // Don't set search - let user see all commands at this level
      }
    }
  }, [isOpen, initialPath, treeData, loading]);

  // Normalize indexed paths for lookup: ch[1] -> ch[x]
  // This is needed because JSON stores generic indexed nodes as [x], not concrete indices
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _normalizeIndexedPath = useCallback((path: string): string => {
    return path.replace(/\[\d+\]/g, '[x]');
  }, []);

  // Get current subtree based on path
  const getCurrentTree = useCallback((): TreeNode | null => {
    if (!treeData) return null;

    const modelInfo = MODELS.find(m => m.id === selectedModel);
    if (!modelInfo) return null;

    let current: any = treeData[modelInfo.rootKey];
    if (!current) return null;

    // Traverse path - normalize indexed paths for lookup
    // Key insight: Tree stores indexed factories as "ch[x]", "ref[x]", "math[x]", etc., 
    // not "ch" then "[x]". This applies to ALL indexed factories:
    // - ch[x], ref[x], math[x], meas[x], source[x], cursor[x], etc.
    // So when we have pathStack: [{type: 'attr', value: 'ch'}, {type: 'index', value: 1}]
    // We need to look for "ch[x]" directly, not "ch" first
    // Same logic works for ref[1] → ref[x], math[1] → math[x], etc.
    for (let i = 0; i < pathStack.length; i++) {
      const node = pathStack[i];
      
      if (node.type === 'attr') {
        // Check if next node is an index - if so, look for the [x] version directly
        // This works for ALL indexed factories: ch[x], ref[x], math[x], meas[x], source[x], etc.
        if (i + 1 < pathStack.length && pathStack[i + 1].type === 'index') {
          // Look for the indexed version (e.g., "ch[x]", "ref[x]", "math[x]") directly
          const indexedKey = `${node.value}[x]`;
          if (current && typeof current === 'object' && indexedKey in current) {
            current = current[indexedKey];
            i++; // Skip both the attr and index nodes since we've handled them together
            if (!current) return null;
            continue;
          }
          // If [x] version doesn't exist, try the base name (for non-indexed paths)
          current = current[node.value as string];
        } else {
          // No index following - normal attribute navigation
          current = current[node.value as string];
        }
        
        if (!current) return null;
      } else if (node.type === 'index') {
        // Index nodes are handled above when we see the previous attr node
        // If we reach here, it means there was no [x] version, so we can't navigate
        continue;
      }
      
      if (!current) return null;
    }

    return current;
  }, [treeData, selectedModel, pathStack]);

  // Known factory nodes that require indexing (common patterns)
  const FACTORY_NODES: Record<string, { label: string; options: Array<{ label: string; value: number }> }> = {
    'ch': { 
      label: 'Channel', 
      options: [
        { label: 'CH1', value: 1 },
        { label: 'CH2', value: 2 },
        { label: 'CH3', value: 3 },
        { label: 'CH4', value: 4 },
        { label: 'CH5', value: 5 },
        { label: 'CH6', value: 6 },
        { label: 'CH7', value: 7 },
        { label: 'CH8', value: 8 },
      ]
    },
    'math': { 
      label: 'Math', 
      options: [
        { label: 'MATH1', value: 1 },
        { label: 'MATH2', value: 2 },
        { label: 'MATH3', value: 3 },
        { label: 'MATH4', value: 4 },
      ]
    },
    'meas': { 
      label: 'Measurement', 
      options: [
        { label: 'MEAS1', value: 1 },
        { label: 'MEAS2', value: 2 },
        { label: 'MEAS3', value: 3 },
        { label: 'MEAS4', value: 4 },
      ]
    },
    'source': { 
      label: 'Source', 
      options: [
        { label: 'Source 1', value: 1 },
        { label: 'Source 2', value: 2 },
        { label: 'Source 3', value: 3 },
        { label: 'Source 4', value: 4 },
      ]
    },
    'cursor': { 
      label: 'Cursor', 
      options: [
        { label: 'Cursor 1', value: 1 },
        { label: 'Cursor 2', value: 2 },
      ]
    },
  };

  // Check if current path ends at a factory node
  const isAtFactoryNode = useCallback((): { isFactory: boolean; factoryInfo?: { label: string; options: Array<{ label: string; value: number }> } } => {
    if (pathStack.length === 0) return { isFactory: false };
    
    const lastNode = pathStack[pathStack.length - 1];
    if (lastNode.type === 'attr') {
      const nodeName = lastNode.value as string;
      const factoryInfo = FACTORY_NODES[nodeName.toLowerCase()];
      if (factoryInfo) {
        return { isFactory: true, factoryInfo };
      }
      
      // Also check if the tree shows this node has indexed children
      const current = getCurrentTree();
      if (current) {
        for (const key of Object.keys(current)) {
          if (key.includes('[x]') && key.replace('[x]', '').toLowerCase() === nodeName.toLowerCase()) {
            // Found indexed child - this is a factory node
            // Try to infer options from common patterns
            const inferredFactory = FACTORY_NODES[nodeName.toLowerCase()] || {
              label: nodeName.charAt(0).toUpperCase() + nodeName.slice(1),
              options: [
                { label: `${nodeName}1`, value: 1 },
                { label: `${nodeName}2`, value: 2 },
                { label: `${nodeName}3`, value: 3 },
                { label: `${nodeName}4`, value: 4 },
              ]
            };
            return { isFactory: true, factoryInfo: inferredFactory };
          }
        }
      }
    }
    
    return { isFactory: false };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathStack, getCurrentTree]);

  /**
   * Canonical classification algorithm (authoritative)
   * Classifies nodes based on structure, not labels
   * This runs when building the browser tree
   */
  const classifyNode = useCallback((key: string, node: TreeNodeValue, currentTree: TreeNode | null): NodeKind => {
    // Check if it's a method (methods are represented as the string 'METHOD' in the tree)
    if (node === 'METHOD') {
      return NodeKind.LEAF; // Methods are terminal
    }

    if (!node || typeof node !== 'object') {
      return NodeKind.LEAF;
    }

    const isIndexed = key.includes('[x]');
    const methodKeys = new Set(['write', 'query', 'verify', 'cmd_syntax']);
    
    // Get all child keys (excluding special keys)
    const childKeys = Object.keys(node).filter(k => k !== 'cmd_syntax');
    
    // Filter out method-only children
    const nonMethodChildren = childKeys.filter(k => !methodKeys.has(k));
    
    // Check if indexed
    if (isIndexed) {
      // Indexed node with non-method descendants → FACTORY
      if (nonMethodChildren.length > 0) {
        return NodeKind.FACTORY;
      }
      // Indexed node with only methods → INDEXED_LEAF
      return NodeKind.INDEXED_LEAF;
    }
    
    // Non-indexed node
    // If it has children (beyond methods), it's NORMAL
    if (nonMethodChildren.length > 0) {
      return NodeKind.NORMAL;
    }
    
    // Terminal node (only methods or cmd_syntax: "LEAF")
    return NodeKind.LEAF;
  }, []);

  // Legacy helper for backward compatibility
  const isIndexedFactory = useCallback((node: TreeNode, key: string): boolean => {
    if (!key.includes('[x]') || typeof node !== 'object' || node === null) {
      return false;
    }
    
    const methodKeys = new Set(['write', 'query', 'verify', 'cmd_syntax']);
    let hasNonMethodChildren = false;
    
    for (const childKey of Object.keys(node)) {
      if (!methodKeys.has(childKey)) {
        hasNonMethodChildren = true;
        break;
      }
    }
    
    return hasNonMethodChildren;
  }, []);

  /**
   * Visibility predicate: determines if a node should be shown to the user
   * A node is visible only if it is semantically actionable:
   * 1. Has children beyond write, query, verify (navigable structure)
   * 2. Has meaningful SCPI syntax (check via docstrings)
   * 3. Has parameters (check via docstrings)
   * 
   * This filters out internal framework nodes and utility commands.
   */
  const isNodeVisible = useCallback((key: string, node: TreeNodeValue, kind: NodeKind, currentPath: string): boolean => {
    // Methods are always visible (they're actionable)
    if (node === 'METHOD') {
      return true;
    }

    // Factories and indexed leaves are always visible (they have structure)
    if (kind === NodeKind.FACTORY || kind === NodeKind.INDEXED_LEAF) {
      return true;
    }

    // Normal nodes (with children) are always visible
    if (kind === NodeKind.NORMAL) {
      return true;
    }

    // For LEAF nodes, check if they have semantic value
    if (kind === NodeKind.LEAF && typeof node === 'object' && node !== null) {
      // Check if it has children beyond just methods
      const methodKeys = new Set(['write', 'query', 'verify', 'cmd_syntax']);
      const childKeys = Object.keys(node).filter(k => k !== 'cmd_syntax');
      const nonMethodChildren = childKeys.filter(k => !methodKeys.has(k));
      
      // If it has non-method children, it's visible
      if (nonMethodChildren.length > 0) {
        return true;
      }

      // Check if it has methods (write, query, verify) - these are actionable
      const hasMethods = childKeys.some(k => methodKeys.has(k));
      if (!hasMethods) {
        return false; // No methods, no children - internal node
      }

      // For leaf nodes with only methods, check if there's meaningful documentation
      // Build the full path for docstring lookup
      const modelInfo = MODELS.find(m => m.id === selectedModel);
      if (modelInfo) {
        const fullPath = currentPath ? `${currentPath}.${key}` : key;
        
        // Try to get docstring synchronously (if loaded)
        try {
          const { getDocstring } = require('./docstrings');
          const docstring = getDocstring(selectedModel, fullPath);
          
          // Visible if it has SCPI syntax or description
          if (docstring && (docstring.scpiSyntax || docstring.description)) {
            return true;
          }
        } catch {
          // Docstrings not loaded yet - be permissive
        }
      }

      // If we can't check docstrings, show it if it has methods (better to show than hide)
      return hasMethods;
    }

    // Default: hide if we can't determine visibility
    return false;
  }, [selectedModel]);

  // Generate current path string (moved before getTreeNodes to avoid dependency issues)
  const getPathString = useCallback((): string => {
    if (pathStack.length === 0) return '';

    let result = '';
    for (const node of pathStack) {
      if (node.type === 'attr') {
        result += (result ? '.' : '') + node.value;
      } else if (node.type === 'index') {
        result += `[${node.value}]`;
      }
    }
    return result;
  }, [pathStack]);

  // Get tree nodes at current level with canonical classification
  const getTreeNodes = useCallback((): Array<{ key: string; node: TreeNode; kind: NodeKind; isIndexed: boolean; isMethod: boolean; isLeaf: boolean; isIndexedFactory: boolean; isIndexedLeaf: boolean }> => {
    const current = getCurrentTree();
    if (!current) return [];

    const nodes: Array<{ key: string; node: TreeNode; kind: NodeKind; isIndexed: boolean; isMethod: boolean; isLeaf: boolean; isIndexedFactory: boolean; isIndexedLeaf: boolean }> = [];
    const currentPath = getPathString();

    for (const [key, value] of Object.entries(current)) {
      // Skip special keys
      if (key === 'cmd_syntax') continue;

      // Classify node using canonical algorithm
      const kind = classifyNode(key, value as TreeNodeValue, current);
      const isIndexed = key.includes('[x]');
      const isMethod = value === 'METHOD';
      
      // Apply visibility filter - only show semantically actionable nodes
      if (!isNodeVisible(key, value as TreeNodeValue, kind, currentPath)) {
        continue; // Skip internal/utility nodes
      }
      
      // Map NodeKind to legacy boolean flags for backward compatibility
      const isIndexedFactory = kind === NodeKind.FACTORY;
      const isIndexedLeaf = kind === NodeKind.INDEXED_LEAF;
      const isLeaf = kind === NodeKind.LEAF || kind === NodeKind.INDEXED_LEAF;
      
      nodes.push({ 
        key, 
        node: value as TreeNode, 
        kind,
        isIndexed, 
        isMethod, 
        isLeaf,
        isIndexedFactory,
        isIndexedLeaf
      });
    }

    return nodes.sort((a, b) => {
      // Sort: NORMAL, FACTORY, INDEXED_LEAF, LEAF, then methods
      const kindOrder: Record<NodeKind, number> = {
        [NodeKind.NORMAL]: 0,
        [NodeKind.FACTORY]: 1,
        [NodeKind.INDEXED_LEAF]: 2,
        [NodeKind.LEAF]: 3
      };
      const aScore = a.isMethod ? 4 : kindOrder[a.kind] ?? 3;
      const bScore = b.isMethod ? 4 : kindOrder[b.kind] ?? 3;
      if (aScore !== bScore) return aScore - bScore;
      return a.key.localeCompare(b.key);
    });
  }, [getCurrentTree, classifyNode, isNodeVisible, getPathString]);

  // Filter nodes by search
  const nodeOrDescendantMatchesQuery = useCallback((node: TreeNodeValue, queryTokens: string[], maxDepth = 4, depth = 0): boolean => {
    if (queryTokens.length === 0) return true;
    if (!node || typeof node !== 'object') return false;
    if (depth > maxDepth) return false;

    const keyMatches = (rawKey: string) => {
      const key = rawKey.toLowerCase();
      const keyNoBrackets = key.replace(/[\][]]/g, '');
      return queryTokens.every((tok) => {
        const forms = [
          tok,
          tok.replace(/[:.[\]\s]/g, ''),
          tok.replace(/\d+/g, ''),
        ].filter((f, idx, arr) => !!f && arr.indexOf(f) === idx);
        for (const f of forms) {
          if (key.includes(f) || keyNoBrackets.includes(f)) return true;
        }
        return false;
      });
    };

    for (const [childKey, childValue] of Object.entries(node)) {
      if (childKey === 'cmd_syntax') continue;
      if (keyMatches(childKey)) return true;
      if (typeof childValue === 'object' && nodeOrDescendantMatchesQuery(childValue as TreeNodeValue, queryTokens, maxDepth, depth + 1)) {
        return true;
      }
    }
    return false;
  }, []);

  const filteredNodes = useMemo(() => {
    const nodes = getTreeNodes();
    if (!nodeSearch.trim()) return nodes;

    const rawQuery = nodeSearch.toLowerCase().trim();
    const queryTokens = rawQuery
      .split(/[:.\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    return nodes.filter(({ key, node }) => {
      const keyLc = key.toLowerCase();
      const keyNoBrackets = keyLc.replace(/[\][]]/g, '');
      const directMatch = queryTokens.every((tok) => {
        const forms = [
          tok,
          tok.replace(/[:.[\]\s]/g, ''),
          tok.replace(/\d+/g, ''),
        ].filter((f, idx, arr) => !!f && arr.indexOf(f) === idx);
        for (const f of forms) {
          if (keyLc.includes(f) || keyNoBrackets.includes(f)) return true;
        }
        return false;
      });
      if (directMatch) return true;
      return nodeOrDescendantMatchesQuery(node as TreeNodeValue, queryTokens);
    });
  }, [getTreeNodes, nodeSearch, nodeOrDescendantMatchesQuery]);

  // Generate a human-readable label from code
  // Examples: "mso.commands.opc.query()" -> "OPC Query"
  //           "mso.commands.ch[1].scale.write(1.0)" -> "Channel Scale"
  const generateLabel = useCallback((code: string, method: string): string => {
    if (!code) return 'tm_devices Command';
    
    // Extract the meaningful parts (remove device var and .commands)
    const parts = code.replace(/^[^.]+\.commands\./, '').split('.');
    const methodPart = method.charAt(0).toUpperCase() + method.slice(1);
    
    // Get the last meaningful part before the method
    const lastPart = parts[parts.length - 2] || parts[parts.length - 1] || '';
    const cleanPart = lastPart.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '');
    
    // Capitalize and format
    const formatted = cleanPart
      .split(/(?=[A-Z])/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    
    return formatted ? `${formatted} ${methodPart}` : `${methodPart} Command`;
  }, []);

  // Check if current path ends with an indexed leaf node
  // This happens when we navigate to an indexed leaf like slot[x] (which only has methods, no children)
  const isCurrentPathIndexedLeaf = useCallback((): boolean => {
    if (pathStack.length === 0) return false;
    
    // Check if the last node in pathStack is an attr that corresponds to an indexed leaf
    const lastNode = pathStack[pathStack.length - 1];
    if (lastNode.type !== 'attr') return false;
    
    // Navigate to parent to check for [x] version
    const parentPath = pathStack.slice(0, -1);
    const modelInfo = MODELS.find(m => m.id === selectedModel);
    if (!modelInfo || !treeData) return false;
    
    let parent: any = treeData[modelInfo.rootKey];
    if (!parent) return false;
    
    // Navigate to parent level
    for (const node of parentPath) {
      if (node.type === 'attr') {
        parent = parent?.[node.value as string];
        if (!parent) return false;
        
        // Check if next is index - if so, navigate into [x] version
        const nextIdx = parentPath.indexOf(node) + 1;
        if (nextIdx < parentPath.length && parentPath[nextIdx].type === 'index') {
          const indexedKey = `${node.value}[x]`;
          if (parent && typeof parent === 'object' && indexedKey in parent) {
            parent = parent[indexedKey];
          }
        }
      }
    }
    
    // Check if parent has indexed version of last node
    const indexedKey = `${lastNode.value}[x]`;
    if (parent && typeof parent === 'object' && indexedKey in parent) {
      const indexedNode = parent[indexedKey];
      return !isIndexedFactory(indexedNode, indexedKey);
    }
    
    return false;
  }, [pathStack, treeData, selectedModel, isIndexedFactory]);

  // Extract valid values from SCPI syntax like "{ON|OFF|1|0}" or "{SAMPLE|PEAKDETECT|HIRES|...}"
  const extractValidValues = useCallback((scpiSyntax: string | undefined): string[] => {
    if (!scpiSyntax) return [];
    
    // Match content inside curly braces: {ON|OFF|1|0} or {CH<x>|MATH<x>|...}
    const match = scpiSyntax.match(/\{([^}]+)\}/);
    if (!match) return [];
    
    // Split by | and clean up
    let values = match[1].split('|').map(v => v.trim()).filter(v => v && v !== '...');
    
    // Expand patterns like CH<x>, MATH<x>, REF<x>, etc.
    const expanded: string[] = [];
    for (const val of values) {
      // Check for common channel/source patterns
      if (val.includes('<x>') || val.includes('<X>')) {
        const base = val.replace(/<x>|<X>/gi, '');
        
        // Determine the range based on the base pattern
        if (base.match(/^CH$/i)) {
          // Channels: CH1-CH8
          for (let i = 1; i <= 8; i++) {
            expanded.push(`${base}${i}`);
          }
        } else if (base.match(/^MATH$/i)) {
          // Math channels: MATH1-MATH4
          for (let i = 1; i <= 4; i++) {
            expanded.push(`${base}${i}`);
          }
        } else if (base.match(/^REF$/i)) {
          // Reference channels: REF1-REF4
          for (let i = 1; i <= 4; i++) {
            expanded.push(`${base}${i}`);
          }
        } else if (base.match(/^B$/i) || base.match(/^BUS$/i)) {
          // Bus channels: B1-B8
          for (let i = 1; i <= 8; i++) {
            expanded.push(`${base}${i}`);
          }
        } else if (base.match(/^MEAS$/i)) {
          // Measurements: MEAS1-MEAS8
          for (let i = 1; i <= 8; i++) {
            expanded.push(`${base}${i}`);
          }
        } else if (base.match(/^SEARCH$/i)) {
          // Searches: SEARCH1-SEARCH8
          for (let i = 1; i <= 8; i++) {
            expanded.push(`${base}${i}`);
          }
        } else if (base.match(/^CURSOR$/i)) {
          // Cursors: CURSOR1-CURSOR2
          for (let i = 1; i <= 2; i++) {
            expanded.push(`${base}${i}`);
          }
        } else {
          // Generic numbered pattern - assume 1-4
          for (let i = 1; i <= 4; i++) {
            expanded.push(`${base}${i}`);
          }
        }
      } else {
        // No pattern to expand - use as-is
        expanded.push(val);
      }
    }
    
    return expanded;
  }, []);

  // Get current docstring for value suggestions
  const getCurrentDocstring = useCallback(() => {
    const commandPath = getPathString();
    if (!commandPath) return null;
    
    // Use the proper getDocstring function which handles all lookup logic
    let docstring = getDocstring(selectedModel, commandPath);
    if (docstring) return docstring;
    
    // Try without .write/.query suffix
    const basePath = commandPath.replace(/\.(write|query|verify)$/, '');
    docstring = getDocstring(selectedModel, basePath);
    if (docstring) return docstring;
    
    // Walk up the path tree to find valid entries
    const parts = commandPath.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const partialPath = parts.slice(0, i).join('.');
      docstring = getDocstring(selectedModel, partialPath);
      if (docstring) return docstring;
    }
    
    return null;
  }, [getPathString, selectedModel]);

  const normalizeScpiHeader = useCallback((value: string): string => {
    return (value || '')
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/\?$/, '')
      .replace(/[^A-Z0-9:]/g, '');
  }, []);

  const getScpiSyntaxForPath = useCallback((commandPath: string): string | undefined => {
    if (!commandPath || !scpiCommandLibrary.length) return undefined;
    const targetHeader = normalizeScpiHeader(commandPath.replace(/\./g, ':'));
    if (!targetHeader) return undefined;

    const getCandidateSyntax = (cmd: any): string | undefined => {
      const syntaxCandidates: string[] = [];
      const rawSyntax = cmd?.syntax;
      if (Array.isArray(rawSyntax)) {
        syntaxCandidates.push(...rawSyntax.filter((s: any) => typeof s === 'string').map((s: string) => s.trim()));
      } else if (typeof rawSyntax === 'string' && rawSyntax.trim()) {
        syntaxCandidates.push(rawSyntax.trim());
      }

      const manualSet = cmd?.manualEntry?.syntax?.set;
      const manualQuery = cmd?.manualEntry?.syntax?.query;
      if (typeof manualSet === 'string' && manualSet.trim()) syntaxCandidates.push(manualSet.trim());
      if (typeof manualQuery === 'string' && manualQuery.trim()) syntaxCandidates.push(manualQuery.trim());
      if (typeof cmd?._manualEntry?.syntax?.set === 'string' && cmd._manualEntry.syntax.set.trim()) syntaxCandidates.push(cmd._manualEntry.syntax.set.trim());
      if (typeof cmd?._manualEntry?.syntax?.query === 'string' && cmd._manualEntry.syntax.query.trim()) syntaxCandidates.push(cmd._manualEntry.syntax.query.trim());
      if (typeof cmd?.scpi === 'string' && cmd.scpi.trim()) syntaxCandidates.push(cmd.scpi.trim());

      if (!syntaxCandidates.length) return undefined;

      // Prefer syntaxes that expose argument structure
      const ranked = syntaxCandidates
        .filter(Boolean)
        .sort((a, b) => {
          const score = (v: string) => (/\{[^}]+\}/.test(v) ? 3 : 0) + (/<[^>]+>/.test(v) ? 2 : 0) + (v.includes('?') ? 0 : 1);
          return score(b) - score(a);
        });
      return ranked[0];
    };

    let bestMatch: string | undefined;
    let bestScore = -1;
    for (const cmd of scpiCommandLibrary) {
      const syntax = getCandidateSyntax(cmd);
      if (!syntax) continue;
      const cmdHeader = normalizeScpiHeader(String(syntax).split(' ')[0] || '');
      if (cmdHeader !== targetHeader) continue;
      const score = (/\{[^}]+\}/.test(syntax) ? 3 : 0) + (/<[^>]+>/.test(syntax) ? 2 : 0) + (syntax.includes('?') ? 0 : 1);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = syntax;
      }
    }
    return bestMatch;
  }, [normalizeScpiHeader, scpiCommandLibrary]);

  const getEffectiveScpiSyntax = useCallback((): string | undefined => {
    const doc = getCurrentDocstring();
    if (doc?.scpiSyntax) return doc.scpiSyntax;
    return getScpiSyntaxForPath(getPathString());
  }, [getCurrentDocstring, getPathString, getScpiSyntaxForPath]);

  const methodNeedsValueInput = useCallback((methodName: string): boolean => {
    if (!['write', 'verify'].includes(methodName)) return false;
    const syntax = (getEffectiveScpiSyntax() || '').trim();
    if (!syntax) return true; // Unknown syntax: keep input available.
    const firstToken = syntax.split(/\s+/)[0] || '';
    const tail = syntax.slice(firstToken.length).trim();
    return tail.length > 0;
  }, [getEffectiveScpiSyntax]);

  // Generate Python code
  const generateCode = useCallback((method: string, args: Record<string, string> = {}): string => {
    const modelInfo = MODELS.find(m => m.id === selectedModel);
    const modelDefault = modelInfo?.id.toLowerCase().replace(/\d+/g, '') || 'device';
    const deviceVar = toPythonIdentifier(initialDeviceAlias) || toPythonIdentifier(modelDefault) || 'device';

    let code = deviceVar + '.commands';
    
    // Check if we're dealing with an indexed leaf - if so, index comes from args, not pathStack
    const isIndexedLeafPath = isCurrentPathIndexedLeaf();
    let indexFromArgs: number | null = null;
    
    for (const node of pathStack) {
      if (node.type === 'attr') {
        code += '.' + node.value;
      } else if (node.type === 'index') {
        // For indexed leaves, don't add index to path - it will be a parameter
        if (!isIndexedLeafPath) {
          code += `[${node.value}]`;
        } else {
          // Store index for later use as parameter
          indexFromArgs = node.value as number;
        }
      }
    }

    code += '.' + method;

    // Serialize arguments correctly
    const serializedArgs: string[] = [];
    
    // For indexed leaves, the index is the first parameter (from methodArgs, not pathStack)
    if (isIndexedLeafPath) {
      const indexArg = args['index'] || indexFromArgs?.toString();
      if (indexArg) {
        serializedArgs.push(indexArg);
      }
    }
    
    for (const [key, value] of Object.entries(args)) {
      // Skip index for indexed leaves (already added above)
      if (isIndexedLeafPath && key === 'index') continue;
      
      const trimmed = value.trim();
      if (!trimmed) continue;

      // Detect if value needs quoting
      const needsQuoting = !isAlreadyValidPython(trimmed);
      
      if (needsQuoting) {
        // Auto-quote strings (QString handling)
        // Escape internal quotes
        const escaped = trimmed.replace(/"/g, '\\"');
        serializedArgs.push(`"${escaped}"`);
      } else {
        // Already valid Python (number, boolean, etc.)
        serializedArgs.push(trimmed);
      }
    }

    if (serializedArgs.length > 0) {
      code += '(' + serializedArgs.join(', ') + ')';
    } else {
      code += '()';
    }

    return code;
  }, [pathStack, selectedModel, isCurrentPathIndexedLeaf, initialDeviceAlias, toPythonIdentifier]);

  // Helper: Check if value is already valid Python literal
  const isAlreadyValidPython = (value: string): boolean => {
    // Already quoted string
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      return true;
    }
    
    // Number (int or float, including scientific notation)
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
      return true;
    }
    
    // Boolean
    if (value === 'True' || value === 'False') {
      return true;
    }
    
    // None
    if (value === 'None') {
      return true;
    }
    
    // List or tuple (starts with [ or ()
    if (value.startsWith('[') || value.startsWith('(')) {
      return true;
    }
    
    // Everything else needs quoting (QString)
    return false;
  };

  // Handle node click - behavior based on NodeKind
  const handleNodeClick = (key: string, kind: NodeKind, isMethod: boolean) => {
    if (isMethod) {
      // METHOD: Show argument input
      setSelectedMethod(key);
      return;
    }

    switch (kind) {
      case NodeKind.FACTORY:
        // FACTORY (ch[x], math[x], ...): Show index selector
        setNodeSearch('');
        setShowIndexPrompt(key);
        setIndexInput('');
        return;

      case NodeKind.INDEXED_LEAF:
        // INDEXED_LEAF (slot[x], plot.plot[x], ...): Do not navigate
        // Show inline parameter UI - methods will be shown, index is a parameter
        const cleanKey = key.replace('[x]', '');
        setNodeSearch('');
        setPathStack([...pathStack, { type: 'attr', value: cleanKey }]);
        return;

      case NodeKind.LEAF:
        // LEAF: Show methods only, no navigation
        const leafKey = key.replace('[x]', '');
        setNodeSearch('');
        setPathStack([...pathStack, { type: 'attr', value: leafKey }]);
        return;

      case NodeKind.NORMAL:
      default:
        // NORMAL: Navigate and show children
        const normalKey = key.replace('[x]', '');
        setNodeSearch('');
        setPathStack([...pathStack, { type: 'attr', value: normalKey }]);
        return;
    }
  };

  // Handle index submission
  const handleIndexSubmit = () => {
    if (!showIndexPrompt) return;

    const idx = parseInt(indexInput, 10);
    if (isNaN(idx) || idx < 0) {
      alert('Please enter a valid integer index (0 or greater)');
      return;
    }

    const cleanKey = showIndexPrompt.replace('[x]', '');
    setPathStack([
      ...pathStack,
      { type: 'attr', value: cleanKey },
      { type: 'index', value: idx }
    ]);
    setNodeSearch('');
    setShowIndexPrompt(null);
    setIndexInput('');
  };

  // Handle method submission
  const handleMethodSubmit = () => {
    if (!selectedMethod) return;

    const code = generateCode(selectedMethod, methodArgs);
    const label = generateLabel(code, selectedMethod);
    
    // Get the value based on method type
    let enteredValue: string | undefined;
    if (selectedMethod === 'write') {
      enteredValue = methodArgs['value'];
    } else if (selectedMethod === 'verify') {
      enteredValue = methodArgs['expected'];
    }
    
    const command: TmDeviceCommand = {
      code,
      model: selectedModel,
      path: [...pathStack, { type: 'method', value: selectedMethod }],
      description: label,
      method: selectedMethod,
      value: enteredValue
    };

    onSelect(command);
    onClose();
  };

  // Handle back navigation
  const handleBack = () => {
    if (pathStack.length > 0) {
      setNodeSearch('');
      setPathStack(pathStack.slice(0, -1));
    }
  };

  // Toggle node expansion (for UI visual feedback)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _toggleExpanded = (key: string) => {
    const newSet = new Set(expandedNodes);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    setExpandedNodes(newSet);
  };

  // Handle close without triggering Blockly focus issues
  const handleClose = () => {
    setTimeout(() => onClose(), 10);
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]" onClick={handleClose}>
        <div
          className="bg-white rounded-lg shadow-xl w-full h-full max-w-[98vw] max-h-[98vh] flex flex-col m-4"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-4 border-b flex items-center justify-between bg-gradient-to-r from-purple-50 to-white flex-shrink-0">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{title}</h2>
              <p className="text-xs text-gray-600 mt-1">
                Hierarchical command browser for tm_devices Python framework • {availableModels.length} instrument models
              </p>
            </div>
            <button onClick={handleClose} className="p-2 hover:bg-gray-100 rounded transition">
              <X size={20} />
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Left Sidebar - Model Selector */}
            <div className="w-64 border-r bg-gray-50 overflow-y-auto flex-shrink-0">
              <div className="p-3 border-b bg-white sticky top-0 z-[5]">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Instrument Model</h3>
                <div className="relative">
                  <Search className="absolute left-2 top-2 text-gray-400" size={14} />
                  <input
                    type="text"
                    placeholder="Search models..."
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    className="w-full pl-7 pr-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>
              </div>
              <div className="p-2 space-y-1">
                {availableModels.filter(m => 
                  modelSearch === '' || 
                  m.label.toLowerCase().includes(modelSearch.toLowerCase()) ||
                  m.id.toLowerCase().includes(modelSearch.toLowerCase())
                ).map(model => (
                  <button
                    key={model.id}
                    onClick={() => setSelectedModel(model.id)}
                    className={`w-full text-left px-3 py-2 text-sm rounded transition ${
                      selectedModel === model.id
                        ? 'bg-purple-100 text-purple-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {model.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Middle - Tree View */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Breadcrumb / Path Display */}
              <div className="p-3 border-b bg-gray-50 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 text-sm min-w-0 flex-1 flex-wrap">
                  <span className="text-gray-600 font-medium flex-shrink-0">Path:</span>
                  <code className="px-2 py-1 bg-white border rounded text-purple-600 font-mono text-xs truncate">
                    {(() => {
                      const pathStr = getPathString();
                      return pathStr 
                        ? `${targetDeviceVar}.commands.${pathStr}` 
                        : `${targetDeviceVar}.commands`;
                    })()}
                  </code>
                  <span className="text-gray-500 font-medium flex-shrink-0">Target device:</span>
                  <code className="px-2 py-1 bg-purple-50 border border-purple-200 rounded text-purple-700 font-mono text-xs">
                    {targetDeviceVar}
                  </code>
                </div>
                {pathStack.length > 0 && (
                  <button
                    onClick={handleBack}
                    className="px-3 py-1 text-sm bg-white border rounded hover:bg-gray-100 transition flex-shrink-0 ml-2"
                  >
                    ← Back
                  </button>
                )}
              </div>
              <div className="px-3 py-2 border-b bg-white flex-shrink-0">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 text-gray-400" size={14} />
                  <input
                    type="text"
                    placeholder="Filter commands at this level..."
                    value={nodeSearch}
                    onChange={(e) => setNodeSearch(e.target.value)}
                    className="w-full pl-8 pr-8 py-2 text-xs border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                  {nodeSearch && (
                    <button
                      type="button"
                      onClick={() => setNodeSearch('')}
                      className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-700"
                      title="Clear filter"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Tree View */}
              <div className="flex-1 overflow-y-auto p-4 bg-white">
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
                      <p className="text-gray-600">Loading command tree...</p>
                    </div>
                  </div>
                ) : error ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-red-600">
                      <AlertCircle size={48} className="mx-auto mb-4" />
                      <p className="font-medium">{error}</p>
                      <p className="text-sm text-gray-600 mt-2">
                        Make sure tm_devices_full_tree.json is in /public/commands/
                      </p>
                    </div>
                  </div>
                ) : (() => {
                  // Check if we're at a factory node with no visible children
                  const factoryCheck = isAtFactoryNode();
                  const nodes = filteredNodes;
                  
                  // If at factory node and no indexed children visible, show factory selector
                  if (factoryCheck.isFactory && factoryCheck.factoryInfo && nodes.length === 0) {
                    return (
                      <div className="flex items-center justify-center h-full">
                        <div className="text-center max-w-md">
                          <Hash size={48} className="mx-auto mb-4 text-blue-500" />
                          <p className="font-medium text-lg mb-2">Indexed Factory Node</p>
                          <p className="text-sm text-gray-600 mb-6">
                            This is an indexed factory node. Select an index to continue browsing commands.
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {factoryCheck.factoryInfo.options.map((option) => (
                              <button
                                key={option.value}
                                onClick={() => {
                                  const lastNode = pathStack[pathStack.length - 1];
                                  if (lastNode && lastNode.type === 'attr') {
                                    setNodeSearch('');
                                    setPathStack([
                                      ...pathStack,
                                      { type: 'index', value: option.value }
                                    ]);
                                  }
                                }}
                                className="p-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition text-left"
                              >
                                <div className="font-semibold text-blue-900">{option.label}</div>
                                <div className="text-xs text-blue-600">Index: {option.value}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  
                  // No factory node or has children - show normal empty state or nodes
                  if (nodes.length === 0) {
                    return (
                      <div className="flex items-center justify-center h-full">
                        <div className="text-center text-gray-500">
                          <Search size={48} className="mx-auto mb-4 text-gray-300" />
                          <p className="font-medium">No commands found</p>
                          <p className="text-sm mt-2">Try adjusting your search</p>
                        </div>
                      </div>
                    );
                  }
                  
                  return (
                  <div className="space-y-2 max-w-4xl">
                    {filteredNodes.map(({ key, kind, isIndexed, isMethod, isLeaf, isIndexedFactory, isIndexedLeaf }) => (
                      <button
                        key={key}
                        onClick={() => handleNodeClick(key, kind, isMethod)}
                        className={`w-full text-left p-3 rounded-lg border transition flex items-center justify-between group ${
                          isMethod
                            ? 'bg-green-50 border-green-200 hover:bg-green-100'
                            : kind === NodeKind.INDEXED_LEAF || kind === NodeKind.LEAF
                            ? 'bg-yellow-50 border-yellow-200 hover:bg-yellow-100'
                            : kind === NodeKind.FACTORY
                            ? 'bg-blue-50 border-blue-200 hover:bg-blue-100'
                            : 'bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {isMethod ? (
                            <Code2 size={18} className="text-green-600 flex-shrink-0" />
                          ) : kind === NodeKind.FACTORY ? (
                            <Hash size={18} className="text-blue-600 flex-shrink-0" />
                          ) : kind === NodeKind.INDEXED_LEAF ? (
                            <Hash size={18} className="text-orange-600 flex-shrink-0" />
                          ) : (
                            <ChevronRight size={18} className="text-gray-400 flex-shrink-0" />
                          )}
                          <code className="font-mono text-sm text-gray-900">{key}</code>
                          {kind === NodeKind.LEAF && !isMethod && (
                            <span className="text-xs px-2 py-0.5 bg-yellow-200 text-yellow-800 rounded font-medium">
                              LEAF
                            </span>
                          )}
                          {isMethod && (
                            <span className="text-xs px-2 py-0.5 bg-green-200 text-green-800 rounded font-medium">
                              METHOD
                            </span>
                          )}
                          {kind === NodeKind.FACTORY && (
                            <span className="text-xs px-2 py-0.5 bg-blue-200 text-blue-800 rounded font-medium">
                              FACTORY
                            </span>
                          )}
                          {kind === NodeKind.INDEXED_LEAF && (
                            <span className="text-xs px-2 py-0.5 bg-orange-200 text-orange-800 rounded font-medium">
                              INDEXED LEAF
                            </span>
                          )}
                        </div>
                        <ChevronRight size={16} className="text-gray-400 opacity-0 group-hover:opacity-100 transition" />
                      </button>
                    ))}
                  </div>
                  );
                })()}
              </div>

              {/* Help Footer */}
              <div className="p-3 border-t bg-gray-50 text-xs text-gray-600 flex-shrink-0">
                <p>
                  <strong>How to use:</strong> Navigate the tree by clicking nodes. 
                  Indexed nodes (e.g., <code className="px-1 bg-white rounded">ch[x]</code>) will prompt for an index. 
                  Click a METHOD to generate code.
                </p>
                {docstringsLoading && (
                  <p className="mt-1 text-[11px] text-gray-500">Loading tm_devices docs...</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Index Prompt Modal */}
      {showIndexPrompt && (() => {
        const factoryName = showIndexPrompt.replace('[x]', '').toLowerCase();
        const factoryInfo = FACTORY_NODES[factoryName];
        
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110]" onClick={() => setShowIndexPrompt(null)}>
            <div
              className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold mb-4">Select Index for {showIndexPrompt}</h3>
              <p className="text-sm text-gray-600 mb-4">
                {factoryInfo 
                  ? `This is an indexed factory node. Select a ${factoryInfo.label.toLowerCase()} to continue.`
                  : 'This node requires an integer index. Enter a value (e.g., 0, 1, 2...)'
                }
              </p>
              
              {factoryInfo ? (
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {factoryInfo.options.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        const cleanKey = showIndexPrompt.replace('[x]', '');
                        setNodeSearch('');
                        setPathStack([
                          ...pathStack,
                          { type: 'attr', value: cleanKey },
                          { type: 'index', value: option.value }
                        ]);
                        setShowIndexPrompt(null);
                        setIndexInput('');
                      }}
                      className="p-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition text-left"
                    >
                      <div className="font-semibold text-blue-900">{option.label}</div>
                      <div className="text-xs text-blue-600">Index: {option.value}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <input
                    type="number"
                    value={indexInput}
                    onChange={(e) => setIndexInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleIndexSubmit();
                      }
                    }}
                    placeholder="Enter index (e.g., 1)"
                    className="w-full px-3 py-2 border rounded mb-4"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleIndexSubmit}
                      className="flex-1 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition"
                    >
                      Continue
                    </button>
                    <button
                      onClick={() => setShowIndexPrompt(null)}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Method Argument Modal */}
      {selectedMethod && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110]" onClick={() => setSelectedMethod(null)}>
          <div
            className="bg-white rounded-lg shadow-xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">
                Method: <code className="text-purple-600">{selectedMethod}()</code>
              </h3>
              <button
                onClick={() => setSelectedMethod(null)}
                className="p-1 hover:bg-gray-100 rounded transition"
              >
                <X size={18} />
              </button>
            </div>
            
            {/* SCPI Path */}
            <div className="text-xs text-gray-500 mb-3 font-mono bg-gray-50 px-2 py-1 rounded">
              {getPathString()}.{selectedMethod}()
            </div>
            
            {/* Help - Rich Docstring Information */}
            <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-start gap-3">
                <BookOpen size={18} className="text-blue-600 flex-shrink-0 mt-1" />
                <div className="flex-1 space-y-2">
                  {(() => {
                    const commandPath = getPathString();
                    
                    // Helper to try multiple path variations
                    // NOTE: tm_devices uses command trees, not flat paths. Composed paths like
                    // "display.mathfftview1.cursor.mode" are valid in Python but may not exist as
                    // single leaf entries. We walk up the tree to find valid entries.
                    const tryGetDocstring = (model: string, path: string): CommandDocstring | null => {
                      // Try exact match first
                      let docstring = getDocstring(model, path);
                      if (docstring) return docstring;
                      
                      // Try removing method suffix (e.g., "display.colors.write" -> "display.colors")
                      if (path.endsWith('.write') || path.endsWith('.query') || path.endsWith('.verify')) {
                        const basePath = path.replace(/\.(write|query|verify)$/, '');
                        docstring = getDocstring(model, basePath);
                        if (docstring) return docstring;
                      }
                      
                      // Walk up the path tree to find valid entries
                      // For "display.mathfftview1.cursor.mode", try:
                      // - display.mathfftview1.cursor.mode (already tried)
                      // - display.mathfftview1.cursor
                      // - display.mathfftview1
                      // - display
                      // Also try finding leaf nodes that might be attached (e.g., "cursor.mode")
                      const parts = path.split('.');
                      
                      // First, try progressively shorter paths from the full path
                      for (let i = parts.length - 1; i > 0; i--) {
                        const partialPath = parts.slice(0, i).join('.');
                        docstring = getDocstring(model, partialPath);
                        if (docstring) return docstring;
                      }
                      
                      // Then, try finding leaf nodes that might be composed into this path
                      // For "display.mathfftview1.cursor.mode", try "cursor.mode" as a standalone entry
                      if (parts.length > 1) {
                        // Try the last two parts as a potential leaf (e.g., "cursor.mode")
                        const leafPath = parts.slice(-2).join('.');
                        docstring = getDocstring(model, leafPath);
                        if (docstring) return docstring;
                        
                        // Try just the last part (e.g., "mode")
                        const lastPart = parts[parts.length - 1];
                        docstring = getDocstring(model, lastPart);
                        if (docstring) return docstring;
                      }
                      
                      return null;
                    };
                    
                    // Try to get docstring with improved lookup
                    let docstring = tryGetDocstring(selectedModel, commandPath);
                    let isComposedPath = false;
                    const fallbackScpiSyntax = getScpiSyntaxForPath(commandPath);
                    
                    // Check if we found a docstring but it's not an exact match (composed path)
                    if (docstring) {
                      const exactMatch = getDocstring(selectedModel, commandPath);
                      if (!exactMatch && commandPath.includes('.')) {
                        // We found a docstring by walking up the tree - this is a composed path
                        isComposedPath = true;
                      }
                    }
                    
                    // Validate that the docstring matches the method type
                    if (docstring) {
                      const isQueryOnly = docstring.description?.toLowerCase().includes('query-only');
                      const isWriteMethod = selectedMethod === 'write';
                      // eslint-disable-next-line @typescript-eslint/no-unused-vars
                      const _isQueryMethod = selectedMethod === 'query';
                      
                      // If description says "query-only" but method is write, try to find a better match
                      if (isQueryOnly && isWriteMethod) {
                        // Try to find a write version by checking parent or sibling paths
                        const basePath = commandPath.replace(/\.(write|query|verify)$/, '');
                        const writePath = `${basePath}.write`;
                        const altDocstring = tryGetDocstring(selectedModel, writePath);
                        if (altDocstring && !altDocstring.description?.toLowerCase().includes('query-only')) {
                          docstring = altDocstring;
                        }
                      }
                    }
                    
                    if (docstring) {
                      return (
                        <>
                          <div>
                            <p className="font-semibold text-sm text-blue-900 mb-1">
                              {commandPath}.{selectedMethod}()
                            </p>
                            {isComposedPath && (
                              <p className="text-xs text-blue-600 italic mb-1">
                                Note: This is a composed path (valid in Python but not a single entry in tm_devices docstrings).
                              </p>
                            )}
                            <p className="text-xs text-blue-800">{docstring.description}</p>
                          </div>
                          
                          {docstring.usage && docstring.usage.length > 0 && (
                            <div className="text-xs">
                              <p className="font-semibold text-blue-900 mb-1">Usage:</p>
                              <ul className="list-disc list-inside space-y-0.5 text-blue-800">
                                {docstring.usage.map((usage: string, idx: number) => (
                                  <li key={idx} className="break-words whitespace-pre-wrap">{usage}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          
                          {(docstring.scpiSyntax || fallbackScpiSyntax) && (
                            <div className="text-xs">
                              <p className="font-semibold text-blue-900 mb-1">SCPI Syntax:</p>
                              <code className="bg-white px-2 py-1 rounded border border-blue-300 text-blue-900 font-mono text-xs">
                                {docstring.scpiSyntax || fallbackScpiSyntax}
                              </code>
                              {!docstring.scpiSyntax && fallbackScpiSyntax && (
                                <p className="text-[11px] text-blue-700 mt-1">
                                  Syntax sourced from SCPI registry fallback.
                                </p>
                              )}
                            </div>
                          )}
                          
                          {docstring.parameters && docstring.parameters.length > 0 && (
                            <div className="text-xs">
                              <p className="font-semibold text-blue-900 mb-1">Parameters:</p>
                              <ul className="list-disc list-inside space-y-0.5 text-blue-800">
                                {docstring.parameters.map((param: string, idx: number) => (
                                  <li key={idx} className="break-words whitespace-pre-wrap">{param}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          
                          {docstring.info && docstring.info.length > 0 && (
                            <div className="text-xs">
                              <p className="font-semibold text-blue-900 mb-1">Info:</p>
                              <ul className="list-disc list-inside space-y-0.5 text-blue-800">
                                {docstring.info.map((info: string, idx: number) => (
                                  <li key={idx} className="break-words whitespace-pre-wrap">{info}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          
                          {docstring.subProperties && docstring.subProperties.length > 0 && (
                            <div className="text-xs">
                              <p className="font-semibold text-blue-900 mb-1">Sub-properties:</p>
                              <ul className="list-disc list-inside space-y-0.5 text-blue-800">
                                {docstring.subProperties.slice(0, 5).map((prop: string, idx: number) => (
                                  <li key={idx} className="text-xs">{prop}</li>
                                ))}
                                {docstring.subProperties.length > 5 && (
                                  <li className="text-gray-600 italic">...and {docstring.subProperties.length - 5} more</li>
                                )}
                              </ul>
                            </div>
                          )}
                        </>
                      );
                    }
                    
                    // Fallback: Generic help if no docstring found
                    return (
                      <>
                        <p className="font-semibold text-sm text-blue-900">
                          {commandPath}.{selectedMethod}()
                        </p>
                        {selectedMethod === 'write' && (
                          <p className="text-xs text-blue-800">
                            Sets the parameter value. <strong>String values:</strong> Enter plain text (quotes added automatically). Numbers and booleans: enter as-is.
                          </p>
                        )}
                        {selectedMethod === 'query' && (
                          <p className="text-xs text-blue-800">
                            Queries the current parameter value (typically no arguments needed).
                          </p>
                        )}
                        {selectedMethod === 'verify' && (
                          <p className="text-xs text-blue-800">
                            Verifies the parameter matches the expected value. <strong>Strings:</strong> Enter plain text without quotes.
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
            
            {/* Common methods have predefined argument patterns */}
            {(() => {
              const isIndexedLeaf = isCurrentPathIndexedLeaf();
              
              return (
                <>
                  {/* For indexed leaves, show index input first */}
                  {isIndexedLeaf && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Index <span className="text-xs text-gray-500">(required)</span>
                      </label>
                      <input
                        type="number"
                        value={methodArgs['index'] || ''}
                        onChange={(e) => setMethodArgs({ ...methodArgs, index: e.target.value })}
                        placeholder='e.g., 1, 2, 3'
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono text-sm"
                        autoFocus
                        min="0"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        This command takes an index value as a parameter.
                      </p>
                    </div>
                  )}
                  
                  {selectedMethod === 'write' && (() => {
                    const effectiveSyntax = getEffectiveScpiSyntax();
                    const validValues = extractValidValues(effectiveSyntax);
                    const needsValue = methodNeedsValueInput('write');
                    
                    return (
                      <div className="mb-4">
                        {needsValue && (
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Value
                          </label>
                        )}
                        {effectiveSyntax && (
                          <p className="text-xs text-gray-600 mb-2">
                            Expected syntax: <code className="px-1 py-0.5 rounded bg-gray-100 border border-gray-200 font-mono">{effectiveSyntax}</code>
                          </p>
                        )}
                        {!needsValue && (
                          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
                            No parameter required. <code className="font-mono">write()</code> will send this command as-is.
                          </p>
                        )}
                        
                        {/* Show dropdown if valid values exist */}
                        {needsValue && validValues.length > 0 ? (
                          <div className="space-y-2">
                            <select
                              value={methodArgs['value'] || ''}
                              onChange={(e) => setMethodArgs({ ...methodArgs, value: e.target.value })}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono text-sm bg-white"
                              autoFocus={!isIndexedLeaf}
                            >
                              <option value="">-- Select a value --</option>
                              {validValues.map((val) => (
                                <option key={val} value={val}>{val}</option>
                              ))}
                            </select>
                            <div className="text-xs text-gray-500">
                              Or enter a custom value:
                            </div>
                            <input
                              type="text"
                              value={methodArgs['value'] || ''}
                              onChange={(e) => setMethodArgs({ ...methodArgs, value: e.target.value })}
                              placeholder='Custom value'
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono text-sm"
                            />
                          </div>
                        ) : needsValue ? (
                          <input
                            type="text"
                            value={methodArgs['value'] || ''}
                            onChange={(e) => setMethodArgs({ ...methodArgs, value: e.target.value })}
                            placeholder='e.g., SAMPLE, 1.0, 5e6'
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono text-sm"
                            autoFocus={!isIndexedLeaf}
                          />
                        ) : null}
                      </div>
                    );
                  })()}

                  {selectedMethod === 'query' && (
                    <p className="text-sm text-gray-600 mb-4 italic">
                      {isIndexedLeaf 
                        ? 'Query methods require an index value (enter above).'
                        : 'Query methods typically take no arguments.'
                      }
                    </p>
                  )}
                </>
              );
            })()}

            {selectedMethod === 'verify' && (() => {
              const effectiveSyntax = getEffectiveScpiSyntax();
              const validValues = extractValidValues(effectiveSyntax);
              const needsValue = methodNeedsValueInput('verify');
              
              return (
                <div className="mb-4">
                  {needsValue && (
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Expected Value
                    </label>
                  )}
                  {effectiveSyntax && (
                    <p className="text-xs text-gray-600 mb-2">
                      Expected syntax: <code className="px-1 py-0.5 rounded bg-gray-100 border border-gray-200 font-mono">{effectiveSyntax}</code>
                    </p>
                  )}
                  {!needsValue && (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                      This command does not expose a value argument pattern for <code className="font-mono">verify()</code>.
                    </p>
                  )}
                  
                  {needsValue && validValues.length > 0 ? (
                    <div className="space-y-2">
                      <select
                        value={methodArgs['expected'] || ''}
                        onChange={(e) => setMethodArgs({ ...methodArgs, expected: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono text-sm bg-white"
                        autoFocus
                      >
                        <option value="">-- Select a value --</option>
                        {validValues.map((val) => (
                          <option key={val} value={val}>{val}</option>
                        ))}
                      </select>
                      <div className="text-xs text-gray-500">
                        Or enter a custom value:
                      </div>
                      <input
                        type="text"
                        value={methodArgs['expected'] || ''}
                        onChange={(e) => setMethodArgs({ ...methodArgs, expected: e.target.value })}
                        placeholder='Custom value'
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono text-sm"
                      />
                    </div>
                  ) : needsValue ? (
                    <input
                      type="text"
                      value={methodArgs['expected'] || ''}
                      onChange={(e) => setMethodArgs({ ...methodArgs, expected: e.target.value })}
                      placeholder='e.g., ON, 1.0'
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono text-sm"
                      autoFocus
                    />
                  ) : null}
                </div>
              );
            })()}

            {!['write', 'query', 'verify'].includes(selectedMethod) && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Arguments
                </label>
                <input
                  type="text"
                  value={methodArgs['args'] || ''}
                  onChange={(e) => setMethodArgs({ ...methodArgs, args: e.target.value })}
                  placeholder='e.g., value1, 123'
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono text-sm"
                  autoFocus
                />
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Generated Code Preview</label>
              <pre className="bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto border border-gray-700 font-mono text-xs leading-relaxed">
                <code className="text-green-400 whitespace-pre">
                  {generateCode(selectedMethod, methodArgs)}
                </code>
              </pre>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setSelectedMethod(null)}
                className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleMethodSubmit}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition"
              >
                {buttonText}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
