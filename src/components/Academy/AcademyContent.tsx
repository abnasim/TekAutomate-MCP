import React from 'react';
import { Article, ContentBlock } from './types';
import { getArticleById } from '../../data/AcademyData';
import { BookOpen, ChevronRight, AlertCircle, Info, Lightbulb, XCircle } from 'lucide-react';
import { useHelp } from './useHelp';

interface AcademyContentProps {
  article: Article | null;
}

export const AcademyContent: React.FC<AcademyContentProps> = ({ article }) => {
  const { openArticle } = useHelp();

  if (!article) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="text-center">
          <BookOpen size={48} className="mx-auto mb-4 opacity-50" />
          <p className="text-lg">Select an article to view</p>
        </div>
      </div>
    );
  }

  const renderContentBlock = (block: ContentBlock, index: number) => {
    switch (block.type) {
      case 'heading':
        const HeadingTag = `h${block.level || 2}` as keyof JSX.IntrinsicElements;
        const headingClasses = {
          1: 'text-3xl font-bold mb-4 text-gray-900',
          2: 'text-2xl font-bold mt-8 mb-4 text-gray-900',
          3: 'text-xl font-semibold mt-6 mb-3 text-gray-800',
          4: 'text-lg font-semibold mt-4 mb-2 text-gray-800',
          5: 'text-base font-semibold mt-3 mb-2 text-gray-700',
          6: 'text-sm font-semibold mt-2 mb-1 text-gray-700',
        };
        return (
          <HeadingTag
            key={index}
            className={headingClasses[block.level as keyof typeof headingClasses] || headingClasses[2]}
          >
            {block.text}
          </HeadingTag>
        );

      case 'paragraph':
        return (
          <p key={index} className="mb-4 text-gray-700 leading-relaxed">
            {block.text}
          </p>
        );

      case 'list':
        return (
          <ul key={index} className="mb-4 list-disc list-inside text-gray-700 space-y-1">
            {block.items?.map((item, i) => (
              <li key={i} className="ml-4">{item}</li>
            ))}
          </ul>
        );

      case 'code':
        return (
          <div key={index} className="mb-4">
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm font-mono">
              <code>{block.code}</code>
            </pre>
            {block.language && (
              <div className="text-xs text-gray-500 mt-1 ml-1">{block.language}</div>
            )}
          </div>
        );

      case 'table':
        if (block.data) {
          return (
            <div key={index} className="mb-6 overflow-x-auto shadow-sm rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {block.data.headers.map((header, i) => (
                      <th 
                        key={i} 
                        className={`px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider ${
                          i === 0 ? 'sticky left-0 bg-gray-50 z-10' : ''
                        }`}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {block.data.rows.map((row, i) => (
                    <tr 
                      key={i} 
                      className={`hover:bg-gray-50 transition-colors ${
                        i % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                      }`}
                    >
                      {row.map((cell, j) => (
                        <td 
                          key={j} 
                          className={`px-6 py-4 text-sm text-gray-700 whitespace-nowrap ${
                            j === 0 ? 'font-medium text-gray-900' : ''
                          }`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return null;

      case 'image':
        return (
          <div key={index} className="mb-4">
            <img
              src={block.src || '/placeholder.png'}
              alt={block.alt || 'Article image'}
              className="max-w-full h-auto rounded-lg border border-gray-300"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/placeholder.png';
              }}
            />
          </div>
        );

      case 'callout':
        const calloutConfig = {
          info: { icon: Info, bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800', iconColor: 'text-blue-600' },
          warning: { icon: AlertCircle, bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800', iconColor: 'text-yellow-600' },
          tip: { icon: Lightbulb, bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', iconColor: 'text-green-600' },
          error: { icon: XCircle, bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', iconColor: 'text-red-600' },
        };
        const config = calloutConfig[block.variant || 'info'];
        const Icon = config.icon;
        return (
          <div
            key={index}
            className={`mb-4 p-4 rounded-lg border ${config.bg} ${config.border} ${config.text}`}
          >
            <div className="flex items-start gap-3">
              <Icon size={20} className={`${config.iconColor} flex-shrink-0 mt-0.5`} />
              <div className="flex-1">
                {block.title && (
                  <div className="font-semibold mb-1">{block.title}</div>
                )}
                <div>{block.text}</div>
              </div>
            </div>
          </div>
        );

      case 'divider':
        return <hr key={index} className="my-6 border-gray-300" />;

      default:
        return null;
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-8 max-w-4xl mx-auto">
        {/* Article Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{article.title}</h1>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">
              {article.category.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </span>
            {article.subcategory && (
              <>
                <ChevronRight size={12} />
                <span>{article.subcategory.replace('_', ' ')}</span>
              </>
            )}
          </div>
        </div>

        {/* Article Content */}
        <div className="prose prose-sm max-w-none">
          {article.content.map((block, index) => renderContentBlock(block, index))}
        </div>

        {/* Code Examples */}
        {article.codeExamples && article.codeExamples.length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">Code Examples</h2>
            {article.codeExamples.map((example, index) => (
              <div key={index} className="mb-6">
                {example.title && (
                  <h3 className="text-lg font-semibold mb-2 text-gray-800">{example.title}</h3>
                )}
                {example.description && (
                  <p className="mb-2 text-gray-600">{example.description}</p>
                )}
                <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm font-mono">
                  <code>{example.code}</code>
                </pre>
              </div>
            ))}
          </div>
        )}

        {/* FAQs */}
        {article.faqs && article.faqs.length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">Frequently Asked Questions</h2>
            <div className="space-y-4">
              {article.faqs.map((faq, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4">
                  <h3 className="font-semibold text-gray-900 mb-2">Q: {faq.question}</h3>
                  <div className="text-gray-700">
                    {typeof faq.answer === 'string' ? (
                      <p>{faq.answer}</p>
                    ) : (
                      faq.answer.map((block, i) => renderContentBlock(block, i))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Related Articles */}
        {article.relatedArticles && article.relatedArticles.length > 0 && (
          <div className="mt-8 pt-6 border-t border-gray-200">
            <h2 className="text-xl font-semibold mb-4 text-gray-900">Related Articles</h2>
            <div className="flex flex-wrap gap-2">
              {article.relatedArticles.map((relatedId) => {
                const relatedArticle = getArticleById(relatedId);
                if (!relatedArticle) return null;
                return (
                  <button
                    key={relatedId}
                    onClick={() => openArticle(relatedId)}
                    className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm transition-colors flex items-center gap-1"
                  >
                    <BookOpen size={14} />
                    {relatedArticle.title}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

