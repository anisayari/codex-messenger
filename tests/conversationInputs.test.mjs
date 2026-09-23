import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeConversationInputs} from '../shared/conversationInputs.js';
import {decodeMediaDataUrl} from '../shared/mediaData.js';
test('structured skill and connector input is retained with bounded canonical fields',()=>{
  assert.deepEqual(normalizeConversationInputs([{type:'text',text:'do work',secret:'omit'},{type:'skill',name:'real',path:'/tmp/SKILL.md'},{type:'mention',name:'app',path:'app://verified'}]),[{type:'text',text:'do work'},{type:'skill',name:'real',path:'/tmp/SKILL.md'},{type:'mention',name:'app',path:'app://verified'}]);
});
test('rejects oversized, unknown, empty and malformed sends',()=>{
  for(const items of [[],Array.from({length:21},()=>({type:'text',text:'hi'})),[{type:'text',text:'x'.repeat(200001)}],[{type:'audio',path:'/a'}],[{type:'localImage',path:'\0'}],[{type:'text',text:' '}],null])assert.throws(()=>normalizeConversationInputs(items));
});
test('MediaRecorder codec parameters and limits are validated',()=>{
  const audio=decodeMediaDataUrl('data:audio/webm;codecs=opus;base64,AQID');assert.equal(audio.mime,'audio/webm');assert.equal(audio.bytes.length,3);
  assert.throws(()=>decodeMediaDataUrl('data:audio/webm;base64,!!!!'));assert.throws(()=>decodeMediaDataUrl('data:text/html;base64,AQID'));assert.throws(()=>decodeMediaDataUrl('data:image/png;base64,AQID',2));
});
