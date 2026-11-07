// Saved hot-seat game in this browser. Storage can be unavailable (private
// windows, blocked site data), so every access is guarded.

const KEY = 'fleetcommand.save.v1';

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveGame(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearGame() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
