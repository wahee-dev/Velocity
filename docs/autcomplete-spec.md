Feature: Next Command Prediction (Groq Powered)

This feature provides ultra-low-latency "Ghost Text" suggestions by leveraging Groq's LPU (Language Processing Unit) to predict the user’s next move.



Logic Flow

Trigger: * Post-Execution: Immediately after a command finishes (Exit Code 0).

Intentional Pause: User stops typing for 150ms (Groq is fast enough that you don't need a long debounce).

Context Gathering (Rust/Tauri):

last_5_commands: The recent shell history.

cwd: Current working directory name.

ls_snapshot: A comma-separated list of the top 10 files/folders in the CWD.

os: (Optional) The OS (macOS/Linux/Windows) to ensure compatible syntax.

Inference (Groq Backend via HF Space or Direct):

Model Recommendation: llama-3.1 8B instant2 (Extremely fast and highly capable of shell logic).

System Prompt: > "You are a terminal autocomplete engine. Suggest only the single most likely next shell command based on history and files. Output only the command. No prose. No markdown."

User Prompt Pattern: > Files: [ls_snapshot] | CWD: [cwd] | History: [last_5_commands] | Suggest next command:

UI Rendering (SolidJS):

The suggestion is rendered as inline grayed-out text.

Low Latency Optimization: Because Groq returns text in ~100-200ms, you can update the ghost text as the user types the first few characters of the next command to "narrow down" the prediction.



Technical Tip: The "Stop" Sequence

To ensure Groq doesn't start explaining the command, set a stop sequence in your API call for \n (newline). This forces the model to stop immediately after generating the command line, further reducing latency and token costs.

Since Groq is so fast, do you plan to have the ghost text update in real-time as the user types, or only when the prompt is empty?