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
const AM_PLAYLIST_OR_ALBUM = /(?:music\.apple\.com\/[^/]+\/(?:playlist|album)\/)/i;

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
  // Support: /album/NAME/ID?i=TRACKID, /fr/album/NAME/ID?i=TRACKID
  return /https?:\/\/music\.apple\.com\/(?:[a-z]{2}\/)?album\/[^\/]+\/\d+\?i=\d+/i.test(s);
}

/* =========================
   Logging helpers
   ========================= */
const logInfo = (id, tag, payload) => console.log(LOG_PREFIX, id, tag, payload || '');
const logWarn = (id, tag, payload) => console.warn(LOG_PREFIX, id, tag, payload || '');

/* =========================
   Normalisation & scoring
   ========================= */

function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeSimilarity(a, b) {
  if (!a || !b) return 0;
  const na = normalizeString(a);
  const nb = normalizeString(b);
  const wa = na.split(/\s+/);
  const wb = nb.split(/\s+/);
  const common = wa.filter(w => wb.includes(w)).length;
  const total = Math.max(wa.length, wb.length);
  return total > 0 ? common / total : 0;
}

function scoreCandidate(meta, candidate) {
  let score = 0;
  if (meta.title && candidate.title) {
    const titleSim = computeSimilarity(meta.title, candidate.title);
    score += titleSim * 0.6;
  }
  if (meta.author && candidate.author) {
    const authorSim = computeSimilarity(meta.author, candidate.author);
    score += authorSim * 0.4;
  }
  return score;
}

/* =========================
   Récupération méta (OEmbed / OG)
   ========================= */

async function fetchYouTubeOEmbed(url, reqId) {
  logInfo(reqId, 'meta:oembedYT:start', { url });
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  try {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const meta = {
      title: json.title?.trim() || null,
      author: json.author_name?.trim() || null,
      uri: url
    };
    logInfo(reqId, 'meta:oembedYT:found', meta);
    return meta;
  }
  catch (err) {
    logWarn(reqId, 'meta:oembedYT:error', err?.message || String(err));
    return null;
  }
}

async function fetchSpotifyOG(url, reqId) {
  logInfo(reqId, 'meta:ogSP:start', { url });
  try {
    const res = await fetch(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    if (!titleMatch) return null;
    let author = 'Unknown Artist';
    if (descMatch) {
      const parts = descMatch[1].split('·');
      if (parts.length > 1) author = parts[0].trim();
    }
    const meta = { title: titleMatch[1].trim(), author, uri: url };
    logInfo(reqId, 'meta:ogSP:found', meta);
    return meta;
  }
  catch (err) {
    logWarn(reqId, 'meta:ogSP:error', err?.message || String(err));
    return null;
  }
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
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    const artistMatch = html.match(/<meta\s+property="music:musician"\s+content="([^"]+)"/i)
      || html.match(/<meta\s+name="apple:content_artist"\s+content="([^"]+)"/i);
    if (!titleMatch) return null;
    const meta = {
      title: titleMatch[1].trim(),
      author: artistMatch ? artistMatch[1].trim() : 'Unknown Artist',
      uri: url
    };
    logInfo(reqId, 'meta:ogAM:found', meta);
    return meta;
  }
  catch (err) {
    logWarn(reqId, 'meta:ogAM:error', err?.message || String(err));
    return null;
  }
}

let metaCache = {};
async function getMetaOnce(url, reqId) {
  if (metaCache[url]) {
    logInfo(reqId, 'meta:cached', { url });
    return metaCache[url];
  }
  if (isYouTubeUrl(url)) {
    try { const meta = await fetchYouTubeOEmbed(url, reqId); if (meta && (meta.title || meta.author)) { logInfo(reqId, 'meta:oembedYT', meta); return meta; } }
    catch (e) { logWarn(reqId, 'meta:oembedYT:error', e?.message || String(e)); }
  }
  if (isSpotifyTrackUrl(url)) {
    try { const meta = await fetchSpotifyOG(url, reqId); if (meta && (meta.title || meta.author)) { logInfo(reqId, 'meta:ogSP', meta); return meta; } }
    catch (e) { logWarn(reqId, 'meta:ogSP:error', e?.message || String(e)); }
  }
  if (isAppleMusicTrackUrl(url)) {
    try { 
      const meta = await fetchAppleMusicOG(url, reqId); 
      if (meta && (meta.title || meta.author)) { 
        logInfo(reqId, 'meta:ogAM', meta); 
        metaCache[url] = meta;
        return meta; 
      } 
    }
    catch (e) { 
      logWarn(reqId, 'meta:ogAM:error', e?.message || String(e)); 
    }
  }
  logWarn(reqId, 'meta:none');
  return null;
}

