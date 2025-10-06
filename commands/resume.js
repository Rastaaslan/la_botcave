module.exports = {
  name: 'resume',
  description: 'Reprend la lecture',
  execute(message, args, client) {
    const player = client.manager.players.get(message.guild.id);
    
    if (!player) {
      return message.reply('❌ Rien ne joue actuellement !');
    }
    
    if (message.member.voice.channel?.id !== player.voiceChannelId) {
      return message.reply('❌ Vous devez être dans le même salon vocal que le bot !');
    }
    
    if (!player.paused) {
      return message.reply('▶️ La lecture n\'est pas en pause.');
    }
    
    player.resume();
    message.reply('▶️ Lecture reprise.');
  },
};
