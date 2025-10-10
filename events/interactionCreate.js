module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (!interaction.isButton()) return;
    const [ns, action] = interaction.customId.split(':');
    if (ns !== 'player') return;

    const player = client.manager.players.get(interaction.guild.id);
    if (!player) return interaction.reply({ content: 'Aucun lecteur.', ephemeral: true });

    if (action === 'skip') player.skip();
    if (action === 'pause') player.pause();
    if (action === 'resume') player.resume();

    return interaction.deferUpdate();
  }
};