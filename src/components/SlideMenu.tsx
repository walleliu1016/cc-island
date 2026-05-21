// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { motion } from 'framer-motion';

interface SlideMenuProps {
  onDelete: () => void;
  onArchive: () => void;
}

export function SlideMenu({ onDelete, onArchive }: SlideMenuProps) {
  return (
    <motion.div
      initial={{ x: 80 }}
      animate={{ x: 0 }}
      className="flex flex-col gap-1 justify-center"
      style={{
        background: 'rgba(255,255,255,0.1)',
        borderRadius: '8px',
        padding: '8px',
        width: '80px',
      }}
    >
      {/* Delete button */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="flex items-center gap-1"
        style={{
          background: 'none',
          border: 'none',
          color: '#f44336',
          fontSize: 11,
          padding: '4px',
        }}
      >
        ✗ 删除
      </button>

      {/* Archive button */}
      <button
        onClick={(e) => { e.stopPropagation(); onArchive(); }}
        className="flex items-center gap-1"
        style={{
          background: 'none',
          border: 'none',
          color: '#888',
          fontSize: 11,
          padding: '4px',
        }}
      >
        📁 归档
      </button>
    </motion.div>
  );
}