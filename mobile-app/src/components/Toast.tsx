// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { motion, AnimatePresence } from 'framer-motion'
import { ToastType } from '../hooks/useToast'

interface ToastProps {
  visible: boolean
  message: string
  type: ToastType
}

const toastStyles: Record<ToastType, { bg: string; icon: string }> = {
  success: { bg: 'bg-[#22c55e]', icon: '✓' },
  error: { bg: 'bg-[#ef4444]', icon: '✗' },
  warning: { bg: 'bg-[#f59e0b]', icon: '⚠' },
}

export function Toast({ visible, message, type }: ToastProps) {
  const style = toastStyles[type]

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50"
        >
          <div className={`${style.bg} text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2`}>
            <span>{style.icon}</span>
            <span className="text-sm font-medium">{message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}