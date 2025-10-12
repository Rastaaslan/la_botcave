// slash/play.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');

// Détections
const SC_SET = /soundcloud\.com\/[^/]+\/sets\/[^/]+/i;
const SC_TRACK = /soundcloud\.com\/[^/]+\/[^/]+/i;

const YT_PLAYLIST = /(?:youtu\.be|youtube\.com).*?[?&]list=/i;             // ❌ non supporté
const SP_PLAYLIST_OR_ALBUM = /(?:open\.spotify\.com\/(?:playlist|album)\/|spotify:(?:playlist|album):)/i; // ❌ non supporté

const YT_VIDEO = /(?:youtu\.be\/([A-Za-z0-9_-]{6,})|youtube\.com\/watch\?v=([A-Za-z0-9_-]{6,}))/i;
const SP_TRACK = /(?:open\.spotify\.com\/track\/([A-Za-z0-9]+)|spotify:track:([A-Za-z0-9]+))/i;

function isUrl(s) {
  try { new URL(s); return true; } catch { return false; }
}

// Ajout par lots (utile si un set est volumineux)
async function addInBatches(player, tracks, batchSize = 25) {
  let added = 0;
  for (let i = 0; i < tracks.length; i += batchSize) {
    const slice = tracks.slice(i, i + batchSize);
    for (const t of slice) player.queue.add(t);
    added += slice.length;
    await new Promise(r => setTimeout(r, 120)); // petit délai anti-spam
  }
  return added;
}

// Rebond: résout une URL YouTube/Spotify en métadonnées puis cherche le meilleur match SoundCloud
async function resolveToSoundCloudTrack(client, requester, urlOrQuery) {
  // 1) Si URL YT/SP de piste: on résout d'abord pour obtenir titre/auteur
  if (isUrl(urlOrQuery) && (YT_VIDEO.test(urlOrQuery) || SP_TRACK.test(urlOrQuery))) {
    try {
      const meta = await client.manager.search({ query: urlOrQuery, requester });
      const srcTrack = meta?.tracks?.[0];
      if (srcTrack) {
        const author = (srcTrack.author || '').replace(/\s*-\s*Topic$/i, '').trim();
        const title = (srcTrack.title || '').trim();
        const scQuery = `${author} ${title}`.trim();
        const sc = await client.manager.search({
          query: scQuery,
          source: 'soundcloud',
          requester
        });
        if (sc?.tracks?.length) return sc.tracks[0];
      }
    } catch { /* on poursuit le fallback */ }
  }

  // 2) Sinon, on tente directement une recherche SoundCloud avec la chaîne fournie
  const sc = await client.manager.search({
    query: urlOrQuery,
    source: 'soundcloud',
    requester
  });
  return sc?.tracks?.[0] || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Lire une musique depuis une recherche ou une URL (priorité SoundCloud)')
    .addStringOption(o => o.setName('query').setDescription('Recherche ou URL').setRequired(true)),

  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const member = interaction.member;
    const vc = member.voice?.channel;

    if (!vc) {
      return interaction.reply({
        embeds: [buildEmbed(gid, {
          type: 'error', title: 'Salon vocal requis', description: 'Rejoindre un salon vocal.'
        })],
        ephemeral: true
      });
    }

    const perms = vc.permissionsFor(interaction.client.user);
    if (!perms?.has(PermissionFlagsBits.Connect) || !perms?.has(PermissionFlagsBits.Speak)) {
      return interaction.reply({
        embeds: [buildEmbed(gid, {
          type: 'error', title: 'Permissions manquantes', description: 'Connect et Speak requis.'
        })],
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

    // ❌ Refus explicite: playlists/albums YouTube & Spotify
    if (isUrl(query) && (YT_PLAYLIST.test(query) || SP_PLAYLIST_OR_ALBUM.test(query))) {
      return interaction.editReply({
        embeds: [buildEmbed(gid, {
          type: 'error',
          title: 'Playlist non supportée',
          description: 'Seules les playlists SoundCloud (sets) sont acceptées.'
        })]
      });
    }

    // ✅ Playlists SoundCloud (sets) supportées
    if (isUrl(query) && SC_SET.test(query)) {
      const res = await client.manager.search({ query, requester: interaction.user });
      if (!res?.tracks?.length) {
        return interaction.editReply({ embeds: [buildEmbed(gid, {
          type: 'error', title: 'Aucun résultat', description: 'Aucune piste trouvée pour ce set SoundCloud.'
        })]});
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

    // 🎯 Rebond systématique vers SoundCloud
    // - URL YouTube/Spotify de piste → on résout méta puis on cherche sur SoundCloud
    // - URL SoundCloud de piste → on joue directement
    // - Recherches texte → SoundCloud
    if (isUrl(query) && SC_TRACK.test(query)) {
      // URL piste SoundCloud: direct
      const res = await client.manager.search({ query, requester: interaction.user });
      if (!res?.tracks?.length) {
        return interaction.editReply({ embeds: [buildEmbed(gid, {
          type: 'error', title: 'Introuvable', description: 'Piste SoundCloud non trouvée.'
        })]});
      }
      const track = res.tracks[0];
      const wasPlaying = player.playing;
      player.queue.add(track);
      if (!wasPlaying) player.play();
      return interaction.editReply({ embeds: [buildEmbed(gid, {
        type: 'success', title: 'Ajouté à la file', description: track.title, url: track.uri || null
      })]});
    }

    // URL YT/SP de piste ou recherche générique → résolution SoundCloud
    const scTrack = await resolveToSoundCloudTrack(client, interaction.user, query);
    if (!scTrack) {
      return interaction.editReply({ embeds: [buildEmbed(gid, {
        type: 'error', title: 'Aucun résultat', description: 'Aucune piste SoundCloud pertinente trouvée.'
      })]});
    }

    const wasPlaying = player.playing;
    player.queue.add(scTrack);
    if (!wasPlaying) player.play();

    return interaction.editReply({ embeds: [buildEmbed(gid, {
      type: 'success', title: 'Ajouté à la file', description: scTrack.title, url: scTrack.uri || null
    })]});
  }
};
