// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useCallback } from 'react'

type ToastType = 'success' | 'error' | 'warning'

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

  const showToast = useCallback((message: string, type: ToastType = 'success', duration: number = 2000) => {
    setToast({ visible: true, message, type })
    setTimeout(() => {
      setToast({ visible: false, message: '', type: 'success' })
    }, duration)
  }, [])

  const showSuccess = useCallback((message: string) => showToast(message, 'success', 2000), [showToast])
  const showError = useCallback((message: string) => showToast(message, 'error', 2000), [showToast])
  const showWarning = useCallback((message: string) => showToast(message, 'warning', 3000), [showToast])

  const hideToast = useCallback(() => {
    setToast({ visible: false, message: '', type: 'success' })
  }, [])

  return { toast, showSuccess, showError, showWarning, hideToast }
}