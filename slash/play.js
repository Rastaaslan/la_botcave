// slash/play.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Lire une musique depuis une recherche ou une URL')
    .addStringOption(o =>
      o.setName('query').setDescription('Recherche ou URL').setRequired(true)
    ),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const member = interaction.member;
    const vc = member.voice?.channel;
    if (!vc) {
      return interaction.reply({ embeds: [buildEmbed(gid, {
        type: 'error', title: 'Salon vocal requis', description: 'Rejoindre un salon vocal.'
      })], ephemeral: true });
    }
    const perms = vc.permissionsFor(interaction.client.user);
    if (!perms?.has(PermissionFlagsBits.Connect) || !perms?.has(PermissionFlagsBits.Speak)) {
      return interaction.reply({ embeds: [buildEmbed(gid, {
        type: 'error', title: 'Permissions manquantes', description: 'Connect et Speak requis.'
      })], ephemeral: true });
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
