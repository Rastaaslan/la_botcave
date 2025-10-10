// slash/unmute.js
const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');

module.exports = {
  data: new SlashCommandBuilder().setName('unmute').setDescription('Rétablir le son du bot à 100%'),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const player = client.manager.players.get(gid);
    if (!player || !player.connected) return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'Aucune musique', description: 'Aucune musique en cours.' })]});
    if (interaction.member.voice.channel?.id !== player.voiceChannelId) return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'Salon vocal', description: 'Être dans le même salon.' })]});
    player.setVolume(100);
    return interaction.reply({ embeds: [buildEmbed(gid, { type: 'success', title: 'Volume rétabli', description: '🔊 Volume à 100%.' })]});
  }
};
