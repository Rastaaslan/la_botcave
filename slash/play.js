// slash/play.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

/* ========================= 
   Constantes & Détection 
========================= */
const LOG_PREFIX = '[PLAY]';
const SC_PREFIX = '[SC]';
const SC_SET = /soundcloud\.com\/[^/]+\/sets\/[^/]+/i;
const SC_TRACK = /soundcloud\.com\/[^/]+\/[^/]+/i;
const YT_PLAYLIST = /(?:youtu\.be|youtube\.com).*?[?&]list=/i;
const SP_PLAYLIST_OR_ALBUM = /(?:open\.spotify\.com\/(?:playlist|album)\/|spotify:(?:playlist|album):)/i;

function isUrl(s) {
  try { new URL(s); return true; } catch { return false; }
}

function isYouTubeUri(uri) {
  return typeof uri === 'string' && /youtu\.be|youtube\.com/i.test(uri);
}

function isYouTubeUrl(s) {
  return typeof s === 'string' && /youtu\.be|youtube\.com/i.test(s);
}

function isSpotifyTrackUrl(s) {
  if (typeof s !== 'string') return false;
  return /https?:\/\/open\.spotify\.com\/(?:[a-z-]+\/)?track\/[A-Za-z0-9]+/i.test(s) 
      || /^spotify:track:[A-Za-z0-9]+$/i.test(s);
}

function isAppleMusicTrackUrl(s) {
  if (typeof s !== 'string') return false;
  return /https?:\/\/music\.apple\.com\/(?:[a-z]{2}\/)?(?:album\/[^\/]+\/\d+\?i=\d+|song\/[^\/]+\/\d+)/i.test(s);
}

function isAppleMusicPlaylistUrl(s) {
  if (typeof s !== 'string') return false;
  return /https?:\/\/music\.apple\.com\/(?:[a-z]{2}\/)?playlist\/[^\/]+\/pl\.[a-zA-Z0-9-]+/i.test(s);
}

function isAppleMusicAlbumUrl(s) {
  if (typeof s !== 'string') return false;
  return /https?:\/\/music\.apple\.com\/(?:[a-z]{2}\/)?album\/[^\/]+\/\d+(?:\?(?!i=)|$)/i.test(s);
}

/* ========================= 
   Logging helpers 
========================= */
const logInfo = (id, tag, payload) => console.log(LOG_PREFIX, id, tag, payload || '');
const logWarn = (id, tag, payload) => console.warn(LOG_PREFIX, id, tag, payload || '');

