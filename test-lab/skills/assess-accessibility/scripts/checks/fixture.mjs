// Fulfilled by Playwright. None of these controls send a request.
export const fixture = `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Accessibility negative control</title>
<style>
  body { margin: 12px; }
  #first:focus { outline: none; }
  #zoom { overflow: hidden; width: 145px; height: 22px; white-space: nowrap; }
  #spacing { overflow: hidden; width: 104px; white-space: nowrap; }
  #wide { width: 420px; }
  @media (orientation: landscape) and (max-height: 450px) { h1 { display: none; } }
</style>
<main>
  <h1>Negative control</h1>
  <button id="first" tabindex="2" aria-label="Different name">First button</button>
  <p id="zoom">Text grows here</p>
  <p id="spacing">Spacing sample</p>
  <div id="wide">Fixed width</div>
  <input id="unlabeled">
  <button id="focus-move">Moves focus</button>
  <button id="trap">Traps Tab</button>
  <button id="broken" aria-expanded="false" aria-controls="always">Broken trigger</button>
  <div id="always">Visible despite collapsed state</div>
  <button id="menu" aria-haspopup="menu" aria-expanded="false" aria-controls="popup">Open menu</button>
  <div id="popup" role="menu" hidden><button role="menuitem">Menu item</button></div>
  <button id="hover" aria-controls="tooltip">Show tooltip</button>
  <div id="tooltip" role="tooltip" hidden>Persistent and cannot be dismissed</div>
  <label for="change">Change focus</label>
  <select id="change"><option>One</option><option>Two</option></select>
  <div id="shortcut">Unchanged</div>
</main>
<script>
  const get = id => document.getElementById(id);
  get('focus-move').addEventListener('focus', () => setTimeout(() => get('trap').focus(), 10));
  get('trap').addEventListener('keydown', event => {
    if (event.key === 'Tab') event.preventDefault();
  });
  get('menu').onclick = () => {
    get('popup').hidden = false;
    get('menu').setAttribute('aria-expanded', 'true');
    get('popup').firstElementChild.focus();
  };
  get('hover').onmouseenter = () => get('tooltip').hidden = false;
  get('change').onchange = () => get('first').focus();
  document.addEventListener('keydown', event => {
    if (event.key === 'a' && event.target === document.body) get('shortcut').textContent = 'Changed';
  });
</script></html>`;
