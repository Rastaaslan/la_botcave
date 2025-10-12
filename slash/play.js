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
const AM_PLAYLIST_OR_ALBUM = /music\.apple\.com\/[^/]+\/(?:playlist)/i;

function isUrl(s) { try { new URL(s); return true; } catch { return false; } }
function isYouTubeUri(uri) { return typeof uri === 'string' && /youtu\.be|youtube\.com/i.test(uri); }
function isYouTubeUrl(s) { return typeof s === 'string' && /youtu\.be|youtube\.com/i.test(s); }

function isSpotifyTrackUrl(s) {
  if (typeof s !== 'string') return false;
  // Support: /track/ID, /intl-fr/track/ID, /fr/track/ID, spotify:track:ID
  return /https?:\/\/open\.spotify\.com\/(?:[a-z-]+\/)?track\/[A-Za-z0-9]+/i.test(s)
    || /^spotify:track:[A-Za-z0-9]+$/i.test(s);
}

function isAppleMusicTrackUrl(s) {
  if (typeof s !== 'string') return false;
  // Support: /album/NAME/ID?i=TRACKID ET /song/NAME/TRACKID
  return /https?:\/\/music\.apple\.com\/(?:[a-z]{2}\/)?(?:album\/[^\/]+\/\d+\?i=\d+|song\/[^\/]+\/\d+)/i.test(s);
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
  return normalize(artist)
    .replace(/-\s*topic$/i, '');
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
  console.log(SC_PREFIX, reqId, 'search', JSON.stringify({ q, limit }), limit);
  const res = await client.manager.search({ query: q, source: 'soundcloud', requester });
  const n = res?.tracks?.length || 0;
  console.log(SC_PREFIX, reqId, 'results', n);
  return (res?.tracks || []).slice(0, limit).filter(t => !isYouTubeUri(t?.uri));
}

/* =========================
   Méta unique (Lavalink + oEmbed YT + OG Spotify + OG Apple Music)
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
    const m = html.match(new RegExp(`<meta property="${prop}" content="([^"]+)"`, 'i'));
    return m?.[1];
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
    
    // Extraire le titre og:title ou <title>
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)
      || html.match(/<title>([^<]+)<\/title>/i);
    
    if (!titleMatch) {
      logWarn(reqId, 'meta:ogAM:noTitle');
      return null;
    }
    
    let rawTitle = titleMatch[1].trim();
    let title = '';
    let author = '';
    
    // Format français: "TITRE par ARTISTE sur Apple Music"
    let match = rawTitle.match(/^(.+?)\s+par\s+(.+?)\s+sur\s+Apple\s+Music$/i);
    if (match) {
      title = match[1].trim();
      author = match[2].trim();
    }
    // Format anglais: "TITRE by ARTIST on Apple Music"
    else {
      match = rawTitle.match(/^(.+?)\s+by\s+(.+?)\s+on\s+Apple\s+Music$/i);
      if (match) {
        title = match[1].trim();
        author = match[2].trim();
      }
    }
    
    // Format alternatif: "TITRE - ARTISTE"
    if (!title && rawTitle.includes(' - ')) {
      const parts = rawTitle.split(' - ', 2);
      title = parts[0].trim();
      author = parts[1].replace(/\s+sur\s+Apple\s+Music$/i, '').replace(/\s+on\s+Apple\s+Music$/i, '').trim();
    }
    
    // Dernier recours: extraire depuis les meta tags music:
    if (!title || !author) {
      const musicTitle = html.match(/<meta\s+name="apple:title"\s+content="([^"]+)"/i);
      const musicArtist = html.match(/<meta\s+property="music:musician"\s+content="([^"]+)"/i)
        || html.match(/<meta\s+name="apple:content_artist"\s+content="([^"]+)"/i);
      
      if (musicTitle) title = musicTitle[1].trim();
      if (musicArtist) author = musicArtist[1].trim();
    }
    
    if (!title) {
      logWarn(reqId, 'meta:ogAM:parsingFailed', { rawTitle });
      return null;
    }
    
    const meta = {
      title: stripTitleNoise(title),
      author: stripArtistNoise(author || 'Unknown Artist')
    };
    
    logInfo(reqId, 'meta:ogAM:found', meta);
    return meta;
  }
  catch (err) {
    logWarn(reqId, 'meta:ogAM:error', err?.message || String(err));
    return null;
  }
}

async function getMetaOnce(client, requester, url, reqId) {
  try {
    const res = await client.manager.search({ query: url, requester });
    const t = res?.tracks?.[0];
    if (t) {
      const meta = { title: t.title, author: t.author };
      logInfo(reqId, 'meta:lavalink', meta);
      return meta;
    }
  }
  catch (e) {
    logWarn(reqId, 'meta:lavalink:error', e?.message || String(e));
  }

  if (isYouTubeUrl(url)) {
    try {
      const meta = await fetchYouTubeOEmbed(url, reqId);
      if (meta && (meta.title || meta.author)) {
        logInfo(reqId, 'meta:oembedYT', meta);
        return meta;
      }
    }
    catch (e) { logWarn(reqId, 'meta:oembedYT:error', e?.message || String(e)); }
  }

  if (isSpotifyTrackUrl(url)) {
    try {
      const meta = await fetchSpotifyOG(url, reqId);
      if (meta && (meta.title || meta.author)) {
        logInfo(reqId, 'meta:ogSP', meta);
        return meta;
      }
    }
    catch (e) { logWarn(reqId, 'meta:ogSP:error', e?.message || String(e)); }
  }

  if (isAppleMusicTrackUrl(url)) {
    try {
      const meta = await fetchAppleMusicOG(url, reqId);
      if (meta && (meta.title || meta.author)) {
        logInfo(reqId, 'meta:ogAM', meta);
        return meta;
      }
    }
    catch (e) { logWarn(reqId, 'meta:ogAM:error', e?.message || String(e)); }
  }

  logWarn(reqId, 'meta:none');
  return null;
}

/* =========================
   Résolution stricte: URL → méta → SC (sinon texte)
   ========================= */
