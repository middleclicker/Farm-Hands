// ==========================================================================
// FARM HANDS KEY BINDINGS
// --------------------------------------------------------------------------
// A tiny shared store for every remappable action in the game. Both game.js
// (camera movement, field planting) and calendar.js (menus, dev speed) read
// their shortcuts from here, so the Settings panel can rebind them live.
//
// Bindings are stored as KeyboardEvent.code values (physical keys) which keeps
// WASD working the same way on non-QWERTY layouts. Each action owns a fixed
// number of slots; a slot may be unbound (null).
// ==========================================================================

export const STORAGE_KEYBINDS_KEY = 'farm-hands-keybinds-v1';

// Every action the player can rebind, grouped for display in Settings.
export const KEYBIND_GROUPS = [
  {
    id: 'camera',
    title: 'Camera movement',
    description: 'Move the camera across the farm.',
    actions: [
      { id: 'moveForward', label: 'Move forward', slots: ['KeyW'] },
      { id: 'moveBackward', label: 'Move backward', slots: ['KeyS'] },
      { id: 'moveLeft', label: 'Move left', slots: ['KeyA'] },
      { id: 'moveRight', label: 'Move right', slots: ['KeyD'] },
    ],
  },
  {
    id: 'field',
    title: 'Field & planting',
    description: 'Choose a soil plot and sow wheat.',
    actions: [
      { id: 'selectUp', label: 'Select plot above', slots: ['ArrowUp'] },
      { id: 'selectDown', label: 'Select plot below', slots: ['ArrowDown'] },
      { id: 'selectLeft', label: 'Select plot to the left', slots: ['ArrowLeft'] },
      { id: 'selectRight', label: 'Select plot to the right', slots: ['ArrowRight'] },
      { id: 'plant', label: 'Plant wheat in the selected plot', slots: ['Enter', 'Space'] },
    ],
  },
  {
    id: 'menus',
    title: 'Menus & time',
    description: 'Open the calendar, the menu, and developer time controls.',
    actions: [
      { id: 'calendar', label: 'Open the farmhouse calendar', slots: ['KeyC', 'KeyH'] },
      { id: 'openMenu', label: 'Open this menu', slots: ['Escape'] },
      { id: 'speedUp', label: 'Speed up game time', slots: ['KeyT', 'BracketRight'] },
      { id: 'speedDown', label: 'Slow down game time', slots: ['BracketLeft'] },
    ],
  },
];

export const KEYBIND_ACTIONS = KEYBIND_GROUPS.flatMap((group) => group.actions);
const ACTION_BY_ID = new Map(KEYBIND_ACTIONS.map((action) => [action.id, action]));

// Physical-key whitelist. Anything outside this list is rejected so a stray
// code (or hand-edited localStorage) can never make an action unpressable.
const KEY_CODE_PATTERN = new RegExp(
  '^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Numpad(?:Add|Subtract|Multiply|Divide|Decimal|Enter)|' +
  'F(?:[1-9]|1[0-2])|Arrow(?:Up|Down|Left|Right)|' +
  'Space|Enter|NumpadEnter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock|' +
  'BracketLeft|BracketRight|Semicolon|Quote|Comma|Period|Slash|Backslash|Minus|Equal|Backquote|' +
  'ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight|MetaLeft|MetaRight|Escape)$',
);

// Keys that need a friendlier name than the raw KeyboardEvent.code.
const SPECIAL_LABELS = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  CapsLock: 'Caps',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  AltLeft: 'L Alt',
  AltRight: 'R Alt',
  MetaLeft: 'L Cmd',
  MetaRight: 'R Cmd',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num −',
  NumpadMultiply: 'Num ×',
  NumpadDivide: 'Num ÷',
  NumpadDecimal: 'Num .',
  NumpadEnter: 'Num Enter',
};

export function isBindableCode(code) {
  return typeof code === 'string' && KEY_CODE_PATTERN.test(code);
}

