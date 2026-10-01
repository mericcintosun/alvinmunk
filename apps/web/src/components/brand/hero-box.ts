// The 3D hero's box, shared with its dynamic() loading placeholder on /app so the swap
// doesn't shift the dashboard. Lives outside constellation-3d.tsx so the placeholder can
// import it without pulling three.js into the page chunk. Phones get a shorter sky so the
// dashboard's first actions come sooner; from `sm` up it is the full-height hero.
export const HERO_BOX = 'h-[42vh] max-h-[620px] min-h-[280px] sm:h-[64vh] sm:min-h-[440px]';
