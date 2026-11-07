import { describe, expect, it } from 'vitest';
import { maintenanceProgress } from './maintenanceProgress.js';

describe('maintenanceProgress', () => {
  it('starts at zero at maintenance activation', () => {
    expect(maintenanceProgress(100, 100, 200)).toBe(0);
  });

  it('reaches 100 percent at the target date', () => {
    expect(maintenanceProgress(200, 100, 200)).toBe(100);
  });

  it('calculates the elapsed fraction', () => {
    expect(maintenanceProgress(150, 100, 200)).toBe(50);
  });

  it('clamps progress before activation and after the target date', () => {
    expect(maintenanceProgress(50, 100, 200)).toBe(0);
    expect(maintenanceProgress(250, 100, 200)).toBe(100);
  });

  it('returns zero for invalid or non-positive date ranges', () => {
    expect(maintenanceProgress(Number.NaN, 100, 200)).toBe(0);
    expect(maintenanceProgress(100, 100, 100)).toBe(0);
    expect(maintenanceProgress(100, 200, 100)).toBe(0);
  });
});
