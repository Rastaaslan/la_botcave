// slash/resume.js
const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');

module.exports = {
  data: new SlashCommandBuilder().setName('resume').setDescription('Reprendre la lecture'),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const player = client.manager.players.get(gid);
    if (!player) return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'Aucune musique', description: 'Rien ne joue.' })]});
    if (interaction.member.voice.channel?.id !== player.voiceChannelId) {
      return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'Salon vocal', description: 'Être dans le même salon.' })]});
    }
    if (!player.paused) return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { title: 'Déjà en lecture', description: 'La lecture n’est pas en pause.' })]});
    player.resume();
    return interaction.reply({ embeds: [buildEmbed(gid, { type: 'success', title: 'Lecture reprise', description: 'La musique continue.' })]});
  }
};
