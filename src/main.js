import { mountMapLab } from './ui/maplab.js';
import { mountSetup } from './ui/setup.js';
import { mountGame } from './ui/game.js';

// Routes: #lab&seed=…&players=…  (Map Lab), #play (current game), else setup.
const routeOf = () => (location.hash.startsWith('#lab') ? 'lab' : location.hash === '#play' ? 'play' : 'setup');
const current = routeOf();
const root = document.getElementById('app');

if (current === 'lab') mountMapLab(root);
else if (current === 'play') mountGame(root);
else mountSetup(root);

// Screens own window-level listeners, so switching screens reloads the page.
window.addEventListener('hashchange', () => {
  if (routeOf() !== current) location.reload();
});
