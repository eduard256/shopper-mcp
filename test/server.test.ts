import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.js';

const client = new Client({ name: 'test', version: '0' });

before(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  await client.connect(clientSide);
});

after(() => client.close());

const text = (result: unknown) => (result as { content: { text: string }[] }).content[0].text;

test('server lists the four tools', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['shop_docs', 'shop_get_info', 'shop_request', 'shop_show']);
});

test('shop_docs returns the topic list and a topic, without the network', async () => {
  assert.match(text(await client.callTool({ name: 'shop_docs', arguments: { marketplace: 'ozon.ru' } })), /^overview /);
  assert.match(text(await client.callTool({ name: 'shop_docs', arguments: { marketplace: 'ozon.ru', topic: 'search' } })), /^# Search/);
  const unknown = await client.callTool({ name: 'shop_docs', arguments: { marketplace: 'ozon.ru', topic: 'nope' } });
  assert.equal(unknown.isError, true);
});

test('shop_request refuses checkout before touching the browser', async () => {
  const result = await client.callTool({
    name: 'shop_request',
    arguments: { marketplace: 'ozon.ru', path: '/api/composer-api.bx/_action/initCheckoutState', body: {} },
  });
  assert.equal(result.isError, true);
  assert.match(text(result), /^blocked:/);
});
