import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
const panel=(name)=>html.split(`<section id="panel-${name}" hidden>`)[1]?.split(/<section id="panel-[a-z]+" hidden>/)[0]||'';

test('社交首页优先呈现被 @、评论和私信入口，而非大批直接展开的授权控件',()=>{
  const social=panel('social');
  const firstAuth=social.indexOf('id="unified-friends"');
  const firstLink=social.indexOf('data-open-anchor="comment-at-section"');
  assert.ok(firstLink>=0&&firstLink<firstAuth);
  assert.match(social,/data-open-tab="comments" data-open-anchor="comments-configuration"/);
  assert.match(social,/data-open-tab="dm" data-open-anchor="dm-settings-section"/);
  assert.match(social,/data-open-settings="social-friends-group" data-target-tab="social"/);
  for(const id of ['social-friends-group','social-outreach-group','social-owner-dm-group','social-owner-comment-group','social-emotion-group']){
    assert.match(social,new RegExp(`<details id="${id}" class="social-category">`));
    assert.equal(html.split(`id="${id}"`).length-1,1,id+' is not duplicated');
  }
});

test('评论和 @ 设置只保留一套并且跳转到开关后即可保存',()=>{
  const comments=panel('comments'),social=panel('social');
  for(const id of ['comment-at-enabled','comment-watch-replies','comments-settings-save','comments-configuration']){
    assert.ok(comments.includes(`id="${id}"`),id+' remains in comment settings');
    assert.ok(!social.includes(`id="${id}"`),id+' must not be cloned to social');
    assert.equal(html.split(`id="${id}"`).length-1,1,id+' must be unique');
  }
  assert.match(comments,/href="#comment-at-section"/);
  assert.ok(comments.indexOf('id="comment-at-section"') < comments.indexOf('id="comments-settings-save"'));
  assert.ok(comments.indexOf('id="comment-at-section"')>comments.indexOf('id="comment-watch-replies"'));
  assert.match(js,/commentAtEnabled:\$\('comment-at-enabled'\)\.checked/);
});

test('跨页导航会展开折叠分组，并在异步记录加载结束后重新定位',()=>{
  assert.match(js,/const revealTarget=\(element\)=>/);
  assert.match(js,/if\(parent\.tagName==='DETAILS'\)groups\.unshift\(parent\)/);
  assert.match(js,/for\(const group of groups\)group\.open=true/);
  assert.match(js,/Promise\.resolve\(loading\)\.then\(navigate,\(\)=>\{\}\)/);
  assert.match(js,/if\(active!==destination\)return/);
  assert.match(js,/data-social-anchor/);
  assert.match(js,/data-open-settings/);
});
