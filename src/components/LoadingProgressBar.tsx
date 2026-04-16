import React from 'react';

interface LoadingProgressBarProps {
  progress: number; // 0-100
  currentFile?: string;
  loadedFiles: number;
  totalFiles: number;
  isVisible: boolean;
}

export const LoadingProgressBar: React.FC<LoadingProgressBarProps> = ({
  progress,
  currentFile,
  loadedFiles,
  totalFiles,
  isVisible,
}) => {
  if (!isVisible) return null;

  const fileName = currentFile?.replace('/commands/', '').replace('.json', '') || '';

  return (
    <div className="fixed bottom-4 left-4 z-50 bg-white rounded-lg shadow-xl border border-gray-200 p-4 min-w-[320px] max-w-md">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <span className="text-sm font-semibold text-gray-700">Loading Commands</span>
        </div>
        <span className="text-xs text-gray-500">{Math.round(progress)}%</span>
      </div>
      
      {/* Progress Bar */}
      <div className="w-full bg-gray-200 rounded-full h-2 mb-2 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        >
          <div className="h-full bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
        </div>
      </div>
      
      {/* File Info */}
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span className="truncate flex-1 mr-2" title={currentFile || ''}>
          {fileName ? `Loading ${fileName}...` : 'Preparing...'}
        </span>
        <span className="text-gray-500 whitespace-nowrap">
          {loadedFiles}/{totalFiles} files
        </span>
      </div>
    </div>
  );
};


