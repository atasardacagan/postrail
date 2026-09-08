import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import sharp from 'sharp';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
const run = JSON.parse(await readFile('assets/demo/run.json', 'utf8'));
const c = { paper:'#F4F2EC', ink:'#172B2B', muted:'#667774', rule:'#D7DDD4', mint:'#D8EBCE', green:'#355B4F', orange:'#DF744F', white:'#FFFFFF', dark:'#122425' };
const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const rect = (x,y,w,h,fill,rx=0,stroke='none') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}"/>`;
const line = (x,y,x2,y2,color=c.rule,width=1) => `<path d="M${x} ${y}H${x2}" fill="none" stroke="${color}" stroke-width="${width}"/>`.replace(`H${x2}`, `L${x2} ${y2}`);
const txt = (x,y,value,size=24,fill=c.ink,weight=400,extra='') => `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" ${extra}>${esc(value)}</text>`;
const mono = (x,y,value,size=16,fill=c.muted) => `<text x="${x}" y="${y}" font-family="Menlo, Consolas, monospace" font-size="${size}" fill="${fill}">${esc(value)}</text>`;
function wrap(text,max=60) { const lines=[]; for (const paragraph of text.split('\n')) { let current=''; for(const word of paragraph.split(' ')) { if(current && (current+' '+word).length>max){lines.push(current);current=word;}else current+=(current?' ':'')+word; } lines.push(current); } return lines; }
const paragraph = (x,y,text,max=60,size=22,leading=32,fill=c.ink) => wrap(text,max).map((row,i)=>txt(x,y+i*leading,row,size,fill)).join('');
const icon = (x,y,s=64,bg=c.green,fg=c.mint) => `<g transform="translate(${x},${y}) scale(${s/64})">${rect(0,0,64,64,bg,16)}<path d="M14 20H33M14 32H26M14 44H33" stroke="${fg}" stroke-width="4" stroke-linecap="round"/><path d="M35 31L42 38L53 23" fill="none" stroke="${fg}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>`;
const brand = (x,y,size=32,dark=false) => icon(x,y-34,46,dark?c.mint:c.green,dark?c.dark:c.mint)+txt(x+61,y,'Postrail',size,dark?c.paper:c.ink,700,'letter-spacing="-1.2"');
const shell = (w,h,body,bg=c.paper) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"><title>Postrail — AI drafts. You decide what ships.</title>${rect(0,0,w,h,bg)}${body}</svg>`;
const pill = (x,y,w,label,fill=c.mint,fg=c.green) => rect(x,y,w,30,fill,15)+txt(x+14,y+20,label,13,fg,700);
async function save(name,svg,makePng=true) { await mkdir(name.slice(0,name.lastIndexOf('/')),{recursive:true}); await writeFile(name+'.svg',svg); if(makePng) await sharp(Buffer.from(svg)).png().toFile(name+'.png'); }
await save('assets/brand/logo',`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><title>Postrail mark</title>${icon(0,0,128)}</svg>`);
await save('assets/brand/wordmark',shell(360,90,brand(12,58,49)),false);
await save('assets/brand/wordmark-dark',shell(360,90,brand(12,58,49,true),c.dark),false);

