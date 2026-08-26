import { app } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '4310', 10);

if (host !== '127.0.0.1' && host !== 'localhost') {
  throw new Error('The local service must bind to a loopback address.');
}

const server = app.listen(port, host, () => {
  console.log(`Local service listening at http://${host}:${port}`);
});

function shutDown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);
