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

function isUrl(s) { try { new URL(s); return true; } catch { return false; } }
function isYouTubeUri(uri) { return typeof uri === 'string' && /youtu\.be|youtube\.com/i.test(uri); }
function isYouTubeUrl(s) { return typeof s === 'string' && /youtu\.be|youtube\.com/i.test(s); }

function isSpotifyTrackUrl(s) {
  if (typeof s !== 'string') return false;
  return /https?:\/\/open\.spotify\.com\/(?:[a-z-]+\/)?track\/[A-Za-z0-9]+/i.test(s)
    || /^spotify:track:[A-Za-z0-9]+$/i.test(s);
}

function isAppleMusicTrackUrl(s) {
  if (typeof s !== 'string') return false;
  // Track individuel: /album/NAME/ID?i=TRACKID OU /song/NAME/TRACKID
  return /https?:\/\/music\.apple\.com\/(?:[a-z]{2}\/)?(?:album\/[^\/]+\/\d+\?i=\d+|song\/[^\/]+\/\d+)/i.test(s);
}

function isAppleMusicPlaylistUrl(s) {
  if (typeof s !== 'string') return false;
  return /https?:\/\/music\.apple\.com\/(?:[a-z]{2}\/)?playlist\/[^\/]+\/pl\.[a-zA-Z0-9-]+/i.test(s);
}

function isAppleMusicAlbumUrl(s) {
  if (typeof s !== 'string') return false;
  // Album complet sans ?i= (pas un track individuel)
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
  const res = await client.manager.search({ query: q, source: 'soundcloud', requester });
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
  const resp = await fetch(o.toString(), { headers: { 'Accept': 'application/json' } });
  if (!resp.ok) {
    logWarn(reqId, 'oembedYT:http', { status: resp.status });
    return null;
  }
  const data = await resp.json();
  return { title: String(data?.title || ''), author: String(data?.author_name || '') };
}

async function fetchSpotifyOG(url, reqId) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,application/xhtml+xml' } });
  if (!resp.ok) {
    logWarn(reqId, 'ogSP:http', { status: resp.status });
    return null;
  }
  const html = await resp.text();
  const get = (prop) => {
    const m = html.match(new RegExp(`<meta\\s+property="${prop}"\\s+content="([^"]+)"`, 'i'));
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
  return { title: stripTitleNoise(title), author: stripArtistNoise(artist) };
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
    
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (!titleMatch) {
      logWarn(reqId, 'meta:ogAM:noTitle');
      return null;
    }

    let rawTitle = titleMatch[1].trim();
    let title = '';
    let author = '';

    // Format FR: "Titre par Artiste sur Apple Music"
    let match = rawTitle.match(/^(.+?)\s+par\s+(.+?)\s+sur\s+Apple\s+Music$/i);
    if (match) {
      title = match[1].trim();
      author = match[2].trim();
    } else {
      // Format EN: "Title by Artist on Apple Music"
      match = rawTitle.match(/^(.+?)\s+by\s+(.+?)\s+on\s+Apple\s+Music$/i);
      if (match) {
        title = match[1].trim();
        author = match[2].trim();
      }
    }

    // Fallback: format "Titre - Artiste"
    if (!title && rawTitle.includes(' - ')) {
      const parts = rawTitle.split(' - ', 2);
      title = parts[0].trim();
      author = parts[1].replace(/\s+sur\s+Apple\s+Music$/i, '').replace(/\s+on\s+Apple\s+Music$/i, '').trim();
    }

    if (!title || !author) {
      logWarn(reqId, 'meta:ogAM:parseFailed', { rawTitle });
      return null;
    }

    logInfo(reqId, 'meta:ogAM:ok', { title, author });
    return { title: stripTitleNoise(title), author: stripArtistNoise(author) };
  } catch (err) {
    logWarn(reqId, 'meta:ogAM:error', { error: err.message });
    return null;
  }
}

/* =========================
   Scoring & Best Match
========================= */

