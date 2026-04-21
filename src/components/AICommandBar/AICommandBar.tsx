import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import {
  Sparkles,
  Terminal,
  Send,
  ArrowUp,
  Command,
  CornerDownLeft,
} from 'lucide-react';
import { handleExecuteCommand, handleAIPrompt, handleAIToCommand } from '../../hooks/useTauri';
import './AICommandBar.css';

type InputMode = 'command' | 'ai';

interface Suggestion {
  id: string;
  text: string;
  type: 'history' | 'ai' | 'completion';
}

export function AICommandBar() {
  const [inputValue, setInputValue] = useState('');
  const [mode, setMode] = useState<InputMode>('command');
  const [isProcessing, setIsProcessing] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mock suggestions for demonstration
  const mockSuggestions: Suggestion[] = [
    { id: '1', text: 'git status', type: 'history' },
    { id: '2', text: 'git commit -m ""', type: 'completion' },
    { id: '3', text: 'git push origin main', type: 'history' },
    { id: '4', text: 'npm run dev', type: 'history' },
    { id: '5', text: 'docker ps -a', type: 'history' },
  ];

  // Update suggestions based on input
  useEffect(() => {
    if (inputValue.trim() && mode === 'command') {
      const filtered = mockSuggestions.filter((s) =>
        s.text.toLowerCase().includes(inputValue.toLowerCase())
      );
      setSuggestions(filtered.slice(0, 5));
    } else {
      setSuggestions([]);
    }
    setSelectedSuggestionIndex(-1);
  }, [inputValue, mode]);

  const handleSubmit = async () => {
    if (!inputValue.trim() || isProcessing) return;

    setIsProcessing(true);

    try {
      if (mode === 'ai') {
        // AI mode - convert natural language to command or get AI response
        if (inputValue.startsWith('/')) {
          // Direct AI query
          await handleAIPrompt(inputValue.slice(1));
        } else {
          // Convert to command
          const command = await handleAIToCommand(inputValue);
          setInputValue(command);
          setMode('command');
        }
      } else {
        // Command mode - execute the command
        await handleExecuteCommand(inputValue);
        setInputValue('');
      }
    } catch (error) {
      console.log('Processing:', mode, inputValue);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Handle Tab for mode switching
    if (e.key === 'Tab') {
      e.preventDefault();
      setMode((prev) => (prev === 'command' ? 'ai' : 'command'));
      return;
    }

    // Handle Enter for submission
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (selectedSuggestionIndex >= 0 && suggestions[selectedSuggestionIndex]) {
        setInputValue(suggestions[selectedSuggestionIndex].text);
        setSuggestions([]);
        setSelectedSuggestionIndex(-1);
      } else {
        handleSubmit();
      }
      return;
    }

    // Handle arrow keys for suggestions
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestionIndex((prev) =>
        prev <= 0 ? suggestions.length - 1 : prev - 1
      );
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestionIndex((prev) =>
        prev >= suggestions.length - 1 ? 0 : prev + 1
      );
      return;
    }

    // Handle Escape to clear
    if (e.key === 'Escape') {
      e.preventDefault();
      if (suggestions.length > 0) {
        setSuggestions([]);
        setSelectedSuggestionIndex(-1);
      } else {
        setInputValue('');
      }
      return;
    }
  };

  const handleSuggestionClick = (suggestion: Suggestion) => {
    setInputValue(suggestion.text);
    setSuggestions([]);
    setSelectedSuggestionIndex(-1);
    inputRef.current?.focus();
  };

  return (
    <div className={`ai-command-bar ${isFocused ? 'focused' : ''}`}>
      {/* Suggestions Dropdown */}
      {suggestions.length > 0 && isFocused && (
        <div className="suggestions-dropdown">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.id}
              className={`suggestion-item ${index === selectedSuggestionIndex ? 'selected' : ''}`}
              onClick={() => handleSuggestionClick(suggestion)}
            >
              {suggestion.type === 'ai' ? (
                <Sparkles size={14} className="suggestion-icon ai" />
              ) : (
                <Terminal size={14} className="suggestion-icon" />
              )}
              <span className="suggestion-text">{suggestion.text}</span>
              <span className="suggestion-type">{suggestion.type}</span>
            </button>
          ))}
        </div>
      )}

      {/* Main Input Container */}
      <div className="command-bar-container">
        {/* Mode Toggle */}
        <button
          className={`mode-toggle ${mode}`}
          onClick={() => setMode((prev) => (prev === 'command' ? 'ai' : 'command'))}
          title={`Switch to ${mode === 'command' ? 'AI' : 'Command'} mode (Tab)`}
        >
          {mode === 'ai' ? (
            <Sparkles size={18} className="mode-icon ai" />
          ) : (
            <Terminal size={18} className="mode-icon" />
          )}
        </button>

        {/* Input Field */}
        <input
          ref={inputRef}
          type="text"
          className="command-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 150)}
          placeholder={
            mode === 'ai'
              ? 'Ask AI anything or describe a task...'
              : 'Enter a command...'
          }
          disabled={isProcessing}
        />

        {/* Submit Button */}
        <button
          className={`submit-btn ${isProcessing ? 'processing' : ''}`}
          onClick={handleSubmit}
          disabled={!inputValue.trim() || isProcessing}
          title="Execute (Enter)"
        >
          {isProcessing ? (
            <div className="spinner" />
          ) : mode === 'ai' ? (
            <Send size={18} />
          ) : (
            <CornerDownLeft size={18} />
          )}
        </button>
      </div>

      {/* Keyboard Hints */}
      <div className="keyboard-hints">
        <div className="hint">
          <kbd>Tab</kbd>
          <span>Switch mode</span>
        </div>
        <div className="hint">
          <kbd><ArrowUp size={12} /></kbd>
          <span>History</span>
        </div>
        <div className="hint">
          <kbd><Command size={12} /></kbd>
          <kbd>K</kbd>
          <span>Command palette</span>
        </div>
      </div>
    </div>
  );
}
