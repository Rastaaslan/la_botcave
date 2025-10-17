// slash/play.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

/* ========================= 
   Constantes & Détection 
========================= */
const LOG_PREFIX = '[PLAY]';
const SC_PREFIX = '[SC]';

// Regex patterns optimisées
const PATTERNS = {
  SC_PLAYLIST: /soundcloud\.com\/[^/]+\/sets\/[^/?]+/i,
  SC_TRACK: /soundcloud\.com\/[^/]+\/[^/?]+/i,
  YT_PLAYLIST: /(?:youtube\.com\/(?:watch\?.*?list=|playlist\?list=)|youtu\.be\/.*?\?list=)([a-zA-Z0-9_-]+)/i,
  YT_VIDEO: /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/i,
  YT_RADIO: /[?&]start_radio=1/i,
  YT_MIX: /[?&]list=RD/i,
  SP_PLAYLIST: /open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/i,
  SP_ALBUM: /open\.spotify\.com\/album\/([a-zA-Z0-9]+)/i,
  SP_TRACK: /open\.spotify\.com\/track\/([a-zA-Z0-9]+)/i,
  AM_TRACK: /music\.apple\.com\/[a-z]{2}\/(?:album\/[^/]+\/\d+\?i=(\d+)|song\/[^/]+\/(\d+))/i,
  AM_PLAYLIST: /music\.apple\.com\/[a-z]{2}\/playlist\/[^/]+\/(pl\.[a-zA-Z0-9-]+)/i,
  AM_ALBUM: /music\.apple\.com\/[a-z]{2}\/album\/[^/]+\/(\d+)(?:\?(?!i=)|$)/i
};

/* ========================= 
   Configuration Spotify API
========================= */
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';

let spotifyAccessToken = null;
let tokenExpiry = 0;

/* ========================= 
   Utilitaires de base
========================= */
function isUrl(s) {
  try { 
    new URL(s); 
    return true; 
  } catch { 
    return false; 
  }
}

function isYouTubeUri(uri) {
  return typeof uri === 'string' && /youtu\.be|youtube\.com/i.test(uri);
}

/* ========================= 
   Logging helpers 
========================= */
const logInfo = (id, tag, payload = '') => {
  console.log(`${LOG_PREFIX} [${id}] ${tag}`, typeof payload === 'object' ? JSON.stringify(payload) : payload);
};

const logWarn = (id, tag, payload = '') => {
  console.warn(`${LOG_PREFIX} [${id}] ⚠️  ${tag}`, typeof payload === 'object' ? JSON.stringify(payload) : payload);
};

const logError = (id, tag, payload = '') => {
  console.error(`${LOG_PREFIX} [${id}] ❌ ${tag}`, typeof payload === 'object' ? JSON.stringify(payload) : payload);
};

/* ========================= 
   Normalisation & scoring 
========================= */
function normalize(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTitleNoise(title) {
  if (!title) return '';
  let t = title;
  
  // Retirer le contenu entre parenthèses/crochets
  t = t.replace(/\(.*?\)/g, '');
  t = t.replace(/\[.*?\]/g, '');
  
  // Retirer les mots-clés communs
  const noise = /\b(?:official|audio|video|music|lyric|lyrics|visuali?zer?|mv|hd|hq|4k|remaster(?:ed)?|explicit|clean|radio|edit|extended|version|ft\.?|feat(?:uring)?\.?)\b/ig;
  t = t.replace(noise, '');
  
  // Retirer les jurons censurés
  t = t.replace(/\bf[*u]ck(?:ed|ing)?\b/ig, '');
  
  // Normaliser les séparateurs
  t = t.replace(/[_\-—–·]+/g, ' ');
  
  // Prendre uniquement la partie avant |
  t = t.split('|')[0];
  
  return t.trim();
}

function stripArtistNoise(artist) {
  if (!artist) return '';
  return artist.replace(/-\s*topic$/i, '').trim();
}

function tokenSet(s) {
  return new Set(normalize(s).split(/\s+/).filter(Boolean));
}

function coreTokens(s) {
  return [...tokenSet(s)].filter(w => w.length >= 2);
}

function jaccard(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  
  const inter = [...A].filter(x => B.has(x)).length;
  const union = A.size + B.size - inter;
  
  return union > 0 ? inter / union : 0;
}

/* ========================= 
   Recherches SoundCloud 
========================= */
async function scSearch(client, requester, q, limit, reqId) {
  try {
    logInfo(reqId, 'scSearch', { query: q, limit });
    
    const res = await client.manager.search({ 
      query: q, 
      source: 'soundcloud', 
      requester 
    });
    
    const tracks = (res?.tracks || [])
      .slice(0, limit)
      .filter(t => t && !isYouTubeUri(t.uri));
    
    logInfo(reqId, 'scSearch:results', { count: tracks.length });
    return tracks;
    
  } catch (err) {
    logError(reqId, 'scSearch:error', err.message);
    return [];
  }
}

/* ========================= 
   Spotify Access Token 
========================= */
async function getSpotifyAccessToken(reqId) {
  try {
    // Réutiliser le token s'il est encore valide
    if (spotifyAccessToken && Date.now() < tokenExpiry) {
      return spotifyAccessToken;
    }

    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      throw new Error('Spotify credentials not configured');
    }

    logInfo(reqId, 'spotify:token:refresh');
    
    const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    
    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials',
      timeout: 10000
    });
    
    if (!resp.ok) {
      throw new Error(`Spotify Auth failed: ${resp.status}`);
    }
    
    const data = await resp.json();
    spotifyAccessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // -1 minute de sécurité
    
    logInfo(reqId, 'spotify:token:success', { expiresIn: data.expires_in });
    return spotifyAccessToken;
    
  } catch (err) {
    logError(reqId, 'spotify:token:error', err.message);
    throw err;
  }
}

