import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PopupItem, AskQuestion } from '../types';

// Maximum length for command/details before truncation
const MAX_DETAILS_LENGTH = 200;

// Truncate string with ellipsis
const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
};

// Truncated project name tag component - fixed width for alignment, left-aligned
const ProjectNameTag = ({ name }: { name: string }) => (
  <span
    className="text-white/50 text-xs flex-shrink-0"
    style={{ width: '95px' }}
    title={name}
  >
    {truncateText(name, 12)}
  </span>
);

interface PopupListProps {
  popups: PopupItem[];
  onRespond: (popupId: string, decision?: string, answer?: string, answers?: string[][]) => void;
}

export function PopupList({ popups, onRespond }: PopupListProps) {
  const pendingPopups = popups.filter(p => p.status === 'pending');

  if (pendingPopups.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mb-2">
      {pendingPopups.map((popup) => (
        <PopupCard key={popup.id} popup={popup} onRespond={onRespond} />
      ))}
    </div>
  );
}

interface PopupCardProps {
  popup: PopupItem;
  onRespond: (popupId: string, decision?: string, answer?: string, answers?: string[][]) => void;
}

export function PopupCard({ popup, onRespond }: PopupCardProps) {
  if (popup.type === 'permission') {
    const toolName = popup.permission_data?.tool_name || 'Unknown Tool';
    const action = popup.permission_data?.action || 'Permission request';
    const details = popup.permission_data?.details;

    return (
      <motion.div
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20"
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-base">🔐</span>
          <span className="text-white/80 text-sm font-medium">{toolName}</span>
          <ProjectNameTag name={popup.project_name} />
        </div>

        {/* Description */}
        <div className="text-white/70 text-sm ml-7">
          {truncateText(action, 100)}
        </div>

        {/* Details (command/filepath/url) - code block style with max height */}
        {details && (
          <div className="ml-7 bg-black/30 rounded px-2.5 py-1.5 text-xs font-mono text-white/60 border border-white/10 overflow-hidden">
            <span className="text-white/40 mr-1.5">$</span>
            <span className="break-all">{truncateText(details, MAX_DETAILS_LENGTH)}</span>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2 ml-7">
          <button
            onClick={() => onRespond(popup.id, 'deny')}
            className="px-3 py-1 text-sm text-white/60 bg-red-500/20 hover:bg-red-500/30 rounded transition-colors"
          >
            Deny
          </button>
          <button
            onClick={() => onRespond(popup.id, 'allow')}
            className="px-3 py-1 text-sm text-white/90 bg-green-500/25 hover:bg-green-500/35 rounded transition-colors"
          >
            Allow
          </button>
        </div>
      </motion.div>
    );
  }

  if (popup.type === 'ask') {
    const questions = popup.ask_data?.questions || [];

    return (
      <AskPopup
        popup={popup}
        questions={questions}
        onRespond={onRespond}
      />
    );
  }

  return null;
}

// Separate component for Ask popup with pagination
interface AskPopupProps {
  popup: PopupItem;
  questions: AskQuestion[];
  onRespond: (popupId: string, decision?: string, answer?: string, answers?: string[][]) => void;
}

function AskPopup({ popup, questions, onRespond }: AskPopupProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [selections, setSelections] = useState<string[][]>(() =>
    questions.map(() => [])
  );
  const [textInput, setTextInput] = useState<string>(() => '');

  const totalQuestions = questions.length;
  const isLastPage = currentPage >= totalQuestions - 1;
  const isFirstPage = currentPage === 0;
  const currentQuestion = questions[currentPage];

  // Handle selection change for current question
  const handleSelect = (optionLabel: string, multiSelect: boolean) => {
    setSelections(prev => {
      const updated = [...prev];
      if (multiSelect) {
        const current = updated[currentPage] || [];
        if (current.includes(optionLabel)) {
          updated[currentPage] = current.filter(s => s !== optionLabel);
        } else {
          updated[currentPage] = [...current, optionLabel];
        }
      } else {
        updated[currentPage] = [optionLabel];
      }
      return updated;
    });
  };

  // Navigate to next page or submit
  const handleNext = () => {
    if (isLastPage) {
      handleSubmit();
    } else {
      setCurrentPage(p => p + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirstPage) {
      setCurrentPage(p => p - 1);
    }
  };

  // Submit response
  const handleSubmit = () => {
    if (questions.length > 0) {
      onRespond(popup.id, undefined, undefined, selections);
    } else {
      onRespond(popup.id, undefined, textInput);
    }
  };

  // Check if current question is answered
  const isCurrentAnswered = currentQuestion
    ? currentQuestion.options.length === 0 || (selections[currentPage]?.length ?? 0) > 0
    : true;

  // No questions case
  if (questions.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">💬</span>
          <span className="text-white/80 text-sm font-medium">问题</span>
          <ProjectNameTag name={popup.project_name} />
        </div>
        <div className="ml-7">
          <input
            type="text"
            placeholder="输入回答..."
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            className="w-full px-2.5 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white placeholder-white/30 focus:outline-none focus:border-white/25"
          />
          <button
            onClick={handleSubmit}
            className="mt-2 px-3 py-1.5 text-sm bg-blue-500/30 hover:bg-blue-500/40 text-white/90 rounded"
          >
            提交
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20"
    >
      {/* Header with pagination */}
      <div className="flex items-center gap-2">
        <span className="text-base">💬</span>
        <span className="text-white/80 text-sm font-medium">
          {totalQuestions > 1 ? `问题 ${currentPage + 1}/${totalQuestions}` : '问题'}
        </span>
        <ProjectNameTag name={popup.project_name} />
      </div>

      {/* Question content with animation */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentPage}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.15 }}
          className="ml-7"
        >
          {currentQuestion && (
            <>
              {/* Header chip */}
              {currentQuestion.header && (
                <span className="inline-block px-2 py-0.5 mb-1.5 text-xs text-white/70 bg-white/10 rounded-full">
                  {currentQuestion.header}
                </span>
              )}
              {/* Question text */}
              <div className="text-white/80 text-sm mb-2">{currentQuestion.question}</div>

              {/* Options - vertical list */}
              {currentQuestion.options.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {currentQuestion.options.map((opt, optIndex) => {
                    const isSelected = selections[currentPage]?.includes(opt.label);
                    return (
                      <button
                        key={optIndex}
                        onClick={() => handleSelect(opt.label, currentQuestion.multi_select)}
                        className={`px-2.5 py-1.5 text-sm rounded transition-colors text-left ${
                          isSelected
                            ? 'bg-blue-500/40 text-white border border-blue-400/50'
                            : 'bg-white/10 text-white/70 hover:bg-white/15 border border-transparent'
                        }`}
                      >
                        {currentQuestion.multi_select && (
                          <span className="mr-1.5">{isSelected ? '☑' : '☐'}</span>
                        )}
                        <span className="font-medium">{opt.label}</span>
                        {opt.description && (
                          <span className="ml-2 text-white/50 text-xs">{opt.description}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  type="text"
                  placeholder="输入回答..."
                  value={selections[currentPage]?.[0] || ''}
                  onChange={(e) => setSelections(prev => {
                    const updated = [...prev];
                    updated[currentPage] = e.target.value ? [e.target.value] : [];
                    return updated;
                  })}
                  className="w-full px-2.5 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white placeholder-white/30 focus:outline-none focus:border-white/25"
                />
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between gap-2 ml-7 mt-2">
        <button
          onClick={handlePrev}
          disabled={isFirstPage}
          className={`px-3 py-1 text-sm rounded transition-colors ${
            isFirstPage
              ? 'text-white/30 cursor-not-allowed'
              : 'text-white/60 hover:text-white/80'
          }`}
        >
          ← 上一个
        </button>

        {/* Page dots */}
        {totalQuestions > 1 && (
          <div className="flex gap-1">
            {questions.map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === currentPage ? 'bg-blue-400' : 'bg-white/30'
                }`}
              />
            ))}
          </div>
        )}

        <button
          onClick={handleNext}
          disabled={!isCurrentAnswered}
          className={`px-3 py-1 text-sm rounded transition-colors ${
            !isCurrentAnswered
              ? 'bg-white/5 text-white/40 cursor-not-allowed'
              : isLastPage
                ? 'bg-blue-500/30 hover:bg-blue-500/40 text-white/90'
                : 'bg-white/10 hover:bg-white/15 text-white/60'
          }`}
        >
          {isLastPage ? '提交' : '下一个 →'}
        </button>
      </div>
    </motion.div>
  );
}