import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, BookOpen } from 'lucide-react';
import { categories, articles, searchArticles } from '../../data/AcademyData';
import { AcademySearch } from './AcademySearch';

interface AcademySidebarProps {
  currentArticleId: string | null;
  onArticleSelect: (articleId: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const AcademySidebar: React.FC<AcademySidebarProps> = ({
  currentArticleId,
  onArticleSelect,
  searchQuery,
  onSearchChange,
}) => {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(categories.map(c => c.id))
  );
  const [expandedSubcategories, setExpandedSubcategories] = useState<Set<string>>(
    new Set()
  );

  // Filter articles based on search
  const filteredArticles = useMemo(() => {
    if (!searchQuery.trim()) {
      return articles;
    }
    return searchArticles(searchQuery);
  }, [searchQuery]);

  // Get filtered categories/subcategories based on search
  const displayCategories = useMemo(() => {
    if (!searchQuery.trim()) {
      return categories;
    }

    // If searching, show only categories/subcategories that have matching articles
    return categories.map(category => {
      const matchingSubcategories = category.subcategories?.filter(subcat => {
        return subcat.articles.some(article => 
          filteredArticles.some(fa => fa.id === article.id)
        );
      }).map(subcat => ({
        ...subcat,
        articles: subcat.articles.filter(article =>
          filteredArticles.some(fa => fa.id === article.id)
        ),
      }));

      return {
        ...category,
        subcategories: matchingSubcategories,
      };
    }).filter(category => 
      category.subcategories && category.subcategories.length > 0
    );
  }, [searchQuery, filteredArticles]);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const toggleSubcategory = (subcategoryId: string) => {
    setExpandedSubcategories(prev => {
      const next = new Set(prev);
      if (next.has(subcategoryId)) {
        next.delete(subcategoryId);
      } else {
        next.add(subcategoryId);
      }
      return next;
    });
  };

  return (
    <div className="w-1/4 border-r border-gray-200 bg-gray-50 flex flex-col h-full">
      {/* Search */}
      <AcademySearch
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        resultCount={filteredArticles.length}
      />

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto">
        {displayCategories.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p>No articles found</p>
            <p className="text-sm mt-2">Try a different search term</p>
          </div>
        ) : (
          <div className="p-2">
            {displayCategories.map((category) => {
              const isCategoryExpanded = expandedCategories.has(category.id);
              const hasSubcategories = category.subcategories && category.subcategories.length > 0;

              return (
                <div key={category.id} className="mb-2">
                  {/* Category Header */}
                  <button
                    onClick={() => toggleCategory(category.id)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {hasSubcategories ? (
                        isCategoryExpanded ? (
                          <ChevronDown size={16} className="text-gray-500" />
                        ) : (
                          <ChevronRight size={16} className="text-gray-500" />
                        )
                      ) : null}
                      <span className="font-semibold text-gray-900 text-sm">
                        {category.title}
                      </span>
                    </div>
                  </button>

                  {/* Subcategories */}
                  {isCategoryExpanded && hasSubcategories && (
                    <div className="ml-4 mt-1 space-y-1">
                      {category.subcategories!.map((subcategory) => {
                        const isSubcategoryExpanded = expandedSubcategories.has(subcategory.id);
                        const hasArticles = subcategory.articles.length > 0;

                        return (
                          <div key={subcategory.id}>
                            {/* Subcategory Header */}
                            {hasArticles && (
                              <button
                                onClick={() => toggleSubcategory(subcategory.id)}
                                className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-gray-100 rounded transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  {isSubcategoryExpanded ? (
                                    <ChevronDown size={14} className="text-gray-400" />
                                  ) : (
                                    <ChevronRight size={14} className="text-gray-400" />
                                  )}
                                  <span className="text-xs text-gray-700">
                                    {subcategory.title}
                                  </span>
                                </div>
                              </button>
                            )}

                            {/* Articles */}
                            {isSubcategoryExpanded && hasArticles && (
                              <div className="ml-4 mt-1 space-y-0.5">
                                {subcategory.articles.map((article) => {
                                  const isActive = currentArticleId === article.id;
                                  return (
                                    <button
                                      key={article.id}
                                      onClick={() => onArticleSelect(article.id)}
                                      className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors flex items-center gap-2 ${
                                        isActive
                                          ? 'bg-blue-100 text-blue-700 font-medium'
                                          : 'text-gray-600 hover:bg-gray-100'
                                      }`}
                                    >
                                      <BookOpen size={12} className="flex-shrink-0" />
                                      <span className="truncate">{article.title}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* If no subcategories, show articles directly under category */}
                  {isCategoryExpanded && !hasSubcategories && (
                    <div className="ml-4 mt-1 space-y-0.5">
                      {articles
                        .filter(a => a.category === category.id && filteredArticles.some(fa => fa.id === a.id))
                        .map((article) => {
                          const isActive = currentArticleId === article.id;
                          return (
                            <button
                              key={article.id}
                              onClick={() => onArticleSelect(article.id)}
                              className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors flex items-center gap-2 ${
                                isActive
                                  ? 'bg-blue-100 text-blue-700 font-medium'
                                  : 'text-gray-600 hover:bg-gray-100'
                              }`}
                            >
                              <BookOpen size={12} className="flex-shrink-0" />
                              <span className="truncate">{article.title}</span>
                            </button>
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
    </div>
  );
};