/* ========================= 
   Extraction métadonnées YouTube
========================= */
async function fetchYouTubeOEmbed(url, reqId) {
  try {
    logInfo(reqId, 'yt:oembed:start', { url });
    
    const oembedUrl = new URL('https://www.youtube.com/oembed');
    oembedUrl.searchParams.set('url', url);
    oembedUrl.searchParams.set('format', 'json');
    
    const resp = await fetch(oembedUrl.toString(), { 
      headers: { 'Accept': 'application/json' },
      timeout: 10000
    });
    
    if (!resp.ok) {
      logWarn(reqId, 'yt:oembed:http', { status: resp.status });
      return null;
    }
    
    const data = await resp.json();
    const result = { 
      title: stripTitleNoise(data?.title || ''), 
      author: stripArtistNoise(data?.author_name || '') 
    };
    
    logInfo(reqId, 'yt:oembed:success', result);
    return result;
    
  } catch (err) {
    logError(reqId, 'yt:oembed:error', err.message);
    return null;
  }
}

/* ========================= 
   Extraction métadonnées Spotify
========================= */
async function fetchSpotifyOG(url, reqId) {
  try {
    logInfo(reqId, 'sp:og:start', { url });
    
    const resp = await fetch(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 10000
    });
    
    if (!resp.ok) {
      logWarn(reqId, 'sp:og:http', { status: resp.status });
      return null;
    }
    
    const html = await resp.text();
    
    // Extraire les meta tags
    const getMeta = (prop) => {
      const match = html.match(new RegExp(`<meta\\s+property="${prop}"\\s+content="([^"]*)"`, 'i'));
      return match?.[1] || '';
    };
    
    const ogTitle = getMeta('og:title');
    const ogDescription = getMeta('og:description');
    
    let title = '';
    let artist = '';
    
    // === STRATÉGIE 1: og:description ===
    // Format: "Artist · Title · Song · Year"
    if (ogDescription) {
      const parts = ogDescription.split('·').map(p => p.trim());
      if (parts.length >= 2) {
        artist = parts[0];
        title = parts[1];
        logInfo(reqId, 'sp:og:fromDescription', { artist, title });
      }
    }
    
    // === STRATÉGIE 2: og:title (fallback) ===
    if (!title && ogTitle) {
      let cleanTitle = ogTitle.replace(/\s*[-|]\s*Spotify$/i, '').trim();
      
      // Format : "TITLE - song and lyrics by ARTIST"
      let match = cleanTitle.match(/^(.+?)\s*-\s*song(?:\s*and\s*lyrics)?\s*by\s*(.+)$/i);
      if (match) {
        title = match[1].trim();
        if (!artist) artist = match[2].trim();
      } else {
        // Format : "TITLE · song by ARTIST"
        match = cleanTitle.match(/^(.+?)\s*·\s*(?:song|single|album|ep)\s*by\s*(.+)$/i);
        if (match) {
          title = match[1].trim();
          if (!artist) artist = match[2].trim();
        } else if (!title) {
          title = cleanTitle;
        }
      }
    }
    
    // === STRATÉGIE 3: JSON-LD ===
    if (!title || !artist) {
      const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>(\{[^<]+\})<\/script>/);
      if (jsonLdMatch) {
        try {
          const jsonData = JSON.parse(jsonLdMatch[1]);
          if (jsonData.name && !title) title = jsonData.name;
          if (jsonData.byArtist?.name && !artist) artist = jsonData.byArtist.name;
          logInfo(reqId, 'sp:og:jsonLd', { title, artist });
        } catch (e) {
          logWarn(reqId, 'sp:og:jsonLdError', e.message);
        }
      }
    }
    
    // === STRATÉGIE 4: Extraction HTML brute ===
    if (!title || !artist) {
      if (!title) {
        const titleMatch = html.match(/"name"\s*:\s*"([^"]+)"/);
        if (titleMatch) title = titleMatch[1];
      }
      
      if (!artist) {
        const artistMatch = html.match(/"artists"\s*:\s*\[\s*\{\s*"name"\s*:\s*"([^"]+)"/);
        if (artistMatch) artist = artistMatch[1];
      }
      
      if (title || artist) {
        logInfo(reqId, 'sp:og:htmlExtract', { title, artist });
      }
    }
    
    if (!title) {
      logWarn(reqId, 'sp:og:noTitle');
      return null;
    }
    
    const result = {
      title: stripTitleNoise(title),
      author: stripArtistNoise(artist)
    };
    
    logInfo(reqId, 'sp:og:success', result);
    return result;
    
  } catch (err) {
    logError(reqId, 'sp:og:error', err.message);
    return null;
  }
}

