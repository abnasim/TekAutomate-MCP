import React from 'react';
import { Search, X } from 'lucide-react';

interface AcademySearchProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  resultCount?: number;
}

export const AcademySearch: React.FC<AcademySearchProps> = ({
  searchQuery,
  onSearchChange,
  resultCount,
}) => {
  return (
    <div className="p-4 border-b border-gray-200 bg-white">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search articles..."
          className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        )}
      </div>
      {searchQuery && resultCount !== undefined && (
        <div className="mt-2 text-xs text-gray-500">
          {resultCount > 0 ? (
            <span>Found {resultCount} article{resultCount !== 1 ? 's' : ''}</span>
          ) : (
            <span className="text-orange-600">No articles found</span>
          )}
        </div>
      )}
    </div>
  );
};












