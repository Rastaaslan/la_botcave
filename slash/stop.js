// slash/stop.js
const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');

module.exports = {
  data: new SlashCommandBuilder().setName('stop').setDescription('Arrêter la lecture et vider la file'),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const player = client.manager.players.get(gid);
    if (!player) return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'Aucune musique', description: 'Rien ne joue.' })]});
    if (interaction.member.voice.channel?.id !== player.voiceChannelId) {
      return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'Salon vocal', description: 'Être dans le même salon.' })]});
    }
    player.destroy();
    return interaction.reply({ embeds: [buildEmbed(gid, { type: 'success', title: 'Arrêt', description: 'Lecture arrêtée et file vidée.' })]});
  }
};
