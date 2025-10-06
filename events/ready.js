module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log(`Connecté en tant que ${client.user.tag}`);
    client.manager.init(client.user.id);
    console.log('Moonlink Manager initialisé');
  },
};