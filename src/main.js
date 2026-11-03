// Compte à rebours dynamique basé sur une date cible précise
function startCountdown() {
  const daysEl = document.getElementById('days');
  const hoursEl = document.getElementById('hours');
  const minutesEl = document.getElementById('minutes');
  const secondsEl = document.getElementById('seconds');

  // Date cible de fin de maintenance (Modifiable au format AAAA-MM-JJTHH:MM:SS)
  const targetDateString = "2026-11-04T17:00:00";
  const targetTime = new Date(targetDateString).getTime();

  function update() {
    const now = new Date().getTime();
    const distance = targetTime - now;

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

// Gestion de la soumission du formulaire vers l'API Vercel / Neon
const form = document.getElementById('notify-form');
const successMessage = document.getElementById('success-message');

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const emailInput = document.getElementById('email');
  const email = emailInput.value;

  try {
    const response = await fetch('/api/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    if (response.ok) {
      form.style.display = 'none';
      successMessage.classList.remove('hidden');
    } else {
      alert("An error occurred. Please try again.");
    }
  } catch (error) {
    console.error('Network error:', error);
    alert("Unable to contact the server.");
  }
});

startCountdown();
