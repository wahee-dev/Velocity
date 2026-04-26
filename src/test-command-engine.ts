import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Simulation of the TerminalPane initialization logic to ensure engine integrity
async function runCommandTest(command: string) {
  console.log(`Starting test for: "${command}"`);
  
  const paneId = "test-session-1";
  
  // 1. Initialize PTY
  const ptyInfo = await invoke<{ id: string; cwd: string }>("spawn_pty", {
    paneId,
  });
  const sessionId = ptyInfo.id;
  console.log(`PTY spawned, session: ${sessionId}`);

  // 2. Listen for events like the app
  const unlistenCwd = await listen("cwd-changed", (event: any) => {
    if (event.payload.sessionId === sessionId) {
      console.log(`[EVENT] CWD changed to: ${event.payload.cwd}`);
    }
  });

  // 3. Execute command
  await invoke("execute_command", {
    paneId,
    command,
  });

  // 4. Wait a moment to see if it triggers
  await new Promise(r => setTimeout(r, 2000));
  
  // Cleanup
  unlistenCwd();
  await invoke("kill_pty", { sessionId });
  console.log("Test finished.");
}

// Run test
runCommandTest("cd ..");
