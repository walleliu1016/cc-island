import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PopupItem, AskQuestion } from '../types';

// Maximum length for command/details before truncation
const MAX_DETAILS_LENGTH = 150;

// Truncate string with ellipsis
const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
};

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
    const toolName = popup.permission_data?.tool_name || 'Unknown';
    const action = popup.permission_data?.action || 'Permission request';
    const details = popup.permission_data?.details;

    return (
      <motion.div
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-2 p-3 rounded-lg bg-white/[0.06]"
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-medium">{toolName}</span>
          <span className="text-white/40 text-xs">{truncateText(popup.project_name, 10)}</span>
        </div>

        {/* Description */}
        <div className="text-white/60 text-xs">
          {truncateText(action, 80)}
        </div>

        {/* Details */}
        {details && (
          <div className="bg-black/40 rounded px-2 py-1.5 text-xs font-mono text-white/50 overflow-hidden">
            {truncateText(details, MAX_DETAILS_LENGTH)}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => onRespond(popup.id, 'deny')}
            className="px-3 py-1.5 text-xs text-white/90 bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors"
          >
            Deny
          </button>
          <button
            onClick={() => onRespond(popup.id, 'allow')}
            className="px-3 py-1.5 text-xs text-white bg-purple-500 hover:bg-purple-400 rounded-lg transition-colors"
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

// Ask popup with pagination
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
  const [textInput, setTextInput] = useState<string>('');

  const totalQuestions = questions.length;
  const isLastPage = currentPage >= totalQuestions - 1;
  const isFirstPage = currentPage === 0;
  const currentQuestion = questions[currentPage];

  // Handle selection
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

  // Navigate
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

  // Submit
  const handleSubmit = () => {
    if (questions.length > 0) {
      onRespond(popup.id, undefined, undefined, selections);
    } else {
      onRespond(popup.id, undefined, textInput);
    }
  };

  // Check if answered
  const isCurrentAnswered = currentQuestion
    ? currentQuestion.options.length === 0 || (selections[currentPage]?.length ?? 0) > 0
    : true;

  // No questions case
  if (questions.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-2 p-3 rounded-lg bg-white/[0.06]"
      >
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-medium">Question</span>
          <span className="text-white/40 text-xs">{truncateText(popup.project_name, 10)}</span>
        </div>
        <input
          type="text"
          placeholder="Enter answer..."
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          className="w-full px-2.5 py-1.5 text-sm bg-white/[0.08] border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-white/25"
        />
        <button
          onClick={handleSubmit}
          className="px-3 py-1.5 text-xs text-white bg-purple-500 hover:bg-purple-400 rounded-lg transition-colors"
        >
          Submit
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2 p-3 rounded-lg bg-white/[0.06]"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-white text-sm font-medium">
          {totalQuestions > 1 ? `Q ${currentPage + 1}/${totalQuestions}` : 'Question'}
        </span>
        <span className="text-white/40 text-xs">{truncateText(popup.project_name, 10)}</span>
      </div>

      {/* Question content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentPage}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.15 }}
        >
          {currentQuestion && (
            <>
              {/* Header chip */}
              {currentQuestion.header && (
                <span className="inline-block px-2 py-0.5 mb-2 text-xs text-white/60 bg-white/[0.08] rounded-full">
                  {currentQuestion.header}
                </span>
              )}
              {/* Question text */}
              <div className="text-white/80 text-sm mb-2">{currentQuestion.question}</div>

              {/* Options */}
              {currentQuestion.options.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {currentQuestion.options.map((opt, optIndex) => {
                    const isSelected = selections[currentPage]?.includes(opt.label);
                    return (
                      <button
                        key={optIndex}
                        onClick={() => handleSelect(opt.label, currentQuestion.multiSelect)}
                        className={`px-2.5 py-1.5 text-sm rounded-lg transition-colors text-left ${
                          isSelected
                            ? 'bg-white/[0.15] text-white border border-white/20'
                            : 'bg-white/[0.05] text-white/60 hover:bg-white/[0.08] border border-transparent'
                        }`}
                      >
                        {currentQuestion.multiSelect && (
                          <span className="mr-1.5">{isSelected ? '☑' : '☐'}</span>
                        )}
                        <span className="font-medium">{opt.label}</span>
                        {opt.description && (
                          <span className="ml-2 text-white/40 text-xs">{opt.description}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  type="text"
                  placeholder="Enter answer..."
                  value={selections[currentPage]?.[0] || ''}
                  onChange={(e) => setSelections(prev => {
                    const updated = [...prev];
                    updated[currentPage] = e.target.value ? [e.target.value] : [];
                    return updated;
                  })}
                  className="w-full px-2.5 py-1.5 text-sm bg-white/[0.08] border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-white/25"
                />
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-2 mt-2">
        <button
          onClick={handlePrev}
          disabled={isFirstPage}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            isFirstPage
              ? 'text-white/30'
              : 'text-white/50 hover:text-white/70'
          }`}
        >
          ← Prev
        </button>

        {/* Page dots */}
        {totalQuestions > 1 && (
          <div className="flex gap-1">
            {questions.map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === currentPage ? 'bg-white/60' : 'bg-white/20'
                }`}
              />
            ))}
          </div>
        )}

        <button
          onClick={handleNext}
          disabled={!isCurrentAnswered}
          className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
            !isCurrentAnswered
              ? 'bg-white/[0.05] text-white/30'
              : 'bg-purple-500 text-white hover:bg-purple-400'
          }`}
        >
          {isLastPage ? 'Submit' : 'Next →'}
        </button>
      </div>
    </motion.div>
  );
}