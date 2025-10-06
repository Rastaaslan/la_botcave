module.exports = {
  name: 'skip',
  description: 'Passe à la piste suivante',
  execute(message, args, client) {
    const player = client.manager.players.get(message.guild.id);
    
    if (!player) {
      return message.reply('❌ Rien ne joue actuellement !');
    }
    
    if (message.member.voice.channel?.id !== player.voiceChannelId) {
      return message.reply('❌ Vous devez être dans le même salon vocal que le bot !');
    }
    
    if (!player.queue.size && !player.current) {
      return message.reply('❌ Aucune piste à passer.');
    }
    
    const currentTrack = player.current;
    player.skip();
    message.reply(`⏭️ Piste passée : **${currentTrack.title}**`);
  },
};
