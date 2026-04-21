import { useState, useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { SessionsSidebar } from './components/SessionsSidebar';
import { FileExplorer } from './components/FileExplorer';
import { TerminalPane } from './components/TerminalPane';
import { TerminalProvider, useTerminalContext } from './context/TerminalContext';
import type { Session } from './types';
import './styles/globals.css';
import './App.css';

function TerminalArea() {
  const context = useTerminalContext();
  const [sessionIds, setSessionIds] = useState<string[]>([]);

  useEffect(() => {
    // Initialize 2 default sessions on mount
    const id1 = context.createSession('~\\Documents\\Code\\Big Apps\\Velocity\\velocity');
    const id2 = context.createSession('~\\Documents\\Code\\Big Apps\\Velocity\\velocity');
    setSessionIds([id1, id2]);
    context.setActiveSession(id1);
  }, []);

  return (
    <div className="terminal-area">
      {sessionIds.map((id) => (
        <TerminalPane key={id} sessionId={id} />
      ))}
    </div>
  );
}

function App() {
  const [showFileExplorer, setShowFileExplorer] = useState(true);
  const [_activeSession, setActiveSession] = useState<Session | null>(null);

  function handleSelectSession(session: Session) {
    setActiveSession(session);
  }

  return (
    <TerminalProvider>
      <div className="app-container">
        <TitleBar />
        <div className="app-body">
          <SessionsSidebar onSelectSession={handleSelectSession} />
          <FileExplorer
            isOpen={showFileExplorer}
            onClose={() => setShowFileExplorer(false)}
          />
          <TerminalArea />
        </div>
      </div>
    </TerminalProvider>
  );
}

export default App;
