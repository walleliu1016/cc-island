// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { ClaudeInstance, PopupItem } from '../types';

const API_BASE = 'http://localhost:17527';

export const api = {
  async getInstances(): Promise<ClaudeInstance[]> {
    const res = await fetch(`${API_BASE}/instances`);
    return res.json();
  },

  async getPopups(): Promise<PopupItem[]> {
    const res = await fetch(`${API_BASE}/popups`);
    return res.json();
  },

  async respondToPopup(popupId: string, decision?: string, answer?: string): Promise<void> {
    await fetch(`${API_BASE}/response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ popup_id: popupId, decision, answer }),
    });
  },

  async jumpToInstance(sessionId: string): Promise<void> {
    await fetch(`${API_BASE}/jump`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
  },
};