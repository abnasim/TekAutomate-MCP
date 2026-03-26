import { describe, expect, it } from 'vitest';
import { classifyIntent } from '../src/core/intentMap';

describe('behavioral.intentMap', () => {
  it('classifies horizontal scale queries as horizontal before bare scale fallback', () => {
    const result = classifyIntent('set horizontal scale 10000');

    expect(result.intent).toBe('horizontal');
    expect(result.subject).toBe('horizontal_scale');
    expect(result.groups).toEqual(['Horizontal']);
  });

  it('classifies channel scale queries as vertical measurement/channel setup', () => {
    const result = classifyIntent('set channel scale 0.5');

    expect(result.intent).toBe('vertical');
    expect(result.subject).toBe('channel_scale');
    expect(result.groups).toEqual(['Measurement']);
  });

  it('classifies trigger level queries as trigger instead of generic level fallback', () => {
    const result = classifyIntent('set trigger level 1.5V');

    expect(result.intent).toBe('trigger');
    expect(result.subject).toBe('trigger_level');
    expect(result.groups).toEqual(['Trigger']);
  });

  it('classifies display scale queries as display instead of generic screen fallback', () => {
    const result = classifyIntent('set display scale to 2');

    expect(result.intent).toBe('display');
    expect(result.subject).toBe('display_scale');
    expect(result.groups).toEqual(['Display']);
  });
});