/* ========================= 
   Normalisation & scoring 
========================= */
function normalize(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTitleNoise(title) {
  let t = title;
  t = t.replace(/\(.*?\)/g, '');
  t = t.replace(/\[.*?\]/g, '');
  t = t.replace(/\b(?:official|audio|video|music|lyric|lyrics|visuali?zer?|mv|hd|hq|4k|remaster(?:ed)?|explicit|clean|radio|edit|extended|version|ft\.?|feat(?:uring)?\.?)\b/ig, '');
  t = t.replace(/\bf[*u]ck(?:ed|ing)?\b/ig, '');
  t = t.replace(/[_\-—–·]+/g, ' ');
  t = t.split('|')[0];
  return normalize(t);
}

function stripArtistNoise(artist) {
  return normalize(artist).replace(/-\s*topic$/i, '');
}

function tokenSet(s) {
  return new Set(normalize(s).split(/\s+/).filter(Boolean));
}

function jaccard(a, b) {
  const A = new Set(normalize(a).split(/\s+/).filter(Boolean));
  const B = new Set(normalize(b).split(/\s+/).filter(Boolean));
  const inter = [...A].filter(x => B.has(x)).length;
  const union = A.size + B.size - inter + 1;
  return inter / union;
}

function coreTokens(s) {
  return [...tokenSet(s)].filter(w => w.length >= 2);
}

function dynamicBoostGeneric(title, author, wantTokens) {
  let b = 0;
  const T = tokenSet(title);
  const A = tokenSet(author);
  const overlapTitle = wantTokens.filter(t => T.has(t)).length;
  const overlapAuthor = wantTokens.filter(t => A.has(t)).length;
  if (overlapTitle >= 2) b += 0.12;
  if (overlapAuthor >= 1) b += 0.10;
  return b;
}

/* ========================= 
   Recherches SoundCloud 
========================= */
async function scSearch(client, requester, q, limit, reqId) {
  console.log(SC_PREFIX, reqId, 'search', JSON.stringify({ q, limit }));
  const res = await client.manager.search({ 
    query: q, 
    source: 'soundcloud', 
    requester 
  });
  const n = res?.tracks?.length || 0;
  console.log(SC_PREFIX, reqId, 'results', n);
  return (res?.tracks || []).slice(0, limit).filter(t => !isYouTubeUri(t?.uri));
}

/* ========================= 
   Métadonnées (OG Tags) 
========================= */
async function fetchYouTubeOEmbed(url, reqId) {
  const o = new URL('https://www.youtube.com/oembed');
  o.searchParams.set('url', url);
  o.searchParams.set('format', 'json');
  const resp = await fetch(o.toString(), { 
    headers: { 'Accept': 'application/json' } 
  });
  if (!resp.ok) {
    logWarn(reqId, 'oembedYT:http', { status: resp.status });
    return null;
  }
  const data = await resp.json();
  return { 
    title: String(data?.title || ''), 
    author: String(data?.author_name || '') 
  };
}

async function fetchSpotifyOG(url, reqId) {
  const resp = await fetch(url, { 
    headers: { 
      'User-Agent': 'Mozilla/5.0', 
      'Accept': 'text/html,application/xhtml+xml' 
    } 
  });
  if (!resp.ok) {
    logWarn(reqId, 'ogSP:http', { status: resp.status });
    return null;
  }
  const html = await resp.text();
  const get = (prop) => {
    const m = html.match(new RegExp(`<meta\\s+property="${prop}"\\s+content="([^"]*)"`, 'i'));
    return m?.[1] || '';
  };
  const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
  const ogTitle = get('og:title') || titleTag;
  let title = ogTitle.replace(/\s*-\s*Spotify$/i, '');
  let artist = '';
  let m = title.match(/\s*-\s*song(?:\s*and\s*lyrics)?\s*by\s*(.+)/i);
  if (m) {
    artist = m[1];
    title = title.replace(/\s*-\s*song(?:\s*and\s*lyrics)?\s*by\s*.+/i, '');
  } else {
    m = title.match(/\s*·\s*(?:single|album|ep)\s*by\s*(.+)/i);
    if (m) {
      artist = m[1];
      title = title.replace(/\s*·\s*(?:single|album|ep)\s*by\s*.+/i, '');
    }
  }
  return { 
    title: stripTitleNoise(title), 
    author: stripArtistNoise(artist) 
  };
}

async function fetchAppleMusicOG(url, reqId) {
  logInfo(reqId, 'meta:ogAM:start', { url });
  try {
    const res = await fetch(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0' }, 
      redirect: 'follow' 
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const titleMatch = html.match(/"name":"([^"]+)"/);
    const artistMatch = html.match(/"artist(?:Name)?":"([^"]+)"/);
    if (!titleMatch) {
      logWarn(reqId, 'meta:ogAM:noTitle');
      return null;
    }
    return {
      title: stripTitleNoise(titleMatch[1] || ''),
      author: stripArtistNoise(artistMatch?.[1] || '')
    };
  } catch (err) {
    logWarn(reqId, 'meta:ogAM:err', String(err));
    return null;
  }
}