export function keyLabel(code) {
  if (!code) return 'Unbound';
  if (SPECIAL_LABELS[code]) return SPECIAL_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

function defaultState() {
  const state = new Map();
  for (const action of KEYBIND_ACTIONS) {
    state.set(action.id, action.slots.slice());
  }
  return state;
}

function sanitizeSlotList(value, slotCount) {
  if (!Array.isArray(value)) return null;
  const slots = [];
  for (let index = 0; index < slotCount; index += 1) {
    const code = value[index];
    slots.push(isBindableCode(code) ? code : null);
  }
  // Drop duplicates that a hand-edited save may contain.
  const seen = new Set();
  return slots.map((code) => {
    if (!code || seen.has(code)) return null;
    seen.add(code);
    return code;
  });
}

function loadState() {
  const state = defaultState();
  let saved = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYBINDS_KEY);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  if (saved && typeof saved === 'object') {
    for (const action of KEYBIND_ACTIONS) {
      const slots = sanitizeSlotList(saved[action.id], action.slots.length);
      if (slots) state.set(action.id, slots);
    }
  }
  return state;
}

const state = loadState();
const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEYBINDS_KEY, JSON.stringify(Object.fromEntries(state)));
  } catch {
    // Storage unavailable (private browsing); bindings still work this session.
  }
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A broken listener must never break the input system.
    }
  }
}

export function onKeybindsChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBindingCodes(actionId) {
  return (state.get(actionId) || []).slice();
}

/** All bindable codes for an action, with unbound slots removed. */
export function getBoundCodes(actionId) {
  return getBindingCodes(actionId).filter(Boolean);
}

/** Human-readable label for an action's first bound key, e.g. "W" or "Unbound". */
export function bindingLabel(actionId) {
  return keyLabel(getBoundCodes(actionId)[0]);
}

/** "W / ↑" style summary of every bound key for an action. */
export function bindingSummary(actionId) {
  const labels = getBoundCodes(actionId).map(keyLabel);
  return labels.length ? labels.join(' / ') : 'Unbound';
}

/** True when the keyboard event matches any key bound to the action. */
export function eventMatches(event, actionId) {
  if (!event || !event.code) return false;
  return getBoundCodes(actionId).includes(event.code);
}

/**
 * Assign a physical key to one slot of an action. The same key can only be
 * bound once across the whole game: it is removed from wherever it was before.
 * Passing null/undefined clears the slot.
 */
export function setBinding(actionId, slotIndex, code) {
  const action = ACTION_BY_ID.get(actionId);
  if (!action || slotIndex < 0 || slotIndex >= action.slots.length) return false;
  if (code !== null && code !== undefined && !isBindableCode(code)) return false;

  const slots = state.get(actionId);
  if (code === null || code === undefined) {
    slots[slotIndex] = null;
  } else {
    for (const other of KEYBIND_ACTIONS) {
      const otherSlots = state.get(other.id);
      for (let index = 0; index < otherSlots.length; index += 1) {
        if (otherSlots[index] === code) otherSlots[index] = null;
      }
    }
    slots[slotIndex] = code;
  }
  persist();
  notify();
  return true;
}

export function clearBinding(actionId, slotIndex) {
  return setBinding(actionId, slotIndex, null);
}

/** True when the action still looks like it ships out of the box. */
export function isDefaultBinding(actionId) {
  const action = ACTION_BY_ID.get(actionId);
  if (!action) return true;
  const current = getBindingCodes(actionId);
  if (current.length !== action.slots.length) return false;
  return current.every((code, index) => code === action.slots[index]);
}

export function resetKeybinds() {
  for (const action of KEYBIND_ACTIONS) {
    state.set(action.id, action.slots.slice());
  }
  persist();
  notify();
}

export function anyCustomBindings() {
  return KEYBIND_ACTIONS.some((action) => !isDefaultBinding(action.id));
}
