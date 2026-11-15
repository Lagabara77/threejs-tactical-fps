// Emberline's look plan, in one place. A dusk foundry yard: cold blue-grey steel, warm
// amber for Vanguard, cool teal for Sentinel, one hot orange accent for the reactor and
// the crosshair. The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#191d24',
  surface: '#22272f',
  hairline: '#333a45',
  ink: '#ece7db',
  muted: '#9aa3ae',
  amber: '#f0a830',
  teal: '#3fb8a6',
  danger: '#e5484d',
  reactor: '#ff6a2b',
  floor: '#2a2f37',
  floorDark: '#23272e',
  crate: '#6b5b3e',
  container: '#3d5a66',
  containerAlt: '#6b4a3d',
};

export function hex(name) {
  return PALETTE[name];
}
