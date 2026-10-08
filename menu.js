// ==========================================================================
// FARM HANDS ESCAPE MENU
// --------------------------------------------------------------------------
// Pressing Escape (or the key bound to "Open this menu") opens a small menu
// with three choices: resume farming, credits, and settings. Settings is where
// every shortcut in the game can be rebound; changes apply immediately and are
// saved to localStorage by keybinds.js.
// ==========================================================================

import {
  KEYBIND_GROUPS,
  anyCustomBindings,
  clearBinding,
  eventMatches,
  getBindingCodes,
  isBindableCode,
  keyLabel,
  onKeybindsChange,
  resetKeybinds,
  setBinding,
} from './keybinds.js?v=field-craft-1';
import { closeFarmhouseMenu, isFarmhouseMenuOpen, isDeveloperTimeEnabled, setDeveloperTimeEnabled, setGamePaused } from './calendar.js?v=field-craft-1';

const pauseModal = document.querySelector('#pause-modal');
const pauseBackdrop = document.querySelector('#pause-backdrop');
const pauseCloseBtn = document.querySelector('#pause-close-btn');
const pauseResumeBtn = document.querySelector('#pause-resume-btn');
const pauseCreditsBtn = document.querySelector('#pause-credits-btn');
const pauseSettingsBtn = document.querySelector('#pause-settings-btn');
const pauseFooterHint = document.querySelector('#pause-footer-hint');
const viewRoot = document.querySelector('#pause-view-root');
const viewCredits = document.querySelector('#pause-view-credits');
const viewSettings = document.querySelector('#pause-view-settings');
const creditsBackBtn = document.querySelector('#credits-back-btn');
const settingsBackBtn = document.querySelector('#settings-back-btn');
const keybindGroupsEl = document.querySelector('#keybind-groups');
const keybindStatusEl = document.querySelector('#keybind-status');
const keybindResetBtn = document.querySelector('#keybind-reset-btn');
const keybindCustomNote = document.querySelector('#keybind-custom-note');
const cameraMemoryToggle = document.querySelector('#camera-memory-toggle');
const cameraResetBtn = document.querySelector('#camera-reset-btn');
const plotFocusToggle = document.querySelector('#plot-focus-toggle');
const developerResetBtn = document.querySelector('#developer-reset-btn');
const developerResetStatus = document.querySelector('#developer-reset-status');
const developerTimeToggle = document.querySelector('#developer-time-toggle');

const VIEWS = {
  root: { element: viewRoot, focus: () => pauseResumeBtn, hint: 'Press Esc to return to the farm.' },
  credits: { element: viewCredits, focus: () => viewCredits, hint: 'Press Esc to go back.' },
  settings: { element: viewSettings, focus: () => viewSettings, hint: 'Press Esc to go back.' },
};

let currentView = 'root';
let developerResetArmed = false;
// { actionId, slotIndex } while the player is choosing a new key.
let capturing = null;

export function isPauseMenuOpen() {
  return Boolean(pauseModal) && !pauseModal.hasAttribute('hidden');
}

function setStatus(message) {
  if (keybindStatusEl) keybindStatusEl.textContent = message;
}

function showView(name) {
  developerResetArmed = false;
  if (developerResetBtn) developerResetBtn.textContent = 'Reset everything';
  if (developerResetStatus) developerResetStatus.textContent = '';
  currentView = VIEWS[name] ? name : 'root';
  capturing = null;
  for (const [key, view] of Object.entries(VIEWS)) {
    if (!view.element) continue;
    if (key === currentView) view.element.removeAttribute('hidden');
    else view.element.setAttribute('hidden', '');
  }
  if (currentView === 'settings') renderKeybinds();
  if (pauseFooterHint) pauseFooterHint.textContent = VIEWS[currentView].hint;
  const focusTarget = VIEWS[currentView].focus();
  focusTarget?.focus?.();
}

// ─── Keybind editor ──────────────────────────────────────────────────────

function actionLabel(actionId) {
  for (const group of KEYBIND_GROUPS) {
    const action = group.actions.find((entry) => entry.id === actionId);
    if (action) return action.label;
  }
  return actionId;
}

