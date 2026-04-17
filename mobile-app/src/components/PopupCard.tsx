// mobile-app/src/components/PopupCard.tsx
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react'
import { motion } from 'framer-motion'
import { PopupState, PermissionData, AskData, AskOption } from '../types'

interface PopupCardProps {
  popup: PopupState
  onRespond: (popupId: string, decision?: string | null, answers?: string[][]) => void
}

export function PopupCard({ popup, onRespond }: PopupCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [selectedAnswers, setSelectedAnswers] = useState<string[][]>(() =>
    popup.type === 'ask' ? ((popup.data as AskData)?.questions || []).map(() => []) : []
  )

  // Auto-dismiss animation
  const handleRespond = (decision?: string | null, answers?: string[][]) => {
    onRespond(popup.id, decision, answers)
  }

  // Permission popup
  if (popup.type === 'permission') {
    const data = popup.data as PermissionData
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20, height: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-white rounded-[12px] p-4 shadow-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[#f59e0b]">⚠</span>
            <span className="text-[#1a1a1a] font-medium text-[16px]">{data?.tool_name || '权限请求'}</span>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[#737373] text-sm"
          >
            {expanded ? '收起' : '展开'}
          </button>
        </div>

        {/* Content */}
        <div className="text-[#1a1a1a] text-[14px] mb-3">
          {expanded ? (
            <div className="space-y-2">
              <div><span className="text-[#737373]">操作:</span> {data?.action}</div>
              {data?.details && <div className="text-[14px] text-[#737373] truncate">{data.details}</div>}
              <div><span className="text-[#737373]">项目:</span> {popup.project_name}</div>
            </div>
          ) : (
            <div className="truncate">{data?.action || ''}</div>
          )}
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => handleRespond('deny')}
            className="flex-1 py-2 bg-[#ef4444] text-white rounded-[8px] font-medium text-[14px]"
          >
            拒绝
          </button>
          <button
            onClick={() => handleRespond('allow')}
            className="flex-1 py-2 bg-[#22c55e] text-white rounded-[8px] font-medium text-[14px]"
          >
            允许
          </button>
        </div>
      </motion.div>
    )
  }

  // Ask popup (multi-question)
  const askData = popup.data as AskData
  if (!askData?.questions || askData.questions.length === 0) return null

  const questions = askData.questions
  const totalQuestions = questions.length
  const isLastQuestion = currentQuestion === totalQuestions - 1
  const isFirstQuestion = currentQuestion === 0
  const currentQ = questions[currentQuestion]

  const handleOptionSelect = (optionLabel: string) => {
    setSelectedAnswers(prev => {
      const newAnswers = [...prev]
      if (currentQ.multi_select) {
        const current = newAnswers[currentQuestion]
        if (current.includes(optionLabel)) {
          newAnswers[currentQuestion] = current.filter(o => o !== optionLabel)
        } else {
          newAnswers[currentQuestion] = [...current, optionLabel]
        }
      } else {
        newAnswers[currentQuestion] = [optionLabel]
      }
      return newAnswers
    })
  }

  const handleNext = () => {
    if (currentQuestion < totalQuestions - 1) {
      setCurrentQuestion(currentQuestion + 1)
    }
  }

  const handlePrev = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1)
    }
  }

  const handleSubmit = () => {
    handleRespond(null, selectedAnswers)
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20, height: 0 }}
      transition={{ duration: 0.2 }}
      className="bg-white rounded-[12px] p-4 shadow-lg"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[#3b82f6]">❓</span>
          <span className="text-[#1a1a1a] font-medium text-[16px]">AskUserQuestion</span>
        </div>
        <span className="text-[#737373] text-sm">问题 {currentQuestion + 1}/{totalQuestions}</span>
      </div>

      {/* Question */}
      <div className="mb-3">
        <div className="text-[#1a1a1a] text-[14px] mb-2">
          {currentQ.header}: {currentQ.question}
        </div>
        <div className="space-y-2">
          {currentQ.options.map((opt: AskOption, idx: number) => {
            const isSelected = selectedAnswers[currentQuestion]?.includes(opt.label)
            return (
              <button
                key={idx}
                onClick={() => handleOptionSelect(opt.label)}
                className={`w-full text-left py-2 px-3 rounded-[8px] border text-[14px] ${
                  isSelected
                    ? 'bg-[#22c55e] border-[#22c55e] text-white'
                    : 'bg-[#f5f5f5] border-[#e5e5e5] text-[#1a1a1a]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{currentQ.multi_select ? (isSelected ? '☑' : '□') : (isSelected ? '●' : '○')}</span>
                  <span>{opt.label}</span>
                </div>
                {opt.description && (
                  <div className="text-xs mt-1 opacity-70">{opt.description}</div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={handlePrev}
          disabled={isFirstQuestion}
          className={`py-2 px-4 rounded-[8px] text-[14px] ${
            isFirstQuestion
              ? 'bg-[#f5f5f5] text-[#737373] cursor-not-allowed'
              : 'bg-[#1a1a1a] text-white'
          }`}
        >
          ◀ 上一题
        </button>

        {isLastQuestion ? (
          <button
            onClick={handleSubmit}
            className="flex-1 py-2 bg-[#22c55e] text-white rounded-[8px] font-medium text-[14px]"
          >
            提交全部答案
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="py-2 px-4 bg-[#1a1a1a] text-white rounded-[8px] text-[14px]"
          >
            下一题 ▶
          </button>
        )}
      </div>
    </motion.div>
  )

  // Fallback for unknown popup types
  return null
}