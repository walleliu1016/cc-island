// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { motion } from 'framer-motion';

interface NotchShapeProps {
  width: number;
  height: number;
  isOpen: boolean;
}

// Corner radius constants matching iOS Dynamic Island
const CORNERS = {
  closed: { top: 6, bottom: 14 },
  opened: { top: 19, bottom: 24 },
};

// Terminal-style colors
export const TerminalColors = {
  green: '#66c075',
  amber: '#ffb700',
  red: '#ff4d4d',
  cyan: '#00cccc',
  blue: '#6699ff',
  magenta: '#cc66cc',
  dim: 'rgba(255,255,255,0.4)',
  dimmer: 'rgba(255,255,255,0.2)',
  prompt: '#d97857', // Claude orange
  background: 'rgba(255,255,255,0.05)',
  backgroundHover: 'rgba(255,255,255,0.1)',
};

/**
 * Generate SVG path for the notch shape using quadratic curves
 * Matches the iOS Dynamic Island shape with asymmetric corners
 */
export function generateNotchPath(
  width: number,
  height: number,
  topRadius: number,
  bottomRadius: number
): string {
  // Ensure minimum dimensions
  const w = Math.max(width, 2 * topRadius + 2 * bottomRadius);
  const h = Math.max(height, topRadius + bottomRadius);

  const points: string[] = [];

  // Start at top-left
  points.push(`M 0,0`);

  // Top-left corner curve (curves inward)
  points.push(`Q ${topRadius},0 ${topRadius},${topRadius}`);

  // Left edge down to bottom-left corner
  points.push(`L ${topRadius},${h - bottomRadius}`);

  // Bottom-left corner curve
  points.push(`Q ${topRadius},${h} ${topRadius + bottomRadius},${h}`);

  // Bottom edge
  points.push(`L ${w - topRadius - bottomRadius},${h}`);

  // Bottom-right corner curve
  points.push(`Q ${w - topRadius},${h} ${w - topRadius},${h - bottomRadius}`);

  // Right edge up to top-right corner
  points.push(`L ${w - topRadius},${topRadius}`);

  // Top-right corner curve (curves inward)
  points.push(`Q ${w - topRadius},0 ${w},0`);

  // Close path
  points.push(`Z`);

  return points.join(' ');
}

/**
 * NotchShape component - renders the Dynamic Island shape
 * Uses pure SVG path for cross-platform compatibility
 */
export function NotchShape({ width, height, isOpen }: NotchShapeProps) {
  const corners = isOpen ? CORNERS.opened : CORNERS.closed;
  const path = generateNotchPath(width, height, corners.top, corners.bottom);

  return (
    <motion.svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      <motion.path
        d={path}
        fill="black"
        initial={false}
        animate={{ d: path }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      />
    </motion.svg>
  );
}

/**
 * Get current corner radii based on state
 */
export function getCornerRadii(isOpen: boolean) {
  return isOpen ? CORNERS.opened : CORNERS.closed;
}

/**
 * CSS-compatible border-radius approximation
 * Note: CSS can't do asymmetric corners on all sides, this is an approximation
 */
export function getCSSBorderRadius(isOpen: boolean): string {
  const corners = getCornerRadii(isOpen);
  // Use the larger radius for all corners as approximation
  return `${corners.top}px ${corners.top}px ${corners.bottom}px ${corners.bottom}px`;
}