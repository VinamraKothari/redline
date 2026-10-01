/**
 * The keyboard shortcuts of the review workspace, as bound in
 * `src/lib/hooks/useShortcuts.ts`. Keys are written as they appear on key
 * caps; "⌘" stands for Ctrl on Windows and Linux.
 */
export interface Shortcut {
  keys: string[];
  does: string;
}

export const SHORTCUT_GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: "Modes",
    items: [
      { keys: ["V"], does: "Browse the page as a visitor" },
      { keys: ["C"], does: "Comment: click an element or drag over an area" },
      { keys: ["D"], does: "Draw on the page" },
      { keys: ["I"], does: "Inspect type, colour and spacing" },
      { keys: ["F"], does: "Full screen — the page without Redline's chrome" },
      { keys: ["Esc"], does: "Close what's open, then back to browsing" },
      { keys: ["?"], does: "Show every shortcut" },
    ],
  },
  {
    title: "Comments",
    items: [
      { keys: ["N"], does: "Next thread" },
      { keys: ["Shift", "N"], does: "Previous thread" },
      { keys: ["U"], does: "Mark the open thread read or unread" },
      { keys: ["Shift", "U"], does: "Mark every thread read" },
      { keys: ["Shift", "C"], does: "Hide or show all comments" },
    ],
  },
  {
    title: "Inspect",
    items: [
      { keys: ["Alt", "hover"], does: "Measure the distance to the selected element" },
      { keys: ["⌘", "hover"], does: "Deep-select: pick the innermost element" },
      { keys: ["H"], does: "Lock the hover state of a menu so you can comment on it" },
    ],
  },
  {
    title: "Draw tools",
    items: [
      { keys: ["P"], does: "Pen" },
      { keys: ["H"], does: "Highlighter" },
      { keys: ["L"], does: "Line" },
      { keys: ["A"], does: "Arrow" },
      { keys: ["R"], does: "Rectangle" },
      { keys: ["O"], does: "Ellipse" },
      { keys: ["T"], does: "Text" },
      { keys: ["S"], does: "Select and move" },
      { keys: ["⌫"], does: "Delete the selected shape" },
      { keys: ["⌘", "Z"], does: "Undo · Shift ⌘ Z redo" },
    ],
  },
  {
    title: "Page & viewport",
    items: [
      { keys: ["1"], does: "Desktop viewports (press again to cycle 1440 / 1920)" },
      { keys: ["2"], does: "Tablet viewports (1024 / 768)" },
      { keys: ["3"], does: "Phone viewports (430 / 390 / 375)" },
      { keys: ["⌘", "+"], does: "Zoom in · ⌘− zoom out" },
      { keys: ["⌘", "0"], does: "Fit the page to the window · ⌘1 100 %" },
      { keys: ["R"], does: "Reload the page" },
      { keys: ["Shift", "J"], does: "Turn the site's scripts off or on" },
    ],
  },
  {
    title: "Versions, Figma, sharing",
    items: [
      { keys: ["Shift", "F"], does: "Freeze this version" },
      { keys: ["Shift", "P"], does: "Save the current state as a new page" },
      { keys: ["Shift", "G"], does: "Compare with Figma" },
      { keys: ["Shift", "S"], does: "Share and export" },
    ],
  },
];