function scoreSoundCloudTrack(track, wantTitle, wantAuthor, reqId) {
  const lavaTitle = String(track?.title || '');
  const lavaAuthor = String(track?.author || '');
  const cleanTitle = stripTitleNoise(lavaTitle);
  const cleanAuthor = stripArtistNoise(lavaAuthor);
  const jTitle = jaccard(cleanTitle, wantTitle);
  const jAuthor = jaccard(cleanAuthor, wantAuthor);
  const wantTokens = coreTokens(`${wantTitle} ${wantAuthor}`);
  const dynBoost = dynamicBoostGeneric(cleanTitle, cleanAuthor, wantTokens);
  const score = (jTitle * 0.55) + (jAuthor * 0.35) + dynBoost;
  logInfo(reqId, 'score', { lavaTitle, cleanTitle, cleanAuthor, jTitle: jTitle.toFixed(3), jAuthor: jAuthor.toFixed(3), dynBoost: dynBoost.toFixed(3), score: score.toFixed(3) });
  return { track, score };
}

function pickBestMatch(candidates, wantTitle, wantAuthor, reqId) {
  if (!candidates || candidates.length === 0) return null;
  const scored = candidates.map(t => scoreSoundCloudTrack(t, wantTitle, wantAuthor, reqId));
  scored.sort((a, b) => b.score - a.score);
  logInfo(reqId, 'bestMatch', { top: scored[0].score.toFixed(3) });
  return scored[0].track;
}

/* =========================
   Playlists SoundCloud
========================= */

async function loadSoundCloudSet(url, client, requester, reqId) {
  logInfo(reqId, 'SC_SET:load:start', { url });
  const res = await client.manager.search({ query: url, requester });
  if (res?.loadType !== 'playlist' || !res.tracks?.length) {
    logWarn(reqId, 'SC_SET:noTracks');
    return { tracks: [], name: 'SoundCloud Set' };
  }
  const name = res.playlist?.name || 'SoundCloud Set';
  const tracks = res.tracks.filter(t => !isYouTubeUri(t?.uri));
  logInfo(reqId, 'SC_SET:load:success', { tracks: tracks.length });
  return { tracks, name };
}

/* =========================
   Garde-fou création player
========================= */

async function ensurePlayer(interaction, client, gid, vc, reqId) {
  if (!client.manager || !client.manager.nodes || client.manager.nodes.size === 0) {
    await interaction.editReply({
      embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: 'Serveur audio indisponible. Ressaie plus tard.' })]
    });
    throw new Error('No Lavalink nodes connected');
  }

  let player = client.manager.players.get(gid);
  
  if (!player) {
    player = client.manager.createPlayer({
      guildId: gid,
      voiceChannelId: vc.id,
      textChannelId: interaction.channel.id,
      autoPlay: true,
      volume: 35
    });
    logInfo(reqId, 'player:create', { guildId: gid, vc: vc.id });
  }

  if (!player) {
    await interaction.editReply({
      embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: 'Création du lecteur impossible.' })]
    });
    throw new Error('createPlayer returned undefined');
  }

  if (!player.connected) {
    try {
      await player.connect({ setDeaf: true, setMute: false });
      await new Promise(r => setTimeout(r, 400));
      logInfo(reqId, 'player:connected', { guildId: gid });
    } catch (e) {
      await interaction.editReply({
        embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: 'Connexion vocale échouée.' })]
      });
      throw e;
    }
  }

  return player;
}

