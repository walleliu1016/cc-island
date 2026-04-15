import { useState } from 'react'
import { PopupItem } from '../types'

interface PopupCardProps {
  popup: PopupItem
  onRespond: (popupId: string, decision?: string, answers?: string[][]) => void
}

export function PopupCard({ popup, onRespond }: PopupCardProps) {
  const [selectedAnswers, setSelectedAnswers] = useState<string[][]>(() =>
    popup.ask_data?.questions.map(() => []) || []
  )

  const handleAllow = () => {
    onRespond(popup.id, 'allow')
  }

  const handleDeny = () => {
    onRespond(popup.id, 'deny')
  }

  const handleAnswerSubmit = () => {
    onRespond(popup.id, undefined, selectedAnswers)
  }

  const handleOptionSelect = (questionIndex: number, optionLabel: string, multiSelect: boolean) => {
    setSelectedAnswers(prev => {
      const newAnswers = [...prev]
      if (multiSelect) {
        const current = newAnswers[questionIndex]
        if (current.includes(optionLabel)) {
          newAnswers[questionIndex] = current.filter(o => o !== optionLabel)
        } else {
          newAnswers[questionIndex] = [...current, optionLabel]
        }
      } else {
        newAnswers[questionIndex] = [optionLabel]
      }
      return newAnswers
    })
  }

  return (
    <div className="bg-nexus-bg2 border border-nexus-warning rounded-lg p-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full bg-nexus-warning animate-pulse" />
        <span className="text-nexus-warning text-sm font-medium">
          {popup.project_name}
        </span>
      </div>

      {/* Permission Request */}
      {popup.type === 'permission' && popup.permission_data && (
        <>
          <div className="text-nexus-text text-sm mb-1">
            {popup.permission_data.tool_name}
          </div>
          <div className="text-nexus-text2 text-xs mb-3">
            {popup.permission_data.action}
            {popup.permission_data.details && (
              <div className="truncate">{popup.permission_data.details}</div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAllow}
              className="flex-1 bg-nexus-success text-white rounded-lg py-2 text-sm font-medium"
            >
              允许
            </button>
            <button
              onClick={handleDeny}
              className="flex-1 bg-nexus-error text-white rounded-lg py-2 text-sm font-medium"
            >
              拒绝
            </button>
          </div>
        </>
      )}

      {/* Ask Questions */}
      {popup.type === 'ask' && popup.ask_data && (
        <>
          <div className="text-nexus-text2 text-xs mb-3">
            AskUserQuestion
          </div>
          {popup.ask_data.questions.map((q, qIndex) => (
            <div key={qIndex} className="mb-3">
              <div className="text-nexus-text text-sm mb-2">
                {q.header}: {q.question}
              </div>
              <div className="flex flex-col gap-1">
                {q.options.map((opt, optIndex) => {
                  const isSelected = selectedAnswers[qIndex]?.includes(opt.label)
                  return (
                    <button
                      key={optIndex}
                      onClick={() => handleOptionSelect(qIndex, opt.label, q.multi_select)}
                      className={`w-full text-left py-2 px-3 rounded-lg text-sm border ${
                        isSelected
                          ? 'bg-nexus-accent border-nexus-accent text-white'
                          : 'bg-nexus-bg border-nexus-border text-nexus-text'
                      }`}
                    >
                      {opt.label}
                      {opt.description && (
                        <div className="text-xs text-nexus-text2 mt-0.5">{opt.description}</div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <button
            onClick={handleAnswerSubmit}
            className="w-full bg-nexus-accent text-white rounded-lg py-2 text-sm font-medium"
          >
            提交答案
          </button>
        </>
      )}
    </div>
  )
}