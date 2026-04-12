import { useState, useEffect } from 'react';

// Terminal-style colors (matching Claude Island)
export const TerminalColors = {
  green: '#66c075',
  amber: '#ffb700',
  red: '#ff4d4d',
  cyan: '#00cccc',
  blue: '#6699ff',
  purple: '#8b5cf6',  // Allow button color
  dim: 'rgba(255,255,255,0.4)',
  dimmer: 'rgba(255,255,255,0.2)',
  prompt: '#d97857', // Claude orange
  islandOrange: '#ff9500',  // Island sunset orange
  islandYellow: '#ffcc00',  // Island sunset yellow
};

/**
 * Processing Spinner - Animated symbol spinner matching Claude Island
 * Uses rotating symbols: · ✢ ✳ ∗ ✻ ✽
 */
export function ProcessingSpinner({ size = 12 }: { size?: number }) {
  const [phase, setPhase] = useState(0);
  const symbols = ['·', '✢', '✳', '∗', '✻', '✽'];
  const color = TerminalColors.prompt;

  useEffect(() => {
    const timer = setInterval(() => {
      setPhase((p) => (p + 1) % symbols.length);
    }, 150);
    return () => clearInterval(timer);
  }, []);

  return (
    <span
      style={{
        fontSize: size,
        fontWeight: 'bold',
        color,
        width: size,
        textAlign: 'center',
        display: 'inline-block',
      }}
    >
      {symbols[phase]}
    </span>
  );
}

/**
 * Claude Crab Icon - Pixel art style crab mascot
 * With optional animated legs when processing
 */
export function ClaudeCrabIcon({
  size = 14,
  animateLegs = false,
  color = TerminalColors.prompt,
}: {
  size?: number;
  animateLegs?: boolean;
  color?: string;
}) {
  const [legPhase, setLegPhase] = useState(0);

  // Leg height offsets for walking animation
  const legPatterns = [
    [3, -3, 3, -3], // Phase 0: alternating
    [0, 0, 0, 0], // Phase 1: neutral
    [-3, 3, -3, 3], // Phase 2: opposite
    [0, 0, 0, 0], // Phase 3: neutral
  ];

  useEffect(() => {
    if (animateLegs) {
      const timer = setInterval(() => {
        setLegPhase((p) => (p + 1) % 4);
      }, 150);
      return () => clearInterval(timer);
    }
  }, [animateLegs]);

  const legOffsets = animateLegs ? legPatterns[legPhase] : [0, 0, 0, 0];
  const baseLegHeight = 13;
  const legPositions = [6, 18, 42, 54];

  return (
    <svg
      width={size * (66 / 52)}
      height={size}
      viewBox="0 0 66 52"
      style={{ display: 'block' }}
    >
      {/* Left antenna */}
      <rect x={0} y={13} width={6} height={13} fill={color} />
      {/* Right antenna */}
      <rect x={60} y={13} width={6} height={13} fill={color} />

      {/* Legs - animated */}
      {legPositions.map((xPos, index) => {
        const heightOffset = legOffsets[index];
        const legHeight = baseLegHeight + heightOffset;
        return (
          <rect
            key={index}
            x={xPos}
            y={39}
            width={6}
            height={legHeight}
            fill={color}
          />
        );
      })}

      {/* Body */}
      <rect x={6} y={0} width={54} height={39} fill={color} />

      {/* Left eye */}
      <rect x={12} y={13} width={6} height={6.5} fill="black" />
      {/* Right eye */}
      <rect x={48} y={13} width={6} height={6.5} fill="black" />
    </svg>
  );
}

/**
 * Permission Indicator Icon - Amber dot for waiting approval
 */
export function PermissionIndicatorIcon({
  size = 14,
  color = TerminalColors.amber,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14">
      {/* Simple amber circle */}
      <circle cx={7} cy={7} r={6} fill={color} />
      {/* Inner dot */}
      <circle cx={7} cy={7} r={2} fill="black" opacity={0.3} />
    </svg>
  );
}

/**
 * Ready for Input Icon - Green checkmark for waiting user input
 */
export function ReadyForInputIcon({
  size = 14,
  color = TerminalColors.green,
}: {
  size?: number;
  color?: string;
}) {
  const scale = size / 30;

  // Checkmark pixel positions
  const pixels: [number, number][] = [
    [5, 15],
    [9, 19],
    [13, 23],
    [17, 19],
    [21, 15],
    [25, 11],
    [29, 7],
  ];

  const pixelSize = 4 * scale;

  return (
    <svg width={size} height={size} viewBox="0 0 30 30">
      {pixels.map(([x, y], i) => (
        <rect
          key={i}
          x={x - pixelSize / 2}
          y={y - pixelSize / 2}
          width={pixelSize}
          height={pixelSize}
          fill={color}
        />
      ))}
    </svg>
  );
}

/**
 * Idle Icon - Simple dim circle
 */
export function IdleIcon({
  size = 12,
  color = TerminalColors.dim,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12">
      <circle cx={6} cy={6} r={4} fill={color} />
    </svg>
  );
}

/**
 * Island Icon - Sunset/island style icon matching Claude Island
 * Orange-yellow gradient with island silhouette
 */
export function IslandIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      {/* Gradient definitions */}
      <defs>
        <linearGradient id="islandGradient" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#ff9500" />
          <stop offset="100%" stopColor="#ffcc00" />
        </linearGradient>
      </defs>

      {/* Sun/semicircle at top */}
      <circle cx="8" cy="8" r="5" fill="url(#islandGradient)" />

      {/* Island silhouette at bottom */}
      <path
        d="M2 12 L5 10 L8 11 L11 9 L14 12 L14 14 L2 14 Z"
        fill="#1c1c1e"
      />
    </svg>
  );
}

/**
 * Close Icon - X icon for closing expanded view
 */
export function CloseIcon({ size = 14, color = 'rgba(255,255,255,0.4)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14">
      <path
        d="M3 3 L11 11 M11 3 L3 11"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Menu Icon - Three horizontal lines (hamburger menu)
 */
export function MenuIcon({ size = 14, color = 'rgba(255,255,255,0.4)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="currentColor" style={{ color }}>
      <rect x="2" y="4" width="10" height="1.5" rx="0.75" />
      <rect x="2" y="7" width="10" height="1.5" rx="0.75" />
      <rect x="2" y="10" width="10" height="1.5" rx="0.75" />
    </svg>
  );
}

/**
 * Status Icon - Unified component showing appropriate icon based on phase
 */
export function StatusIcon({
  phase,
  size = 12,
}: {
  phase: 'processing' | 'waitingForApproval' | 'waitingForInput' | 'idle' | 'ended';
  size?: number;
}) {
  switch (phase) {
    case 'processing':
      return <ProcessingSpinner size={size} />;
    case 'waitingForApproval':
      return (
        <span style={{ fontSize: size, color: TerminalColors.amber }}>
          <ProcessingSpinner size={size} />
        </span>
      );
    case 'waitingForInput':
      return <ReadyForInputIcon size={size} />;
    case 'idle':
    case 'ended':
      return <IdleIcon size={size} />;
    default:
      return <IdleIcon size={size} />;
  }
}