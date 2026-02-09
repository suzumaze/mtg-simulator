// Drag & drop handling for card movement between zones

import { sendAction } from './game.js';

const dropZoneMap = {
  'my-battlefield': 'battlefield',
  'my-hand': 'hand',
  'my-graveyard-zone': 'graveyard',
  'my-exile-zone': 'exile',
  'my-library-zone': 'library',
  'my-sideboard-zone': 'sideboard',
};

export function initDragDrop() {
  for (const [elementId, zoneName] of Object.entries(dropZoneMap)) {
    const el = document.getElementById(elementId);
    if (!el) continue;

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('drag-over');
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');

      let data;
      try {
        data = JSON.parse(e.dataTransfer.getData('text/plain'));
      } catch {
        return;
      }

      const { cardId, fromZone } = data;
      if (!cardId || !fromZone) return;
      if (fromZone === zoneName) return; // No-op if same zone

      sendAction('move_card', { cardId, from: fromZone, to: zoneName });
    });
  }
}
