import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const transport = new StdioClientTransport({command:process.execPath,
  args:['--import',fileURLToPath(new URL('./fixtures/wb-http.js',import.meta.url)),'src/index.js'],
  env:{...process.env,MARKET_COMPACT:'1'},stderr:'ignore'});
const client = new Client({name:'wb-regression',version:'1'});
try {
  await client.connect(transport);
  assert((await client.listTools()).tools.some(tool=>tool.name==='wb_card'));
  const result = await client.callTool({name:'wb_card',arguments:{product:'279743305'}});
  assert(!result.isError);
  const data = JSON.parse(result.content[0].text);
  assert.equal(data.name,'Стеллаж Momal 3х3');
  assert.deepEqual(data.dimensions_mm,{width:960,depth:300,height:960});
  assert.equal(data.image_url,'https://basket-17.wbbasket.ru/vol2797/part279743/279743305/images/big/1.webp');
  for (const id of ['231837905','493683677','379743305','479743305','579743305','https://localhost/']) {
    const bad = await client.callTool({name:'wb_card',arguments:{product:id}});
    assert.equal(bad.isError,true,`${id} must return a native MCP error`);
  }
  const visual = await client.callTool({name:'wb_card',arguments:{product:'279743305',include_image:true}});
  assert(!visual.isError);
  assert.equal(visual.content[1].type,'image');
  assert.equal(visual.content[1].mimeType,'image/webp');
  assert(Buffer.from(visual.content[1].data,'base64').length > 12);
  assert(!visual.content[0].text.includes('base64'));
  assert(!visual.content[0].text.includes('imageContent'));
  for (const id of ['679743305','779743305','879743305']) {
    const badPhoto = await client.callTool({name:'wb_card',arguments:{product:id,include_image:true}});
    assert.equal(badPhoto.isError,true,`${id} invalid/missing photo must be an error`);
  }
  const partial = await client.callTool({name:'wb_card',arguments:{product:'813575140'}});
  const parsed = JSON.parse(partial.content[0].text);
  assert(!parsed.dimensions_mm.width);
  assert(parsed.warnings[0].includes('packaging'));
  console.log('Native WB MCP card, images, missing dimensions and transport error regressions passed');
} finally { await client.close(); }
