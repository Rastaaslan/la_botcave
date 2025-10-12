const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');

const SC_SET = /soundcloud\.com\/[^/]+\/sets\/[^/]+/i;
const SC_TRACK = /soundcloud\.com\/[^/]+\/[^/]+/i;

const YT_PLAYLIST = /(?:youtu\.be|youtube\.com).*?[?&]list=/i;
const SP_PLAYLIST_OR_ALBUM = /(?:open\.spotify\.com\/(?:playlist|album)\/|spotify:(?:playlist|album):)/i;

const YT_VIDEO = /(?:youtu\.be\/([A-Za-z0-9_-]{6,})|youtube\.com\/watch\?v=([A-Za-z0-9_-]{6,}))/i;
const SP_TRACK = /(?:open\.spotify\.com\/track\/([A-Za-z0-9]+)|spotify:track:([A-Za-z0-9]+))/i;

function isUrl(s) { try { new URL(s); return true; } catch { return false; } }

function normalize(s) {
  return (s || '').toLowerCase()
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

function deurlToText(s) {
  try {
    const u = new URL(s);
    const hostWords = (u.hostname || '').replace(/^www\./, '').split('.').join(' ');
    const pathWords = (u.pathname || '').replace(/[\/_]+/g, ' ');
    const searchWords = (u.search || '').replace(/[?&=]+/g, ' ');
    const raw = `${hostWords} ${pathWords} ${searchWords}`;
    return normalize(raw.replace(/\b(youtube|youtu|watch|v|list|feature|si|index|t)\b/gi, ''));
  } catch {
    return normalize(s.replace(/https?:\/\/\S+/g, ' '));
  }
}

function jaccard(a, b) {
  const A = new Set(normalize(a).split(' ').filter(Boolean));
  const B = new Set(normalize(b).split(' ').filter(Boolean));
  const inter = [...A].filter(x => B.has(x)).length;
  const union = A.size + B.size - inter || 1;
  return inter / union;
}

async function scSearch(client, requester, q, limit = 10) {
  const res = await client.manager.search({
    query: q,              // texte pur
    source: 'soundcloud',  // la lib formera scsearch:q
    requester
  });
  return (res?.tracks || []).slice(0, limit);
}

async function getMetaFromUrl(client, requester, url) {
  try {
    const res = await client.manager.search({ query: url, requester });
    return res?.tracks?.[0] || null;
  } catch { return null; }
}

async function resolveToSoundCloudTrack(client, requester, urlOrQuery) {
  let candidates = [];

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
      ];
      candidates.push(...combos.filter(Boolean));
    }
  }

  if (candidates.length === 0) {
    const cleaned = isUrl(urlOrQuery) ? deurlToText(urlOrQuery) : stripTitleNoise(urlOrQuery);
    if (cleaned) candidates.push(cleaned);
  }
  if (candidates.length === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const q of candidates) {
    const tracks = await scSearch(client, requester, q, 8);
    for (const t of tracks) {
      const score = 0.6 * jaccard(t.title || '', q) + 0.4 * jaccard(t.author || '', q);
      if (score > bestScore) { best = t; bestScore = score; }
    }
    if (best && bestScore >= 0.35) break;
  }

  if (!best) {
    const fallback = await scSearch(client, requester, candidates.at(-1), 1);
    best = fallback[0] || null;
  }
  return best;
}

