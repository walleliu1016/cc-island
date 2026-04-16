// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useCallback, useRef, useEffect } from 'react'

export type ToastType = 'success' | 'error' | 'warning'

interface ToastState {
  visible: boolean
  message: string
  type: ToastType
}

export function useToast() {
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: '',
    type: 'success',
  })

  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => clearTimer, [clearTimer])

  const showToast = useCallback((message: string, type: ToastType = 'success', duration: number = 2000) => {
    clearTimer() // Clear any existing timer first
    setToast({ visible: true, message, type })
    timerRef.current = setTimeout(() => {
      setToast({ visible: false, message: '', type: 'success' })
      timerRef.current = null
    }, duration)
  }, [clearTimer])

  const showSuccess = useCallback((message: string) => showToast(message, 'success', 2000), [showToast])
  const showError = useCallback((message: string) => showToast(message, 'error', 2000), [showToast])
  const showWarning = useCallback((message: string) => showToast(message, 'warning', 3000), [showToast])

  const hideToast = useCallback(() => {
    clearTimer()
    setToast({ visible: false, message: '', type: 'success' })
  }, [clearTimer])

  return { toast, showSuccess, showError, showWarning, hideToast }
}