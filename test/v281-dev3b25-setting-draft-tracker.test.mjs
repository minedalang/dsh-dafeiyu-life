import test from 'node:test'
import assert from 'node:assert/strict'
import {createSettingDraftTracker} from './helpers/setting-draft-tracker.mjs'

test('management UI uses the baseline tracker and only captures real user input',async()=>{
 const {readFileSync}=await import('node:fs');const ui=readFileSync('lib/management-console.js','utf8')
 assert.match(ui,/document\.addEventListener\('beforeinput',captureSettingBaseline,true\)/)
 assert.match(ui,/document\.addEventListener\('pointerdown',captureSettingBaseline,true\)/)
 assert.match(ui,/settingDraftTracker\.change\(field,save,panel\)/)
 assert.match(ui,/settingDraftTracker\.saved\(button\)/)
})

test('checkbox toggled away and back to baseline is not dirty',()=>{
 const tracker=createSettingDraftTracker(),field={type:'checkbox',checked:false},save={id:'social-save'}
 tracker.capture(field);field.checked=true;tracker.change(field,save,'social');assert.equal(tracker.has(),true)
 field.checked=false;tracker.change(field,save,'social');assert.equal(tracker.has(),false)
})

test('programmatic hydration without a captured user change does not create a draft',()=>{
 const tracker=createSettingDraftTracker(),field={type:'checkbox',checked:false},save={id:'life-save'}
 field.checked=true;tracker.change(field,save,'life');assert.equal(tracker.has(),false)
})

test('saved value becomes the next baseline and independent groups remain separate',()=>{
 const tracker=createSettingDraftTracker(),a={type:'checkbox',checked:false},b={value:'old'},sa={id:'a'},sb={id:'b'}
 tracker.capture(a);a.checked=true;tracker.change(a,sa,'social')
 tracker.capture(b);b.value='new';tracker.change(b,sb,'models')
 assert.equal(tracker.drafts.size,2);tracker.saved(sa);assert.equal(tracker.drafts.size,1)
 a.checked=false;tracker.change(a,sa,'social');assert.equal(tracker.drafts.size,2)
 b.value='old';tracker.change(b,sb,'models');assert.equal(tracker.drafts.has('b'),false)
})

test('radio group returning to the original selection clears both field drafts',()=>{
 const tracker=createSettingDraftTracker(),a={type:'radio',name:'mode',checked:true},b={type:'radio',name:'mode',checked:false},save={id:'mode-save'}
 tracker.capture(a);tracker.capture(b);b.checked=true;a.checked=false;tracker.change(a,save,'life');tracker.change(b,save,'life')
 assert.equal(tracker.has(),true)
 a.checked=true;b.checked=false;tracker.change(a,save,'life');tracker.change(b,save,'life')
 assert.equal(tracker.has(),false)
})
