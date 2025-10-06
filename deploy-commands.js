const { REST, Routes } = require('discord.js');
const fs = require('fs');

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    try {
        const command = require(`./commands/${file}`);
        if (command.data) {
            commands.push(command.data.toJSON());
            console.log(`✅ Chargé: ${file}`);
        } else {
            console.log(`⚠️ Ignoré (pas de data): ${file}`);
        }
    } catch (error) {
        console.log(`❌ Erreur avec ${file}:`, error.message);
    }
}

// ✅ UTILISE LE TOKEN DEPUIS index.js ou .env
const TOKEN = 'MTMxNTMyMDYzMTI5OTY2Mzk3NA.GyDxkz.2HM8T9uxXhXy3hYGtvIEKZJ_TsOG3q-mUIzNn8';
const CLIENT_ID = '1315320631299663974';

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('\nDébut du rafraîchissement des commandes...');

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands },
        );

        console.log(`✅ ${commands.length} commande(s) enregistrée(s) avec succès !`);
    } catch (error) {
        console.error('❌ Erreur:', error.message);
    }
})();
