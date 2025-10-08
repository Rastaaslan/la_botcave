module.exports = {
    name: 'unmute',
    description: 'Remet le son du bot à 100%',
    
    async execute(message, args, client) {
        try {
            const player = client.manager.players.get(message.guild.id);

            if (!player || !player.connected) {
                return message.reply('❌ Aucune musique en cours !');
            }

            const voiceChannel = message.member.voice.channel;
            if (!voiceChannel || voiceChannel.id !== player.voiceChannelId) {
                return message.reply('❌ Tu dois être dans le même salon vocal !');
            }

            player.setVolume(100);
            return message.reply('🔊 Volume rétabli à 100%');

        } catch (error) {
            console.error('Erreur unmute:', error);
            return message.reply('❌ Erreur');
        }
    }
};
