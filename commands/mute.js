module.exports = {
    name: 'mute',
    description: 'Coupe le son du bot',
    
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

            player.setVolume(0);
            return message.reply('🔇 Son coupé');

        } catch (error) {
            console.error('Erreur mute:', error);
            return message.reply('❌ Erreur');
        }
    }
};
