import { describe, expect, it } from 'vitest';

import { checkPlannerConflicts } from '../src/core/conflictChecker';
import type { PlannerIntent } from '../src/core/intentPlanner';

function baseIntent(overrides: Partial<PlannerIntent> = {}): PlannerIntent {
  return {
    deviceType: 'SCOPE',
    modelFamily: 'MSO6B',
    groups: [],
    channels: [],
    measurements: [],
    buses: [],
    unresolved: [],
    ...overrides,
  };
}

describe('checkPlannerConflicts', () => {
  it('flags channel conflict when CH1 is used by UART B1 and SPI B3', () => {
    const intent = baseIntent({
      buses: [
        { protocol: 'UART', bus: 'B1', source1: 'CH1' },
        { protocol: 'SPI', bus: 'B3', source1: 'CH4', source2: 'CH1', chipSelect: 'CH3' },
      ],
    });

    const conflicts = checkPlannerConflicts(intent);
    expect(conflicts.some((conflict) => conflict.type === 'CHANNEL_CONFLICT' && conflict.severity === 'ERROR')).toBe(true);
  });

  it('flags bus slot conflict when B1 is assigned to I2C and CAN', () => {
    const intent = baseIntent({
      buses: [
        { protocol: 'I2C', bus: 'B1', source1: 'CH1', source2: 'CH2' },
        { protocol: 'CAN', bus: 'B1', source1: 'CH3' },
      ],
    });

    const conflicts = checkPlannerConflicts(intent);
    expect(conflicts.some((conflict) => conflict.type === 'BUS_CONFLICT' && conflict.severity === 'ERROR')).toBe(true);
  });

  it('warns when EDGE trigger source channel is also claimed by a bus', () => {
    const intent = baseIntent({
      trigger: { type: 'EDGE', source: 'CH1' },
      buses: [{ protocol: 'UART', bus: 'B1', source1: 'CH1' }],
    });

    const conflicts = checkPlannerConflicts(intent);
    expect(conflicts.some((conflict) => conflict.type === 'TRIGGER_CONFLICT' && conflict.severity === 'WARNING')).toBe(true);
  });

  it('warns on timebase conflict for slow UART and fast frequency measurement', () => {
    const intent = baseIntent({
      measurements: [{ type: 'FREQUENCY', source1: 'CH1' }],
      buses: [{ protocol: 'UART', bus: 'B1', source1: 'CH1', baudRate: 115200 }],
    });

    const conflicts = checkPlannerConflicts(intent);
    expect(
      conflicts.some(
        (conflict) =>
          conflict.severity === 'WARNING' &&
          conflict.message.toLowerCase().includes('timebase conflict')
      )
    ).toBe(true);
  });

  it('returns no conflicts when resources do not overlap', () => {
    const intent = baseIntent({
      trigger: { type: 'BUS', source: 'B1' },
      measurements: [{ type: 'LOW', source1: 'CH4' }],
      buses: [{ protocol: 'I2C', bus: 'B1', source1: 'CH1', source2: 'CH2', bitrateBps: 400000 }],
    });

    const conflicts = checkPlannerConflicts(intent);
    expect(conflicts).toEqual([]);
  });
});
