import { expectTypeOf, it } from 'vitest';
import type {
  AppMeasurementScene,
  AppMeasurementRepeatRequest,
  AppMeasurementRequest,
  AppMeasurementRefusalReason,
  AppMeasurementRefusal,
  AppMeasurementStopReason,
  AppMeasurementRepeat,
  AppMeasurementRestoration,
  AppMeasurementWorkload,
  AppMeasurementRuntime,
  AppMeasurementEnd,
  AppMeasurementEvent,
  AppMeasurementSession,
  AppMeasurementStart,
  AppHandle,
  MeasurementSceneResult,
} from './index';
import type { WakeLease, WakeLeaseResult } from '../platform';
import type { AudioSuspendLeaseResult } from '../audio';
import type {
  RendererPresentationRecipe,
  RendererPresentationToken,
  QualitySetting,
  QualityTierId,
} from '../render';

it('exports the exact measurement consumer types through public modules', () => {
  expectTypeOf<AppMeasurementScene>().toEqualTypeOf<
    Extract<MeasurementSceneResult, { kind: 'ready' }>['scene']
  >();
  expectTypeOf<AppMeasurementRequest['driverForRepeat']>()
    .parameter(0)
    .toEqualTypeOf<Readonly<AppMeasurementRepeatRequest>>();
  expectTypeOf<AppMeasurementRefusal['reason']>().toEqualTypeOf<AppMeasurementRefusalReason>();
  expectTypeOf<AppMeasurementStart>().extract<{ kind: 'refused' }>().toEqualTypeOf<AppMeasurementRefusal>();
  expectTypeOf<AppHandle['beginMeasurement']>().parameter(0).toEqualTypeOf<AppMeasurementRequest>();
  expectTypeOf<AppMeasurementSession['stop']>().parameter(0).toEqualTypeOf<AppMeasurementStopReason>();
  expectTypeOf<AppMeasurementRuntime['wake']>().toEqualTypeOf<WakeLease['state']>();
  expectTypeOf<AppMeasurementRuntime['quality']['setting']>().toEqualTypeOf<QualitySetting>();
  expectTypeOf<AppMeasurementRuntime['quality']['tier']>().toEqualTypeOf<QualityTierId>();
  expectTypeOf<AppMeasurementWorkload['graphics']['frameDivisor']>().toEqualTypeOf<1>();
  expectTypeOf<AppMeasurementEnd['restored']>().toEqualTypeOf<AppMeasurementRestoration>();
  expectTypeOf<AppMeasurementEvent>()
    .extract<{ kind: 'repeat-end' }>()
    .toEqualTypeOf<{ readonly kind: 'repeat-end'; readonly repeat: AppMeasurementRepeat }>();
  expectTypeOf<AppMeasurementRefusal['audioRefusal']>().toEqualTypeOf<Extract<
    AudioSuspendLeaseResult,
    { kind: 'refused' }
  > | null>();
  expectTypeOf<AppMeasurementRefusal['wakeRefusal']>().toEqualTypeOf<Readonly<
    Extract<WakeLeaseResult, { kind: 'refused' }>
  > | null>();
  expectTypeOf<RendererPresentationRecipe['quality']['tier']>().toEqualTypeOf<QualityTierId>();
  expectTypeOf<RendererPresentationToken>().toBeObject();
  expectTypeOf<AppMeasurementSession>().not.toHaveProperty('config');
  expectTypeOf<AppMeasurementSession>().not.toHaveProperty('stream');
  expectTypeOf<AppMeasurementRefusal>().not.toHaveProperty('config');
  expectTypeOf<AppMeasurementRefusal>().not.toHaveProperty('stream');
});
