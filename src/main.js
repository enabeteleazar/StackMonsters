import { maintenanceProgress } from './maintenanceProgress.js';

// Compte à rebours dynamique basé sur une date cible précise
function startCountdown() {
  const daysEl = document.getElementById('days');
  const hoursEl = document.getElementById('hours');
  const minutesEl = document.getElementById('minutes');
  const secondsEl = document.getElementById('seconds');
  const progressBar = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');

  const startDateString = import.meta.env.VITE_MAINTENANCE_START_DATE;
  const targetDateString = import.meta.env.VITE_MAINTENANCE_TARGET_DATE;
  const startTime = Date.parse(startDateString ?? '');
  const targetTime = Date.parse(targetDateString ?? '');

  if (!Number.isFinite(targetTime)) {
    console.error('VITE_MAINTENANCE_TARGET_DATE must be a valid ISO 8601 date.');
    return;
  }

  if (!Number.isFinite(startTime) || startTime >= targetTime) {
    console.error('VITE_MAINTENANCE_START_DATE must be a valid date before the target date.');
  }

  function update() {
    const now = new Date().getTime();
    const distance = targetTime - now;
    const progress = maintenanceProgress(now, startTime, targetTime);
    const roundedProgress = Math.floor(progress);

    if (progressBar) {
      progressBar.style.width = `${progress}%`;
      progressBar.setAttribute('aria-valuenow', String(roundedProgress));
    }
    if (progressLabel) progressLabel.textContent = `${roundedProgress}%`;

    if (distance < 0) {
      if (daysEl) daysEl.textContent = '00';
      if (hoursEl) hoursEl.textContent = '00';
      if (minutesEl) minutesEl.textContent = '00';
      if (secondsEl) secondsEl.textContent = '00';
      return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    if (daysEl) daysEl.textContent = String(days).padStart(2, '0');
    if (hoursEl) hoursEl.textContent = String(hours).padStart(2, '0');
    if (minutesEl) minutesEl.textContent = String(minutes).padStart(2, '0');
    if (secondsEl) secondsEl.textContent = String(seconds).padStart(2, '0');
  }

  update();
  setInterval(update, 1000);
}

startCountdown();