function renderKeybinds() {
  if (!keybindGroupsEl) return;
  keybindGroupsEl.innerHTML = '';
  for (const group of KEYBIND_GROUPS) {
    const section = document.createElement('section');
    section.className = 'keybind-group';
    section.setAttribute('aria-label', group.title);

    const heading = document.createElement('div');
    heading.className = 'keybind-group-header';
    heading.innerHTML = `<div class="keybind-group-text">
        <h4 class="keybind-group-title">${group.title}</h4>
        <p class="keybind-group-desc">${group.description}</p>
      </div>`;
    section.append(heading);

    for (const action of group.actions) {
      const codes = getBindingCodes(action.id);

      const row = document.createElement('div');
      row.className = 'keybind-row';

      const label = document.createElement('span');
      label.className = 'keybind-label';
      label.textContent = action.label;
      row.append(label);

      const keys = document.createElement('div');
      keys.className = 'keybind-keys';
      for (let slotIndex = 0; slotIndex < action.slots.length; slotIndex += 1) {
        const code = codes[slotIndex] || null;
        const isCapturing = capturing
          && capturing.actionId === action.id
          && capturing.slotIndex === slotIndex;
        const slot = document.createElement('button');
        slot.type = 'button';
        slot.className = 'keybind-slot';
        slot.dataset.action = action.id;
        slot.dataset.slot = String(slotIndex);
        if (!code) slot.classList.add('is-empty');
        if (isCapturing) slot.classList.add('is-capturing');
        slot.textContent = isCapturing ? 'Press a key…' : keyLabel(code);
        slot.setAttribute(
          'aria-label',
          `${action.label}: ${isCapturing ? 'waiting for a key press' : keyLabel(code)}. Activate to rebind.`,
        );
        keys.append(slot);
      }
      row.append(keys);
      section.append(row);
    }
    keybindGroupsEl.append(section);
  }

  if (keybindCustomNote) {
    keybindCustomNote.textContent = anyCustomBindings()
      ? 'Custom keybinds are saved in this browser.'
      : 'Using the default keybinds.';
  }
}

function startCapture(actionId, slotIndex) {
  capturing = { actionId, slotIndex };
  renderKeybinds();
  setStatus(`Press a key for "${actionLabel(actionId)}". Backspace clears it, Escape cancels.`);
  const slot = keybindGroupsEl?.querySelector(
    `.keybind-slot[data-action="${actionId}"][data-slot="${slotIndex}"]`,
  );
  slot?.focus?.();
}

function finishCapture(code) {
  if (!capturing) return;
  const { actionId, slotIndex } = capturing;
  if (code === null) {
    clearBinding(actionId, slotIndex);
    setStatus(`"${actionLabel(actionId)}" is now unbound.`);
  } else {
    setBinding(actionId, slotIndex, code);
    setStatus(`"${actionLabel(actionId)}" is now ${keyLabel(code)}.`);
  }
  capturing = null;
  renderKeybinds();
}

keybindGroupsEl?.addEventListener('click', (event) => {
  const slot = event.target instanceof Element ? event.target.closest('.keybind-slot') : null;
  if (!slot) return;
  startCapture(slot.dataset.action, Number(slot.dataset.slot));
});

keybindResetBtn?.addEventListener('click', () => {
  resetKeybinds();
  capturing = null;
  renderKeybinds();
  setStatus('Keybinds reset to their default keys.');
});

// While capturing, swallow the key press before any game shortcut sees it.
document.addEventListener(
  'keydown',
  (event) => {
    if (!capturing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.code === 'Escape') {
      capturing = null;
      renderKeybinds();
      setStatus('Rebinding cancelled.');
      return;
    }
    if (event.code === 'Backspace' || event.code === 'Delete') {
      finishCapture(null);
      return;
    }
    if (!isBindableCode(event.code)) {
      setStatus('That key cannot be bound. Try a letter, number, arrow, or bracket key.');
      return;
    }
    finishCapture(event.code);
  },
  true,
);

// Clicking anywhere outside the slot being edited cancels the capture.
document.addEventListener(
  'pointerdown',
  (event) => {
    if (!capturing) return;
    const slot = event.target instanceof Element ? event.target.closest('.keybind-slot') : null;
    if (slot && slot.dataset.action === capturing.actionId && Number(slot.dataset.slot) === capturing.slotIndex) {
      return;
    }
    capturing = null;
    renderKeybinds();
  },
  true,
);

// ─── Camera memory controls ──────────────────────────────────────────────