const hook = run.steps[2].blocks.find(block=>block.kind==='hook').text;
let hero = brand(72,104,38)+pill(1196,66,330,'SELF-HOSTED · HUMAN-APPROVED');
hero+=txt(72,213,'AI LINKEDIN CONTENT',17,c.green,700,'letter-spacing="2.5"');
hero+=txt(68,324,'AI drafts.',92,c.ink,700,'letter-spacing="-4"')+txt(68,426,'You decide',92,c.ink,700,'letter-spacing="-4"')+txt(68,528,'what ships.',92,c.green,700,'letter-spacing="-4"');
hero+=paragraph(72,609,'A content engine with Telegram review,\nprecise revisions and a durable publish queue.',45,26,39,c.muted);
hero+=line(72,748,730,748)+mono(72,791,'TypeScript  /  PostgreSQL  /  Telegram',18)+txt(72,847,'Independent open source. Built around your approval.',17,c.muted);
hero+=rect(836,170,692,582,c.white,26,c.rule)+mono(870,215,'RECORDED WORKFLOW · OFFLINE FIXTURES',14)+line(870,243,1494,243);
hero+=txt(870,291,'03',19,c.muted)+txt(925,292,'Final draft',27,c.ink,700)+pill(1312,268,182,'AWAITING APPROVAL',c.paper,c.green);
hero+=rect(870,326,624,244,c.paper,16)+txt(898,363,'HOOK · v3',13,c.green,700)+paragraph(898,407,hook,43,26,37)+line(898,480,1464,480)+txt(898,516,'Body preserved. CTA removed.',19,c.muted)+txt(898,547,'The previous approval cannot publish this version.',16,c.muted);
hero+=rect(870,597,252,65,c.green,14)+txt(906,638,'You: “onayla”',23,c.white,700)+line(1142,630,1206,630,c.orange,3)+txt(1228,624,'Approved v3',21,c.ink,700)+txt(1228,652,'One publish call',18,c.muted);
hero+=txt(870,712,'Live mode uses the official LinkedIn Posts API.',17,c.muted);
hero+=line(836,801,1528,801)+txt(836,840,'DRAFT',14,c.muted,700)+txt(1000,840,'REVISE',14,c.muted,700)+txt(1168,840,'APPROVE',14,c.green,700)+txt(1393,840,'PUBLISH',14,c.muted,700)+line(921,835,973,835)+line(1089,835,1141,835)+line(1273,835,1365,835);
await save('assets/hero',shell(1600,900,hero));

let social=brand(62,101,40,true)+pill(934,63,282,'AI LINKEDIN CONTENT',c.green,c.mint);
social+=txt(57,238,'AI drafts.',90,c.paper,700,'letter-spacing="-4"')+txt(57,342,'You decide what ships.',78,c.paper,700,'letter-spacing="-3.5"');
social+=txt(62,408,'Telegram approval. Precise revisions. Durable publishing.',26,'#B9CAC1');
const rails=[['01','Draft',c.green],['02','Revise',c.green],['03','You approve',c.mint],['04','Publish',c.green]];
rails.forEach(([n,label,bg],i)=>{const x=62+i*296;social+=rect(x,470,268,96,bg,14)+mono(x+18,503,n,15,i===2?c.green:'#B9CAC1')+txt(x+18,542,label,26,i===2?c.ink:c.paper,700);if(i<3)social+=line(x+268,519,x+295,519,c.orange,3);});
social+=txt(62,610,'Independent open-source tool · TypeScript + PostgreSQL',17,'#B9CAC1');
await save('assets/social-preview',shell(1280,640,social,c.dark));

let card=brand(65,104,40)+txt(63,210,'Your voice.',76,c.ink,700,'letter-spacing="-3"')+txt(63,296,'Your final say.',76,c.green,700,'letter-spacing="-3"');
card+=txt(65,353,'AI content → Telegram review → LinkedIn',25,c.muted);
card+=rect(65,409,1070,310,c.dark,22)+mono(96,457,'APPROVAL-BOUND WORKFLOW',15,'#B9CAC1');
card+=line(116,541,1078,541,c.green,4);
['Draft v1','Revise v2','Review v3','Approve v3'].forEach((label,i)=>{const x=117+i*270;card+=`<circle cx="${x}" cy="541" r="13" fill="${i===3?c.mint:c.orange}"/>`+txt(x-20,598,label,25,c.paper,700);});
card+=rect(96,641,398,45,c.green,9)+txt(115,671,'No publication before approval',20,c.mint,700)+txt(677,671,'3 versions · 1 fixture publication',18,'#B9CAC1');
card+=txt(65,790,'POSTRAIL',15,c.green,700,'letter-spacing="3"')+txt(65,834,'TypeScript  ·  PostgreSQL  ·  Telegram  ·  OpenAI',23,c.muted)+txt(65,876,'Workflow illustration based on a recorded offline run.',15,c.muted);
await save('assets/showcase/project-card',shell(1200,900,card));