/* =========================
   Résolution stricte: URL -> méta -> SC (sinon texte)
   ========================= */
async function resolveToSoundCloudTrack(client, requester, urlOrQuery, reqId) {
  logInfo(reqId, 'resolve:start', { input: urlOrQuery });
  logInfo(reqId, 'detect', { isURL: isUrl(urlOrQuery), isYT: isYouTubeUrl(urlOrQuery), isSP: isSpotifyTrackUrl(urlOrQuery), isAM: isAppleMusicTrackUrl(urlOrQuery) });

  const candidates = [];
  let best = null;
  let bestScore = 0;

  if (isUrl(urlOrQuery)) {
    if (isYouTubeUrl(urlOrQuery) || isSpotifyTrackUrl(urlOrQuery) || isAppleMusicTrackUrl(urlOrQuery)) {
      const meta = await getMetaOnce(urlOrQuery, reqId);
      if (meta && (meta.title || meta.author)) {
        const source = isYouTubeUrl(urlOrQuery) ? 'youtube-oembed' : 
                       isSpotifyTrackUrl(urlOrQuery) ? 'spotify-og' : 'apple-music-og';
        candidates.push({ ...meta, source });
      }
      else {
        logWarn(reqId, 'url:notSupported');
        return null;
      }
    }
    else {
      logWarn(reqId, 'url:notSupported');
      logInfo(reqId, 'resolve:none', { query: urlOrQuery });
      return null;
    }
  }
  else {
    candidates.push({ query: urlOrQuery, source: 'text-query' });
  }

  for (const cand of candidates) {
    let searchQuery;
    if (cand.source === 'text-query') {
      searchQuery = cand.query;
    }
    else {
      const parts = [];
      if (cand.author) parts.push(cand.author);
      if (cand.title) parts.push(cand.title);
      searchQuery = parts.join(' ');
    }

    if (!searchQuery || searchQuery.trim().length === 0) {
      logWarn(reqId, 'sc:emptyQuery', cand);
      continue;
    }

    logInfo(reqId, 'sc:search', { query: searchQuery, source: cand.source });
    let res;
    try {
      res = await client.node.rest.loadTracks(`scsearch:${searchQuery}`);
    }
    catch (err) {
      logWarn(reqId, 'sc:searchError', err?.message || String(err));
      continue;
    }

    if (res?.data && Array.isArray(res.data) && res.data.length > 0) {
      logInfo(reqId, 'track:sc:found', { count: res.data.length });
      for (const t of res.data) {
        const score = cand.source === 'text-query' ? 1 : scoreCandidate(cand, { title: t.info.title, author: t.info.author });
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }
    }
    else {
      logInfo(reqId, 'track:sc:none', { query: searchQuery });
    }
  }

  if (!best) {
    logInfo(reqId, 'resolve:none', { query: urlOrQuery });
    return null;
  }

  logInfo(reqId, 'resolve:ok', { title: best.info.title, author: best.info.author, score: bestScore });
  return best;
}

/* =========================
   Commande /play
   ========================= */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Joue un morceau depuis YouTube, Spotify, Apple Music ou SoundCloud')
    .addStringOption(opt =>
      opt.setName('query')
        .setDescription('Lien ou texte à rechercher')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Connect),

  async execute(interaction, client) {
    const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    logInfo(reqId, 'cmd:start', { user: interaction.user.id, guild: interaction.guild.id });

    const query = interaction.options.getString('query');
    logInfo(reqId, 'input', { query });

    const member = interaction.guild.members.cache.get(interaction.user.id);
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      const embed = buildEmbed('error', { description: 'Tu dois être dans un salon vocal.' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    await interaction.deferReply();

    let player = client.manager.players.get(interaction.guild.id);
    if (!player) {
      logInfo(reqId, 'player:create', { guildId: interaction.guild.id, vc: voiceChannel.id });
      player = client.manager.create({
        guild: interaction.guild.id,
        voiceChannel: voiceChannel.id,
        textChannel: interaction.channel.id,
        selfDeafen: true,
      });
      player.connect();
      logInfo(reqId, 'player:connected', { guildId: interaction.guild.id });
    }

    const track = await resolveToSoundCloudTrack(client, interaction.user, query, reqId);
    if (!track) {
      const embed = buildEmbed('error', { description: 'Impossible de trouver ce morceau.' });
      return interaction.editReply({ embeds: [embed] });
    }

    player.queue.add(track);
    logInfo(reqId, 'queue:add:sc', { title: track.info.title, author: track.info.author });

    if (!player.playing && !player.paused) {
      player.play();
      logInfo(reqId, 'player:play');
    }

    const embed = buildEmbed('queue', {
      title: track.info.title,
      author: track.info.author,
      position: player.queue.size
    });
    return interaction.editReply({ embeds: [embed] });
  }
};