/* ========================= 
   Extraction métadonnées Apple Music
========================= */
async function fetchAppleMusicOG(url, reqId) {
  try {
    logInfo(reqId, 'am:og:start', { url });
    
    const resp = await fetch(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0' }, 
      redirect: 'follow',
      timeout: 10000
    });
    
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    
    const html = await resp.text();
    
    const titleMatch = html.match(/"name":"([^"]+)"/);
    const artistMatch = html.match(/"artist(?:Name)?":"([^"]+)"/);
    
    if (!titleMatch) {
      logWarn(reqId, 'am:og:noTitle');
      return null;
    }
    
    const result = {
      title: stripTitleNoise(titleMatch[1] || ''),
      author: stripArtistNoise(artistMatch?.[1] || '')
    };
    
    logInfo(reqId, 'am:og:success', result);
    return result;
    
  } catch (err) {
    logError(reqId, 'am:og:error', err.message);
    return null;
  }
}

/* ========================= 
   Extraction playlist YouTube
========================= */
async function extractYouTubePlaylistTracks(url, reqId) {
  try {
    logInfo(reqId, 'yt:playlist:start', { url });
    
    const match = url.match(PATTERNS.YT_PLAYLIST);
    const playlistId = match?.[1];
    
    if (!playlistId) {
      logWarn(reqId, 'yt:playlist:noId');
      return [];
    }

    const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
    logInfo(reqId, 'yt:playlist:fetching', { playlistId, url: playlistUrl });

    const resp = await fetch(playlistUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 15000
    });
    
    if (!resp.ok) {
      logWarn(reqId, 'yt:playlist:http', { status: resp.status, statusText: resp.statusText });
      
      // Détection d'erreurs spécifiques
      if (resp.status === 404) {
        logWarn(reqId, 'yt:playlist:notFound');
        return { error: 'not_found' };
      }
      if (resp.status === 403) {
        logWarn(reqId, 'yt:playlist:forbidden');
        return { error: 'private' };
      }
      
      return [];
    }

    const html = await resp.text();
    
    // Vérifier si la playlist est vide ou privée
    if (html.includes('This playlist is private') || html.includes('Cette playlist est privée')) {
      logWarn(reqId, 'yt:playlist:private');
      return { error: 'private' };
    }
    
    if (html.includes('No videos') || html.includes('Aucune vidéo')) {
      logWarn(reqId, 'yt:playlist:empty');
      return { error: 'empty' };
    }
    
    // Extraction des données
    const dataMatch = html.match(/var ytInitialData = ({.+?});/);
    
    if (!dataMatch) {
      logWarn(reqId, 'yt:playlist:noData');
      
      // Tentative alternative : chercher dans un autre format
      const altMatch = html.match(/window\["ytInitialData"\]\s*=\s*({.+?});/);
      if (!altMatch) {
        logError(reqId, 'yt:playlist:parseError', 'No ytInitialData found');
        return { error: 'parse_failed' };
      }
      
      logInfo(reqId, 'yt:playlist:altFormat');
      const data = JSON.parse(altMatch[1]);
      return extractTracksFromYTData(data, reqId);
    }

    const data = JSON.parse(dataMatch[1]);
    return extractTracksFromYTData(data, reqId);
    
  } catch (err) {
    logError(reqId, 'yt:playlist:error', err.message);
    
    // Différencier les erreurs
    if (err.name === 'AbortError' || err.code === 'ETIMEDOUT') {
      return { error: 'timeout' };
    }
    if (err instanceof SyntaxError) {
      return { error: 'parse_failed' };
    }
    
    return [];
  }
}

