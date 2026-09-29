// The 3D hero's box, shared with its dynamic() loading placeholder on /app so the swap
// doesn't shift the dashboard. Lives outside constellation-3d.tsx so the placeholder can
// import it without pulling three.js into the page chunk.
export const HERO_BOX = 'h-[64vh] max-h-[620px] min-h-[440px]';
