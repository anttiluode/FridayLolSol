const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
let Engine;
class FakeWorklet{constructor(){this.port={onmessage(){}};}}
const scope={AudioWorkletProcessor:FakeWorklet,sampleRate:48000,registerProcessor:(n,klass)=>{assert.equal(n,'residue-engine');Engine=klass;}};
const content=fs.readFileSync(path.join(__dirname,'..','residue-worklet.js'),'utf8');
vm.runInNewContext(content,scope,{filename:'residue-worklet.js'});
const N=128;
const sine=(hz,phase=0)=>Float32Array.from({length:N},(_,i)=>.2*Math.sin(2*Math.PI*hz*i/48000+phase));
const A=sine(441),B=sine(599),C=sine(733);
const inputs=(...signals)=>{const arr=Array.from({length:12},()=>[]);signals.forEach((x,i)=>arr[i]=[x,x]);return arr;};
function test(signals,mode='ring',enabled=[true,true],pairs=['0-1'],other={}){
 const e=new Engine();
 e.port.onmessage({data:{type:'settings',value:{enabled,gains:Array(12).fill(1),pairKeys:pairs,mode,wet:1,dry:0,drive:4,output:.72,...other}}});
 const out=[[new Float32Array(N),new Float32Array(N)]];
 e.process(inputs(...signals),out);
 assert.ok(out[0][0].every(Number.isFinite),'samples finite');
 return Math.max(...Array.from(out[0][0],Math.abs));
}
assert.ok(test([A,B])>.005,'two songs produce ring residue');
assert.equal(test([A],'ring',[true,false]),0,'one song ring silent');
assert.equal(test([A,B],'ring',[true,true],[]),0,'disabled pairs silent');
assert.equal(test([A,B],'triple'),0,'two songs triple silent');
assert.ok(test([A,B,C],'triple',[true,true,true],['0-1','0-2','1-2'])>.001,'triangle produces output');
assert.equal(test([A,B,C],'triple',[true,true,true],['0-1','0-2']),0,'missing triangle edge silent');
assert.ok(test([A,B],'weave',[true,true],['0-1'],{delayMs:2})>.0001,'delay-weave produces output');
assert.equal(test([A,A],'weave',[true,true],['0-1'],{delayMs:2}),0,'identical aligned waves cancel');
assert.ok(test([A,B],'imprint')>.0001,'imprint responds to distinct songs');
assert.equal(test([A],'imprint',[true,false]),0,'imprint with one song silent');
console.log('10 DSP assertions passed');
