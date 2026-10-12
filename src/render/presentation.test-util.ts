import type { Camera, Scene, Vector2 } from 'three';

/** Native rendering is recorded; every scene/mesh remains a real Three.js CPU object. */
export class NativeRendererFake {
  static instances: NativeRendererFake[] = [];
  ratio = 1;
  target: unknown = null;
  draws: Scene[] = [];
  info = {
    autoReset: true,
    render: { calls: 0, triangles: 0 },
    reset: () => {
      this.info.render.calls = 0;
    },
  };
  constructor() {
    NativeRendererFake.instances.push(this);
  }
  setPixelRatio(value: number) {
    this.ratio = value;
  }
  getPixelRatio() {
    return this.ratio;
  }
  setSize() {}
  getContext() {
    return { RENDERER: 1, getExtension: () => null, getParameter: () => 'cpu-fake' };
  }
  render(scene: Scene, _camera: Camera) {
    this.draws.push(scene);
    this.info.render.calls++;
  }
  getDrawingBufferSize(out: Vector2) {
    return out.set(320, 180);
  }
  getRenderTarget() {
    return this.target;
  }
  setRenderTarget(target: unknown) {
    this.target = target;
  }
}

export function canvasFake(): HTMLCanvasElement {
  return {
    clientWidth: 320,
    clientHeight: 180,
    width: 320,
    height: 180,
    addEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 180 }),
  } as unknown as HTMLCanvasElement;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