/* ========================= 
   Extraction playlists YouTube 
========================= */
async function extractYouTubePlaylistTracks(url, reqId) {
  logInfo(reqId, 'ytPlaylist:start', { url });
  try {
    const playlistId = extractYouTubePlaylistId(url);
    if (!playlistId) {
      logWarn(reqId, 'ytPlaylist:noId');
      return [];
    }

    const resp = await fetch(`https://www.youtube.com/playlist?list=${playlistId}`, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    
    if (!resp.ok) {
      logWarn(reqId, 'ytPlaylist:httpError', { status: resp.status });
      return [];
    }

    const html = await resp.text();
    const match = html.match(/var ytInitialData = ({.+?});/);
    if (!match) {
      logWarn(reqId, 'ytPlaylist:noData');
      return [];
    }

    const data = JSON.parse(match[1]);
    const contents = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]
      ?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
      ?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents;

    if (!contents) {
      logWarn(reqId, 'ytPlaylist:noContents');
      return [];
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

    logInfo(reqId, 'ytPlaylist:extracted', { count: tracks.length });
    return tracks;
  } catch (err) {
    logWarn(reqId, 'ytPlaylist:error', String(err));
    return [];
  }
}

function extractYouTubePlaylistId(url) {
  const match = url.match(/[?&]list=([^&]+)/);
  return match?.[1] || null;
}

/* ========================= 
   Extraction playlists Spotify 
========================= */
async function extractSpotifyPlaylistTracks(url, reqId) {
  logInfo(reqId, 'spPlaylist:start', { url });
  try {
    const match = url.match(/(?:playlist|album)\/([A-Za-z0-9]+)/);
    if (!match) {
      logWarn(reqId, 'spPlaylist:noId');
      return [];
    }

    const type = url.includes('/playlist/') ? 'playlist' : 'album';
    
    const resp = await fetch(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      } 
    });

    if (!resp.ok) {
      logWarn(reqId, 'spPlaylist:httpError', { status: resp.status });
      return [];
    }

    const html = await resp.text();
    const tracks = [];
    
    // Regex pour extraire les tracks du HTML
    const trackPattern = /"name":"([^"]+)","artists":\[({[^}]+}(?:,{[^}]+})*)\]/g;
    let match2;
    
    while ((match2 = trackPattern.exec(html)) !== null) {
      const title = match2[1];
      const artistsJson = `[${match2[2]}]`;
      
      try {
        const artistsData = JSON.parse(artistsJson);
        const artists = artistsData.map(a => a.name).join(', ');
        
        tracks.push({
          title: stripTitleNoise(title),
          author: stripArtistNoise(artists),
          query: `${artists} ${title}`.trim()
        });
      } catch (e) {
        logWarn(reqId, 'spPlaylist:parseTrack', { error: String(e) });
      }
    }

    // Fallback : chercher les données JSON-LD
    if (tracks.length === 0) {
      const scriptMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>(\{[^<]+\})<\/script>/);
      if (scriptMatch) {
        try {
          const jsonData = JSON.parse(scriptMatch[1]);
          const trackList = jsonData?.track?.itemListElement || [];
          
          for (const item of trackList) {
            const track = item?.item;
            if (track?.name) {
              tracks.push({
                title: stripTitleNoise(track.name),
                author: stripArtistNoise(track?.byArtist?.name || ''),
                query: `${track?.byArtist?.name || ''} ${track.name}`.trim()
              });
            }
          }
        } catch (e) {
          logWarn(reqId, 'spPlaylist:parseJSON', { error: String(e) });
        }
      }
    }

    logInfo(reqId, 'spPlaylist:extracted', { count: tracks.length });
    return tracks;
    
  } catch (err) {
    logWarn(reqId, 'spPlaylist:error', String(err));
    return [];
  }
}

