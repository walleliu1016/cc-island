// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

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
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-black/95 border border-white/10 rounded-xl p-4 w-[280px] shadow-xl"
          >
            <h3 className="text-white text-sm font-medium mb-3">重命名 session</h3>

            {/* Cwd hint */}
            <p className="text-white/40 text-xs mb-2 truncate">
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
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-white/30"
            />

            {/* Buttons */}
            <div className="flex gap-2 mt-3">
              <button
                onClick={onClose}
                className="flex-1 px-3 py-1.5 text-sm text-white/60 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="flex-1 px-3 py-1.5 text-sm text-black bg-white hover:bg-white/90 rounded-lg transition-colors"
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