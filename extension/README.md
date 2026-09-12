# SmartForm AI – Chrome Manifest V3 Extension

A real Chrome Manifest V3 extension designed for cyber café operators to inspect live government application portals, extract structured DOM elements, and execute non-intrusive auto-fill.

## Features
- **Live Tab Inspection**: Recursively discovers inputs, textareas, selects, radio groups, checkboxes, file inputs, semantic labels, ARIA tags, fieldsets, and nearby text.
- **Controlled Input Compatibility**: Dispatches standard native input setter and synthetic DOM events (`input`, `change`, `blur`) ensuring modern React/Vue/Angular controlled forms react immediately.
- **Security-First Auto-Fill**: Strictly never submits forms automatically. Highlights the final Submit button for operator manual verification.
- **File Input Detection**: Explicitly identifies file inputs requiring manual attachment when browser security mandates manual user interaction.

## Installation Instructions
1. Open Google Chrome.
2. Navigate to `chrome://extensions`.
3. Enable **Developer Mode** using the toggle in the top right corner.
4. Click **Load unpacked**.
5. Select this `/extension` folder.
6. The SmartForm AI icon will appear in your Chrome toolbar.
7. Open any live government form or the sample test form (`/live-test-form`) to begin filling.
