const http = require('http');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const { randomUUID } = require('crypto');
const { networkInterfaces } = require('os');

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const lanAddress = Object.entries(networkInterfaces()).filter(([name]) => !/virtual|vEthernet|loopback/i.test(name)).flatMap(([, addresses]) => addresses || []).find(address => address.family === 'IPv4' && !address.internal)?.address;
const questions = [
  ['World', 'The national animal of Scotland is the ____.', 'unicorn'],
  ['India', 'In India, the town of Shani Shingnapur is famous for houses traditionally having no ____.', 'doors'],
  ['India', 'The Indian state that produces the most tea is ____.', 'Assam'],
  ['India', 'India’s floating post office sits on ____ Lake in Srinagar.', 'Dal'],
  ['India', 'The world’s highest cricket ground is in Chail, ____.', 'Himachal Pradesh'],
  ['India', 'The first Indian to travel to space was Rakesh ____.', 'Sharma'],
  ['India', 'Mawlynnong, often called India’s cleanest village, is in ____.', 'Meghalaya'],
  ['India', 'The Indian Railways has a train museum in ____ called the National Rail Museum.', 'New Delhi'],
  ['India', 'The currency used in Bhutan is called the ngultrum, and it is pegged to the Indian ____.', 'rupee'],
  ['India', 'The Indian city nicknamed the “Pink City” is ____.', 'Jaipur'],
  ['India', 'The Hornbill Festival is celebrated in the Indian state of ____.', 'Nagaland'],
  ['India', 'The world’s only floating national park, Keibul Lamjao, is in ____.', 'Manipur'],
  ['India', 'The ancient stepwell Chand Baori is located in ____.', 'Rajasthan'],
  ['India', 'The Indian town of Jharia has underground ____ fires that have burned for decades.', 'coal'],
  ['India', 'The Sunderbans are home to mangrove forests and the Royal Bengal ____.', 'tiger'],
  ['World', 'A group of flamingos is called a ____.', 'flamboyance'],
  ['World', 'Octopuses have ____ hearts.', 'three'],
  ['World', 'The shortest war in recorded history lasted about ____ minutes.', '38'],
  ['World', 'Wombat poop is shaped like a ____.', 'cube'],
  ['World', 'Bananas are botanically berries, but strawberries are not ____.', 'berries'],
  ['World', 'A day on Venus is longer than a year on ____.', 'Venus'],
  ['World', 'The Eiffel Tower can grow taller in summer because metal ____.', 'expands'],
  ['World', 'Sea otters hold ____ while sleeping so they do not drift apart.', 'hands'],
  ['World', 'The tiny country of Liechtenstein once rented out its entire ____ for an event.', 'country'],
  ['World', 'The inventor of the Pringles can was partly buried in one ____.', 'can'],
  ['World', 'Cows have best friends and can become stressed when they are ____.', 'separated'],
  ['World', 'The first oranges were actually ____.', 'green'],
  ['World', 'There are more possible chess games than atoms in the observable ____.', 'universe'],
  ['World', 'A snail can sleep for up to ____ years.', 'three'],
  ['World', 'Some turtles can breathe through their ____.', 'butts'],
  ['World', 'Honey never spoils; archaeologists have tasted ancient honey from Egyptian ____.', 'tombs'],
  ['World', 'The dot over a lowercase i or j is called a ____.', 'tittle'],
  ['World', 'A single cloud can weigh more than a million ____.', 'pounds'],
  ['World', 'The heart of a shrimp is located in its ____.', 'head'],
  ['World', 'The world’s quietest room is so silent that people can hear their own ____.', 'heartbeat']
];