async function resolveToSoundCloudTrack(client, requester, urlOrQuery, reqId) {
  logInfo(reqId, 'resolve:start', { input: urlOrQuery });
  logInfo(reqId, 'detect', { isURL: isUrl(urlOrQuery), isYT: isYouTubeUrl(urlOrQuery), isSP: isSpotifyTrackUrl(urlOrQuery), isAM: isAppleMusicTrackUrl(urlOrQuery) });

  const candidates = [];
  let best = null;
  let bestScore = 0;

  if (isUrl(urlOrQuery)) {
    if (isYouTubeUrl(urlOrQuery) || isSpotifyTrackUrl(urlOrQuery) || isAppleMusicTrackUrl(urlOrQuery)) {
      const meta = await getMetaOnce(client, requester, urlOrQuery, reqId);
      if (!meta) {
        logWarn(reqId, 'noMeta:stopForUrl');
        return null;
      }

      const artist = stripArtistNoise(meta.author);
      const title = stripTitleNoise(meta.title);
      const combos = [`${artist} ${title}`, `${title} ${artist}`, title, artist].filter(Boolean);
      logInfo(reqId, 'candidates:fromMeta', combos);
      candidates.push(...combos);
    }
    else {
      logWarn(reqId, 'url:notSupported');
      return null;
    }
  }
  else {
    const cleaned = stripTitleNoise(urlOrQuery);
    if (cleaned) candidates.push(cleaned);
    logInfo(reqId, 'candidates:text', candidates);
  }

  if (candidates.length === 0) return null;

  for (const q of candidates) {
    const wantTokens = coreTokens(q);
    const tracks = await scSearch(client, requester, q, 10, reqId);

    let i = 0;
    for (const t of tracks) {
      const title = t.title;
      const author = t.author;

      let score = 0.6 * jaccard(title, q) + 0.4 * jaccard(author, q);
      score += dynamicBoostGeneric(title, author, wantTokens);

      if (/mix|set|live|full album/i.test(title)) score -= 0.08;

      if (score > bestScore) {
        best = t;
        bestScore = score;
      }

      if (i < 3) console.log(SC_PREFIX, reqId, 'score', q, `→ "${title}" — ${author}`, '→', Number(score.toFixed(3)));
      i++;
    }
    logInfo(reqId, 'candidate:done', { q, bestScore: Number(bestScore.toFixed(3)) });
    if (best && bestScore > 0.45) break;
  }

  if (!best) {
    logWarn(reqId, 'resolve:none');
    return null;
  }

  logInfo(reqId, 'resolve:pick', { title: best.title, author: best.author, uri: best.uri, score: Number(bestScore.toFixed(3)) });
  return best;
}

