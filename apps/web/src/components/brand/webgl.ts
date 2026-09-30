/** Whether this browser can create a WebGL context for a decorative 3D scene. */
export function hasWebGL(): boolean {
  const canvas = document.createElement('canvas');
  try {
    if (canvas.getContext('webgl2')) return true;
  } catch {
    // Try WebGL 1 below when WebGL 2 is unavailable or throws during initialization.
  }
  try {
    return Boolean(canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
