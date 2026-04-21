import { useState } from 'react';
import { Search, Plus, Minus, Square, X, Bell, User } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import './TitleBar.css';

export function TitleBar() {
  const [searchQuery, setSearchQuery] = useState('');

  async function handleSearch(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && searchQuery.trim()) {
      try {
        await invoke('search_sessions', { query: searchQuery });
      } catch (error) {
        console.error('[Tauri] search_sessions failed:', error);
      }
    }
  }

  async function handleMinimize() {
    try {
      await invoke('minimize_window');
    } catch (error) {
      console.error('[Tauri] minimize_window failed:', error);
    }
  }

  async function handleMaximize() {
    try {
      await invoke('maximize_window');
    } catch (error) {
      console.error('[Tauri] maximize_window failed:', error);
    }
  }

  async function handleClose() {
    try {
      await invoke('close_window');
    } catch (error) {
      console.error('[Tauri] close_window failed:', error);
    }
  }

  return (
    <div className="title-bar" data-tauri-drag-region>
      <div className="title-bar-left">
        {/* Spacer for sidebar alignment */}
      </div>
      
      <div className="title-bar-center">
        <div className="search-container">
          <Search size={14} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search sessions, agents, files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearch}
          />
        </div>
      </div>
      
      <div className="title-bar-right">
        <button className="title-btn">
          <Plus size={16} />
        </button>
        <button className="title-btn">
          <Bell size={16} />
        </button>
        <div className="user-avatar">
          <User size={14} />
        </div>
        <div className="window-controls">
          <button className="window-btn" onClick={handleMinimize}>
            <Minus size={14} />
          </button>
          <button className="window-btn" onClick={handleMaximize}>
            <Square size={12} />
          </button>
          <button className="window-btn window-btn-close" onClick={handleClose}>
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