// Fonction helper pour extraire les tracks
function extractTracksFromYTData(data, reqId) {
  try {
    // Tentative 1 : Structure standard
    let contents = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]
      ?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
      ?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents;

    // Tentative 2 : Structure alternative (sidebar)
    if (!contents) {
      contents = data?.sidebar?.playlistSidebarRenderer?.items?.[0]
        ?.playlistSidebarPrimaryInfoRenderer?.contents;
      
      if (contents) {
        logInfo(reqId, 'yt:playlist:altStructure', 'sidebar');
      }
    }
    
    // Tentative 3 : Structure avec continuationContents
    if (!contents) {
      contents = data?.continuationContents?.playlistVideoListContinuation?.contents;
      
      if (contents) {
        logInfo(reqId, 'yt:playlist:altStructure', 'continuation');
      }
    }

    if (!contents || !Array.isArray(contents)) {
      logWarn(reqId, 'yt:playlist:noContents', { hasData: !!data, hasContents: !!contents, isArray: Array.isArray(contents) });
      return { error: 'no_contents' };
    }

    const tracks = [];
    for (const item of contents) {
      const videoRenderer = item?.playlistVideoRenderer;
      if (!videoRenderer) continue;

      const videoId = videoRenderer.videoId;
      const title = videoRenderer.title?.runs?.[0]?.text || videoRenderer.title?.simpleText || '';
      const author = videoRenderer.shortBylineText?.runs?.[0]?.text || '';

      if (videoId && title) {
        tracks.push({
          videoId,
          title: stripTitleNoise(title),
          author: stripArtistNoise(author),
          url: `https://www.youtube.com/watch?v=${videoId}`
        });
      }
    }

    if (tracks.length === 0) {
      logWarn(reqId, 'yt:playlist:noVideos', { contentsLength: contents.length });
      return { error: 'no_videos' };
    }

    logInfo(reqId, 'yt:playlist:success', { count: tracks.length });
    return tracks;
    
  } catch (err) {
    logError(reqId, 'yt:playlist:extractError', err.message);
    return { error: 'extract_failed' };
  }
}

