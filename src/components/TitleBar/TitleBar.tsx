/* @solid */
import { createSignal } from "solid-js";
import { Search, Plus, Minus, Square, X, Bell, User } from "lucide-solid";
import { invoke } from "@tauri-apps/api/core";
import "./TitleBar.css";

export function TitleBar() {
  const [searchQuery, setSearchQuery] = createSignal("");

  async function handleSearch(e: KeyboardEvent) {
    if (e.key === "Enter" && searchQuery().trim()) {
      try {
        await invoke("search_sessions", { query: searchQuery() });
      } catch (error) {
        console.error("[Tauri] search_sessions failed:", error);
      }
    }
  }

  return (
    <div class="title-bar" data-tauri-drag-region>
      <div class="title-bar-left" />
      <div class="title-bar-center">
        <div class="search-container">
          <Search size={14} class="search-icon" />
          <input
            type="text"
            class="search-input"
            placeholder="Search sessions, agents, files..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
            onKeyDown={handleSearch}
          />
        </div>
      </div>
      <div class="title-bar-right">
        <button class="title-btn">
          <Plus size={16} />
        </button>
        <button class="title-btn">
          <Bell size={16} />
        </button>
        <div class="user-avatar">
          <User size={14} />
        </div>
        <div class="window-controls">
          <button
            class="window-btn"
            onClick={() =>
              invoke("minimize_window").catch(console.error)
            }
          >
            <Minus size={14} />
          </button>
          <button
            class="window-btn"
            onClick={() =>
              invoke("maximize_window").catch(console.error)
            }
          >
            <Square size={12} />
          </button>
          <button
            class="window-btn window-btn-close"
            onClick={() => invoke("close_window").catch(console.error)}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
