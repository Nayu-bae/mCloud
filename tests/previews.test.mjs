import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Users } from '../dist/users.js';
import { Files } from '../dist/files.js';
import { createApp } from '../dist/app.js';

test('private inline previews reject spoofed images and display active content only as text', async () => {
  const dir=mkdtempSync(join(tmpdir(),'mcloud-preview-test-'));
  const database=join(dir,'test.sqlite');
  const users=new Users(database); const files=new Files(database);
  await users.bootstrap('owner','owner-test-password');
  await users.add('member','member-test-password');
  const server=createApp(users,false,{files,directory:join(dir,'uploads')}).listen(0,'127.0.0.1');
  await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=async(username,password)=>(await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})})).headers.get('set-cookie').split(';')[0];
  try {
    const owner=await login('owner','owner-test-password');
    const cookie=await login('member','member-test-password');
    const upload=async(name,body)=>(await (await fetch(base+'/api/files',{method:'POST',headers:{cookie,'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name)},body})).json()).file;
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zXsAAAAASUVORK5CYII=','base64');
    const image=await upload('photo.png',png);
    assert.equal(image.previewKind,'image');
    const preview=await fetch(base+`/api/files/${image.id}/preview`,{headers:{cookie}});
    assert.equal(preview.status,200);assert.equal(preview.headers.get('content-disposition'),'inline');
    assert.equal(preview.headers.get('content-type'),'image/png');
    assert.equal(preview.headers.get('cache-control'),'no-store');
    assert.equal(preview.headers.get('x-content-type-options'),'nosniff');
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()),png);
    for (const path of ['preview','preview-info']) {
      assert.equal((await fetch(base+`/api/files/${image.id}/${path}`)).status,401);
      assert.equal((await fetch(base+`/api/files/${image.id}/${path}`,{headers:{cookie:owner}})).status,404);
      assert.equal((await fetch(base+`/api/files/999999/${path}`,{headers:{cookie}})).status,404);
    }
    const range=await fetch(base+`/api/files/${image.id}/preview`,{headers:{cookie,Range:'bytes=0-7'}});
    assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,8);
    const spoof=await upload('fake.jpg','<script>alert(1)</script>');
    assert.equal((await (await fetch(base+`/api/files/${spoof.id}/preview-info`,{headers:{cookie}})).json()).kind,'unsupported');
    assert.equal((await fetch(base+`/api/files/${spoof.id}/preview`,{headers:{cookie}})).status,415);
    for (const name of ['page.html','drawing.svg','notes.txt']) {
      const file=await upload(name,'<script>alert(1)</script>');
      const result=await fetch(base+`/api/files/${file.id}/preview`,{headers:{cookie}});
      assert.equal(result.status,200);assert.match(result.headers.get('content-type'),/^text\/plain/);
      assert.match(result.headers.get('content-security-policy'),/sandbox/);
      assert.equal(await result.text(),'<script>alert(1)</script>');
    }
    const pdf=await upload('document.pdf','%PDF-1.4\nexample');
    assert.equal((await (await fetch(base+`/api/files/${pdf.id}/preview-info`,{headers:{cookie}})).json()).kind,'pdf');
    const unsupported=await upload('archive.zip','unsupported');
    assert.equal((await fetch(base+`/api/files/${unsupported.id}/preview`,{headers:{cookie}})).status,415);
    const large=await upload('large.txt','a'.repeat(1024*1024+1));
    assert.equal((await (await fetch(base+`/api/files/${large.id}/preview-info`,{headers:{cookie}})).json()).textTooLarge,true);
    assert.equal((await fetch(base+`/api/files/${large.id}/preview`,{headers:{cookie}})).status,413);
    await fetch(base+'/api/logout',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:'{}'});
    assert.equal((await fetch(base+`/api/files/${image.id}/preview`,{headers:{cookie}})).status,401);
  } finally {await new Promise(resolve=>server.close(resolve));users.close();files.close();rmSync(dir,{recursive:true,force:true});}
});