/* ========================= 
   Extraction playlist/album Spotify
========================= */
async function extractSpotifyPlaylistTracks(url, reqId) {
  try {
    logInfo(reqId, 'sp:playlist:start', { url });
    
    // Déterminer le type et l'ID
    let type, id;
    
    const playlistMatch = url.match(PATTERNS.SP_PLAYLIST);
    const albumMatch = url.match(PATTERNS.SP_ALBUM);
    
    if (playlistMatch) {
      type = 'playlist';
      id = playlistMatch[1];
    } else if (albumMatch) {
      type = 'album';
      id = albumMatch[1];
    } else {
      logWarn(reqId, 'sp:playlist:noId');
      return [];
    }
    
    logInfo(reqId, 'sp:playlist:type', { type, id });
    
    // Récupération du token
    const token = await getSpotifyAccessToken(reqId);
    
    // Construction de l'endpoint
    const endpoint = type === 'playlist' 
      ? `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100`
      : `https://api.spotify.com/v1/albums/${id}/tracks?limit=50`;
    
    const tracks = [];
    let nextUrl = endpoint;
    let page = 0;
    
    // Pagination
    while (nextUrl && page < 10) { // Limite de 10 pages pour éviter les boucles infinies
      page++;
      logInfo(reqId, 'sp:playlist:page', { page, url: nextUrl });
      
      const resp = await fetch(nextUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
      
      if (!resp.ok) {
        logWarn(reqId, 'sp:playlist:http', { status: resp.status, page });
        break;
      }
      
      const data = await resp.json();
      
      // Traitement des items
      for (const item of data.items || []) {
        const track = item.track || item;
        
        // Ignorer les tracks null (supprimées)
        if (!track || !track.name) continue;
        
        const title = track.name;
        const artists = track.artists?.map(a => a.name).join(', ') || '';
        
        tracks.push({
          title: stripTitleNoise(title),
          author: stripArtistNoise(artists),
          query: `${artists} ${title}`.trim()
        });
      }
      
      // Next page
      nextUrl = data.next;
    }
    
    logInfo(reqId, 'sp:playlist:success', { count: tracks.length, pages: page });
    return tracks;
    
  } catch (err) {
    logError(reqId, 'sp:playlist:error', err.message);
    return [];
  }
}

/* ========================= 
   Matching track sur SoundCloud
========================= */
async function matchTrackOnSoundCloud(client, requester, track, reqId) {
  try {
    const query = track.query || `${track.author} ${track.title}`.trim();
    logInfo(reqId, 'sc:match:start', { query });

    // Détection de mots-clés contextuels dans le titre
    const contextKeywords = /\b(naruto|pokemon|zelda|mario|final fantasy|studio ghibli|howl|spirited away|piano|orchestr|cover|version|remix|acoustic|live|remaster)\b/i;
    const hasContext = contextKeywords.test(track.title);
    
    // Détecter si le titre est "générique" (mots communs)
    const genericTitles = /\b(blue bird|forever young|imagine|yesterday|hello|sorry|stay|closer|perfect|beautiful)\b/i;
    const isGenericTitle = genericTitles.test(normalize(track.title));
    
    logInfo(reqId, 'sc:match:analysis', { 
      hasContext, 
      isGenericTitle,
      titleLength: track.title.length 
    });

    // Stratégies de recherche adaptatives
    const strategies = [];
    
    // Stratégie 1 : Recherche exacte (toujours)
    if (track.author && track.title) {
      strategies.push({ 
        name: 'exact', 
        query: `"${track.author}" "${track.title}"`, 
        limit: 5 
      });
    }
    
    // Stratégie 2 : Avec contexte si présent
    if (hasContext && track.author) {
      strategies.push({ 
        name: 'with-context', 
        query: `${track.author} ${track.title}`, 
        limit: 8 
      });
    }
    
    // Stratégie 3 : Standard (toujours)
    if (track.author && track.title) {
      strategies.push({ 
        name: 'standard', 
        query: `${track.author} ${track.title}`, 
        limit: 8 
      });
    }
    
    // Stratégie 4 : Titre seul (seulement si pas générique)
    if (!isGenericTitle || !track.author) {
      strategies.push({ 
        name: 'title-only', 
        query: track.title, 
        limit: 10 
      });
    }
    
    let allResults = [];
    
    for (const strategy of strategies) {
      if (!strategy.query.trim()) continue;
      
      logInfo(reqId, 'sc:match:strategy', { name: strategy.name, query: strategy.query });
      
      const results = await scSearch(client, requester, strategy.query, strategy.limit, reqId);
      
      if (results && results.length > 0) {
        allResults = allResults.concat(results);
        
        // Si on a déjà de bons résultats avec la première stratégie, pas besoin de continuer
        if (strategy.name === 'exact' && results.length >= 3) {
          break;
        }
      }
    }
    
    if (allResults.length === 0) {
      logWarn(reqId, 'sc:match:noResults', { query });
      return null;
    }
    
    // Dédupliquer par URI
    const uniqueResults = [];
    const seenUris = new Set();
    
    for (const result of allResults) {
      if (!seenUris.has(result.uri)) {
        seenUris.add(result.uri);
        uniqueResults.push(result);
      }
    }
    
    logInfo(reqId, 'sc:match:candidates', { total: uniqueResults.length });

    // Scoring amélioré avec contexte
    const wantTitleTokens = coreTokens(track.title);
    const wantAuthorTokens = coreTokens(track.author);
    const normalizedWantAuthor = normalize(track.author);
    
    let bestMatch = null;
    let bestScore = 0;

    for (const result of uniqueResults) {
      const resultTitle = result.title || '';
      const resultAuthor = result.author || '';
      
      const normalizedResultTitle = normalize(resultTitle);
      const normalizedResultAuthor = normalize(resultAuthor);
      const resultTitleTokens = tokenSet(resultTitle);
      const resultAuthorTokens = tokenSet(resultAuthor);
      
      // === FILTRES STRICTS ===
      
      // 1. Vérifier présence de l'artiste
      const authorInAuthor = normalizedResultAuthor.includes(normalizedWantAuthor) || 
                            normalizedWantAuthor.includes(normalizedResultAuthor);
      const authorInTitle = normalizedResultTitle.includes(normalizedWantAuthor);
      const hasArtist = authorInAuthor || authorInTitle;
      
      // 2. Vérifier overlap des tokens du titre
      const titleOverlap = wantTitleTokens.filter(t => resultTitleTokens.has(t)).length;
      const titleMatchRatio = wantTitleTokens.length > 0 ? titleOverlap / wantTitleTokens.length : 0;
      
      // 3. Vérifier présence des mots-clés contextuels
      let contextMatch = false;
      if (hasContext) {
        const contextWords = track.title.match(contextKeywords);
        if (contextWords) {
          contextMatch = contextWords.some(word => 
            normalizedResultTitle.includes(normalize(word))
          );
        }
      }
      
      // Filtrer les résultats peu pertinents
      // Plus strict si titre générique
      const minTitleRatio = isGenericTitle ? 0.7 : 0.5;
      
      if (!hasArtist && titleMatchRatio < minTitleRatio) {
        logInfo(reqId, 'sc:match:filtered', { 
          title: resultTitle,
          reason: 'low_relevance',
          artistMatch: hasArtist,
          titleRatio: titleMatchRatio.toFixed(2),
          threshold: minTitleRatio
        });
        continue;
      }
      
      // Si titre générique ET mauvais artiste, filtrer
      if (isGenericTitle && !hasArtist && titleMatchRatio < 0.9) {
        logInfo(reqId, 'sc:match:filtered', { 
          title: resultTitle,
          reason: 'generic_title_no_artist',
          titleRatio: titleMatchRatio.toFixed(2)
        });
        continue;
      }
      
      // === CALCUL DU SCORE ADAPTATIF ===
      
      let score = 0;
      
      // Pondération adaptative selon le contexte
      let titleWeight = isGenericTitle ? 0.35 : 0.5;
      let authorWeight = isGenericTitle ? 0.35 : 0.25;
      
      // 1. Score de titre
      const titleScore = jaccard(track.title, resultTitle);
      score += titleScore * titleWeight;
      
      // 2. Score d'artiste
      const authorScore = jaccard(track.author, resultAuthor);
      score += authorScore * authorWeight;
      
      // 3. Bonus pour correspondance exacte d'artiste (variable)
      if (authorInAuthor) {
        score += isGenericTitle ? 0.20 : 0.15;
      } else if (authorInTitle) {
        score += isGenericTitle ? 0.12 : 0.08;
      }
      
      // 4. Bonus pour overlap de tokens (10%)
      score += titleMatchRatio * 0.1;
      
      // 5. Bonus pour tous les tokens présents
      if (titleMatchRatio === 1.0 && wantTitleTokens.length > 0) {
        score += 0.05;
      }
      
      // 6. Bonus pour correspondance partielle d'artiste dans les tokens
      const authorTokenOverlap = wantAuthorTokens.filter(t => 
        resultAuthorTokens.has(t) || resultTitleTokens.has(t)
      ).length;
      if (wantAuthorTokens.length > 0) {
        score += (authorTokenOverlap / wantAuthorTokens.length) * 0.05;
      }
      
      // 7. NOUVEAU : Bonus contexte
      if (hasContext && contextMatch) {
        score += 0.10;
        logInfo(reqId, 'sc:match:contextBonus', { 
          title: resultTitle.substring(0, 50),
          bonus: 0.10 
        });
      }

      logInfo(reqId, 'sc:match:score', {
        title: resultTitle.substring(0, 50),
        author: resultAuthor.substring(0, 30),
        titleScore: titleScore.toFixed(2),
        authorScore: authorScore.toFixed(2),
        titleRatio: titleMatchRatio.toFixed(2),
        totalScore: score.toFixed(2),
        flags: `${isGenericTitle ? 'GENERIC' : ''}${hasContext ? ' CONTEXT' : ''}`
      });

      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }

    // Seuil de confiance adaptatif
    let confidenceThreshold = 0.38; // Légèrement abaissé
    
    // Plus strict pour les titres génériques
    if (isGenericTitle) {
      confidenceThreshold = 0.50;
    }
    
    // Moins strict si titre très spécifique (long avec contexte)
    if (hasContext && track.title.length > 30) {
      confidenceThreshold = 0.35;
    }
    
    logInfo(reqId, 'sc:match:threshold', { 
      value: confidenceThreshold,
      reason: isGenericTitle ? 'generic_title' : hasContext ? 'specific_title' : 'standard'
    });
    
    if (bestMatch && bestScore >= confidenceThreshold) {
      logInfo(reqId, 'sc:match:found', { 
        score: bestScore.toFixed(2), 
        title: bestMatch.title,
        author: bestMatch.author
      });
      return bestMatch;
    }

    logWarn(reqId, 'sc:match:lowScore', { 
      bestScore: bestScore ? bestScore.toFixed(2) : 'N/A',
      threshold: confidenceThreshold,
      bestTitle: bestMatch?.title || 'none'
    });
    
    return null;
    
  } catch (err) {
    logError(reqId, 'sc:match:error', err.message);
    return null;
  }
}

/* ========================= 
   Commande principale 
========================= */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Jouer une musique ou une playlist')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('URL ou recherche')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  async execute(interaction) {
    const reqId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const query = interaction.options.getString('query');
    const member = interaction.member;
    const voiceChannel = member?.voice?.channel;
    const gid = interaction.guildId;

    logInfo(reqId, 'execute:start', { query, guild: gid });

    // === VALIDATION SALON VOCAL ===
    if (!voiceChannel) {
      return interaction.reply({ 
        embeds: [buildEmbed(gid, {
          type: 'error',
          title: 'Erreur',
          description: 'Vous devez être dans un salon vocal!'
        })],
        ephemeral: true 
      });
    }

    await interaction.deferReply();

    try {
      const client = interaction.client;
      let player = client.manager.players.get(gid);

      // === CRÉATION/CONNEXION DU PLAYER ===
      if (!player) {
        logInfo(reqId, 'player:create');
        player = client.manager.players.create({
          guildId: gid,
          voiceChannelId: voiceChannel.id,
          textChannelId: interaction.channelId,
          volume: 50
        });
      }

      if (!player.connected) {
        logInfo(reqId, 'player:connect');
        player.connect({
          setDeaf: true,
          setMute: false
        });
      }

      // ==========================================
      // === PLAYLISTS ===
      // ==========================================

      // === PLAYLIST YOUTUBE ===
      if (PATTERNS.YT_PLAYLIST.test(query)) {
        logInfo(reqId, 'type:ytPlaylist');
        
        const tracks = await extractYouTubePlaylistTracks(query, reqId);
        
        if (tracks.length === 0) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: 'Playlist YouTube',
              description: 'Impossible de récupérer les pistes de la playlist.'
            })]
          });
        }

        await interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'info',
            title: 'Chargement en cours...',
            description: `Recherche de ${tracks.length} piste(s) sur SoundCloud...`
          })]
        });

        let added = 0;
        let failed = 0;

        for (const [index, track] of tracks.entries()) {
          logInfo(reqId, 'ytPlaylist:processing', { index: index + 1, total: tracks.length });
          
          const scTrack = await matchTrackOnSoundCloud(client, interaction.user, track, reqId);
          
          if (scTrack) {
            player.queue.add(scTrack);
            added++;
          } else {
            failed++;
            logWarn(reqId, 'ytPlaylist:trackFailed', { track: track.title });
          }
        }

        if (!player.playing && !player.paused && added > 0) {
          player.play();
        }

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: added > 0 ? 'success' : 'warning',
            title: 'Playlist YouTube',
            description: `✅ ${added} piste(s) ajoutée(s)` + 
              (failed > 0 ? `\n⚠️ ${failed} piste(s) non trouvée(s)` : '')
          })]
        });
      }

      // === PLAYLIST/ALBUM SPOTIFY ===
      if (PATTERNS.SP_PLAYLIST.test(query) || PATTERNS.SP_ALBUM.test(query)) {
        const isAlbum = PATTERNS.SP_ALBUM.test(query);
        logInfo(reqId, `type:sp${isAlbum ? 'Album' : 'Playlist'}`);
        
        const tracks = await extractSpotifyPlaylistTracks(query, reqId);
        
        if (tracks.length === 0) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: `${isAlbum ? 'Album' : 'Playlist'} Spotify`,
              description: 'Impossible de récupérer les pistes.'
            })]
          });
        }

        await interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'info',
            title: 'Chargement en cours...',
            description: `Recherche de ${tracks.length} piste(s) sur SoundCloud...`
          })]
        });

        let added = 0;
        let failed = 0;

        for (const [index, track] of tracks.entries()) {
          logInfo(reqId, 'spPlaylist:processing', { index: index + 1, total: tracks.length });
          
          const scTrack = await matchTrackOnSoundCloud(client, interaction.user, track, reqId);
          
          if (scTrack) {
            player.queue.add(scTrack);
            added++;
          } else {
            failed++;
            logWarn(reqId, 'spPlaylist:trackFailed', { track: track.title });
          }
        }

        if (!player.playing && !player.paused && added > 0) {
          player.play();
        }

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: added > 0 ? 'success' : 'warning',
            title: `${isAlbum ? 'Album' : 'Playlist'} Spotify`,
            description: `✅ ${added} piste(s) ajoutée(s)` +
              (failed > 0 ? `\n⚠️ ${failed} piste(s) non trouvée(s)` : '')
          })]
        });
      }

      // === PLAYLIST SOUNDCLOUD ===
      if (PATTERNS.SC_PLAYLIST.test(query)) {
        logInfo(reqId, 'type:scPlaylist');
        
        const res = await client.manager.search({
          query,
          source: 'soundcloud',
          requester: interaction.user
        });

        if (!res?.tracks || res.tracks.length === 0) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: 'Playlist SoundCloud',
              description: 'Aucune piste trouvée dans cette playlist.'
            })]
          });
        }

        for (const track of res.tracks) {
          player.queue.add(track);
        }

        if (!player.playing && !player.paused) {
          player.play();
        }

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'success',
            title: 'Playlist SoundCloud',
            description: `✅ ${res.tracks.length} piste(s) ajoutée(s)`
          })]
        });
      }

      // ==========================================
      // === TRACKS INDIVIDUELS ===
      // ==========================================

      // === TRACK YOUTUBE ===
      if (PATTERNS.YT_VIDEO.test(query) && !PATTERNS.YT_PLAYLIST.test(query)) {
        logInfo(reqId, 'type:ytTrack');
        
        const meta = await fetchYouTubeOEmbed(query, reqId);
        
        if (!meta || !meta.title) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: 'Vidéo YouTube',
              description: 'Impossible de récupérer les informations de la vidéo.'
            })]
          });
        }
        
        const scTrack = await matchTrackOnSoundCloud(client, interaction.user, meta, reqId);
        
        if (scTrack) {
          player.queue.add(scTrack);
          
          if (!player.playing && !player.paused) {
            player.play();
          }
          
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'success',
              title: 'Piste ajoutée',
              description: `**${scTrack.title}**\npar ${scTrack.author || 'Artiste inconnu'}`
            })]
          });
        }
        
        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: 'Piste YouTube',
            description: `Non trouvée sur SoundCloud:\n**${meta.title}**${meta.author ? `\npar ${meta.author}` : ''}`
          })]
        });
      }

      // === TRACK SPOTIFY ===
      if (PATTERNS.SP_TRACK.test(query)) {
        logInfo(reqId, 'type:spTrack');
        
        const meta = await fetchSpotifyOG(query, reqId);
        
        if (!meta || !meta.title) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: 'Piste Spotify',
              description: 'Impossible de récupérer les informations de la piste.'
            })]
          });
        }
        
        logInfo(reqId, 'spTrack:meta', { title: meta.title, author: meta.author });
        
        const scTrack = await matchTrackOnSoundCloud(client, interaction.user, meta, reqId);
        
        if (scTrack) {
          player.queue.add(scTrack);
          
          if (!player.playing && !player.paused) {
            player.play();
          }
          
          // Calculer le score de confiance pour l'affichage
          const titleScore = jaccard(meta.title, scTrack.title);
          const authorScore = meta.author ? jaccard(meta.author, scTrack.author || '') : 0;
          const confidence = Math.round((titleScore * 0.6 + authorScore * 0.4) * 100);
          
          const embedType = confidence >= 70 ? 'success' : 'warning';
          const confidenceText = confidence >= 70 ? '' : `\n⚠️ *Correspondance: ${confidence}%*`;
          
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: embedType,
              title: 'Piste Spotify ajoutée',
              description: `**${scTrack.title}**\npar ${scTrack.author || 'Artiste inconnu'}${confidenceText}`
            })]
          });
        }
        
        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: 'Piste Spotify',
            description: `Non trouvée sur SoundCloud:\n**${meta.title}**${meta.author ? `\npar ${meta.author}` : ''}\n\n💡 Essayez une recherche directe.`
          })]
        });
      }

      // === TRACK APPLE MUSIC ===
      if (PATTERNS.AM_TRACK.test(query)) {
        logInfo(reqId, 'type:amTrack');
        
        const meta = await fetchAppleMusicOG(query, reqId);
        
        if (!meta || !meta.title) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: 'Piste Apple Music',
              description: 'Impossible de récupérer les informations de la piste.'
            })]
          });
        }
        
        const scTrack = await matchTrackOnSoundCloud(client, interaction.user, meta, reqId);
        
        if (scTrack) {
          player.queue.add(scTrack);
          
          if (!player.playing && !player.paused) {
            player.play();
          }
          
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'success',
              title: 'Piste Apple Music ajoutée',
              description: `**${scTrack.title}**\npar ${scTrack.author || 'Artiste inconnu'}`
            })]
          });
        }
        
        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: 'Piste Apple Music',
            description: `Non trouvée sur SoundCloud:\n**${meta.title}**${meta.author ? `\npar ${meta.author}` : ''}`
          })]
        });
      }

      // === TRACK SOUNDCLOUD ===
      if (PATTERNS.SC_TRACK.test(query) && !PATTERNS.SC_PLAYLIST.test(query)) {
        logInfo(reqId, 'type:scTrack');
        
        const res = await client.manager.search({
          query,
          source: 'soundcloud',
          requester: interaction.user
        });

        if (!res?.tracks || res.tracks.length === 0) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: 'Piste SoundCloud',
              description: 'Piste introuvable.'
            })]
          });
        }

        player.queue.add(res.tracks[0]);

        if (!player.playing && !player.paused) {
          player.play();
        }

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'success',
            title: 'Piste SoundCloud ajoutée',
            description: `**${res.tracks[0].title}**\npar ${res.tracks[0].author || 'Artiste inconnu'}`
          })]
        });
      }

      // ==========================================
      // === RECHERCHE DIRECTE (FALLBACK) ===
      // ==========================================
      
      logInfo(reqId, 'type:directSearch');
      
      const res = await client.manager.search({
        query,
        source: 'soundcloud',
        requester: interaction.user
      });

      if (!res?.tracks || res.tracks.length === 0) {
        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: 'Aucun résultat',
            description: `Aucune piste trouvée pour: **${query}**`
          })]
        });
      }

      player.queue.add(res.tracks[0]);

      if (!player.playing && !player.paused) {
        player.play();
      }

      return interaction.editReply({
        embeds: [buildEmbed(gid, {
          type: 'success',
          title: 'Piste ajoutée',
          description: `**${res.tracks[0].title}**\npar ${res.tracks[0].author || 'Artiste inconnu'}`
        })]
      });

    } catch (err) {
      logError(reqId, 'execute:criticalError', err.message);
      console.error(`[${reqId}] Stack trace:`, err.stack);
      
      return interaction.editReply({
        embeds: [buildEmbed(gid, {
          type: 'error',
          title: 'Erreur critique',
          description: 'Une erreur inattendue s\'est produite. Veuillez réessayer.'
        })]
      }).catch(() => {
        // Si l'interaction a expiré, on ne peut rien faire
        logError(reqId, 'execute:replyFailed', 'Interaction expired');
      });
    }
  }
};