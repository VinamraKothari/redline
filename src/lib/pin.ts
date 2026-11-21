/**
 * Comment pin geometry, shared by the workspace (CommentLayer) and the
 * exports (render.ts). A pin is a circle centred on its anchor: the point the
 * reviewer clicked (for a region, the region's top-right corner) is the middle
 * of the marker, so nothing about it reads as "a bit above". Stored anchors
 * are untouched — only the drawing is defined here.
 */

/** Diameter of a pin on screen in CSS px, inside its 2px white ring. */
export const PIN_SIZE = 28;
/** How far a pin reaches from its centre, ring included. */
const PIN_REACH = PIN_SIZE / 2 + 2;

/**
 * Where a pin is drawn for an anchor at (x, y) on a page `pageWidth` wide.
 * `inverse` is 1/zoom: the pin keeps its screen size, so in page pixels it
 * reaches PIN_REACH·inverse. A pin on the page's left, right or top edge is
 * nudged inwards just enough to be seen whole; the anchor itself is unchanged.
 */
export function pinCentre(x: number, y: number, inverse = 1, pageWidth = Infinity): { x: number; y: number } {
  const reach = PIN_REACH * inverse;
  return { x: Math.max(reach, Math.min(pageWidth - reach, x)), y: Math.max(reach, y) };
}

/**
 * The box a pin is drawn in, centred on (x, y) in page coordinates and scaled
 * by `inverse` around that centre, so everything inside it that scales
 * (hover, the active pin, the pop-in) scales around the centre as well.
 */
export function pinBox(x: number, y: number, inverse = 1): { left: number; top: number; width: number; height: number; transform: string } {
  return {
    left: x,
    top: y,
    width: PIN_SIZE,
    height: PIN_SIZE,
    transform: `translate(-50%, -50%) scale(${inverse})`,
  };
}
