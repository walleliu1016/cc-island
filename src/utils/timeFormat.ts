// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT

/**
 * Format duration in human-readable form
 * @param seconds Duration in seconds
 * @returns Formatted string like "15分钟" or "2小时"
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours}小时`;
  }
  return `${hours}小时${remainingMinutes}分钟`;
}

/**
 * Format relative time (how long ago)
 * @param timestamp Unix timestamp in seconds
 * @returns Formatted string like "5分钟前" or "刚刚"
 */
export function formatTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 10) {
    return '刚刚';
  }
  if (diff < 60) {
    return `${diff}秒前`;
  }
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) {
    return `${minutes}分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}小时前`;
  }
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

/**
 * Format running duration from start timestamp
 * @param startedAt Unix timestamp in seconds
 * @returns Formatted string like "运行 15分钟"
 */
export function formatRunningDuration(startedAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const duration = now - startedAt;
  return `运行 ${formatDuration(duration)}`;
}