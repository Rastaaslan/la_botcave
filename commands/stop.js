module.exports = {
  name: 'stop',
  description: 'Arrête la lecture et vide la file d\'attente',
  execute(message, args, client) {
    const player = client.manager.players.get(message.guild.id);
    
    if (!player) {
      return message.reply('❌ Rien ne joue actuellement !');
    }
    
    if (message.member.voice.channel?.id !== player.voiceChannelId) {
      return message.reply('❌ Vous devez être dans le même salon vocal que le bot !');
    }
    
    player.destroy();
    message.reply('⏹️ Lecture arrêtée et file d\'attente vidée.');
  },
};
