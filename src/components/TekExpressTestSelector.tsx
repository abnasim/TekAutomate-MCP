import React, { useState, useMemo } from 'react';
import { X, Search, ChevronDown, ChevronRight, Check, Plus } from 'lucide-react';

interface TestGroup {
  name: string;
  tests: string[];
  expanded: boolean;
}

interface TekExpressTestSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  allTests: string[];
  onAddTests: (selectedTests: string[], includeValue: 'Included' | 'Excluded') => void;
}

export const TekExpressTestSelector: React.FC<TekExpressTestSelectorProps> = ({
  isOpen,
  onClose,
  allTests,
  onAddTests,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [includeValue, setIncludeValue] = useState<'Included' | 'Excluded'>('Included');

  // Group tests by their base name (everything before the speed suffix)
  const groupedTests = useMemo(() => {
    const groups: Record<string, string[]> = {};
    
    allTests.forEach(test => {
      // Extract base name by removing speed suffixes (10G, 10p3G, 20G, 20p6G)
      const baseName = test.replace(/\s+(10G|10p3G|20G|20p6G)$/, '');
      
      if (!groups[baseName]) {
        groups[baseName] = [];
      }
      groups[baseName].push(test);
    });

    // Sort tests within each group by speed
    const speedOrder = { '10G': 0, '10p3G': 1, '20G': 2, '20p6G': 3 };
    Object.keys(groups).forEach(baseName => {
      groups[baseName].sort((a, b) => {
        const speedA = a.match(/(10G|10p3G|20G|20p6G)$/)?.[0] || '';
        const speedB = b.match(/(10G|10p3G|20G|20p6G)$/)?.[0] || '';
        return (speedOrder[speedA as keyof typeof speedOrder] || 999) - 
               (speedOrder[speedB as keyof typeof speedOrder] || 999);
      });
    });

    // Convert to sorted array
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, tests]) => ({ name, tests, expanded: false }));
  }, [allTests]);

  // Filter groups based on search
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedTests;
    
    const query = searchQuery.toLowerCase();
    return groupedTests
      .map(group => ({
        ...group,
        tests: group.tests.filter(test => test.toLowerCase().includes(query))
      }))
      .filter(group => group.tests.length > 0 || group.name.toLowerCase().includes(query));
  }, [groupedTests, searchQuery]);

  const toggleGroup = (groupName: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupName)) {
      newExpanded.delete(groupName);
    } else {
      newExpanded.add(groupName);
    }
    setExpandedGroups(newExpanded);
  };

  const toggleTest = (test: string) => {
    const newSelected = new Set(selectedTests);
    if (newSelected.has(test)) {
      newSelected.delete(test);
    } else {
      newSelected.add(test);
    }
    setSelectedTests(newSelected);
  };

  const toggleAllInGroup = (group: TestGroup) => {
    const newSelected = new Set(selectedTests);
    const allSelected = group.tests.every(test => newSelected.has(test));
    
    if (allSelected) {
      // Deselect all in group
      group.tests.forEach(test => newSelected.delete(test));
    } else {
      // Select all in group
      group.tests.forEach(test => newSelected.add(test));
    }
    setSelectedTests(newSelected);
  };

  const selectAll = () => {
    setSelectedTests(new Set(filteredGroups.flatMap(g => g.tests)));
  };

  const deselectAll = () => {
    setSelectedTests(new Set());
  };

  const handleAdd = () => {
    const testsArray = Array.from(selectedTests);
    if (testsArray.length > 0) {
      onAddTests(testsArray, includeValue);
      setSelectedTests(new Set());
      setSearchQuery('');
      onClose();
    }
  };

  const expandAll = () => {
    setExpandedGroups(new Set(filteredGroups.map(g => g.name)));
  };

  const collapseAll = () => {
    setExpandedGroups(new Set());
  };

  if (!isOpen) return null;

  const selectedCount = selectedTests.size;
  const totalTests = allTests.length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
          <div>
            <h2 className="text-xl font-bold">Bulk Test Selection</h2>
            <p className="text-sm text-blue-100 mt-1">Select multiple tests to add at once</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-blue-800 rounded-lg transition-colors"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search and Controls */}
        <div className="p-4 border-b bg-gray-50 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search tests..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              autoFocus
            />
          </div>
          
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-2">
              <button
                onClick={expandAll}
                className="text-xs px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded transition-colors"
              >
                Expand All
              </button>
              <button
                onClick={collapseAll}
                className="text-xs px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded transition-colors"
              >
                Collapse All
              </button>
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="text-xs px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors"
              >
                Select All
              </button>
              <button
                onClick={deselectAll}
                className="text-xs px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded transition-colors"
              >
                Deselect All
              </button>
            </div>
          </div>

          {/* Include/Exclude Toggle */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">Default Action:</label>
            <div className="flex gap-2">
              <button
                onClick={() => setIncludeValue('Included')}
                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                  includeValue === 'Included'
                    ? 'bg-green-100 text-green-700 border-2 border-green-500'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                ✓ Include Tests
              </button>
              <button
                onClick={() => setIncludeValue('Excluded')}
                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                  includeValue === 'Excluded'
                    ? 'bg-red-100 text-red-700 border-2 border-red-500'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                ✗ Exclude Tests
              </button>
            </div>
          </div>
        </div>

        {/* Test List */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredGroups.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Search size={48} className="mx-auto mb-3 opacity-50" />
              <p>No tests found matching "{searchQuery}"</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredGroups.map((group) => {
                const isExpanded = expandedGroups.has(group.name);
                const allSelected = group.tests.every(test => selectedTests.has(test));
                const someSelected = group.tests.some(test => selectedTests.has(test)) && !allSelected;

                return (
                  <div key={group.name} className="border rounded-lg overflow-hidden">
                    {/* Group Header */}
                    <div className="bg-gray-50 hover:bg-gray-100 transition-colors">
                      <div className="flex items-center gap-2 p-3">
                        <button
                          onClick={() => toggleGroup(group.name)}
                          className="p-1 hover:bg-gray-200 rounded transition-colors"
                        >
                          {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        </button>
                        
                        <div
                          className="flex items-center gap-2 cursor-pointer flex-1"
                          onClick={() => toggleAllInGroup(group)}
                        >
                          <div className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${
                            allSelected 
                              ? 'bg-blue-600 border-blue-600' 
                              : someSelected
                              ? 'bg-blue-300 border-blue-600'
                              : 'border-gray-300 bg-white'
                          }`}>
                            {(allSelected || someSelected) && <Check size={14} className="text-white" />}
                          </div>
                          
                          <div className="flex-1">
                            <span className="font-medium text-gray-800">{group.name}</span>
                            <span className="ml-2 text-sm text-gray-500">
                              ({group.tests.length} test{group.tests.length !== 1 ? 's' : ''})
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Group Tests */}
                    {isExpanded && (
                      <div className="p-2 bg-white">
                        {group.tests.map((test) => {
                          const isSelected = selectedTests.has(test);
                          const speedBadge = test.match(/(10G|10p3G|20G|20p6G)$/)?.[0];
                          const speedColor = 
                            speedBadge?.startsWith('10') 
                              ? 'bg-blue-100 text-blue-700' 
                              : 'bg-purple-100 text-purple-700';

                          return (
                            <div
                              key={test}
                              onClick={() => toggleTest(test)}
                              className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
                                isSelected ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'
                              }`}
                            >
                              <div className={`w-5 h-5 border-2 rounded flex items-center justify-center ml-8 transition-colors ${
                                isSelected 
                                  ? 'bg-blue-600 border-blue-600' 
                                  : 'border-gray-300 bg-white'
                              }`}>
                                {isSelected && <Check size={14} className="text-white" />}
                              </div>
                              
                              <span className="flex-1 text-sm text-gray-700">{test}</span>
                              
                              {speedBadge && (
                                <span className={`text-xs px-2 py-0.5 rounded font-medium ${speedColor}`}>
                                  {speedBadge}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 rounded-b-lg">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className="font-semibold text-gray-700">{selectedCount}</span>
              <span className="text-gray-500"> of {totalTests} tests selected</span>
              {selectedCount > 0 && (
                <span className="ml-2 text-gray-500">
                  • Will {includeValue === 'Included' ? 'enable' : 'disable'} selected tests
                </span>
              )}
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={selectedCount === 0}
                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                  selectedCount === 0
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                <Plus size={18} />
                Add {selectedCount > 0 ? `${selectedCount} ` : ''}Test{selectedCount !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


