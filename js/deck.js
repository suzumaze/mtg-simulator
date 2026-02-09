// Deck list parsing and Scryfall API integration

export function parseDeckList(text) {
  const lines = text.trim().split('\n');
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    // Match: optional count, then card name
    // Formats: "4 Lightning Bolt", "4x Lightning Bolt", "Lightning Bolt"
    const match = trimmed.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (match) {
      entries.push({ count: parseInt(match[1], 10), name: match[2].trim() });
    } else {
      entries.push({ count: 1, name: trimmed });
    }
  }
  return entries;
}

export async function fetchCards(entries, onProgress) {
  const uniqueNames = [...new Set(entries.map(e => e.name))];
  const cardDataMap = {};

  // Fetch oldest printing per card via /cards/search
  for (let i = 0; i < uniqueNames.length; i++) {
    const name = uniqueNames[i];
    const query = `!"${name}"`;
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=released&dir=asc`;

    const resp = await fetch(url);

    if (resp.ok) {
      const data = await resp.json();
      if (data.data && data.data.length > 0) {
        const card = data.data[0]; // Oldest printing
        const imageUrl = card.image_uris
          ? card.image_uris.normal
          : (card.card_faces && card.card_faces[0].image_uris
            ? card.card_faces[0].image_uris.normal
            : null);

        cardDataMap[card.name.toLowerCase()] = {
          name: card.name,
          imageUrl,
          oracleText: card.oracle_text || '',
          typeLine: card.type_line || '',
        };
      }
    } else if (resp.status !== 404) {
      console.warn(`Scryfall search failed for "${name}": ${resp.status}`);
    }

    if (onProgress) {
      onProgress(Math.round(((i + 1) / uniqueNames.length) * 100));
    }

    // Rate limit: 100ms between requests (Scryfall guideline)
    if (i < uniqueNames.length - 1) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return { entries, cardDataMap };
}

export function buildDeck(entries, cardDataMap) {
  const cards = [];
  const notFound = [];

  for (const entry of entries) {
    const data = cardDataMap[entry.name.toLowerCase()];
    if (!data) {
      notFound.push(entry.name);
      continue;
    }
    for (let i = 0; i < entry.count; i++) {
      cards.push({ ...data });
    }
  }

  return { cards, notFound };
}
