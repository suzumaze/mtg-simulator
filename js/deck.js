// Deck list parsing and Scryfall API integration

export function parseDeckList(text) {
  const lines = text.trim().split('\n');
  const main = [];
  const sideboard = [];
  let inSideboard = false;

  for (const line of lines) {
    const trimmed = line.replace(/\u3000/g, ' ').replace(/[\u2018\u2019\u2032]/g, "'").trim();

    // Empty line after main deck starts sideboard (MTGO format)
    if (!trimmed) {
      if (main.length > 0) inSideboard = true;
      continue;
    }

    if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue;

    // Skip Arena metadata lines
    if (/^(About|Deck)$/i.test(trimmed)) continue;
    if (/^Name\s+/i.test(trimmed)) continue;

    // Detect sideboard section
    if (/^sideboard:?\s*$/i.test(trimmed)) {
      inSideboard = true;
      continue;
    }

    const match = trimmed.match(/^(\d+)\s*x?\s+(.+)$/i);
    const entry = match
      ? { count: parseInt(match[1], 10), name: match[2].trim() }
      : { count: 1, name: trimmed };

    (inSideboard ? sideboard : main).push(entry);
  }

  return { main, sideboard };
}

function extractCardInfo(card) {
  const imageUrl = card.image_uris
    ? card.image_uris.normal
    : (card.card_faces && card.card_faces[0].image_uris
      ? card.card_faces[0].image_uris.normal
      : null);
  return {
    name: card.name,
    imageUrl,
    oracleText: card.oracle_text || '',
    typeLine: card.type_line || '',
  };
}

export async function fetchCards(entries, onProgress, { firstPrint = false } = {}) {
  const uniqueNames = [...new Set(entries.map(e => e.name))];
  const cardDataMap = {};
  const dir = firstPrint ? 'asc' : 'desc';

  // Check cache first
  const uncachedNames = [];
  for (const name of uniqueNames) {
    const cacheKey = `mtg-card-${name.toLowerCase()}-${dir}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        cardDataMap[parsed.name.toLowerCase()] = parsed;
        continue;
      }
    } catch (e) { /* cache corrupt */ }
    uncachedNames.push(name);
  }

  const cachedCount = uniqueNames.length - uncachedNames.length;
  if (cachedCount > 0 && onProgress) {
    onProgress(Math.round((cachedCount / uniqueNames.length) * 100));
  }

  if (firstPrint) {
    // First-print mode: individual search per card (need oldest printing)
    await fetchCardsIndividually(uncachedNames, cardDataMap, dir, uniqueNames.length, cachedCount, onProgress);
  } else {
    // Default mode: bulk fetch via /cards/collection (up to 75 per request)
    await fetchCardsBulk(uncachedNames, cardDataMap, dir, uniqueNames.length, cachedCount, onProgress);
  }

  return { entries, cardDataMap };
}

async function fetchCardsBulk(names, cardDataMap, dir, totalCount, cachedCount, onProgress) {
  const BATCH_SIZE = 75;
  for (let batch = 0; batch < names.length; batch += BATCH_SIZE) {
    const batchNames = names.slice(batch, batch + BATCH_SIZE);
    const identifiers = batchNames.map(name => ({ name }));

    const resp = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers }),
    });

    if (resp.ok) {
      const data = await resp.json();
      for (const card of (data.data || [])) {
        const cardInfo = extractCardInfo(card);
        cardDataMap[card.name.toLowerCase()] = cardInfo;
        const cacheKey = `mtg-card-${card.name.toLowerCase()}-${dir}`;
        try { localStorage.setItem(cacheKey, JSON.stringify(cardInfo)); } catch (e) { /* storage full */ }
      }
    }

    if (onProgress) {
      const done = cachedCount + Math.min(batch + BATCH_SIZE, names.length);
      onProgress(Math.round((done / totalCount) * 100));
    }

    if (batch + BATCH_SIZE < names.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
}

async function fetchCardsIndividually(names, cardDataMap, dir, totalCount, cachedCount, onProgress) {
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const query = `!"${name}"`;
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=released&dir=${dir}`;

    const resp = await fetch(url);

    if (resp.ok) {
      const data = await resp.json();
      if (data.data && data.data.length > 0) {
        const cardInfo = extractCardInfo(data.data[0]);
        cardDataMap[data.data[0].name.toLowerCase()] = cardInfo;
        const cacheKey = `mtg-card-${name.toLowerCase()}-${dir}`;
        try { localStorage.setItem(cacheKey, JSON.stringify(cardInfo)); } catch (e) { /* storage full */ }
      }
    } else if (resp.status !== 404) {
      console.warn(`Scryfall search failed for "${name}": ${resp.status}`);
    }

    if (onProgress) {
      onProgress(Math.round(((cachedCount + i + 1) / totalCount) * 100));
    }

    // Rate limit: 100ms between requests
    if (i < names.length - 1) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
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
