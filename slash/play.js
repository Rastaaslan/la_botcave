// slash/play.js - VERSION PORU COMPLÈTE (SYNTAXE CORRIGÉE)

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');
const { PlayerManager } = require('../utils/playerManager');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const LOG_PREFIX = '[PLAY]';
const DEBUG_PLAY = process.env.DEBUG_PLAY === '1';
const SC_MATCH_THRESHOLD = parseFloat(process.env.SC_MATCH_THRESHOLD || '0.38');

// Regex patterns
const PATTERNS = {
  SC_PLAYLIST: /soundcloud\.com\/[^/]+\/sets\/[^/?]+/i,
  SC_TRACK: /soundcloud\.com\/[^/]+\/[^/?]+/i,
  YT_PLAYLIST: /(?:youtube\.com\/(?:watch\?.*?list=|playlist\?list=)|youtu\.be\/.*?\?list=)([a-zA-Z0-9_-]+)/i,
  YT_VIDEO: /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/i,
  YT_RADIO: /[?&]start_radio=1/i,
  YT_MIX: /[?&]list=RD/i,
  SP_PLAYLIST: /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/([a-zA-Z0-9]+)/i,
  SP_ALBUM: /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?album\/([a-zA-Z0-9]+)/i,
  SP_TRACK: /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([a-zA-Z0-9]+)/i,
  AM_TRACK: /music\.apple\.com\/[a-z]{2}\/album\/[^/]+\/\d+\?i=\d+/i
};

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
let spotifyAccessToken = null;
let tokenExpiry = 0;

// Logging helpers
const logInfo = (id, tag, payload = '') => {
  console.log(`${LOG_PREFIX} [${id}] ${tag}`, typeof payload === 'object' ? JSON.stringify(payload) : payload);
};

const logWarn = (id, tag, payload = '') => {
  console.warn(`${LOG_PREFIX} [${id}] ⚠️ ${tag}`, typeof payload === 'object' ? JSON.stringify(payload) : payload);
};

const logError = (id, tag, payload = '') => {
  console.error(`${LOG_PREFIX} [${id}] ❌ ${tag}`, typeof payload === 'object' ? JSON.stringify(payload) : payload);
};

// Normalisation
function normalize(s) {
  if (!s) return '';
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripTitleNoise(title) {
  if (!title) return '';
  let t = title;
  t = t.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '');
  t = t.replace(/\b(?:official|audio|video|music|lyric|lyrics|visuali?zer?|mv|hd|hq|4k|remaster(?:ed)?|explicit|clean|radio|edit|extended|version|ft\.?|feat(?:uring)?\.?)\b/ig, '');
  t = t.replace(/\bf[*u]ck(?:ed|ing)?\b/ig, '');
  t = t.replace(/[_\-—–·]+/g, ' ');
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

function isYouTubeUri(uri) {
  return typeof uri === 'string' && /youtu\.be|youtube\.com/i.test(uri);
}

// SoundCloud search avec Poru - ✅ SYNTAXE CORRIGÉE
async function scSearch(client, requester, q, limit, reqId) {
  try {
    logInfo(reqId, 'scSearch', { query: q, limit });
    
    if (DEBUG_PLAY) {
      console.log('[DEBUG] Query brute:', q);
      console.log('[DEBUG] Nodes disponibles:', client.poru.nodes.size);
    }

    // ✅ PORU: NE PAS ajouter scsearch: dans la query, utiliser source directement
    const res = await client.poru.resolve({
      query: q, // Query sans préfixe
      source: 'scsearch', // Source = scsearch pour recherche SoundCloud
      requester: requester
    });
    
    if (DEBUG_PLAY) {
      console.log('[DEBUG] Réponse Poru:', JSON.stringify({
        loadType: res?.loadType,
        tracksCount: res?.tracks?.length,
        firstTrack: res?.tracks?.[0]?.info?.title
      }, null, 2));
    }

    logInfo(reqId, 'scSearch:raw', {
      hasResult: !!res,
      loadType: res?.loadType,
      tracksCount: res?.tracks?.length,
      firstTitle: res?.tracks?.[0]?.info?.title
    });

    if (!res || !res.tracks || res.tracks.length === 0) {
      logWarn(reqId, 'scSearch:emptyResult', { loadType: res?.loadType, query: q });
      return [];
    }

    // Filtrer les résultats YouTube et limiter
    const tracks = res.tracks
      .filter(t => t && t.info && !isYouTubeUri(t.info.uri))
      .slice(0, limit);

    logInfo(reqId, 'scSearch:results', { count: tracks.length, rawCount: res.tracks.length });
    return tracks;
  } catch (err) {
    logError(reqId, 'scSearch:error', err.message);
    if (DEBUG_PLAY) {
      logError(reqId, 'scSearch:stack', err.stack);
    }
    return [];
  }
}

// Spotify token
async function getSpotifyAccessToken(reqId) {
  try {
    if (spotifyAccessToken && Date.now() < tokenExpiry) return spotifyAccessToken;
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) throw new Error('Spotify credentials not configured');

    logInfo(reqId, 'spotify:token:refresh');
    const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      timeout: 10000
    });

    if (!resp.ok) throw new Error(`Spotify Auth failed: ${resp.status}`);
    const data = await resp.json();
    spotifyAccessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
    logInfo(reqId, 'spotify:token:success');
    return spotifyAccessToken;
  } catch (err) {
    logError(reqId, 'spotify:token:error', err.message);
    throw err;
  }
}

