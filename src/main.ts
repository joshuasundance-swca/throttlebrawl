// Placeholder entry point from the scaffold (infra-1). It proves the pipeline end to end: a
// WebGL2 context, a coloured frame and the build stamp. app-1 replaces it with the composition
// root described in docs/architecture.md.

// A Keys sunset, top to bottom: sky bands, the sea, then the road.
const BANDS: readonly (readonly [number, number, number])[] = [
  [0.16, 0.08, 0.3],
  [0.42, 0.12, 0.42],
  [0.78, 0.22, 0.4],
  [0.98, 0.45, 0.25],
  [1.0, 0.72, 0.3],
  [0.05, 0.45, 0.55],
  [0.03, 0.3, 0.4],
  [0.12, 0.12, 0.14],
];
const MAX_PIXEL_RATIO = 1.5;

function stampText(): string {
  return `throttlebrawl · ${__BUILD_CHANNEL__} · ${__BUILD_BRANCH__} · ${__BUILD_ID__}`;
}

function draw(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement): void {
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  canvas.width = width;
  canvas.height = height;
  gl.viewport(0, 0, width, height);
  gl.enable(gl.SCISSOR_TEST);
  BANDS.forEach(([r, g, b], i) => {
    // WebGL's y axis points up, so band 0 (the top) starts at the highest y.
    const top = Math.round((height * (BANDS.length - i)) / BANDS.length);
    const bottom = Math.round((height * (BANDS.length - i - 1)) / BANDS.length);
    gl.scissor(0, bottom, width, top - bottom);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  });
  gl.disable(gl.SCISSOR_TEST);
}

function boot(): void {
  const canvas = document.createElement('canvas');
  canvas.id = 'game';
  const stamp = document.createElement('div');
  stamp.id = 'build-stamp';
  stamp.textContent = stampText();
  document.body.append(canvas, stamp);

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) {
    stamp.textContent = `${stampText()} · WebGL2 is not available here`;
    console.error('WebGL2 is not available');
    return;
  }
  draw(gl, canvas);
  window.addEventListener('resize', () => {
    draw(gl, canvas);
  });
}

boot();