/* =========================
   Commande /play
========================= */

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Jouer une piste ou playlist (SoundCloud, Spotify)')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('URL ou recherche')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Connect),

  async execute(interaction, client) {
    const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const gid = interaction.guild.id;
    logInfo(reqId, 'execute:start', { user: interaction.user.tag, guild: interaction.guild?.name });

    await interaction.deferReply();
    const query = interaction.options.getString('query', true).trim();

    // Vérifications basiques
    if (!interaction.member?.voice?.channel) {
      return interaction.editReply({
        embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: 'Tu dois être dans un canal vocal.' })]
      });
    }

    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel.permissionsFor(interaction.guild.members.me).has(['Connect', 'Speak'])) {
      return interaction.editReply({
        embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: `Je n'ai pas les permissions pour rejoindre **${voiceChannel.name}**.` })]
      });
    }

    // Créer ou récupérer le player
    let player;
    try {
      player = await ensurePlayer(interaction, client, gid, voiceChannel, reqId);
    } catch {
      logWarn(reqId, 'abort:ensurePlayer');
      return;
    }

    logInfo(reqId, 'player:ready', { voiceChannel: voiceChannel.name });

    /* =============================
       BLOQUER PLAYLISTS/ALBUMS APPLE MUSIC
    ============================= */

    if (isAppleMusicPlaylistUrl(query)) {
      logWarn(reqId, 'AM:blocked:playlist', { query });
      return interaction.editReply({
        embeds: [buildEmbed(gid, { 
          type: 'error', 
          title: '⚠️ Playlists Apple Music non supportées', 
          description: 'Les playlists Apple Music ne sont pas prises en charge. Utilise Spotify ou SoundCloud pour les playlists.' 
        })]
      });
    }

    if (isAppleMusicAlbumUrl(query)) {
      logWarn(reqId, 'AM:blocked:album', { query });
      return interaction.editReply({
        embeds: [buildEmbed(gid, { 
          type: 'error', 
          title: '⚠️ Albums Apple Music non supportés', 
          description: 'Les albums Apple Music ne sont pas pris en charge. Utilise Spotify ou SoundCloud pour les albums.' 
        })]
      });
    }

    /* =============================
       PLAYLISTS / ALBUMS SUPPORTÉS
    ============================= */

    // Playlists SoundCloud
    if (SC_SET.test(query)) {
      logInfo(reqId, 'detected:SC_SET', { query });
      const result = await loadSoundCloudSet(query, client, interaction.user, reqId);
      if (result.tracks.length === 0) {
        return interaction.editReply({
          embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: 'Impossible de charger la playlist SoundCloud.' })]
        });
      }
      for (const track of result.tracks) {
        player.queue.add(track);
      }
      if (!player.playing && !player.paused) {
        await player.play();
      }
      return interaction.editReply({
        embeds: [buildEmbed(gid, { 
          type: 'success', 
          title: 'Playlist ajoutée', 
          description: `✅ **${result.tracks.length} pistes** ajoutées depuis **${result.name || 'Playlist'}**`,
          url: query
        })]
      });
    }

    // Playlists/Albums Spotify
    if (SP_PLAYLIST_OR_ALBUM.test(query)) {
      logInfo(reqId, 'detected:SP_PLAYLIST_OR_ALBUM', { query });
      const result = await client.manager.search({ query, requester: interaction.user });
      
      if (result?.loadType === 'playlist' && result.tracks?.length > 0) {
        const tracks = result.tracks.filter(t => !isYouTubeUri(t?.uri));
        for (const track of tracks) {
          player.queue.add(track);
        }
        if (!player.playing && !player.paused) {
          await player.play();
        }
        const name = result.playlist?.name || 'Spotify Collection';
        return interaction.editReply({
          embeds: [buildEmbed(gid, { 
            type: 'success', 
            title: 'Playlist Spotify ajoutée', 
            description: `✅ **${tracks.length} pistes** ajoutées depuis **${name}**`,
            url: query
          })]
        });
      }
      
      return interaction.editReply({
        embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: 'Impossible de charger la playlist/album Spotify.' })]
      });
    }

    /* =============================
       PISTES INDIVIDUELLES
    ============================= */

    // URL directe SoundCloud
    if (SC_TRACK.test(query) && !SC_SET.test(query)) {
      logInfo(reqId, 'detected:SC_TRACK', { query });
      const res = await client.manager.search({ query, requester: interaction.user });
      if (res?.tracks?.length > 0) {
        const track = res.tracks[0];
        player.queue.add(track);
        if (!player.playing && !player.paused) {
          await player.play();
        }
        return interaction.editReply({
          embeds: [buildEmbed(gid, { 
            type: 'success', 
            title: 'Ajouté à la file', 
            description: `✅ **${track.title || 'Piste SoundCloud'}** par **${track.author || 'Artiste inconnu'}**`,
            url: track.uri || null
          })]
        });
      }
      return interaction.editReply({
        embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: 'Piste SoundCloud introuvable.' })]
      });
    }

    // URL Spotify track
    if (isSpotifyTrackUrl(query)) {
      logInfo(reqId, 'detected:SPOTIFY_TRACK', { query });

      let meta = await fetchSpotifyOG(query, reqId);

      if (!meta || !meta.title || !meta.author) {
        const fallbackRes = await client.manager.search({ query, requester: interaction.user });
        if (fallbackRes?.tracks?.length > 0) {
          const track = fallbackRes.tracks[0];
          player.queue.add(track);
          if (!player.playing && !player.paused) {
            await player.play();
          }
          return interaction.editReply({
            embeds: [buildEmbed(gid, { 
              type: 'success', 
              title: 'Ajouté à la file', 
              description: `✅ **${track.title || 'Piste'}** par **${track.author || 'Artiste inconnu'}**`,
              url: track.uri || null
            })]
          });
        }
        return interaction.editReply({
          embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: 'Impossible de charger la piste Spotify.' })]
        });
      }

      const searchQuery = `${meta.author} ${meta.title}`;
      logInfo(reqId, 'search:SC', { searchQuery });
      const candidates = await scSearch(client, interaction.user, searchQuery, 10, reqId);

      if (candidates.length === 0) {
        return interaction.editReply({
          embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: `Aucun résultat SoundCloud pour **${meta.title}** par **${meta.author}**.` })]
        });
      }

      const bestTrack = pickBestMatch(candidates, meta.title, meta.author, reqId);
      if (!bestTrack || !bestTrack.title) {
        return interaction.editReply({
          embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: 'Aucune correspondance valide trouvée.' })]
        });
      }

      player.queue.add(bestTrack);
      if (!player.playing && !player.paused) {
        await player.play();
      }

      return interaction.editReply({
        embeds: [buildEmbed(gid, { 
          type: 'success', 
          title: 'Ajouté à la file', 
          description: `✅ **${bestTrack.title}** par **${bestTrack.author || 'Artiste inconnu'}** (Spotify → SC)`,
          url: bestTrack.uri || null
        })]
      });
    }

    // URL Apple Music track (track individuel uniquement)
    if (isAppleMusicTrackUrl(query)) {
      logInfo(reqId, 'detected:APPLEMUSIC_TRACK', { query });

      let meta = await fetchAppleMusicOG(query, reqId);

      if (!meta || !meta.title || !meta.author) {
        return interaction.editReply({
          embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: 'Impossible d\'extraire les métadonnées Apple Music.' })]
        });
      }

      const searchQuery = `${meta.author} ${meta.title}`;
      logInfo(reqId, 'search:SC', { searchQuery });
      const candidates = await scSearch(client, interaction.user, searchQuery, 10, reqId);

      if (candidates.length === 0) {
        return interaction.editReply({
          embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: `Aucun résultat SoundCloud pour **${meta.title}** par **${meta.author}**.` })]
        });
      }

      const bestTrack = pickBestMatch(candidates, meta.title, meta.author, reqId);
      if (!bestTrack || !bestTrack.title) {
        return interaction.editReply({
          embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: 'Aucune correspondance valide trouvée.' })]
        });
      }

      player.queue.add(bestTrack);
      if (!player.playing && !player.paused) {
        await player.play();
      }

      return interaction.editReply({
        embeds: [buildEmbed(gid, { 
          type: 'success', 
          title: 'Ajouté à la file', 
          description: `✅ **${bestTrack.title}** par **${bestTrack.author || 'Artiste inconnu'}** (Apple Music → SC)`,
          url: bestTrack.uri || null
        })]
      });
    }

    /* =============================
       RECHERCHE GÉNÉRIQUE
    ============================= */

    logInfo(reqId, 'search:generic', { query });
    const candidates = await scSearch(client, interaction.user, query, 5, reqId);

    if (candidates.length === 0) {
      return interaction.editReply({
        embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: `Aucun résultat pour **${query}**.` })]
      });
    }

    const track = candidates[0];
    
    if (!track || !track.title || track.title.trim() === '') {
      return interaction.editReply({
        embeds: [buildEmbed(gid, { type: 'error', title: 'Erreur', description: 'Résultat invalide reçu de SoundCloud.' })]
      });
    }

    player.queue.add(track);
    if (!player.playing && !player.paused) {
      await player.play();
    }

    return interaction.editReply({
      embeds: [buildEmbed(gid, { 
        type: 'success', 
        title: 'Ajouté à la file', 
        description: `✅ **${track.title}** par **${track.author || 'Artiste inconnu'}**`,
        url: track.uri || null
      })]
    });
  }
};