/* ========================= 
   Matching via SoundCloud 
========================= */
async function matchTrackOnSoundCloud(client, requester, track, reqId) {
  const query = track.query || `${track.author} ${track.title}`.trim();
  logInfo(reqId, 'scMatch:start', { query });

  try {
    const results = await scSearch(client, requester, query, 5, reqId);
    
    if (!results || results.length === 0) {
      logWarn(reqId, 'scMatch:noResults', { query });
      return null;
    }

    const wantTokens = coreTokens(`${track.title} ${track.author}`);
    let bestMatch = null;
    let bestScore = 0;

    for (const result of results) {
      const titleScore = jaccard(track.title, result.title || '');
      const authorScore = jaccard(track.author, result.author || '');
      const boost = dynamicBoostGeneric(result.title, result.author, wantTokens);
      const totalScore = titleScore * 0.6 + authorScore * 0.3 + boost;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestMatch = result;
      }
    }

    if (bestMatch && bestScore > 0.3) {
      logInfo(reqId, 'scMatch:found', { 
        score: bestScore.toFixed(2), 
        title: bestMatch.title 
      });
      return bestMatch;
    }

    logWarn(reqId, 'scMatch:lowScore', { bestScore: bestScore.toFixed(2) });
    return null;
  } catch (err) {
    logWarn(reqId, 'scMatch:error', String(err));
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
    const reqId = `req_${Date.now()}`;
    const query = interaction.options.getString('query');
    const member = interaction.member;
    const voiceChannel = member?.voice?.channel;
    const gid = interaction.guildId;

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

      if (!player) {
        player = client.manager.players.create({
          guildId: gid,
          voiceChannelId: voiceChannel.id,
          textChannelId: interaction.channelId,
          volume: 50
        });
      }

      if (!player.connected) {
        player.connect({
          setDeaf: true,
          setMute: false
        });
      }

      // ===== PLAYLIST YOUTUBE =====
      if (YT_PLAYLIST.test(query)) {
        logInfo(reqId, 'type:ytPlaylist');
        const tracks = await extractYouTubePlaylistTracks(query, reqId);
        
        if (tracks.length === 0) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: 'Erreur',
              description: 'Impossible de récupérer les pistes de la playlist YouTube.'
            })]
          });
        }

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

        if (!player.playing && !player.paused) {
          player.play();
        }

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'success',
            title: 'Playlist YouTube ajoutée',
            description: `${added} piste(s) trouvée(s) sur SoundCloud` + 
              (failed > 0 ? `\n⚠️ ${failed} piste(s) non trouvée(s)` : '')
          })]
        });
      }

      // ===== PLAYLIST/ALBUM SPOTIFY =====
      if (SP_PLAYLIST_OR_ALBUM.test(query)) {
        logInfo(reqId, 'type:spPlaylist');
        const tracks = await extractSpotifyPlaylistTracks(query, reqId);
        
        if (tracks.length === 0) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: 'Erreur',
              description: 'Impossible de récupérer les pistes de la playlist/album Spotify.'
            })]
          });
        }

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

        if (!player.playing && !player.paused) {
          player.play();
        }

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'success',
            title: 'Playlist Spotify ajoutée',
            description: `${added} piste(s) trouvée(s) sur SoundCloud` +
              (failed > 0 ? `\n⚠️ ${failed} piste(s) non trouvée(s)` : '')
          })]
        });
      }

      // ===== PLAYLIST SOUNDCLOUD =====
      if (SC_SET.test(query)) {
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
              title: 'Erreur',
              description: 'Aucune piste trouvée dans cette playlist SoundCloud.'
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
            title: 'Playlist SoundCloud ajoutée',
            description: `${res.tracks.length} piste(s) ajoutée(s)`
          })]
        });
      }

      // ===== TRACK YOUTUBE =====
      if (isYouTubeUrl(query) && !YT_PLAYLIST.test(query)) {
        logInfo(reqId, 'type:ytTrack');
        const meta = await fetchYouTubeOEmbed(query, reqId);
        
        if (meta) {
          const scQuery = `${meta.author} ${meta.title}`.trim();
          const scResults = await scSearch(client, interaction.user, scQuery, 3, reqId);
          
          if (scResults.length > 0) {
            player.queue.add(scResults[0]);
            if (!player.playing && !player.paused) {
              player.play();
            }
            return interaction.editReply({
              embeds: [buildEmbed(gid, {
                type: 'success',
                title: 'Piste ajoutée',
                description: `**${scResults[0].title}**\npar ${scResults[0].author}`
              })]
            });
          }
        }
        
        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: 'Erreur',
            description: 'Piste YouTube non trouvée sur SoundCloud.'
          })]
        });
      }

      // ===== TRACK SPOTIFY =====
      if (isSpotifyTrackUrl(query)) {
        logInfo(reqId, 'type:spTrack');
        const meta = await fetchSpotifyOG(query, reqId);
        
        if (meta) {
          const scQuery = `${meta.author} ${meta.title}`.trim();
          const scResults = await scSearch(client, interaction.user, scQuery, 3, reqId);
          
          if (scResults.length > 0) {
            player.queue.add(scResults[0]);
            if (!player.playing && !player.paused) {
              player.play();
            }
            return interaction.editReply({
              embeds: [buildEmbed(gid, {
                type: 'success',
                title: 'Piste ajoutée',
                description: `**${scResults[0].title}**\npar ${scResults[0].author}`
              })]
            });
          }
        }
        
        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: 'Erreur',
            description: 'Piste Spotify non trouvée sur SoundCloud.'
          })]
        });
      }

      // ===== TRACK APPLE MUSIC =====
      if (isAppleMusicTrackUrl(query)) {
        logInfo(reqId, 'type:amTrack');
        const meta = await fetchAppleMusicOG(query, reqId);
        
        if (meta) {
          const scQuery = `${meta.author} ${meta.title}`.trim();
          const scResults = await scSearch(client, interaction.user, scQuery, 3, reqId);
          
          if (scResults.length > 0) {
            player.queue.add(scResults[0]);
            if (!player.playing && !player.paused) {
              player.play();
            }
            return interaction.editReply({
              embeds: [buildEmbed(gid, {
                type: 'success',
                title: 'Piste ajoutée',
                description: `**${scResults[0].title}**\npar ${scResults[0].author}`
              })]
            });
          }
        }
        
        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: 'Erreur',
            description: 'Piste Apple Music non trouvée sur SoundCloud.'
          })]
        });
      }

      // ===== RECHERCHE DIRECTE =====
      const res = await client.manager.search({
        query,
        source: 'soundcloud',
        requester: interaction.user
      });

      if (!res?.tracks || res.tracks.length === 0) {
        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: 'Erreur',
            description: 'Aucun résultat trouvé.'
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
          description: `**${res.tracks[0].title}**\npar ${res.tracks[0].author}`
        })]
      });

    } catch (err) {
      logWarn(reqId, 'execute:error', String(err));
      console.error('[DEBUG] Full error:', err);
      return interaction.editReply({
        embeds: [buildEmbed(gid, {
          type: 'error',
          title: 'Erreur',
          description: 'Une erreur est survenue lors de l\'exécution.'
        })]
      });
    }
  }
};
