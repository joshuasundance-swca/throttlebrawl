// ui/tuning: the hidden tuning panel (tuning-1 owns this folder after app-1). The skeleton's stub
// builds one slider per declaration from the registry and toggles with the backquote key; it
// stays usable as an overlay while the race runs. tuning-1 adds the groups, presets, the three
// ways to open it and the frame-rate cap.
import type { TuningRegistry } from '../../tuning';

export interface TuningPanel {
  readonly element: HTMLElement;
  toggle(open?: boolean): void;
  readonly open: boolean;
}

export function createTuningPanel(root: HTMLElement, registry: TuningRegistry): TuningPanel {
  const panel = document.createElement('div');
  panel.id = 'tuning-panel';
  panel.hidden = true;
  const title = document.createElement('div');
  title.className = 'tuning-title';
  title.textContent = 'Tuning';
  panel.append(title);
  for (const d of registry.decls) {
    const row = document.createElement('label');
    row.className = 'tuning-row';
    const name = document.createElement('span');
    const value = document.createElement('output');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(d.min);
    slider.max = String(d.max);
    slider.step = String(d.step);
    slider.value = String(registry.get(d.id));
    slider.dataset['param'] = d.id;
    name.textContent = d.label;
    const show = () => (value.textContent = `${registry.get(d.id)}${d.unit ? ` ${d.unit}` : ''}`);
    show();
    slider.addEventListener('input', () => {
      registry.set(d.id, Number(slider.value));
      show();
    });
    row.append(name, slider, value);
    panel.append(row);
  }
  root.append(panel);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') panel.hidden = !panel.hidden;
  });
  return {
    element: panel,
    toggle(open) {
      panel.hidden = open === undefined ? !panel.hidden : !open;
    },
    get open() {
      return !panel.hidden;
    },
  };
}