/* =========================
   Ajout par lots (sets SC)
   ========================= */
async function addInBatches(player, tracks, batchSize, reqId) {
  let added = 0;
  for (let i = 0; i < tracks.length; i += batchSize) {
    const slice = tracks.slice(i, i + batchSize);
    for (const t of slice) player.queue.add(t);
    added += slice.length;
    await new Promise(r => setTimeout(r, 120));
  }
  logInfo(reqId, 'batch:added', { added, total: tracks.length });
  return added;
}

/* =========================
   Garde-fou création/connexion
   ========================= */
async function ensurePlayer(interaction, client, gid, vc, reqId) {
  if (!client.manager || !client.manager.nodes || client.manager.nodes.size === 0) {
    await interaction.editReply({ embeds: [buildEmbed(gid, { type: 'error', title: 'Serveur audio indisponible', description: 'Ressaie plus tard.' })] });
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
    await interaction.editReply({ embeds: [buildEmbed(gid, { type: 'error', title: 'Création du lecteur impossible', description: 'Initialisation échouée.' })] });
    throw new Error('createPlayer returned undefined');
  }

  if (!player.connected) {
    try {
      await player.connect({ setDeaf: true, setMute: false });
      await new Promise(r => setTimeout(r, 400));
      logInfo(reqId, 'player:connected', { guildId: gid });
    } catch (e) {
      await interaction.editReply({ embeds: [buildEmbed(gid, { type: 'error', title: 'Connexion vocale échouée', description: 'Impossible de rejoindre le salon.' })] });
      throw e;
    }
  }

  return player;
}

