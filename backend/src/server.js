const createApp = require('./app');
const config = require('./config');

const app = createApp();

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`TalcTech Rooms backend listening on port ${config.port} (${config.env})`);
});
