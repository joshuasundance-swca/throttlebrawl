import type { AppHandle } from '../app';
import { measurementConsumer, measurementReport } from './measurement';

export interface MeasurementTool {
  close(): void;
}
const tools = new WeakMap<AppHandle, MeasurementTool>();

/** A private diagnostic overlay: the ordinary menu and its action gate stay in place. */
export function mountMeasurementTool(
  app: AppHandle,
  exports: { copy: () => unknown; save: () => unknown },
  doc: Document = document,
): MeasurementTool {
  const mounted = tools.get(app);
  if (mounted) return mounted;
  const consumer = measurementConsumer(app);
  const box = doc.createElement('section');
  box.id = 'measurement-tool';
  box.setAttribute('aria-label', 'Measure frames');
  box.setAttribute('data-measurement-tool', '');
  box.style.cssText =
    'position:fixed;z-index:900;right:max(8px,env(safe-area-inset-right));' +
    'bottom:max(8px,env(safe-area-inset-bottom));width:min(360px,calc(100vw - 16px));' +
    'max-height:calc(100dvh - 16px);overflow-y:auto;box-sizing:border-box;padding:12px;' +
    'background:#151515f5;color:#fff;border:1px solid #aaa;border-radius:8px;font:14px/1.35 system-ui';
  const title = doc.createElement('h2');
  title.textContent = 'Measure frames';
  title.style.cssText = 'font-size:18px;margin:0 0 8px';
  box.append(title);
  const explanation = doc.createElement('p');
  explanation.textContent =
    'Runs an automated repeated race. Keeps 15 minutes of eligible frame intervals, with a 20-minute wall limit. Sound and recording are omitted. This is a diagnostic, not a phone performance pass.';
  box.append(explanation);
  const status = doc.createElement('p');
  status.id = 'measurement-status';
  status.setAttribute('role', 'status');
  box.append(status);
  const actions = doc.createElement('div');
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
  box.append(actions);
  let closed = false;
  let progressTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners: (() => void)[] = [];
  const button = (text: string, id: string, action: () => void) => {
    const el = doc.createElement('button');
    el.type = 'button';
    el.textContent = text;
    el.id = id;
    el.style.cssText = 'min-height:44px;padding:8px;font:inherit';
    el.addEventListener('click', action);
    listeners.push(() => el.removeEventListener('click', action));
    actions.append(el);
    return el;
  };
  const start = button('Start', 'measurement-start', () => {
    if (closed) return;
    const pending = consumer.start();
    update();
    void pending.finally(() => {
      if (!closed) update();
    });
  });
  const stop = button('Cancel/Stop', 'measurement-stop', () => {
    consumer.cancel();
    update();
  });
  const tool: MeasurementTool = {
    close() {
      if (closed) return;
      closed = true;
      if (progressTimer !== null) clearTimeout(progressTimer);
      progressTimer = null;
      consumer.dispose();
      for (const remove of listeners) remove();
      box.remove();
      if (tools.get(app) === tool) tools.delete(app);
    },
  };
  button('Close', 'measurement-close', () => tool.close());
  button('Copy debug report', 'measurement-copy-report', () => {
    exports.copy();
  });
  button('Save debug file', 'measurement-save-file', () => {
    exports.save();
  });
  const update = () => {
    if (closed) return;
    if (progressTimer !== null) clearTimeout(progressTimer);
    progressTimer = null;
    const progress = consumer.progress();
    start.disabled = progress.phase !== 'idle';
    stop.disabled = progress.phase === 'idle';
    if (progress.phase === 'preparing') status.textContent = 'Preparing diagnostic…';
    else if (progress.phase === 'running') {
      status.textContent = `Partial/running · eligible ${(progress.eligibleMs / 60_000).toFixed(1)} / 15 min · ${progress.state}`;
    } else {
      const report = measurementReport(app);
      status.textContent =
        report?.kind === 'refused'
          ? `Refused: ${JSON.stringify(report.refusal)}`
          : report?.kind === 'failed-before-start'
            ? report.message
            : report?.kind === 'ended'
              ? `Ended: ${report.end.kind}/${report.end.reason} · eligible ${(report.collector.eligibleMs / 60_000).toFixed(1)} min · wall ${(report.wallMs / 60_000).toFixed(1)} min · restoration ${report.end.restored.visible}`
              : 'Ready. Start is explicit.';
    }
    if (progress.phase !== 'idle') progressTimer = setTimeout(update, 250);
  };
  tools.set(app, tool);
  doc.body.append(box);
  update();
  return tool;
}
