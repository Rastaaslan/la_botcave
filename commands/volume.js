module.exports = {
    name: 'volume',
    description: 'Ajuste le volume du bot (0-200)',
    
    async execute(message, args, client) {
        try {
            const player = client.manager.players.get(message.guild.id);

            if (!player || !player.connected) {
                return message.reply('❌ Aucune musique en cours !');
            }

            // Vérifie que l'utilisateur est dans le même salon
            const voiceChannel = message.member.voice.channel;
            if (!voiceChannel || voiceChannel.id !== player.voiceChannelId) {
                return message.reply('❌ Tu dois être dans le même salon vocal !');
            }

            // Si aucun argument, affiche le volume actuel
            if (!args[0]) {
                return message.reply(`🔊 Volume actuel : **${player.volume}%**`);
            }

            // Parse le volume demandé
            const newVolume = parseInt(args[0]);

            if (isNaN(newVolume)) {
                return message.reply('❌ Volume invalide ! Utilise : `!volume <0-200>`');
            }

            if (newVolume < 0 || newVolume > 200) {
                return message.reply('❌ Le volume doit être entre **0** et **200** !');
            }

            // Change le volume
            player.setVolume(newVolume);
            
            const emoji = newVolume === 0 ? '🔇' : 
                         newVolume < 30 ? '🔈' : 
                         newVolume < 70 ? '🔉' : '🔊';

            return message.reply(`${emoji} Volume réglé à **${newVolume}%**`);

        } catch (error) {
            console.error('Erreur volume:', error);
            return message.reply('❌ Erreur lors du changement de volume');
        }
    }
};
module.exports = {
    name: 'volume',
    description: 'Ajuste le volume du bot (0-200)',
    
    async execute(message, args, client) {
        try {
            const player = client.manager.players.get(message.guild.id);

            if (!player || !player.connected) {
                return message.reply('❌ Aucune musique en cours !');
            }

            // Vérifie que l'utilisateur est dans le même salon
            const voiceChannel = message.member.voice.channel;
            if (!voiceChannel || voiceChannel.id !== player.voiceChannelId) {
                return message.reply('❌ Tu dois être dans le même salon vocal !');
            }

            // Si aucun argument, affiche le volume actuel
            if (!args[0]) {
                return message.reply(`🔊 Volume actuel : **${player.volume}%**`);
            }

            // Parse le volume demandé
            const newVolume = parseInt(args[0]);

            if (isNaN(newVolume)) {
                return message.reply('❌ Volume invalide ! Utilise : `!volume <0-200>`');
            }

            if (newVolume < 0 || newVolume > 200) {
                return message.reply('❌ Le volume doit être entre **0** et **200** !');
            }

            // Change le volume
            player.setVolume(newVolume);
            
            const emoji = newVolume === 0 ? '🔇' : 
                         newVolume < 30 ? '🔈' : 
                         newVolume < 70 ? '🔉' : '🔊';

            return message.reply(`${emoji} Volume réglé à **${newVolume}%**`);

        } catch (error) {
            console.error('Erreur volume:', error);
            return message.reply('❌ Erreur lors du changement de volume');
        }
    }
};
