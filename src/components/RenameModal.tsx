// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../stores/appStore';
import { getTheme } from '../theme';

interface RenameModalProps {
  isOpen: boolean;
  currentName: string;
  cwd: string;
  onSave: (alias: string) => void;
  onClose: () => void;
}

export function RenameModal({ isOpen, currentName, cwd, onSave, onClose }: RenameModalProps) {
  const [alias, setAlias] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);

  // Reset and focus on open
  useEffect(() => {
    if (isOpen) {
      setAlias(currentName);
      // Focus input after animation
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [isOpen, currentName]);

  // Handle save
  const handleSave = () => {
    onSave(alias.trim());
    onClose();
  };

  // Handle keyboard
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 flex items-center justify-center z-50"
          onClick={onClose}
          style={{ background: 'rgba(0,0,0,0.5)' }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl p-4 w-[280px] shadow-xl"
            style={{ background: colors.bgModal, border: `1px solid ${colors.borderMedium}` }}
          >
            <h3 className="text-sm font-medium mb-3" style={{ color: colors.textPrimary }}>重命名 session</h3>

            {/* Cwd hint */}
            <p className="text-xs mb-2 truncate" style={{ color: colors.textMuted }}>
              {cwd.replace(/^\/home\/[^\/]+/, '~').replace(/^\/Users\/[^\/]+/, '~')}
            </p>

            {/* Input */}
            <input
              ref={inputRef}
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入别名..."
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ background: colors.bgInput, border: `1px solid ${colors.bgInputBorder}`, color: colors.textPrimary }}
              onFocus={e => (e.target.style.borderColor = colors.accentPrimary)}
              onBlur={e => (e.target.style.borderColor = colors.bgInputBorder)}
            />

            {/* Buttons */}
            <div className="flex gap-2 mt-3">
              <button
                onClick={onClose}
                className="flex-1 px-3 py-1.5 text-sm rounded-lg transition-colors"
                style={{ background: colors.bgInput, color: colors.textMuted }}
                onMouseEnter={e => { e.currentTarget.style.background = colors.bgCardHover; e.currentTarget.style.color = colors.textSecondary; }}
                onMouseLeave={e => { e.currentTarget.style.background = colors.bgInput; e.currentTarget.style.color = colors.textMuted; }}
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="flex-1 px-3 py-1.5 text-sm rounded-lg transition-colors"
                style={{ background: colors.textPrimary, color: colors.bgApp }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                保存
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}