// YouTube playlist extraction
async function extractYouTubePlaylistTracks(url, reqId) {
  try {
    logInfo(reqId, 'yt:playlist:start', { url });
    const match = url.match(PATTERNS.YT_PLAYLIST);
    const playlistId = match?.[1];
    if (!playlistId) {
      logWarn(reqId, 'yt:playlist:noId');
      return { error: 'no_id' };
    }

    const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
    logInfo(reqId, 'yt:playlist:fetching', { playlistId, url: playlistUrl });

    const resp = await fetch(playlistUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 15000
    });

    if (!resp.ok) {
      logWarn(reqId, 'yt:playlist:http', { status: resp.status });
      if (resp.status === 404) return { error: 'not_found' };
      if (resp.status === 403) return { error: 'private' };
      return { error: 'http_error' };
    }

    const html = await resp.text();
    if (html.includes('This playlist is private') || html.includes('Cette playlist est privée')) {
      logWarn(reqId, 'yt:playlist:private');
      return { error: 'private' };
    }

    let dataMatch = html.match(/var ytInitialData = ({.+?});/);
    if (!dataMatch) {
      dataMatch = html.match(/ytInitialData"\s*:\s*({.+?})/);
    }
    
    if (!dataMatch) {
      logWarn(reqId, 'yt:playlist:noData');
      return { error: 'parse_failed' };
    }

    const data = JSON.parse(dataMatch[1]);
    if (data?.alerts) {
      const alertText = data.alerts.map(a => a?.alertRenderer?.text?.simpleText || a?.alertRenderer?.text?.runs?.[0]?.text).filter(Boolean).join(' ');
      logWarn(reqId, 'yt:playlist:alert', { alertText });
      if (/private/i.test(alertText)) return { error: 'private' };
      if (/not found|deleted/i.test(alertText)) return { error: 'not_found' };
      return { error: 'no_contents', message: alertText };
    }

    const contents = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents;
    if (!contents || !Array.isArray(contents)) {
      logWarn(reqId, 'yt:playlist:noContents');
      return { error: 'no_contents' };
    }

    const tracks = [];
    for (const item of contents) {
      const vr = item?.playlistVideoRenderer;
      if (!vr || !vr.videoId) continue;
      const title = vr.title?.runs?.[0]?.text || vr.title?.simpleText || '';
      const author = vr.shortBylineText?.runs?.[0]?.text || '';
      if (title) {
        tracks.push({
          videoId: vr.videoId,
          title: stripTitleNoise(title),
          author: stripArtistNoise(author),
          url: `https://www.youtube.com/watch?v=${vr.videoId}`
        });
      }
    }

    if (tracks.length === 0) {
      logWarn(reqId, 'yt:playlist:noVideos');
      return { error: 'no_videos' };
    }

    logInfo(reqId, 'yt:playlist:success', { count: tracks.length });
    return tracks;
  } catch (err) {
    logError(reqId, 'yt:playlist:error', err.message);
    return { error: 'extract_failed' };
  }
}

