// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { invoke } from '@tauri-apps/api/core';

/**
 * Alias service for managing session aliases via Tauri IPC
 */

export interface AliasService {
  getAlias(cwd: string): Promise<string | null>;
  setAlias(cwd: string, alias: string): Promise<void>;
  getAllAliases(): Promise<Record<string, string>>;
}

/**
 * Get alias for a cwd path
 */
export async function getAlias(cwd: string): Promise<string | null> {
  try {
    const alias = await invoke<string | null>('get_alias', { cwd });
    return alias;
  } catch (error) {
    console.error('Failed to get alias:', error);
    return null;
  }
}

/**
 * Set alias for a cwd path (empty string removes alias)
 */
export async function setAlias(cwd: string, alias: string): Promise<void> {
  try {
    await invoke('set_alias', { cwd, alias });
  } catch (error) {
    console.error('Failed to set alias:', error);
    throw error;
  }
}

/**
 * Get all aliases as cwd -> alias map
 */
export async function getAllAliases(): Promise<Record<string, string>> {
  try {
    const aliases = await invoke<Record<string, string>>('get_all_aliases');
    return aliases;
  } catch (error) {
    console.error('Failed to get all aliases:', error);
    return {};
  }
}