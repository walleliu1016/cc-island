// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PopupItem, AskQuestion } from '../types';
import { useAppStore } from '../stores/appStore';
import { getTheme } from '../theme';

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
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);

  if (popup.type === 'permission') {
    const toolName = popup.permission_data?.tool_name || 'Unknown';
    const action = popup.permission_data?.action || 'Permission request';
    const details = popup.permission_data?.details;

    return (
      <motion.div
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-2 p-3 rounded-lg"
        style={{ background: colors.bgCardHover }}
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: colors.textPrimary }}>{toolName}</span>
          <span className="text-xs" style={{ color: colors.textMuted }}>{truncateText(popup.project_name, 10)}</span>
        </div>

        {/* Description */}
        <div className="text-xs" style={{ color: colors.textSecondary }}>
          {truncateText(action, 80)}
        </div>

        {/* Details */}
        {details && (
          <div className="rounded px-2 py-1.5 text-xs font-mono overflow-hidden" style={{ background: colors.bgInput, color: colors.textMuted }}>
            {truncateText(details, MAX_DETAILS_LENGTH)}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => onRespond(popup.id, 'deny')}
            className="px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{ background: '#ef4444', color: '#f1f5f9' }}
          >
            Deny
          </button>
          <button
            onClick={() => onRespond(popup.id, 'allow')}
            className="px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{ background: '#8b5cf6', color: '#f1f5f9' }}
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
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);

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
        className="flex flex-col gap-2 p-3 rounded-lg"
        style={{ background: colors.bgCardHover }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: colors.textPrimary }}>Question</span>
          <span className="text-xs" style={{ color: colors.textMuted }}>{truncateText(popup.project_name, 10)}</span>
        </div>
        <input
          type="text"
          placeholder="Enter answer..."
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          className="w-full px-2.5 py-1.5 text-sm rounded-lg focus:outline-none"
          style={{ background: colors.bgInput, border: `1px solid ${colors.bgInputBorder}`, color: colors.textPrimary }}
          onFocus={e => (e.target.style.borderColor = colors.accentPrimary)}
          onBlur={e => (e.target.style.borderColor = colors.bgInputBorder)}
        />
        <button
          onClick={handleSubmit}
          className="px-3 py-1.5 text-xs rounded-lg transition-colors"
          style={{ background: '#8b5cf6', color: '#f1f5f9' }}
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
      className="flex flex-col gap-2 p-3 rounded-lg"
      style={{ background: colors.bgCardHover }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium" style={{ color: colors.textPrimary }}>
          {totalQuestions > 1 ? `Q ${currentPage + 1}/${totalQuestions}` : 'Question'}
        </span>
        <span className="text-xs" style={{ color: colors.textMuted }}>{truncateText(popup.project_name, 10)}</span>
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
                <span className="inline-block px-2 py-0.5 mb-2 text-xs rounded-full" style={{ color: colors.textSecondary, background: colors.bgInput }}>
                  {currentQuestion.header}
                </span>
              )}
              {/* Question text */}
              <div className="text-sm mb-2" style={{ color: colors.textPrimary }}>{currentQuestion.question}</div>

              {/* Options */}
              {currentQuestion.options.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {currentQuestion.options.map((opt, optIndex) => {
                    const isSelected = selections[currentPage]?.includes(opt.label);
                    return (
                      <button
                        key={optIndex}
                        onClick={() => handleSelect(opt.label, currentQuestion.multiSelect)}
                        className="px-2.5 py-1.5 text-sm rounded-lg transition-colors text-left border"
                        style={{
                          background: isSelected ? `${colors.accentPrimary}22` : colors.bgInput,
                          color: isSelected ? colors.textPrimary : colors.textSecondary,
                          borderColor: isSelected ? `${colors.accentPrimary}44` : 'transparent',
                        }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = colors.bgCardHover; }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = colors.bgInput; }}
                      >
                        {currentQuestion.multiSelect && (
                          <span className="mr-1.5">{isSelected ? '☑' : '☐'}</span>
                        )}
                        <span className="font-medium">{opt.label}</span>
                        {opt.description && (
                          <span className="ml-2 text-xs" style={{ color: colors.textMuted }}>{opt.description}</span>
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
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg focus:outline-none"
                  style={{ background: colors.bgInput, border: `1px solid ${colors.bgInputBorder}`, color: colors.textPrimary }}
                  onFocus={e => (e.target.style.borderColor = colors.accentPrimary)}
                  onBlur={e => (e.target.style.borderColor = colors.bgInputBorder)}
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
          className="px-2 py-1 text-xs rounded transition-colors"
          style={{ color: isFirstPage ? colors.textMuted : colors.textSecondary }}
        >
          ← Prev
        </button>

        {/* Page dots */}
        {totalQuestions > 1 && (
          <div className="flex gap-1">
            {questions.map((_, i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full transition-colors"
                style={{ background: i === currentPage ? colors.textSecondary : colors.bgInputBorder }}
              />
            ))}
          </div>
        )}

        <button
          onClick={handleNext}
          disabled={!isCurrentAnswered}
          className="px-2.5 py-1 text-xs rounded-lg transition-colors"
          style={{
            background: !isCurrentAnswered ? colors.bgInput : '#8b5cf6',
            color: !isCurrentAnswered ? colors.textMuted : '#f1f5f9',
          }}
        >
          {isLastPage ? 'Submit' : 'Next →'}
        </button>
      </div>
    </motion.div>
  );
}