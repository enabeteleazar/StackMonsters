export function maintenanceProgress(now, start, target) {
  if (![now, start, target].every(Number.isFinite) || start >= target) {
    return 0;
  }

  return Math.min(100, Math.max(0, ((now - start) / (target - start)) * 100));
}
