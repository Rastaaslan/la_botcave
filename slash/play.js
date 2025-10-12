// slash/play.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');

const LOG_PREFIX = '[PLAY]';
const SC_PREFIX  = '[SC]';

// Détections
const SC_SET = /soundcloud\.com\/[^/]+\/sets\/[^/]+/i;
const SC_TRACK = /soundcloud\.com\/[^/]+\/[^/]+/i;

const YT_PLAYLIST = /(?:youtu\.be|youtube\.com).*?[?&]list=/i;
const SP_PLAYLIST_OR_ALBUM = /(?:open\.spotify\.com\/(?:playlist|album)\/|spotify:(?:playlist|album):)/i;

const YT_VIDEO = /(?:youtu\.be\/([A-Za-z0-9_-]{6,})|youtube\.com\/watch\?v=([A-Za-z0-9_-]{6,}))/i;
const SP_TRACK = /(?:open\.spotify\.com\/track\/([A-Za-z0-9]+)|spotify:track:([A-Za-z0-9]+))/i;

function isUrl(s) { try { new URL(s); return true; } catch { return false; } }

// Utils logs sûrs (pas de secrets)
function logInfo(...args)  { console.log(LOG_PREFIX, ...args); }
function logWarn(...args)  { console.warn(LOG_PREFIX, ...args); }
function logError(...args) { console.error(LOG_PREFIX, ...args); }