function syncCameraControls() {
  if (!cameraMemoryToggle) return;
  let enabled = true;
  try {
    enabled = window.FarmGame?.isCameraMemoryEnabled?.() ?? true;
  } catch {
    enabled = true;
  }
  cameraMemoryToggle.checked = enabled;
  if (plotFocusToggle) plotFocusToggle.checked = window.FarmGame?.isPlotFocusEnabled?.() ?? true;
  if (developerTimeToggle) developerTimeToggle.checked = isDeveloperTimeEnabled();
}

cameraMemoryToggle?.addEventListener('change', () => {
  const enabled = cameraMemoryToggle.checked;
  window.dispatchEvent(new CustomEvent('farm-hands:camera-memory-change', { detail: { enabled } }));
  setStatus(enabled
    ? 'Camera memory on. Your view is saved and restored automatically.'
    : 'Camera memory off. The saved camera view was cleared.');
});

cameraResetBtn?.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('farm-hands:camera-reset'));
  setStatus('Camera moved back to the starting view.');
});

plotFocusToggle?.addEventListener('change', () => {
  window.dispatchEvent(new CustomEvent('farm-hands:plot-focus-change', { detail: { enabled: plotFocusToggle.checked } }));
  setStatus(plotFocusToggle.checked ? 'Plot centering is on.' : 'Plot centering is off.');
});

developerTimeToggle?.addEventListener('change', () => {
  setDeveloperTimeEnabled(developerTimeToggle.checked);
  setStatus(developerTimeToggle.checked ? 'Calendar time skip is available.' : 'Calendar time skip is off.');
});

developerResetBtn?.addEventListener('click', () => {
  if (!developerResetArmed) {
    developerResetArmed = true;
    developerResetBtn.textContent = 'Confirm reset everything';
    if (developerResetStatus) developerResetStatus.textContent = 'Click again to clear all farm data saved in this browser.';
    return;
  }
  window.FarmGame?.resetEverything?.();
});

// ─── Open / close ────────────────────────────────────────────────────────

export function openPauseMenu() {
  if (!pauseModal || isPauseMenuOpen()) return;
  showView('root');
  setStatus('Choose an option below.');
  syncCameraControls();
  pauseModal.removeAttribute('hidden');
  setGamePaused(true);
  window.dispatchEvent(new CustomEvent('farm-hands:menu-open'));
  pauseResumeBtn?.focus();
}

export function closePauseMenu() {
  if (!pauseModal || !isPauseMenuOpen()) return;
  capturing = null;
  pauseModal.setAttribute('hidden', '');
  setGamePaused(false);
  syncCameraControls();
  window.dispatchEvent(new CustomEvent('farm-hands:menu-close'));
  document.querySelector('#field')?.focus({ preventScroll: true });
}

export function togglePauseMenu() {
  if (isPauseMenuOpen()) closePauseMenu();
  else openPauseMenu();
}

/**
 * Escape is handled here so the three modals can never fight each other:
 * the calendar closes first, then a sub-page of this menu returns to the
 * menu root, and finally the menu itself closes.
 */
function handleEscape(event) {
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) {
    return;
  }
  event.preventDefault();
  if (isFarmhouseMenuOpen()) {
    closeFarmhouseMenu();
    return;
  }
  if (isPauseMenuOpen()) {
    if (currentView !== 'root') showView('root');
    else closePauseMenu();
    return;
  }
  openPauseMenu();
}

window.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  // Escape always opens this menu, even if "Open this menu" was rebound.
  if (event.key !== 'Escape' && !eventMatches(event, 'openMenu')) return;
  handleEscape(event);
});

// Root menu buttons
pauseResumeBtn?.addEventListener('click', () => closePauseMenu());
pauseCreditsBtn?.addEventListener('click', () => showView('credits'));
pauseSettingsBtn?.addEventListener('click', () => showView('settings'));
pauseCloseBtn?.addEventListener('click', () => closePauseMenu());
pauseBackdrop?.addEventListener('click', () => closePauseMenu());
creditsBackBtn?.addEventListener('click', () => showView('root'));
settingsBackBtn?.addEventListener('click', () => showView('root'));

onKeybindsChange(() => {
  if (isPauseMenuOpen() && currentView === 'settings') renderKeybinds();
});

renderKeybinds();
syncCameraControls();

window.FarmMenu = {
  openPauseMenu,
  closePauseMenu,
  togglePauseMenu,
  isPauseMenuOpen,
  isCapturingKey: () => Boolean(capturing),
};
