// Loads src/editorData.js (a browser script) into a Node vm sandbox so tests
// can call EditorData.migrate()/validate() without a browser.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The game logs (and recovers from) bad data on purpose; tests feed it bad
// data on purpose, so keep error/warn output out of the test report.
const quietConsole = { ...console, error() {}, warn() {} };

function loadEditorData({ storage = {} } = {}) {
  const store = { ...storage };
  const sandbox = {
    console: quietConsole,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    fetch: () => Promise.reject(new Error('no network in tests')),
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'editorData.js'), 'utf8');
  // `const EditorData` is script-scoped, so expose it by evaluating it last.
  const EditorData = vm.runInContext(src + '\n;EditorData', sandbox);
  return { EditorData, store };
}

module.exports = { loadEditorData };

// Loads editorData + gameState + saveSystem together (same order as index.html).
function loadGame({ storage = {} } = {}) {
  const store = { ...storage };
  const sandbox = {
    console: quietConsole,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
      key: i => Object.keys(store)[i],
      get length() { return Object.keys(store).length; },
    },
    fetch: () => Promise.reject(new Error('no network in tests')),
    BUILD_INFO: { version: 'test' },
  };
  vm.createContext(sandbox);
  const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  const src = ['editorData.js', 'gameState.js', 'saveSystem.js'].map(read).join('\n');
  const api = vm.runInContext(src + '\n;({EditorData, GameState, SaveSystem})', sandbox);
  return { ...api, store };
}
module.exports.loadGame = loadGame;
