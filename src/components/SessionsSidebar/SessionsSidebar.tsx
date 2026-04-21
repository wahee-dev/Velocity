import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PanelLeft,
  Scissors,
  LayoutGrid,
  Search,
  ArrowLeftRight,
  Plus,
  Flame
} from 'lucide-react';
import { useTerminalContext } from '../../context/TerminalContext';
import type { Session } from '../../types';
import './SessionsSidebar.css';

const mockSessions: Session[] = [
  { id: '1', name: 'Claude Code', path: '~\\Documents\\Code\\Big Apps\\Velocity\\velocity', icon: 'claude', isActive: false },
  { id: '2', name: 'clear', path: '~\\Documents\\Code\\Big Apps\\Velocity\\velocity', isActive: false },
  { id: '3', name: 'New session', path: '~\\Documents\\Code\\Big Apps\\Velocity\\velocity', isActive: false },
  { id: '4', name: 'New session', path: '~\\Documents\\Code\\Big Apps\\Velocity\\velocity', isActive: true },
];

interface SessionsSidebarProps {
  onSelectSession: (session: Session) => void;
}

export function SessionsSidebar({ onSelectSession }: SessionsSidebarProps) {
  const context = useTerminalContext();
  const [sessions] = useState<Session[]>(mockSessions);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>('4');

  function handleNewSession() {
    // Stub — will be wired to Tauri backend later
    console.log('[SessionsSidebar] create_session (stub)');
  }

  function handleSelectSession(session: Session) {
    setSelectedId(session.id);
    onSelectSession(session);
    context.setActiveSession(session.id);
  }

  const filteredSessions = sessions.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="sessions-sidebar">
      <div className="sidebar-toolbar">
        <button className="toolbar-btn">
          <PanelLeft size={16} />
        </button>
        <button className="toolbar-btn">
          <Scissors size={16} />
        </button>
        <button className="toolbar-btn">
          <LayoutGrid size={16} />
        </button>
      </div>

      <div className="sidebar-search">
        <Search size={12} className="search-icon" />
        <input
          type="text"
          placeholder="Search tabs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="search-actions">
          <button className="search-action-btn">
            <ArrowLeftRight size={12} />
          </button>
          <button className="search-action-btn" onClick={handleNewSession}>
            <Plus size={12} />
          </button>
        </div>
      </div>

      <div className="sessions-list">
        <AnimatePresence>
          {filteredSessions.map((session) => (
            <motion.div
              key={session.id}
              layout
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`session-item ${selectedId === session.id ? 'selected' : ''}`}
              onClick={() => handleSelectSession(session)}
            >
              <div className="session-icon">
                {session.icon === 'claude' ? (
                  <Flame size={16} className="claude-icon" />
                ) : (
                  <span className="terminal-prompt">&gt;</span>
                )}
              </div>
              <div className="session-info">
                <span className="session-name">{session.name}</span>
                <span className="session-path">{session.path}</span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
