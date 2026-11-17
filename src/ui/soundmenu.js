// Sound button and its menu: master on/off, music and effects volume.

import { sound } from '../audio/sound.js';
import { h } from './dom.js';

export function soundMenu() {
  const s = () => sound.settings;
  const btn = h('button.sound-btn', { type: 'button', 'aria-haspopup': 'true', title: 'Sound settings' });
  const master = h('input', { type: 'checkbox', onchange: (e) => sound.set({ enabled: e.target.checked }) });
  const musicOn = h('input', { type: 'checkbox', onchange: (e) => sound.set({ musicOn: e.target.checked }) });
  const sfxOn = h('input', { type: 'checkbox', onchange: (e) => sound.set({ sfxOn: e.target.checked }) });
  const slider = (key, label) => h('input', {
    type: 'range', min: 0, max: 100, step: 1, 'aria-label': label,
    oninput: (e) => sound.set({ [key]: Number(e.target.value) / 100 }),
    onchange: () => key === 'sfx' && sound.sfx('laser'),
  });
  const musicVol = slider('music', 'Music volume');
  const sfxVol = slider('sfx', 'Effects volume');
  const musicPct = h('span.pct');
  const sfxPct = h('span.pct');
  const panel = h('div.sound-panel', { role: 'dialog', 'aria-label': 'Sound' },
    h('label.sound-row.master', master, h('b', 'Sound')),
    h('div.sound-group',
      h('label.sound-row', musicOn, 'Music'),
      h('div.sound-slider', musicVol, musicPct)),
    h('div.sound-group',
      h('label.sound-row', sfxOn, 'Sound effects'),
      h('div.sound-slider', sfxVol, sfxPct)),
    h('p.muted.small', 'Music and effects are generated live in your browser.'));
  const wrap = h('div.sound-menu', btn, panel);

  function sync() {
    const st = s();
    master.checked = st.enabled;
    musicOn.checked = st.musicOn;
    sfxOn.checked = st.sfxOn;
    musicVol.value = Math.round(st.music * 100);
    sfxVol.value = Math.round(st.sfx * 100);
    musicPct.textContent = `${Math.round(st.music * 100)}%`;
    sfxPct.textContent = `${Math.round(st.sfx * 100)}%`;
    for (const el of [musicOn, sfxOn, musicVol, sfxVol]) el.disabled = !st.enabled;
    musicVol.disabled ||= !st.musicOn;
    sfxVol.disabled ||= !st.sfxOn;
    btn.textContent = st.enabled && (st.musicOn || st.sfxOn) ? '🔊 Sound' : '🔇 Sound';
    btn.classList.toggle('off', !st.enabled);
  }
  sound.onChange(sync);
  sync();

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.classList.toggle('open');
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => wrap.classList.remove('open'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') wrap.classList.remove('open'); });
  return wrap;
}
