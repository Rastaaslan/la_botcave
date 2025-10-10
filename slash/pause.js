// slash/pause.js
const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');

module.exports = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Mettre en pause la lecture'),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const player = client.manager.players.get(gid);
    if (!player) return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'Aucune musique', description: 'Rien ne joue.' })]});
    if (interaction.member.voice.channel?.id !== player.voiceChannelId) {
      return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'Salon vocal', description: 'Être dans le même salon.' })]});
    }
    if (player.paused) return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { title: 'Déjà en pause', description: 'La lecture est déjà en pause.' })]});
    player.pause();
    return interaction.reply({ embeds: [buildEmbed(gid, { type: 'success', title: 'Pause', description: 'Lecture en pause.' })]});
  }
};
