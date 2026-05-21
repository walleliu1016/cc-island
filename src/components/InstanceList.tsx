// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { ClaudeInstance, PopupItem } from '../types';
import { SessionCard, getPhasePriority } from './SessionCard';
import { FoldedSessions } from './FoldedSessions';

// Fold threshold: 10 minutes (600 seconds)
const FOLD_THRESHOLD_SECONDS = 600;

// Check if instance is folded (inactive for threshold)
function isFolded(instance: ClaudeInstance): boolean {
  const now = Math.floor(Date.now() / 1000);
  const inactiveSeconds = now - instance.last_activity_at;
  return inactiveSeconds >= FOLD_THRESHOLD_SECONDS;
}

// Split instances into active and folded
function splitByFoldState(instances: ClaudeInstance[]): { active: ClaudeInstance[], folded: ClaudeInstance[] } {
  const active: ClaudeInstance[] = [];
  const folded: ClaudeInstance[] = [];

  for (const instance of instances) {
    // Ended sessions always go to folded
    if (instance.status.type === 'ended' || isFolded(instance)) {
      folded.push(instance);
    } else {
      active.push(instance);
    }
  }

  return { active, folded };
}

interface InstanceListProps {
  instances: ClaudeInstance[];
  popups?: PopupItem[];
  onJump: (sessionId: string) => void;
  onViewChat?: (sessionId: string) => void;
  onRespond?: (popupId: string, decision: 'allow' | 'deny') => void;
  onViewAsk?: (sessionId: string) => void;
}

export function InstanceList({ instances, popups = [], onJump, onViewChat, onRespond, onViewAsk }: InstanceListProps) {
  // Split into active and folded
  const { active, folded } = splitByFoldState(instances);

  // Sort active instances by priority
  const sortedActive = [...active].sort((a, b) => {
    const priorityA = getPhasePriority(a.status, popups.find(p => p.session_id === a.session_id && p.status === 'pending'));
    const priorityB = getPhasePriority(b.status, popups.find(p => p.session_id === b.session_id && p.status === 'pending'));
    return priorityA - priorityB;
  });

  if (sortedActive.length === 0 && folded.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {/* Active instances */}
      {sortedActive.map((instance) => (
        <SessionCard
          key={instance.session_id}
          instance={instance}
          allInstances={sortedActive}
          pendingPopup={popups.find(p => p.session_id === instance.session_id && p.status === 'pending')}
          onJump={onJump}
          onViewChat={onViewChat}
          onRespond={onRespond}
          onViewAsk={onViewAsk}
          isDesktopMode={false}
        />
      ))}

      {/* Folded instances section */}
      <FoldedSessions
        instances={folded}
        popups={popups}
        onJump={onJump}
        onViewChat={onViewChat}
        onRespond={onRespond}
      />
    </div>
  );
}