async function addInBatches(player, tracks, batchSize = 25) {
  let added = 0;
  for (let i = 0; i < tracks.length; i += batchSize) {
    const slice = tracks.slice(i, i + batchSize);
    for (const t of slice) player.queue.add(t);
    added += slice.length;
    await new Promise(r => setTimeout(r, 120));
  }
  return added;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Lire une musique depuis une recherche ou une URL (lecture SoundCloud transparente)')
    .addStringOption(o => o.setName('query').setDescription('Recherche ou URL').setRequired(true)),

  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const member = interaction.member;
    const vc = member.voice?.channel;

    if (!vc) {
      return interaction.reply({
        embeds: [buildEmbed(gid, { type: 'error', title: 'Salon vocal requis', description: 'Rejoindre un salon vocal.' })],
        ephemeral: true
      });
    }

    const perms = vc.permissionsFor(interaction.client.user);
    if (!perms?.has(PermissionFlagsBits.Connect) || !perms?.has(PermissionFlagsBits.Speak)) {
      return interaction.reply({
        embeds: [buildEmbed(gid, { type: 'error', title: 'Permissions manquantes', description: 'Connect et Speak requis.' })],
        ephemeral: true
      });
    }

    const query = interaction.options.getString('query', true);

    let player = client.manager.players.get(gid);
    if (!player) {
      player = client.manager.createPlayer({
        guildId: gid,
        voiceChannelId: vc.id,
        textChannelId: interaction.channel.id,
        autoPlay: true,
        volume: 35
      });
    }

    if (!player.connected) {
      await player.connect({ setDeaf: true, setMute: false });
      await new Promise(r => setTimeout(r, 400));
    }

    await interaction.deferReply();

    // Refus explicite: playlists & albums YT/Spotify
    if (isUrl(query) && (YT_PLAYLIST.test(query) || SP_PLAYLIST_OR_ALBUM.test(query))) {
      return interaction.editReply({
        embeds: [buildEmbed(gid, {
          type: 'error',
          title: 'Playlist non supportée',
          description: 'Seules les playlists SoundCloud (sets) sont acceptées.'
        })]
      });
    }

    // Playlists SoundCloud (sets)
    if (isUrl(query) && SC_SET.test(query)) {
      const res = await client.manager.search({ query, requester: interaction.user });
      if (!res?.tracks?.length) {
        return interaction.editReply({ embeds: [buildEmbed(gid, { type: 'error', title: 'Aucun résultat', description: 'Aucune piste trouvée pour ce set SoundCloud.' })]});
      }

      const isPlaylist =
        (typeof res.loadType === 'string' && res.loadType.toLowerCase().includes('playlist')) ||
        (res.tracks?.length > 1 && res.playlistInfo);

      const tracks = isPlaylist ? res.tracks : [res.tracks[0]];
      const added = await addInBatches(player, tracks, 25);

      if (!player.playing) player.play();

      const title = res.playlistInfo?.name || 'Set SoundCloud';
      return interaction.editReply({ embeds: [buildEmbed(gid, {
        type: 'success',
        title: 'Playlist ajoutée',
        description: `${title} — ${added} piste(s) ajoutée(s).`,
        url: query
      })]});
    }

    // Cas restants: URL SC piste, URL YT/SP piste, recherche texte
    if (isUrl(query) && SC_TRACK.test(query)) {
      const res = await client.manager.search({ query, requester: interaction.user });
      if (!res?.tracks?.length) {
        return interaction.editReply({ embeds: [buildEmbed(gid, { type: 'error', title: 'Introuvable', description: 'Piste SoundCloud non trouvée.' })]});
      }
      const track = res.tracks[0];
      const wasPlaying = player.playing;
      player.queue.add(track);
      if (!wasPlaying) player.play();
      return interaction.editReply({ embeds: [buildEmbed(gid, { type: 'success', title: 'Ajouté à la file', description: track.title, url: track.uri || null })]});
    }

    // Rebond vers SoundCloud pour YT/SP piste & recherches texte
    const scTrack = await resolveToSoundCloudTrack(client, interaction.user, query);
    if (!scTrack) {
      return interaction.editReply({ embeds: [buildEmbed(gid, { type: 'error', title: 'Aucun résultat', description: 'Aucune piste SoundCloud pertinente trouvée.' })]});
    }

    const wasPlaying = player.playing;
    player.queue.add(scTrack);
    if (!wasPlaying) player.play();

    return interaction.editReply({ embeds: [buildEmbed(gid, { type: 'success', title: 'Ajouté à la file', description: scTrack.title, url: scTrack.uri || null })]});
  }
};