// Spotify playlist extraction
async function extractSpotifyPlaylistTracks(url, reqId) {
  try {
    logInfo(reqId, 'sp:playlist:start', { url });
    const playlistMatch = url.match(PATTERNS.SP_PLAYLIST);
    const albumMatch = url.match(PATTERNS.SP_ALBUM);
    let type, id;

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
    const token = await getSpotifyAccessToken(reqId);
    const endpoint = type === 'playlist'
      ? `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100`
      : `https://api.spotify.com/v1/albums/${id}/tracks?limit=50`;

    const tracks = [];
    let nextUrl = endpoint;
    let page = 0;

    while (nextUrl && page < 10) {
      page++;
      logInfo(reqId, 'sp:playlist:page', { page, totalSoFar: tracks.length });

      const resp = await fetch(nextUrl, {
        headers: { 
          'Authorization': `Bearer ${token}`, 
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 10000
      });

      if (resp.status === 429) {
        const retryAfter = parseInt(resp.headers.get('retry-after') || '1', 10);
        logWarn(reqId, 'sp:playlist:rateLimit', { retryAfter, page });
        await new Promise(resolve => setTimeout(resolve, (retryAfter + 1) * 1000));
        continue;
      }

      if (!resp.ok) {
        logWarn(reqId, 'sp:playlist:http', { status: resp.status, page });
        break;
      }

      const data = await resp.json();
      for (const item of data.items || []) {
        const track = item.track || item;
        
        if (!track || !track.name || track.is_local === true || track.type !== 'track') {
          if (DEBUG_PLAY && track) {
            console.log('[DEBUG] Piste ignorée:', { name: track.name, is_local: track.is_local, type: track.type });
          }
          continue;
        }

        const title = stripTitleNoise(track.name);
        const artists = track.artists?.map(a => a.name).filter(Boolean) || [];
        const firstArtist = stripArtistNoise(artists[0] || '');
        
        const query = firstArtist && title ? `${firstArtist} ${title}`.trim() : title;

        tracks.push({
          title,
          author: firstArtist,
          allArtists: artists.join(', '),
          query
        });
      }

      nextUrl = data.next;
    }

    logInfo(reqId, 'sp:playlist:success', { count: tracks.length, pages: page });
    return tracks;
  } catch (err) {
    logError(reqId, 'sp:playlist:error', err.message);
    return [];
  }
}

// Matching sur SoundCloud
async function matchTrackOnSoundCloud(client, requester, track, reqId) {
  try {
    const query = track.query || `${track.author} ${title}`.trim();
    logInfo(reqId, 'sc:match:start', { query });

    const strategies = [
      { name: 'exact', query: `"${track.author}" "${track.title}"`, limit: 5 },
      { name: 'standard', query: `${track.author} ${track.title}`, limit: 8 },
      { name: 'title-only', query: track.title, limit: 10 }
    ];

    let allResults = [];
    for (const strategy of strategies) {
      if (!strategy.query.trim()) continue;
      logInfo(reqId, 'sc:match:strategy', { name: strategy.name, query: strategy.query });
      
      const results = await scSearch(client, requester, strategy.query, strategy.limit, reqId);
      if (results && results.length > 0) {
        allResults = allResults.concat(results);
        if (strategy.name === 'exact' && results.length >= 3) break;
      }
    }

    if (allResults.length === 0) {
      logWarn(reqId, 'sc:match:noResults');
      return null;
    }

    const uniqueResults = [];
    const seenUris = new Set();
    for (const result of allResults) {
      const uri = result.info?.uri || result.uri;
      if (uri && !seenUris.has(uri)) {
        seenUris.add(uri);
        uniqueResults.push(result);
        if (uniqueResults.length >= 25) break;
      }
    }

    logInfo(reqId, 'sc:match:candidates', { total: uniqueResults.length, raw: allResults.length });

    const wantTitleTokens = coreTokens(track.title);
    const normalizedWantAuthor = normalize(track.author);
    let bestMatch = null;
    let bestScore = 0;

    for (const result of uniqueResults) {
      const resultTitle = result.info.title || '';
      const resultAuthor = result.info.author || '';
      const normalizedResultAuthor = normalize(resultAuthor);
      const resultTitleTokens = tokenSet(resultTitle);

      const authorInAuthor = normalizedResultAuthor.includes(normalizedWantAuthor) || normalizedWantAuthor.includes(normalizedResultAuthor);
      const titleOverlap = wantTitleTokens.filter(t => resultTitleTokens.has(t)).length;
      const titleMatchRatio = wantTitleTokens.length > 0 ? titleOverlap / wantTitleTokens.length : 0;

      if (!authorInAuthor && titleMatchRatio < 0.5) continue;

      const titleScore = jaccard(track.title, resultTitle);
      const authorScore = jaccard(track.author, resultAuthor);
      let score = titleScore * 0.5 + authorScore * 0.25 + titleMatchRatio * 0.1;
      if (authorInAuthor) score += 0.15;
      if (titleMatchRatio === 1.0 && wantTitleTokens.length > 0) score += 0.05;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }

    if (bestMatch && bestScore >= SC_MATCH_THRESHOLD) {
      logInfo(reqId, 'sc:match:found', { 
        score: bestScore.toFixed(2), 
        title: bestMatch.info.title,
        author: bestMatch.info.author,
        threshold: SC_MATCH_THRESHOLD
      });
      return bestMatch;
    }

    logWarn(reqId, 'sc:match:lowScore', { 
      bestScore: bestScore ? bestScore.toFixed(2) : 'N/A', 
      threshold: SC_MATCH_THRESHOLD,
      bestTitle: bestMatch?.info?.title
    });
    return null;
  } catch (err) {
    logError(reqId, 'sc:match:error', err.message);
    return null;
  }
}

// YouTube OEmbed
async function fetchYouTubeOEmbed(url, reqId) {
  try {
    logInfo(reqId, 'yt:oembed:start');
    const oembedUrl = new URL('https://www.youtube.com/oembed');
    oembedUrl.searchParams.set('url', url);
    oembedUrl.searchParams.set('format', 'json');

    const resp = await fetch(oembedUrl.toString(), { headers: { 'Accept': 'application/json' }, timeout: 10000 });
    if (!resp.ok) return null;

    const data = await resp.json();
    const result = { title: stripTitleNoise(data?.title || ''), author: stripArtistNoise(data?.author_name || '') };
    logInfo(reqId, 'yt:oembed:success', result);
    return result;
  } catch (err) {
    logError(reqId, 'yt:oembed:error', err.message);
    return null;
  }
}

// Spotify OG
async function fetchSpotifyOG(url, reqId) {
  try {
    logInfo(reqId, 'sp:og:start', { url });
    const resp = await fetch(url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 
        'Accept': 'text/html,application/xhtml+xml' 
      },
      timeout: 10000
    });

    if (!resp.ok) {
      logWarn(reqId, 'sp:og:http', { status: resp.status });
      return null;
    }

    const html = await resp.text();
    const getMeta = (prop) => {
      const match = html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`, 'i'));
      return match ? match[1] : '';
    };

    let title = getMeta('og:title') || getMeta('twitter:title');
    let artist = getMeta('music:musician_description') || getMeta('og:description') || '';

    if (title.includes('·')) {
      const parts = title.split('·').map(p => p.trim());
      if (parts.length >= 2) {
        artist = parts[0];
        title = parts[1];
      }
    }

    if (!title) {
      logWarn(reqId, 'sp:og:noTitle');
      return null;
    }

    const result = { title: stripTitleNoise(title), author: stripArtistNoise(artist) };
    logInfo(reqId, 'sp:og:success', result);
    return result;
  } catch (err) {
    logError(reqId, 'sp:og:error', err.message);
    return null;
  }
}

// Apple Music OG
async function fetchAppleMusicOG(url, reqId) {
  try {
    logInfo(reqId, 'am:og:start', { url });
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'follow',
      timeout: 10000
    });

    if (!resp.ok) {
      logWarn(reqId, 'am:og:http', { status: resp.status });
      return null;
    }

    const html = await resp.text();
    const titleMatch = html.match(/"name":"([^"]+)"/);
    const artistMatch = html.match(/"artist(?:Name)?":"([^"]+)"/);

    if (!titleMatch) {
      logWarn(reqId, 'am:og:noTitle');
      return null;
    }

    const result = { title: stripTitleNoise(titleMatch[1] || ''), author: stripArtistNoise(artistMatch?.[1] || '') };
    logInfo(reqId, 'am:og:success', result);
    return result;
  } catch (err) {
    logError(reqId, 'am:og:error', err.message);
    return null;
  }
}

// COMMANDE PRINCIPALE
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
    const voiceChannel = interaction.member?.voice?.channel;
    const gid = interaction.guildId;

    logInfo(reqId, 'execute:start', { query, guild: gid });

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

      const { player, isNew } = PlayerManager.getOrCreatePlayer(client, {
        guildId: gid,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        userId: interaction.user.id,
        voiceChannelName: voiceChannel.name
      });

      logInfo(reqId, 'player:status', {
        playerId: player.guildId,
        isNew,
        voiceChannel: voiceChannel.name
      });

      if (!player.isConnected) {
        logInfo(reqId, 'player:connect');
        try {
          player.connect();
          await new Promise(resolve => setTimeout(resolve, 500));
          logInfo(reqId, 'player:connected');
        } catch (err) {
          logError(reqId, 'player:connect:error', err.message);
        }
      }

      PlayerManager.updateActivity(player);

      // ===== PLAYLIST YOUTUBE =====
      if (PATTERNS.YT_PLAYLIST.test(query)) {
        if (PATTERNS.YT_RADIO.test(query) || PATTERNS.YT_MIX.test(query)) {
          logWarn(reqId, 'type:ytRadio');
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'warning',
              title: 'YouTube Radio/Mix',
              description: `❌ Les playlists générées dynamiquement ne sont pas supportées.\n\n💿 Instance: **${player.metadata?.sessionName || 'Session'}** dans **${voiceChannel.name}**`
            })]
          });
        }

        logInfo(reqId, 'type:ytPlaylist');
        const result = await extractYouTubePlaylistTracks(query, reqId);

        if (!Array.isArray(result)) {
          if (result && result.error) {
            const errorMessages = {
              not_found: '❌ Playlist introuvable.',
              private: '🔒 Cette playlist est privée.',
              no_contents: '❌ Impossible de récupérer le contenu.',
              no_videos: '📭 Aucune vidéo trouvée.',
              parse_failed: '⚠️ Structure YouTube non reconnue.',
              extract_failed: '❌ Erreur lors de l\'extraction.'
            };

            return interaction.editReply({
              embeds: [buildEmbed(gid, {
                type: 'error',
                title: '🔍 YouTube → SoundCloud',
                description: `${errorMessages[result.error] || '❌ Erreur inconnue.'}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
              })]
            });
          }

          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: '🔍 YouTube → SoundCloud',
              description: `❌ Erreur inattendue.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }

        if (result.length === 0) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: '🔍 YouTube → SoundCloud',
              description: `❌ Aucune piste récupérée.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }

        await interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'info',
            title: '🔍 Conversion YouTube → SoundCloud',
            description: `Recherche de ${result.length} piste(s) sur SoundCloud...\n\n⏳ Cela peut prendre quelques secondes.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });

        let added = 0;
        let failed = 0;

        for (const track of result) {
          const scTrack = await matchTrackOnSoundCloud(client, interaction.user, track, reqId);
          if (scTrack) {
            player.queue.add(scTrack);
            added++;
          } else {
            failed++;
          }
        }

        PlayerManager.updateActivity(player);
        if (!player.isPlaying && !player.isPaused && added > 0) {
          await player.play();
        }

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: added > 0 ? 'success' : 'warning',
            title: '✅ Playlist YouTube → SoundCloud',
            description: `**${added}** piste(s) trouvée(s)` +
              (failed > 0 ? `\n⚠️ **${failed}** piste(s) non trouvée(s)` : '') +
              `\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });
      }

      // ===== PLAYLIST SPOTIFY =====
      if (PATTERNS.SP_PLAYLIST.test(query) || PATTERNS.SP_ALBUM.test(query)) {
        const isAlbum = PATTERNS.SP_ALBUM.test(query);
        logInfo(reqId, `type:sp${isAlbum ? 'Album' : 'Playlist'}`);

        const tracks = await extractSpotifyPlaylistTracks(query, reqId);
        if (tracks.length === 0) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: '🔍 Spotify → SoundCloud',
              description: `❌ Impossible de récupérer les pistes.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }

        await interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'info',
            title: '🔍 Conversion Spotify → SoundCloud',
            description: `Recherche de ${tracks.length} piste(s) sur SoundCloud...\n\n⏳ Cela peut prendre quelques secondes.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });

        let added = 0;
        let failed = 0;

        for (const track of tracks) {
          const scTrack = await matchTrackOnSoundCloud(client, interaction.user, track, reqId);
          if (scTrack) {
            player.queue.add(scTrack);
            added++;
          } else {
            failed++;
          }
        }

        PlayerManager.updateActivity(player);
        if (!player.isPlaying && !player.isPaused && added > 0) {
          await player.play();
        }

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: added > 0 ? 'success' : 'warning',
            title: `✅ ${isAlbum ? 'Album' : 'Playlist'} Spotify → SoundCloud`,
            description: `**${added}** piste(s) trouvée(s)` +
              (failed > 0 ? `\n⚠️ **${failed}** piste(s) non trouvée(s)` : '') +
              `\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });
      }

      // ===== PLAYLIST SOUNDCLOUD =====
      if (PATTERNS.SC_PLAYLIST.test(query)) {
        logInfo(reqId, 'type:scPlaylist');
        const res = await client.poru.resolve({
          query: query,
          source: 'soundcloud',
          requester: interaction.user
        });

        if (!res?.tracks || res.tracks.length === 0) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: '🔊 Playlist SoundCloud',
              description: `Aucune piste trouvée dans cette playlist.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }

        for (const track of res.tracks) {
          player.queue.add(track);
        }

        PlayerManager.updateActivity(player);
        if (!player.isPlaying && !player.isPaused) {
          await player.play();
        }

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'success',
            title: '✅ Playlist SoundCloud',
            description: `**${res.tracks.length}** piste(s) ajoutée(s)\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });
      }

      // ===== TRACK YOUTUBE =====
      if (PATTERNS.YT_VIDEO.test(query) && !PATTERNS.YT_PLAYLIST.test(query)) {
        logInfo(reqId, 'type:ytTrack');
        const meta = await fetchYouTubeOEmbed(query, reqId);

        if (!meta || !meta.title) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: '🔍 YouTube → SoundCloud',
              description: `Impossible de récupérer les informations de la vidéo.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }

        const scTrack = await matchTrackOnSoundCloud(client, interaction.user, meta, reqId);
        if (scTrack) {
          player.queue.add(scTrack);
          PlayerManager.updateActivity(player);
          if (!player.isPlaying && !player.isPaused) {
            await player.play();
          }

          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'success',
              title: '✅ YouTube → SoundCloud',
              description: `**${scTrack.info.title}**\npar ${scTrack.info.author || 'Artiste inconnu'}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: '🔍 YouTube → SoundCloud',
            description: `❌ Piste non trouvée sur SoundCloud:\n**${meta.title}**${meta.author ? `\npar ${meta.author}` : ''}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });
      }

      // ===== TRACK SPOTIFY =====
      if (PATTERNS.SP_TRACK.test(query)) {
        logInfo(reqId, 'type:spTrack');
        const meta = await fetchSpotifyOG(query, reqId);

        if (!meta || !meta.title) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: '🔍 Spotify → SoundCloud',
              description: `Impossible de récupérer les informations de la piste.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }

        const scTrack = await matchTrackOnSoundCloud(client, interaction.user, meta, reqId);
        if (scTrack) {
          player.queue.add(scTrack);
          PlayerManager.updateActivity(player);
          if (!player.isPlaying && !player.isPaused) {
            await player.play();
          }

          const titleScore = jaccard(meta.title, scTrack.info.title);
          const authorScore = meta.author ? jaccard(meta.author, scTrack.info.author || '') : 0;
          const confidence = Math.round((titleScore * 0.6 + authorScore * 0.4) * 100);
          const embedType = confidence >= 70 ? 'success' : 'warning';
          const confidenceText = confidence >= 70 ? '' : `\n⚠️ Correspondance: ${confidence}%`;

          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: embedType,
              title: '✅ Spotify → SoundCloud',
              description: `**${scTrack.info.title}**\npar ${scTrack.info.author || 'Artiste inconnu'}${confidenceText}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: '🔍 Spotify → SoundCloud',
            description: `❌ Piste non trouvée sur SoundCloud:\n**${meta.title}**${meta.author ? `\npar ${meta.author}` : ''}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });
      }

      // ===== TRACK APPLE MUSIC =====
      if (PATTERNS.AM_TRACK.test(query)) {
        logInfo(reqId, 'type:amTrack');
        const meta = await fetchAppleMusicOG(query, reqId);

        if (!meta || !meta.title) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: '🔍 Apple Music → SoundCloud',
              description: `Impossible de récupérer les informations de la piste.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }

        const scTrack = await matchTrackOnSoundCloud(client, interaction.user, meta, reqId);
        if (scTrack) {
          player.queue.add(scTrack);
          PlayerManager.updateActivity(player);
          if (!player.isPlaying && !player.isPaused) {
            await player.play();
          }

          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'success',
              title: '✅ Apple Music → SoundCloud',
              description: `**${scTrack.info.title}**\npar ${scTrack.info.author || 'Artiste inconnu'}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: '🔍 Apple Music → SoundCloud',
            description: `❌ Piste non trouvée sur SoundCloud:\n**${meta.title}**${meta.author ? `\npar ${meta.author}` : ''}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });
      }

      // ===== TRACK SOUNDCLOUD OU RECHERCHE =====
      logInfo(reqId, 'type:scDirectSearch');
      const res = await client.poru.resolve({
        query: query,
        source: 'scsearch',
        requester: interaction.user
      });

      if (!res?.tracks || res.tracks.length === 0) {
        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: '🔊 Recherche SoundCloud',
            description: `Aucune piste trouvée pour: **${query}**\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });
      }

      player.queue.add(res.tracks[0]);
      PlayerManager.updateActivity(player);
      if (!player.isPlaying && !player.isPaused) {
        await player.play();
      }

      return interaction.editReply({
        embeds: [buildEmbed(gid, {
          type: 'success',
          title: '✅ SoundCloud',
          description: `**${res.tracks[0].info.title}**\npar ${res.tracks[0].info.author || 'Artiste inconnu'}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
        })]
      });

    } catch (err) {
      logError(reqId, 'execute:criticalError', err.message);
      console.error(`[${reqId}] Stack trace:`, err.stack);
      return interaction.editReply({
        embeds: [buildEmbed(gid, {
          type: 'error',
          title: 'Erreur critique',
          description: 'Une erreur inattendue s\'est produite.'
        })]
      }).catch(() => {
        logError(reqId, 'execute:replyFailed', 'Interaction expired');
      });
    }
  }
};
