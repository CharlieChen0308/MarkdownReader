const os = require('os');
let pty;
try {
  pty = require('node-pty');
} catch {
  pty = null;
}

// Map of id → ptyProcess
const processes = new Map();
let nextId = 1;

function create(cwd, shellPath, envVars) {
  if (!pty) throw new Error('node-pty is not available');
  const id = nextId++;
  const shell = shellPath || (os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash'));
  const env = envVars ? { ...process.env, ...envVars } : process.env;
  const p = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: cwd || process.cwd(),
    env,
  });
  processes.set(id, p);
  return { id, process: p };
}

function write(id, data) {
  const p = processes.get(id);
  if (p) p.write(data);
}

function resize(id, cols, rows) {
  const p = processes.get(id);
  if (p) p.resize(cols, rows);
}

function destroy(id) {
  const p = processes.get(id);
  if (p) {
    p.kill();
    processes.delete(id);
  }
}

function destroyAll() {
  for (const [id, p] of processes) {
    p.kill();
  }
  processes.clear();
}

module.exports = { create, write, resize, destroy, destroyAll };
