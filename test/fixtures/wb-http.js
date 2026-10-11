// Anonymous local protocol fixture; no live requests or browser/profile.
import https from 'node:https';
import {EventEmitter} from 'node:events';
https.request = (url, options, callback) => {
  const req = new EventEmitter();
  req.end = () => queueMicrotask(() => {
    const parsed = new URL(url), id = parsed.pathname.split('/')[3];
    const res = new EventEmitter();
    res.statusCode = id === '493683677' ? 404 : id === '379743305' ? 302 : 200;
    const photo = parsed.pathname.endsWith('.webp');
    res.headers = {'content-type':photo ? 'image/webp' : 'application/json'};
    if (id === '479743305') res.headers['content-type'] = 'text/html';
    res.destroy = () => req.emit('close');
    callback(res);
    if (res.statusCode !== 200) return;
    const card = {nm_id: id === '231837905' ? 1 : Number(id), imt_name:'Стеллаж Momal 3х3', media:{photo_count:id === '879743305' ? 0 : 15},
      options:[{name:'Ширина упаковки',value:'33 см'}, ...(id === '813575140' ? [] : [
        {name:'Ширина предмета',value:'96 см'}, {name:'Глубина предмета',value:'30 см'}, {name:'Высота предмета',value:'96 см'}])]};
    if (options.method !== 'HEAD') res.emit('data', photo ? id === '679743305' ? Buffer.alloc(8388609) : id === '779743305' ? Buffer.from('not a webp') : Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==','base64') : Buffer.from(id === '579743305' ? ' '.repeat(1048577) : JSON.stringify(card)));
    res.emit('end'); req.emit('close');
  });
  req.destroy = error => { req.emit('error', error); req.emit('close'); };
  return req;
};
