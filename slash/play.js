// slash/play.js

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');

const YT_PLAYLIST = /(?:youtu\.be\/|youtube\.com\/)(?:playlist|watch).*?[?&]list=([a-zA-Z0-9_-]+)/i;
const SC_SET = /soundcloud\.com\/[^/]+\/sets\/[^/]+/i;
const SP_PLAYLIST = /(?:open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)|spotify:playlist:([a-zA-Z0-9]+))/i;

function isUrl(s) {
  try { new URL(s); return true; } catch { return false; }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Lire une musique depuis une recherche ou une URL')
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
      await player.connect();
      await new Promise(r => setTimeout(r, 500));
    }

    await interaction.deferReply();

    // Cas 1: URL de playlist YouTube ou set SoundCloud -> charge via Lavalink
    if (isUrl(query) && (YT_PLAYLIST.test(query) || SC_SET.test(query))) {
      const res = await client.manager.search({ query, requester: interaction.user });
      if (!res?.tracks?.length) {
        return interaction.editReply({ embeds: [buildEmbed(gid, {
          type: 'error', title: 'Aucun résultat', description: 'Aucune piste trouvée pour cette playlist.'
        })]});
      }

      // Variations de loadType selon la lib: 'PLAYLIST_LOADED' ou 'playlist', etc.
      const isPlaylist =
        (typeof res.loadType === 'string' && res.loadType.toLowerCase().includes('playlist')) ||
        (res.tracks?.length > 1 && res.playlistInfo);

      if (isPlaylist) {
        player.queue.add(res.tracks);
        if (!player.playing) player.play();
        const title = res.playlistInfo?.name || 'Playlist';
        return interaction.editReply({ embeds: [buildEmbed(gid, {
          type: 'success',
          title: 'Playlist ajoutée',
          description: `${title} — ${res.tracks.length} piste(s) ajoutée(s).`,
          url: query
        })]});
      } else {
        // Au cas où le lien renvoie une seule piste
        const track = res.tracks[0];
        const wasPlaying = player.playing;
        player.queue.add(track);
        if (!wasPlaying) player.play();
        return interaction.editReply({ embeds: [buildEmbed(gid, {
          type: 'success', title: 'Ajouté à la file', description: track.title, url: track.uri || null
        })]});
      }
    }

    // Cas 2: URL de playlist Spotify
    if (isUrl(query) && SP_PLAYLIST.test(query)) {
      // Option A: plugin Spotify actif côté Lavalink -> passer l’URL directement
      const tryDirect = true; // mettre à false si aucun plugin Spotify
      if (tryDirect) {
        const res = await client.manager.search({ query, requester: interaction.user });
        if (res?.tracks?.length) {
          const isPlaylist =
            (typeof res.loadType === 'string' && res.loadType.toLowerCase().includes('playlist')) ||
            (res.tracks?.length > 1 && res.playlistInfo);
          if (isPlaylist) {
            player.queue.add(res.tracks);
            if (!player.playing) player.play();
            const title = res.playlistInfo?.name || 'Playlist Spotify';
            return interaction.editReply({ embeds: [buildEmbed(gid, {
              type: 'success',
              title: 'Playlist ajoutée',
              description: `${title} — ${res.tracks.length} piste(s) ajoutée(s).`,
              url: query
            })]});
          }
        }
        // sinon, fallback
      }

      // Option B: Fallback API Spotify -> recherches YouTube/SoundCloud
      // Requiert SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET en env et Node 18+ (fetch global)
      try {
        const playlistId = (SP_PLAYLIST.exec(query)[1] || SP_PLAYLIST.exec(query)[2]);
        // Token app-only
        const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: process.env.SPOTIFY_CLIENT_ID,
            client_secret: process.env.SPOTIFY_CLIENT_SECRET
          })
        }).then(r => r.json());
        if (!tokenRes?.access_token) throw new Error('Token Spotify invalide');

        const token = tokenRes.access_token;
        let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;
        const tracksMeta = [];
        while (url) {
          const page = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` }
          }).then(r => r.json());
          for (const item of page.items || []) {
            const t = item.track;
            if (!t || t.is_local) continue;
            const name = t.name;
            const artist = t.artists?.[0]?.name || '';
            const extra = t.album?.name ? ` ${t.album.name}` : '';
            tracksMeta.push(`${artist} - ${name}${extra}`);
          }
          url = page.next;
        }

        let added = 0;
        let failed = 0;
        for (const q of tracksMeta) {
          try {
            // Choisir la source de recherche selon vos préférences
            const res = await client.manager.search({
              query: q,
              source: 'youtube', // ou 'soundcloud'
              requester: interaction.user
            });
            if (res?.tracks?.length) {
              player.queue.add(res.tracks[0]);
              added++;
            } else {
              failed++;
            }
          } catch {
            failed++;
          }
        }
        if (!player.playing && player.queue.size > 0) player.play();

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'success',
            title: 'Playlist Spotify ajoutée',
            description: `${added} piste(s) ajoutée(s) — ${failed} non résolue(s).`,
            url: null
          })]
        });
      } catch (e) {
        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: 'Spotify indisponible',
            description: 'Impossible de résoudre la playlist Spotify.'
          })]
        });
      }
    }

    // Cas 3: comportement actuel (recherche simple / URL piste)
    const res = await client.manager.search({ query, source: 'soundcloud', requester: interaction.user });
    if (!res?.tracks?.length || res.loadType === 'empty') {
      return interaction.editReply({ embeds: [buildEmbed(gid, {
        type: 'error', title: 'Aucun résultat', description: 'Aucune piste trouvée.'
      })]});
    }
    if (res.loadType === 'error') {
      return interaction.editReply({ embeds: [buildEmbed(gid, {
        type: 'error', title: 'Erreur de recherche', description: 'Recherche impossible.'
      })]});
    }

    const wasPlaying = player.playing;
    const track = res.tracks[0];
    player.queue.add(track);
    if (!wasPlaying) player.play();
    return interaction.editReply({ embeds: [buildEmbed(gid, {
      type: 'success', title: 'Ajouté à la file', description: track.title, url: track.uri || null
    })]});
  }
};
