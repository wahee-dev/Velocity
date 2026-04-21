import { useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { SessionsSidebar } from './components/SessionsSidebar';
import { FileExplorer } from './components/FileExplorer';
import { TerminalPane } from './components/TerminalPane';
import type { Session } from './types';
import './styles/globals.css';
import './App.css';

function App() {
  const [showFileExplorer, setShowFileExplorer] = useState(true);
  const [_activeSession, setActiveSession] = useState<Session | null>(null);

  function handleSelectSession(session: Session) {
    setActiveSession(session);
  }

  return (
    <div className="app-container">
      <TitleBar />
      <div className="app-body">
        <SessionsSidebar onSelectSession={handleSelectSession} />
        <FileExplorer 
          isOpen={showFileExplorer} 
          onClose={() => setShowFileExplorer(false)} 
        />
        <div className="terminal-area">
          <TerminalPane 
            path="~\Documents\Code\Big Apps\Velocity\velocity" 
            isActive={true}
          />
          <TerminalPane 
            path="~\Documents\Code\Big Apps\Velocity\velocity" 
            isActive={false}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
