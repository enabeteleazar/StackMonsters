/* À charger sur le site StackMonsters : <script src="/stackmonsters-tracker.js" defer></script>
   Puis : window.smTrack('connection') après une connexion réussie,
          window.smTrack('can_added')  après l'ajout d'une canette.
   Pour ne pas compter vos propres visites : localStorage.setItem('sm_ignore','1') */
(function () {
  var URL_NTFY = 'https://ntfy.sh/sm-3fa91c07d2b84e55'; // même valeur que NTFY_TOPIC côté serveur
  try { if (localStorage.getItem('sm_ignore')) { window.smTrack = function () {}; return; } } catch (e) {}
  var vid = 'anon';
  try {
    vid = localStorage.getItem('sm_vid');
    if (!vid) { vid = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)); localStorage.setItem('sm_vid', vid); }
  } catch (e) {}
  var ua = navigator.userAgent;
  // Tablettes comptées en « mobile »
  var device = ((navigator.userAgentData && navigator.userAgentData.mobile) || /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) ? 'mobile' : 'desktop';
  function source() {
    var host = ''; try { host = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
    var utm = new URLSearchParams(location.search).get('utm_source') || '';
    var s = (utm + ' ' + host).toLowerCase();
    if (/instagram/.test(s) || /Instagram/.test(ua)) return 'instagram';
    if (/facebook|fb\.com|fb\.me|(^|\s)fb(\s|$)/.test(s) || /FBAN|FBAV|FB_IAB/.test(ua)) return 'facebook';
    if (/twitter|(^|[\s.])t\.co(\s|$)|(^|[\s.])x\.com|(^|\s)x(\s|$)/.test(s)) return 'twitter';
    return host && host !== location.hostname ? 'other' : 'direct';
  }
  window.smTrack = function (type) {
    try { fetch(URL_NTFY, { method: 'POST', keepalive: true, body: JSON.stringify({ type: type, vid: vid, device: device, source: source() }) }).catch(function () {}); } catch (e) {}
  };
  try { if (!sessionStorage.getItem('sm_s')) { sessionStorage.setItem('sm_s', '1'); window.smTrack('visit'); } } catch (e) { window.smTrack('visit'); }
})();