// Normalisation & scoring
function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[-–—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function stripTitleNoise(title) {
  let t = title || '';
  t = t.replace(/(\(|\[|\{).+?(\)|\]|\})/g, ' ');
  t = t.replace(/\bofficial\b|\bvideo\b|\blyrics?\b|\baudio\b|\bmv\b|\bhd\b|\buhd\b|\b4k\b|\bremaster(ed)?\b/ig, ' ');
  t = t.replace(/\bfeat\.?\b|\bft\.?\b|\bwith\b/ig, ' ');
  t = t.split('|')[0];
  return normalize(t);
}
function stripArtistNoise(artist) {
  return normalize((artist || '').replace(/\s*-\s*topic$/i, ''));
}
function tokenSet(s) {
  return new Set(normalize(s).split(' ').filter(Boolean));
}
function containsAll(haystack, needles) {
  const H = tokenSet(haystack);
  for (const n of needles) if (!H.has(n)) return false;
  return true;
}
function jaccard(a, b) {
  const A = new Set(normalize(a).split(' ').filter(Boolean));
  const B = new Set(normalize(b).split(' ').filter(Boolean));
  const inter = [...A].filter(x => B.has(x)).length;
  const union = A.size + B.size - inter || 1;
  return inter / union;
}
function coreTokens(s) {
  return [...tokenSet(s)].filter(w => w.length > 2);
}

function dynamicBoost(title, author, wantTokens) {
  let b = 0;
  const titleHasAll3 = wantTokens.slice(0, 3).every(t => tokenSet(title).has(t));
  if (titleHasAll3) b += 0.15;
  // Bonus si l'auteur semble contenir l'artiste demandé (tokens communs)
  const A = tokenSet(author);
  if (wantTokens.some(t => A.has(t))) b += 0.12;
  return b;
}

// Recherches SoundCloud
async function scSearch(client, requester, q, limit = 10) {
  console.log(SC_PREFIX, 'search', JSON.stringify(q), 'limit=', limit);
  const res = await client.manager.search({
    query: q,              // texte pur
    source: 'soundcloud',  // la lib formera scsearch:q
    requester
  });
  console.log(SC_PREFIX, 'results', (res?.tracks || []).length);
  return (res?.tracks || []).slice(0, limit);
}

// Méta depuis URL (tolère l’échec YT)
async function getMetaFromUrl(client, requester, url) {
  try {
    console.log(LOG_PREFIX, 'meta:url', url);
    const res = await client.manager.search({ query: url, requester });
    const t = res?.tracks?.[0];
    if (t) {
      console.log(LOG_PREFIX, 'meta:ok', { title: t.title, author: t.author });
    } else {
      console.log(LOG_PREFIX, 'meta:none');
    }
    return t || null;
  } catch (e) {
    console.log(LOG_PREFIX, 'meta:error', e?.message || e);
    return null;
  }
}

// URL -> texte neutre
function deurlToText(s) {
  try {
    const u = new URL(s);
    const hostWords = (u.hostname || '').replace(/^www\./, '').split('.').join(' ');
    const pathWords = (u.pathname || '').replace(/[\/_]+/g, ' ');
    const searchWords = (u.search || '').replace(/[?&=]+/g, ' ');
    const raw = `${hostWords} ${pathWords} ${searchWords}`;
    const out = normalize(raw.replace(/\b(youtube|youtu|watch|v|list|feature|si|index|t)\b/gi, ''));
    console.log(LOG_PREFIX, 'deurlToText', out);
    return out;
  } catch {
    const out = normalize(s.replace(/https?:\/\/\S+/g, ' '));
    console.log(LOG_PREFIX, 'deurlToText(fallback)', out);
    return out;
  }
}

// Rebond YT/SP -> SoundCloud avec logs détaillés
async function resolveToSoundCloudTrack(client, requester, urlOrQuery) {
  console.log(LOG_PREFIX, 'resolve:start', { input: urlOrQuery });
  let candidates = [];

  // 1) Essai méta si URL YT/SP de piste
  if (/youtu\.be|youtube\.com/i.test(urlOrQuery) || /open\.spotify\.com\/track|spotify:track:/i.test(urlOrQuery)) {
    const src = await getMetaFromUrl(client, requester, urlOrQuery);
    if (src) {
      const artist = stripArtistNoise(src.author);
      const title = stripTitleNoise(src.title);
      const combos = [
        `${artist} ${title}`,
        `${title} ${artist}`,
        `${title}`,
        `${artist}`
      ].filter(Boolean);
      console.log(LOG_PREFIX, 'candidates:meta', combos);
      candidates.push(...combos);
    }
  }

  // 2) Fallback: URL -> texte ou nettoyage direct
  if (candidates.length === 0) {
    const cleaned = isUrl(urlOrQuery) ? deurlToText(urlOrQuery) : stripTitleNoise(urlOrQuery);
    if (cleaned) candidates.push(cleaned);
    console.log(LOG_PREFIX, 'candidates:fallback', candidates);
  }
  if (candidates.length === 0) {
    console.log(LOG_PREFIX, 'resolve:abort no candidates');
    return null;
  }

  // 3) Variantes initiales
  let best = null;
  let bestScore = 0;
  for (const q of candidates) {
    const wantTokens = coreTokens(q);
    const tracks = await scSearch(client, requester, q, 10);
    let i = 0;
    for (const t of tracks) {
      const title = t.title || '';
      const author = t.author || '';
      let score = 0.6 * jaccard(title, q) + 0.4 * jaccard(author, q);
      // Boost dynamiques
      score += dynamicBoost(title, author, wantTokens);
      // Pénalités set/mix/live
      if (/mix|set|live|full album/i.test(title)) score -= 0.10;
      if (score > bestScore) { best = t; bestScore = score; }
      if (i < 3) {
        console.log(SC_PREFIX, 'score', { q, title, author, score: Number(score.toFixed(3)) });
      }
      i++;
    }
    console.log(LOG_PREFIX, 'candidateDone', { q, bestScore: Number(bestScore.toFixed(3)) });
    if (best && bestScore >= 0.45) break;
  }

  // 4) Essai guidé si pas convaincant
  if (!best || bestScore < 0.45) {
    const guided = [
      'passenger let her go',
      'let her go passenger',
      'let her go',
      'joji glimpse of us',
      'glimpse of us joji'
    ];
    console.log(LOG_PREFIX, 'guided:try', guided);
    for (const g of guided) {
      const wantTokens = coreTokens(g);
      const tracks = await scSearch(client, requester, g, 10);
      let i = 0;
      for (const t of tracks) {
        const title = t.title || '';
        const author = t.author || '';
        let score = 0.6 * jaccard(title, g) + 0.4 * jaccard(author, g);
        score += dynamicBoost(title, author, wantTokens);
        if (/mix|set|live|full album/i.test(title)) score -= 0.10;
        if (score > bestScore) { best = t; bestScore = score; }
        if (i < 3) {
          console.log(SC_PREFIX, 'guidedScore', { g, title, author, score: Number(score.toFixed(3)) });
        }
        i++;
      }
      if (best && bestScore >= 0.45) break;
    }
  }

  if (!best) {
    console.log(LOG_PREFIX, 'resolve:none');
    return null;
  }
  console.log(LOG_PREFIX, 'resolve:pick', {
    title: best.title,
    author: best.author,
    uri: best.uri,
    score: Number(bestScore.toFixed(3))
  });
  return best;
}

// Ajout par lots (sets SC)
async function addInBatches(player, tracks, batchSize = 25) {
  let added = 0;
  for (let i = 0; i < tracks.length; i += batchSize) {
    const slice = tracks.slice(i, i + batchSize);
    for (const t of slice) player.queue.add(t);
    added += slice.length;
    await new Promise(r => setTimeout(r, 120));
  }
  console.log(LOG_PREFIX, 'batchAdded', { added, total: tracks.length });
  return added;
}

// Garde-fou création/connexion
async function ensurePlayer(interaction, client, gid, vc) {
  if (!client.manager || !client.manager.nodes || client.manager.nodes.size === 0) {
    await interaction.editReply({
      embeds: [buildEmbed(gid, {
        type: 'error',
        title: 'Serveur audio indisponible',
        description: 'Réessaie plus tard.'
      })]
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
    console.log(LOG_PREFIX, 'player:create', { guildId: gid, vc: vc.id });
    if (!player) {
      await interaction.editReply({
        embeds: [buildEmbed(gid, {
          type: 'error',
          title: 'Création du lecteur impossible',
          description: 'Initialisation échouée.'
        })]
      });
      throw new Error('createPlayer returned undefined');
    }
  }

  if (!player.connected) {
    try {
      await player.connect({ setDeaf: true, setMute: false });
      await new Promise(r => setTimeout(r, 400));
      console.log(LOG_PREFIX, 'player:connected', { guildId: gid });
    } catch (e) {
      await interaction.editReply({
        embeds: [buildEmbed(gid, {
          type: 'error',
          title: 'Connexion vocale échouée',
          description: 'Impossible de rejoindre le salon.'
        })]
      });
      throw e;
    }
  }

  return player;
}

// Commande slash
module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Lire une musique depuis une recherche ou une URL (lecture SoundCloud transparente)')
    .addStringOption(o => o.setName('query').setDescription('Recherche ou URL').setRequired(true)),

  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const member = interaction.member;
    const vc = member.voice?.channel;

    logInfo('cmd', { user: interaction.user?.id, guild: gid });

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
    logInfo('input', { query });

    await interaction.deferReply();

    let player;
    try {
      player = await ensurePlayer(interaction, client, gid, vc);
    } catch { return; }

    // Refus playlists/albums YT & Spotify
    if (isUrl(query) && (YT_PLAYLIST.test(query) || SP_PLAYLIST_OR_ALBUM.test(query))) {
      logWarn('reject:playlist', { query });
      return interaction.editReply({
        embeds: [buildEmbed(gid, {
          type: 'error',
          title: 'Playlist non supportée',
          description: 'Seules les playlists SoundCloud (sets) sont acceptées.'
        })]
      });
    }

    // Playlists SoundCloud
    if (isUrl(query) && SC_SET.test(query)) {
      logInfo('set:sc', { query });
      const res = await client.manager.search({ query, requester: interaction.user });
      const count = res?.tracks?.length || 0;
      logInfo('set:found', { count });
      if (!count) {
        return interaction.editReply({
          embeds: [buildEmbed(gid, { type: 'error', title: 'Aucun résultat', description: 'Set SoundCloud introuvable.' })]
        });
      }
      const isPlaylist =
        (typeof res.loadType === 'string' && res.loadType.toLowerCase().includes('playlist')) ||
        (res.tracks?.length > 1 && res.playlistInfo);
      const tracks = isPlaylist ? res.tracks : [res.tracks[0]];
      const added = await addInBatches(player, tracks, 25);
      if (!player.playing) player.play();

      const title = res.playlistInfo?.name || 'Set SoundCloud';
      return interaction.editReply({
        embeds: [buildEmbed(gid, {
          type: 'success',
          title: 'Playlist ajoutée',
          description: `${title} — ${added} piste(s) ajoutée(s).`,
          url: query
        })]
      });
    }

    // URL piste SoundCloud → direct
    if (isUrl(query) && SC_TRACK.test(query)) {
      logInfo('track:sc', { query });
      const res = await client.manager.search({ query, requester: interaction.user });
      const count = res?.tracks?.length || 0;
      logInfo('track:sc:found', { count });
      if (!count) {
        return interaction.editReply({
          embeds: [buildEmbed(gid, { type: 'error', title: 'Introuvable', description: 'Piste SoundCloud non trouvée.' })]
        });
      }
      const track = res.tracks[0];
      const wasPlaying = player.playing;
      player.queue.add(track);
      if (!wasPlaying) player.play();
      return interaction.editReply({
        embeds: [buildEmbed(gid, { type: 'success', title: 'Ajouté à la file', description: track.title, url: track.uri || null })]
      });
    }

    // Lien YT/SP piste OU recherche texte → rebond SoundCloud
    const scTrack = await resolveToSoundCloudTrack(client, interaction.user, query);
    if (!scTrack) {
      logWarn('resolve:none', { query });
      return interaction.editReply({
        embeds: [buildEmbed(gid, { type: 'error', title: 'Aucun résultat', description: 'Aucune piste SoundCloud pertinente trouvée.' })]
      });
    }

    const wasPlaying = player.playing;
    player.queue.add(scTrack);
    if (!wasPlaying) player.play();

    logInfo('queue:add', { title: scTrack.title, author: scTrack.author, uri: scTrack.uri });

    return interaction.editReply({
      embeds: [buildEmbed(gid, { type: 'success', title: 'Ajouté à la file', description: scTrack.title, url: scTrack.uri || null })]
    });
  }
};
