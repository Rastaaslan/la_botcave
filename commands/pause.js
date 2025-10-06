module.exports = {
  name: 'pause',
  description: 'Met la lecture en pause',
  execute(message, args, client) {
    const player = client.manager.players.get(message.guild.id);
    
    if (!player) {
      return message.reply('❌ Rien ne joue actuellement !');
    }
    
    if (message.member.voice.channel?.id !== player.voiceChannelId) {
      return message.reply('❌ Vous devez être dans le même salon vocal que le bot !');
    }
    
    if (player.paused) {
      return message.reply('⏸️ La lecture est déjà en pause.');
    }
    
    player.pause();
    message.reply('⏸️ Lecture mise en pause.');
  },
};
