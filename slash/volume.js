// slash/volume.js
const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Afficher ou régler le volume')
    .addIntegerOption(o =>
      o.setName('niveau').setDescription('0 à 200').setMinValue(0).setMaxValue(200).setRequired(false)
    ),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const player = client.manager.players.get(gid);
    if (!player || !player.connected) {
      return interaction.reply({ embeds: [buildEmbed(gid, { type: 'error', title: 'Aucune musique', description: 'Aucune musique en cours.' })], ephemeral: true });
    }
    const val = interaction.options.getInteger('niveau');
    if (val == null) {
      return interaction.reply({ embeds: [buildEmbed(gid, { title: 'Volume actuel', description: `🔊 ${player.volume}%` })]});
    }
    player.setVolume(val);
    return interaction.reply({ embeds: [buildEmbed(gid, { type: 'success', title: 'Volume réglé', description: `Nouveau volume: ${val}%` })]});
  }
};
