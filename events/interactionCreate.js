// events/interactionCreate.js
const { buildEmbed } = require('../utils/embedHelper');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (!interaction.isChatInputCommand()) return;

    const command = client.slashCommands.get(interaction.commandName);
    if (!command) {
      return interaction.reply({ ephemeral: true, embeds: [buildEmbed(interaction.guild.id, {
        type: 'error',
        title: 'Commande introuvable',
        description: 'Cette commande n’est pas enregistrée.',
      })]});
    }

    try {
      await command.execute(interaction, client);
    } catch (e) {
      console.error(e);
      const gid = interaction.guild?.id || null;
      const payload = gid ? { embeds: [buildEmbed(gid, {
        type: 'error', title: 'Erreur', description: 'Une erreur est survenue.'
      })] } : { content: 'Erreur.' };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ ...payload, ephemeral: true });
      } else {
        await interaction.reply({ ...payload, ephemeral: true });
      }
    }
  }
};
