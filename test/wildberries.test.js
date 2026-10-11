import assert from 'node:assert/strict';
import {productId, cardBase, parseCard} from '../src/wildberries.js';
const url = 'https://www.wildberries.ru/catalog/279743305/detail.aspx?size=429804204';
assert.equal(productId(url), '279743305');
assert.equal(productId('279743305'), '279743305');
for (const bad of ['0','../279743305','https://evil.test/catalog/279743305/detail.aspx',
  'http://www.wildberries.ru/catalog/279743305/detail.aspx',
  'https://www.wildberries.ru:443/catalog/279743305/detail.aspx',
  'https://user@www.wildberries.ru/catalog/279743305/detail.aspx',
  'https://www.wildberries.ru/x/../catalog/279743305/detail.aspx',
  'https://www.wildberries.ru/catalog/%32279743305/detail.aspx',
  'https://www.wildberries.ru\\@127.0.0.1/catalog/279743305/detail.aspx']) {
  assert.throws(() => productId(bad), /Invalid/);
}
for (const [sku,basket] of [['813575140',37],['279743305',17],['231837905',15],['493683677',27],['14399999',1],['14400000',2],['830999999',37],['831000000',38]]) {
  assert.equal(new URL(cardBase(sku)).hostname, `basket-${String(basket).padStart(2,'0')}.wbbasket.ru`);
}
const card={nm_id:279743305,imt_name:'Momal 3х3',media:{photo_count:15},options:[
  {name:'Ширина упаковки',value:'33 см'}, {name:'Ширина предмета',value:'96 см'},
  {name:'Глубина предмета',value:'300 мм'},{name:'Высота предмета',value:'0,96 м'}]};
assert.deepEqual(parseCard(card,'279743305').dimensions_mm,{width:960,depth:300,height:960});
assert.throws(()=>parseCard(card,'231837905'),/identity/);
assert.equal(parseCard({...card,options:[{name:'Ширина упаковки',value:'33 см'}]},'279743305').dimensions_mm.width,null);
assert.equal(parseCard({...card,options:[{name:'Ширина предмета',value:'NaN см'}]},'279743305').dimensions_mm.width,null);
console.log('WB canonical URL, official routing boundaries and item-only dimensions passed');
