import { Sidebar } from './components/Sidebar';
import { BlockContainer } from './components/BlockContainer';
import { AICommandBar } from './components/AICommandBar';
import './styles/globals.css';
import './App.css';

function App() {
  return (
    <div className="app-container">
      <Sidebar />
      <main className="main-content">
        <BlockContainer />
        <AICommandBar />
      </main>
    </div>
  );
}

export default App;
