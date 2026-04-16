import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useAcademyContext } from './AcademyContext';
import { AcademySidebar } from './AcademySidebar';
import { AcademyContent } from './AcademyContent';
import { getArticleById } from '../../data/AcademyData';

export const AcademyModal: React.FC = () => {
  const { isOpen, close, currentArticleId, searchQuery, setSearchQuery, openArticle } = useAcademyContext();

  // Handle article selection from sidebar
  const handleArticleSelect = (articleId: string) => {
    openArticle(articleId);
  };

  // Get current article
  const currentArticle = currentArticleId ? (getArticleById(currentArticleId) ?? null) : null;

  // If no article is selected but modal is open, select first article
  useEffect(() => {
    if (isOpen && !currentArticleId) {
      const firstArticle = getArticleById('backend_comparison') || getArticleById('hardware_ip_guide');
      if (firstArticle) {
        openArticle(firstArticle.id);
      }
    }
  }, [isOpen, currentArticleId, openArticle]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        close();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={close}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-7xl w-full h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">TekAutomate Academy</h2>
              <p className="text-sm text-gray-500">Knowledge Base & Tutorials</p>
            </div>
          </div>
          <button
            onClick={close}
            className="text-gray-400 hover:text-gray-600 transition-colors p-2 hover:bg-gray-100 rounded-lg"
            aria-label="Close Academy"
          >
            <X size={24} />
          </button>
        </div>

        {/* Main Content Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <AcademySidebar
            currentArticleId={currentArticleId}
            onArticleSelect={handleArticleSelect}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />

          {/* Content */}
          <div className="w-3/4 bg-white flex flex-col overflow-hidden">
            <AcademyContent article={currentArticle} />
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

