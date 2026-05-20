// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onRename: () => void;
  onClose: () => void;
}

export function ContextMenu({ isOpen, position, onRename, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Delay to avoid immediate close from the same click
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.1 }}
          style={{
            position: 'fixed',
            left: position.x,
            top: position.y,
            zIndex: 1000,
          }}
          className="bg-black/90 border border-white/10 rounded-lg shadow-lg py-1 min-w-[120px]"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRename();
              onClose();
            }}
            className="w-full px-3 py-2 text-sm text-white/80 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" className="text-white/60">
              <path d="M2 3h8v1H2V3zm0 3h6v1H2V6zm0 3h4v1H2V9z"/>
              <path d="M10 2l2 2-5 5H5v-2l5-5z" fill="none" stroke="currentColor" strokeWidth="1"/>
            </svg>
            重命名
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}