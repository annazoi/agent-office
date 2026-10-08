// Opening ⚙️ Settings at a pane from anywhere in the office (the elevator sends an admin to
// Connections to give the office its Composio key), without that place importing the HUD.
import type { SettingsPane } from './settings';

let opener: ((pane?: SettingsPane) => void) | undefined;

/** The HUD says how Settings opens. */
export function setSettingsOpener(open: (pane?: SettingsPane) => void) {
  opener = open;
}

export function openSettingsAt(pane: SettingsPane) {
  opener?.(pane);
}
