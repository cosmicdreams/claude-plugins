import { lookup } from 'node:dns/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';

export async function localProxy(origin, offline = false) {
  const host = origin.hostname.replace(/^\[|\]$/g, '');
  const port = Number(origin.port || 443);
  // Pin the validated address so a subsequent DNS lookup cannot change the destination.
  const addresses = await lookup(host, { all: true });
  const loopback = ({ address, family }) => family === 4 ? address.startsWith('127.') : address === '::1';
  if (!addresses.length || !addresses.every(loopback)) {
    throw new Error(`Origin must resolve exclusively to loopback: ${host}`);
  }
  const sockets = new Set();
  const track = socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  const server = createServer((request, response) => response.writeHead(403).end());
  server.on('connection', track);
  server.on('connect', (request, client, head) => {
    if (offline || request.url.toLowerCase() !== `${origin.hostname}:${port}`) {
      client.destroy();
      return;
    }
    const upstream = connect({ host: addresses[0].address, port });
    track(upstream);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server: `http://127.0.0.1:${server.address().port}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
