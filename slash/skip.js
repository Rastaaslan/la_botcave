// slash/skip.js
const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');

module.exports = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Passer à la piste suivante'),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const player = client.manager.players.get(gid);
    if (!player) return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'Aucune musique', description: 'Rien ne joue.' })]});
    if (interaction.member.voice.channel?.id !== player.voiceChannelId) {
      return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'Salon vocal', description: 'Être dans le même salon.' })]});
    }
    if (!player.queue.size && !player.current) {
      return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'File vide', description: 'Aucune piste à passer.' })]});
    }
    const title = player.current?.title || 'Piste';
    player.skip();
    return interaction.reply({ embeds: [buildEmbed(gid, { type: 'success', title: 'Piste passée', description: `⏭️ ${title}` })]});
  }
};
