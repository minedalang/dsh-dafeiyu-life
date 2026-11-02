import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from './helpers/ready-host.mjs'
import {listCommentMemes} from '../lib/comment-meme-library.mjs'

test('按分类递归扫描，完整名称区分不同文件夹里的同名梗图',async()=>{
 const home=mkdtempSync(join(tmpdir(),'bili-meme-nested-'))
 try{
   const folder=join(home,'bili-duty','comment-memes')
   for(const c of ['奶娃','其他','大模型娘化素材','奶娃/子分类']) mkdirSync(join(folder,c),{recursive:true})
   for(const f of ['奶娃/奶龙大笑.webp','其他/奶龙大笑.png','奶娃/子分类/奶龙无语.GIF','大模型娘化素材/震惊.jpg']) writeFileSync(join(folder,f),'image-placeholder')
   const scan=listCommentMemes(folder)
   assert.equal(scan.ok,true)
   assert.equal(scan.total,4)
   assert.ok(scan.names.includes('奶娃/奶龙大笑'))
   assert.ok(scan.names.includes('其他/奶龙大笑'))
   assert.ok(scan.names.includes('奶娃/子分类/奶龙无语'))
   assert.equal(scan.categories.find(c=>c.path==='奶娃').count,2)
   assert.deepEqual(listCommentMemes(folder,{category:'其他'}).names,['其他/奶龙大笑'])
   let route
   const ctx={get(k){return k==='dshHomePath'?(...parts)=>join(home,...parts):undefined},logger:{info(){},warn(){}},
     tools:{register(){}},webServer:{register(spec){route=spec;return {dispose(){}}}},effect(cb){return cb()},settings:{describe(){return []}}}
   apply(ctx,{})
   const req=Readable.from([]);req.method='GET';req.url='/api/bili-duty/comment-memes';req.headers={host:'localhost'}
   let value;const res={writeHead(){},end(s){value=JSON.parse(s)}}
   await route.handler(req,res)
   assert.equal(value.total,4)
   assert.ok(value.names.includes('奶娃/子分类/奶龙无语'))
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('符号链接目录与同目录同名不同后缀文件不提供给 AI',()=>{
 const home=mkdtempSync(join(tmpdir(),'bili-meme-safety-'))
 try{
   const folder=join(home,'comment-memes')
   mkdirSync(join(folder,'奶娃'),{recursive:true})
   writeFileSync(join(folder,'奶娃','大笑.webp'),'x')
   writeFileSync(join(folder,'奶娃','大笑.png'),'x')
   mkdirSync(join(home,'private'),{recursive:true})
   writeFileSync(join(home,'private','secret.png'),'secret')
   try{symlinkSync(join(home,'private'),join(folder,'链接'),'dir')}catch{}
   const got=listCommentMemes(folder)
   assert.equal(got.total,0)
   assert.deepEqual(got.names,[])
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('选图提示词强调完整分类名称、情绪自然匹配、不凭名字声称看过图',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const prompt=readFileSync(new URL('../lib/comment-meme-prompt.mjs',import.meta.url),'utf8')
 assert.match(index,/buildCommentMemePrompt/)
 assert.match(prompt,/分类\/图片名/)
 assert.match(prompt,/不合适时仍只发文字/)
 assert.match(prompt,/不能声称已亲眼看到画面/)
 assert.match(prompt,/情绪匹配即可/)
 assert.match(prompt,/meme_image_reason/)
 const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
 assert.match(client,/comment-memes 文件夹/)
 const manager=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.match(manager,/AI 选图提示词/)
})
