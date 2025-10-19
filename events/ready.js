module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    console.log(`Connecté en tant que ${client.user.tag}`);
    // Poru s'initialise déjà dans index.js
    console.log('Poru Manager prêt');
  },
};