/* =========================
   Commande slash
   ========================= */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Lire une musique depuis une recherche ou une URL (lecture SoundCloud)')
    .addStringOption(o => o.setName('query').setDescription('Recherche ou URL').setRequired(true)),

  async execute(interaction, client) {
    const reqId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const gid = interaction.guild.id;
    const vc = interaction.member.voice?.channel;

    logInfo(reqId, 'cmd:start', { user: interaction.user?.id, guild: gid });

    if (!vc) {
      return interaction.reply({
        embeds: [buildEmbed(gid, { type: 'error', title: 'Salon vocal requis', description: 'Rejoins un salon vocal.' })],
        flags: 1 << 6
      });
    }

    const perms = vc.permissionsFor(interaction.client.user);
    if (!perms?.has(PermissionFlagsBits.Connect) || !perms?.has(PermissionFlagsBits.Speak)) {
      return interaction.reply({
        embeds: [buildEmbed(gid, { type: 'error', title: 'Permissions manquantes', description: 'Connect et Speak requis.' })],
        flags: 1 << 6
      });
    }

    const query = interaction.options.getString('query', true);
    logInfo(reqId, 'input', { query });
    await interaction.deferReply();

    let player;
    try {
      player = await ensurePlayer(interaction, client, gid, vc, reqId);
    } catch {
      logWarn(reqId, 'abort:ensurePlayer');
      return;
    }

    // Refus playlists/albums (sauf Apple Music tracks dans albums)
    if (isUrl(query)) {
      if (YT_PLAYLIST.test(query) || SP_PLAYLIST_OR_ALBUM.test(query)) {
        logWarn(reqId, 'reject:playlist', { query });
        return interaction.editReply({
          embeds: [buildEmbed(gid, { type: 'error', title: 'Playlist non supportée', description: 'Seules les playlists SoundCloud (sets) sont acceptées.' })]
        });
      }
      // Apple Music: refuser playlist mais accepter /album/?i= (track dans album)
      if (AM_PLAYLIST_OR_ALBUM.test(query) && !isAppleMusicTrackUrl(query)) {
        logWarn(reqId, 'reject:playlist', { query });
        return interaction.editReply({
          embeds: [buildEmbed(gid, { type: 'error', title: 'Playlist non supportée', description: 'Seules les playlists SoundCloud (sets) sont acceptées.' })]
        });
      }
    }

    // SC set
    if (isUrl(query) && SC_SET.test(query)) {
      logInfo(reqId, 'set:sc', { query });
      const res = await client.manager.search({ query, requester: interaction.user });
      const count = res?.tracks?.length || 0;
      logInfo(reqId, 'set:found', { count });

      if (!count) {
        return interaction.editReply({
          embeds: [buildEmbed(gid, { type: 'error', title: 'Aucun résultat', description: 'Set SoundCloud introuvable.' })]
        });
      }

      const isPlaylist = (typeof res.loadType === 'string' && res.loadType.toLowerCase().includes('playlist')) || (res.tracks?.length > 1 && res.playlistInfo);
      const tracks = (isPlaylist ? res.tracks : [res.tracks[0]]).filter(t => !isYouTubeUri(t?.uri));
      const added = await addInBatches(player, tracks, 25, reqId);

      if (!player.playing) player.play();

      const title = res.playlistInfo?.name || 'Set SoundCloud';
      logInfo(reqId, 'queue:set:added', { added, title });
      return interaction.editReply({
        embeds: [buildEmbed(gid, { type: 'success', title: 'Playlist ajoutée', description: `**${title}**\n${added} pistes ajoutées.`, url: query })]
      });
    }

    // SC track direct
    if (isUrl(query) && SC_TRACK.test(query)) {
      logInfo(reqId, 'track:sc', { query });
      const res = await client.manager.search({ query, requester: interaction.user });
      const count = res?.tracks?.length || 0;
      logInfo(reqId, 'track:sc:found', { count });

      if (!count) {
        return interaction.editReply({
          embeds: [buildEmbed(gid, { type: 'error', title: 'Introuvable', description: 'Piste SoundCloud non trouvée.' })]
        });
      }

      const track = res.tracks[0];
      if (isYouTubeUri(track?.uri)) {
        logWarn(reqId, 'guard:youtubeTrackBlocked', { uri: track.uri });
        return interaction.editReply({
          embeds: [buildEmbed(gid, { type: 'error', title: 'Résolution incorrecte', description: 'La recherche a renvoyé une source YouTube bloquée, ressaie.' })]
        });
      }

      const wasPlaying = player.playing;
      player.queue.add(track);
      if (!wasPlaying) player.play();

      logInfo(reqId, 'queue:add:sc', { title: track.title, author: track.author });
      return interaction.editReply({
        embeds: [buildEmbed(gid, { type: 'success', title: 'Ajouté à la file', description: track.title, url: track.uri || null })]
      });
    }

    // Rebond strict: URL (YT/SP/AM) → méta → SC, sinon texte utilisateur
    const scTrack = await resolveToSoundCloudTrack(client, interaction.user, query, reqId);
    if (!scTrack) {
      logWarn(reqId, 'resolve:none', { query });
      return interaction.editReply({
        embeds: [buildEmbed(gid, { type: 'error', title: 'Aucun résultat', description: 'Aucune piste SoundCloud pertinente trouvée.' })]
      });
    }

    if (isYouTubeUri(scTrack?.uri)) {
      logWarn(reqId, 'guard:youtubeTrackBlocked', { uri: scTrack.uri });
      return interaction.editReply({
        embeds: [buildEmbed(gid, { type: 'error', title: 'Résolution incorrecte', description: 'La recherche a renvoyé une source YouTube bloquée, ressaie.' })]
      });
    }

    const wasPlaying = player.playing;
    player.queue.add(scTrack);
    if (!wasPlaying) player.play();

    logInfo(reqId, 'queue:add', { title: scTrack.title, author: scTrack.author, uri: scTrack.uri });
    return interaction.editReply({
      embeds: [buildEmbed(gid, { type: 'success', title: 'Ajouté à la file', description: scTrack.title, url: scTrack.uri || null })]
    });
  }
};