const titles=['Plan the slot','Review a draft','Revise the opening','Remove the CTA','Approve the final version'];
function frame(index) {
 const step=index===0?null:run.steps[index-1];
 let b=brand(45,73,33,true)+pill(881,38,353,'RECORDED OFFLINE WORKFLOW',c.green,c.mint);
 b+=txt(45,157,titles[index],42,c.paper,700,'letter-spacing="-1.4"');
 b+=txt(45,204,'AI drafts. You decide what ships.',23,'#B9CAC1');
 b+=line(45,240,1235,240,c.green);
 ['01  Schedule','02  Draft v1','03  Revise v2','04  Review v3','05  Approve'].forEach((label,i)=>{b+=rect(45,273+i*62,307,49,i===index?c.mint:c.dark,9)+txt(64,305+i*62,label,21,i===index?c.ink:'#B9CAC1',i===index?700:400);});
 b+=rect(385,270,850,378,c.paper,18)+mono(414,309,step?`post.status = ${step.status}`:'settings.timezone = Europe/Istanbul',15,c.green)+line(414,329,1206,329);
 if(!step){b+=txt(414,380,'Tue · Thu · Sat',36,c.ink,700)+txt(414,434,'10:30 · Europe/Istanbul',27,c.green)+paragraph(414,498,'The scheduler prepares a draft for Telegram review.\nThis replay accelerates the slot to the current minute.',65,20,31,c.muted)+pill(414,588,313,'HUMAN APPROVAL STILL REQUIRED');}
 else {
  if(step.instruction)b+=rect(414,348,792,43,c.mint,9)+txt(431,376,`You: “${step.instruction}”`,20,c.green,700);
  else b+=txt(414,375,'Ready for your review · Turkish content',20,c.green,700);
  b+=paragraph(414,426,step.text.replaceAll('\n\n','\n'),75,20,28,c.ink);
  b+=pill(1010,594,195,`PUBLISH CALLS: ${step.publishCalls}`,step.publishCalls?c.mint:'#E6E6DF');
 }
 b+=txt(45,697,'Real application state · fixture providers · no live post · presentation, not a product dashboard',17,'#B9CAC1');
 return shell(1280,720,b,c.dark);
}
const gif=GIFEncoder();
for(let i=0;i<5;i++) {
 const svg=frame(i);
 const png=await sharp(Buffer.from(svg)).png().toBuffer();
 if(i===2) { await writeFile('assets/showcase/workflow.png',png);await writeFile('assets/showcase/workflow.svg',svg); }
 const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const palette=quantize(data,256);
 gif.writeFrame(applyPalette(data,palette),info.width,info.height,{palette,delay:i===0?2000:3500,repeat:0});
}
gif.finish();await writeFile('assets/demo/workflow.gif',gif.bytes());

let arch=brand(65,94,37)+txt(65,170,'A clear boundary between drafting and publishing.',38,c.ink,700);
const box=(x,y,w,h,head,sub,fill=c.white)=>rect(x,y,w,h,fill,16,c.rule)+txt(x+24,y+42,head,24,c.ink,700)+paragraph(x+24,y+77,sub,29,17,24,c.muted);
arch+=box(65,235,302,145,'Scheduler','Due slots → durable jobs');
arch+=box(449,235,302,145,'Content engine','Ideas → writer → critic');
arch+=box(833,235,302,145,'Telegram review','Revise, postpone, cancel',c.mint);
arch+=line(367,305,445,305,c.green,3)+line(751,305,829,305,c.green,3);
arch+=box(833,461,302,145,'Human approval','Bound to the current version',c.mint)+line(985,380,985,457,c.orange,3);
arch+=box(449,461,302,145,'Publisher','Official LinkedIn Posts API')+line(833,532,755,532,c.green,3);
arch+=box(65,461,302,145,'Outcome','Saved post + Telegram notice')+line(449,532,371,532,c.green,3);
arch+=rect(65,685,1070,102,c.dark,16)+txt(91,729,'PostgreSQL',28,c.paper,700)+txt(323,729,'Versions · Approvals · Jobs · Inbox · Outbox · Metrics',21,'#B9CAC1')+txt(91,762,'API + worker use transactions and user-scoped queries. No Redis or n8n required.',18,'#B9CAC1');
arch+=txt(65,847,'Measured outcomes inform future ideas. Unknown publish results pause retries.',19,c.muted);
await save('assets/showcase/architecture',shell(1200,900,arch));
process.stdout.write('Postrail SVG, PNG and 16-second GIF assets rendered from the recorded fixture run.\n');