function shuffle(a) { a=[...a]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function code() { let c; do c = Array.from({length:4},()=> 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random()*24)]).join(''); while(rooms.has(c)); return c; }
function norm(s) { return String(s || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function closeEnough(fake, real) { const a=norm(fake), b=norm(real); return a===b || a.includes(b) || b.includes(a); }
function player(room, id) { return room.players.get(id); }
function publicRoom(room, viewerId) {
  const me = player(room, viewerId); const q=room.current;
  const base={ code:room.code, phase:room.phase, hostId:room.hostId, isHost:room.hostId===viewerId, joinUrl:lanAddress&&!process.env.RENDER?`http://${lanAddress}:${PORT}`:null, me:me&&{id:me.id,name:me.name,score:me.score}, players:[...room.players.values()].map(p=>({id:p.id,name:p.name,score:p.score,submitted:!!p.answer,voted:!!p.vote})), round:room.round, totalRounds:room.totalRounds, deadline:room.deadline||null };
  if(q && ['write','vote','reveal'].includes(room.phase)) base.question={category:q[0],text:q[1]};
  if(room.phase==='vote'||room.phase==='reveal') base.choices=room.choices.map(x=>({id:x.id,text:x.text}));
  if(room.phase==='reveal') base.reveal=room.choices.map(x=>({text:x.text,author:x.author?room.players.get(x.author)?.name:null,isReal:x.real,votes:x.votes||0,fooledBy:[...room.players.values()].filter(p=>p.vote===x.id).map(p=>p.name)}));
  if(room.phase==='final') base.podium=[...room.players.values()].sort((a,b)=>b.score-a.score).map(p=>({name:p.name,score:p.score}));
  return base;
}
function broadcast(room) { room.touched=Date.now(); for(const res of room.clients) res.write(`data: ${JSON.stringify(publicRoom(room, res.playerId))}\n\n`); }
function setTimer(room, ms, fn) { clearTimeout(room.timer); room.deadline=Date.now()+ms; room.timer=setTimeout(fn,ms); broadcast(room); }
function startWrite(room) { room.phase='write'; room.round++; room.current=room.deck.shift(); for(const p of room.players.values()){p.answer=null;p.vote=null;} setTimer(room,60000,()=>finishWrite(room)); }
function showHowTo(room) { room.phase='howto'; room.deadline=null; clearTimeout(room.timer); broadcast(room); room.timer=setTimeout(()=>startWrite(room),10000); }
function finishWrite(room) { if(room.phase!=='write')return; const q=room.current; const fakes=[...room.players.values()].filter(p=>p.answer).map(p=>({id:randomUUID(),text:p.answer,author:p.id,real:false,votes:0})); room.choices=shuffle([...fakes,{id:randomUUID(),text:q[2],author:null,real:true,votes:0}]); room.phase='vote'; for(const p of room.players.values())p.vote=null; setTimer(room,30000,()=>finishVote(room)); }
function finishVote(room) { if(room.phase!=='vote')return; const multiplier=room.round===room.totalRounds?2:1; for(const p of room.players.values()){ const chosen=room.choices.find(c=>c.id===p.vote); if(!chosen)continue; chosen.votes++; if(chosen.real)p.score+=1000*multiplier; else if(chosen.author!==p.id) room.players.get(chosen.author).score+=500*multiplier; } room.phase='reveal'; room.deadline=null; clearTimeout(room.timer); broadcast(room); room.timer=setTimeout(()=> room.round>=room.totalRounds?finishGame(room):startWrite(room),8000); }
function finishGame(room){room.phase='final';room.deadline=null;broadcast(room);}
function body(req){return new Promise((resolve,reject)=>{let d='';req.on('data',x=>d+=x);req.on('end',()=>{try{resolve(JSON.parse(d||'{}'))}catch(e){reject(e)}})})}
function respond(res,status,data){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}
function clientId(req){return req.headers['x-player-id'];}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host}`);
  if(req.method==='GET'&&url.pathname==='/events') { const room=rooms.get(url.searchParams.get('code')); const id=url.searchParams.get('player'); if(!room||!player(room,id)){res.writeHead(404);return res.end();} res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'}); res.playerId=id;room.clients.add(res);res.write(`data: ${JSON.stringify(publicRoom(room,id))}\n\n`);req.on('close',()=>room.clients.delete(res));return; }
  if(req.method==='POST'&&url.pathname==='/api/create'){ const d=await body(req); const name=String(d.name||'Host').trim().slice(0,18); const c=code(),id=randomUUID(); const room={code:c,hostId:id,players:new Map(),clients:new Set(),phase:'lobby',round:0,totalRounds:3,deck:shuffle(questions),timer:null};room.players.set(id,{id,name,score:0});rooms.set(c,room);return respond(res,200,{code:c,id}); }
  if(req.method==='POST'&&url.pathname==='/api/join'){const d=await body(req),room=rooms.get(norm(d.code).toUpperCase());if(!room)return respond(res,404,{error:'Room not found'});if(room.phase!=='lobby')return respond(res,409,{error:'That game has already started'});if(room.players.size>=8)return respond(res,409,{error:'Room is full'});const name=String(d.name||'').trim().slice(0,18);if(name.length<2)return respond(res,400,{error:'Enter a name with at least 2 characters'});if([...room.players.values()].some(p=>norm(p.name)===norm(name)))return respond(res,409,{error:'That name is already in use'});const id=randomUUID();room.players.set(id,{id,name,score:0});broadcast(room);return respond(res,200,{code:room.code,id});}
  if(req.method==='POST'&&url.pathname==='/api/action'){const d=await body(req),room=rooms.get(d.code),p=room&&player(room,d.id);if(!room||!p)return respond(res,404,{error:'Room or player not found'});if(d.action==='continue'){if(room.hostId!==p.id||room.phase!=='howto')return respond(res,403,{error:'Only the host can continue'});startWrite(room);return respond(res,200,{ok:true});}if(d.action==='setRounds'){if(room.hostId!==p.id||room.phase!=='lobby')return respond(res,403,{error:'Only the host can change rounds in the lobby'});room.totalRounds=[3,5,7].includes(+d.rounds)?+d.rounds:3;broadcast(room);return respond(res,200,{ok:true});}if(d.action==='restart'){if(room.hostId!==p.id)return respond(res,403,{error:'Only the host can restart'});clearTimeout(room.timer);room.phase='lobby';room.round=0;room.deck=shuffle(questions);for(const x of room.players.values()){x.score=0;x.answer=null;x.vote=null;}broadcast(room);return respond(res,200,{ok:true});}if(d.action==='end'){if(room.hostId!==p.id)return respond(res,403,{error:'Only the host can end the game'});clearTimeout(room.timer);finishGame(room);return respond(res,200,{ok:true});}if(d.action==='start'){if(room.hostId!==p.id)return respond(res,403,{error:'Only the host can start'});if(room.players.size<2)return respond(res,400,{error:'Need at least 2 players'});showHowTo(room);return respond(res,200,{ok:true});}if(d.action==='answer'){if(room.phase!=='write')return respond(res,409,{error:'Writing is closed'});const answer=String(d.answer||'').trim().slice(0,70);if(answer.length<2)return respond(res,400,{error:'Make your bluff a little longer'});if(closeEnough(answer,room.current[2]))return respond(res,400,{error:'Too close, try again'});p.answer=answer;broadcast(room);if([...room.players.values()].every(x=>x.answer))finishWrite(room);return respond(res,200,{ok:true});}if(d.action==='vote'){if(room.phase!=='vote')return respond(res,409,{error:'Voting is closed'});const choice=room.choices.find(x=>x.id===d.choice);if(!choice)return respond(res,400,{error:'Invalid choice'});if(choice.author===p.id)return respond(res,400,{error:'You cannot vote for your own bluff'});p.vote=choice.id;broadcast(room);if([...room.players.values()].every(x=>x.vote))finishVote(room);return respond(res,200,{ok:true});}return respond(res,400,{error:'Unknown action'});}
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1); const path=join(__dirname,'public',file); if(existsSync(path)){const type=path.endsWith('.css')?'text/css':path.endsWith('.js')?'application/javascript':'text/html';res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-cache'});return res.end(readFileSync(path));}res.writeHead(404);res.end('Not found');
});
setInterval(()=>{const now=Date.now();for(const [c,room] of rooms){if(now-(room.touched||0)>2*60*60*1000&&!room.clients.size){clearTimeout(room.timer);rooms.delete(c);continue;}for(const res of room.clients)res.write(': ping\n\n');}},25000);
server.listen(PORT,()=>console.log(`BluffBurst at http://localhost:${PORT}`));
