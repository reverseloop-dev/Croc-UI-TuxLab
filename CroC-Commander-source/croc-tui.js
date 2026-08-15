#!/usr/bin/env node
// Croc Commander DOS - retro dual-pane file manager TUI
// (c) ReverseLoo-Dev - croc-ui.tuxlab.site

"use strict";
var fs=require("fs"),path=require("path"),os=require("os"),cp=require("child_process"),readline=require("readline");

// ---- box-drawing fallback for Windows codepage ----
var B=function(){
  var u=true;
  if(process.platform==="win32"){
    try{var r=cp.execSync("chcp",{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();var m=r.match(/(\d+)/);if(m&&(m[1]==="437"||m[1]==="850"))u=false}catch(e){}
    if(!u)try{cp.execSync("chcp 65001>NUL",{stdio:"ignore"});u=true}catch(e){}
  }
  if(u)return{TL:String.fromCharCode(9556),TR:String.fromCharCode(9559),BL:String.fromCharCode(9562),BR:String.fromCharCode(9565),HZ:String.fromCharCode(9552),VT:String.fromCharCode(9553)};
  return{TL:"+",TR:"+",BL:"+",BR:"+",HZ:"=",VT:"|"};
}();

// ---- croc detection ----
function findCroc(){
  if(process.env.CROC_BIN)return process.env.CROC_BIN;
  var n=process.platform==="win32"?["croc.exe"]:["croc"];
  var d=[__dirname,process.cwd()];
  for(var a=0;a<d.length;a++)for(var b=0;b<n.length;b++){var f=path.join(d[a],n[b]);try{if(fs.existsSync(f))return f}catch(e){}}
  try{var o=cp.execSync("where croc 2>nul||which croc 2>/dev/null",{encoding:"utf8",timeout:5000}).trim();if(o)return o.split(/\r?\n/)[0].trim()}catch(e){}
  return null;
}
var CROC=findCroc(),CROC_MAJOR=0;
function detectCroc(){if(CROC_MAJOR||!CROC)return;try{var v=cp.execSync('"'+CROC+'" --version',{encoding:"utf8",stdio:["ignore","pipe","ignore"]});var m=v.match(/(\d+)\./);if(m)CROC_MAJOR=parseInt(m[1],10)}catch(e){}}

// ---- path helpers ----
function norm(p){
  if(!p)return p;
  var abs=p.indexOf("/")===0||/^[A-Za-z]:/.test(p);
  var out=[];var parts=String(p).replace(/\\/g,"/").split("/");
  for(var i=0;i<parts.length;i++){var pt=parts[i];if(!pt||pt===".")continue;
    if(pt===".."){if(out.length&&out[out.length-1]!=="..")out.pop();else if(!abs)out.push("..");}else out.push(pt);}
  var r=out.join("/");
  if(abs&&r.indexOf("/")!==0&&!/^[A-Za-z]:/.test(r))r="/"+r;
  return r||(abs?"/":".");
}
function jn(a,b){return norm(a+"/"+b);}
function rp(c,n){return Array(Math.max(0,n)+1).join(c);}
function pad(s,w){s=String(s);return s.length>=w?s.slice(0,w):s+rp(" ",w-s.length);}
function fmtSize(n){
  if(n<0)return"<DIR>";if(n<1024)return n+" B";
  var u=["KB","MB","GB","TB"],v=n/1024,i=0;
  while(v>=1024&&i<3){v/=1024;i++}
  return(v>=100?Math.floor(v):v.toFixed(1))+" "+u[i];
}
function fmtDate(ms){
  if(!ms)return"";var d=new Date(ms);
  function p2(x){return(x<10?"0":"")+x;}
  return p2(d.getDate())+"-"+p2(d.getMonth()+1)+"-"+String(d.getFullYear()).slice(2);
}
function fmtTime(ms){
  if(!ms)return"";var d=new Date(ms);
  function p2(x){return(x<10?"0":"")+x;}
  return p2(d.getHours())+":"+p2(d.getMinutes());
}
function modeStr(m){
  function b(bit){return(m&bit)?"x":"-";}
  return"rw"+b(64)+b(8)+b(1)+b(32)+b(2)+b(16)+b(4);
}

// ---- screen buffer (double buffer) ----
var SB=[],tw=80,th=25;
function sbI(){SB=[];for(var y=0;y<th;y++)SB[y]="";}
function sb(x,y,t){
  if(y<0||y>=th)return;
  var l=SB[y]||"";while(l.length<tw)l+=" ";
  for(var i=0;i<t.length;i++){var px=x+i;if(px>=tw)break;if(px>=0)l=l.slice(0,px)+t[i]+l.slice(px+1);}
  SB[y]=l;
}
function sf(y,c,w){var n=Math.min(w||tw,tw);sb(0,y,rp(c,n));}
function flush(){var o="";for(var y=0;y<th;y++){var l=SB[y]||"";while(l.length<tw)l+=" ";o+="\x1b["+(y+1)+";1H"+l;}process.stdout.write(o);}
function esc(s){process.stdout.write("\x1b["+s);}
function cls(){process.stdout.write("\x1b[2J\x1b[H");}
function hideCur(){process.stdout.write("\x1b[?25l");}
function showCur(){process.stdout.write("\x1b[?25h");}

// ---- sync readDir (simple and working) ----
function readDir(pth){
  try{
    var items=fs.readdirSync(pth,{withFileTypes:true});
    var out=[];var i,it,full,st;
    for(i=0;i<items.length;i++){
      it=items[i];
      try{full=path.join(pth,it.name);st=fs.statSync(full);
        out.push({name:it.name,size:st.isDirectory()?-1:st.size,isDir:st.isDirectory(),mtime:st.mtimeMs,mode:modeStr(st.mode)});
      }catch(e){out.push({name:it.name,size:-1,isDir:it.isDirectory(),mtime:0,mode:""});}
    }
    var dirs=out.filter(function(e){return e.isDir;}).sort(function(a,b){return a.name.toLowerCase().localeCompare(b.name.toLowerCase());});
    var files=out.filter(function(e){return!e.isDir;}).sort(function(a,b){return a.name.toLowerCase().localeCompare(b.name.toLowerCase());});
    return dirs.concat(files);
  }catch(e){return[];}
}

// ---- state ----
var relay="",relayPass="",custom="";
var pl={path:os.homedir(),entries:[],rows:[],cursor:0,top:0,selected:{}};
var pr={path:process.platform==="win32"?"C:\\":"/tmp",entries:[],rows:[],cursor:0,top:0,selected:{}};
var act=pl,mode="browse",msgTitle="",msgLines=[],msgScroll=0;
var pLabel="",pBuf="",pCb=null;
var mOpen=false,mIdx=0,mCur=0;
var MENUS={"Sinistra":["Breve","Completo","Info","Rileggi","Ordina","Drive"],"File":["Invia file","Ricevi file","Codice personalizzato","Imposta relay","Vedi","Modifica","Info file"],"Comandi":["Trova file","Cronologia","Scambia pannelli","Info sistema","Aiuto","Esci"],"Opzioni":["Colori","Mostra nascosti","Barra tasti"],"Destra":["Breve","Completo","Info","Rileggi","Ordina","Drive"]};
var MENU_NAMES=["Sinistra","File","Comandi","Opzioni","Destra"];

function loadP(p){
  p.entries=readDir(p.path);
  p.rows=[{name:".",size:-1,isDir:true,mtime:0,mode:""},{name:"..",size:-1,isDir:true,mtime:0,mode:""}].concat(p.entries);
  if(p.cursor>=p.rows.length)p.cursor=Math.max(0,p.rows.length-1);
  if(p.top>p.cursor)p.top=p.cursor;
}
function loadBoth(){loadP(pl);loadP(pr);}
function cdP(p,d){
  try{if(fs.statSync(d).isDirectory()){p.path=norm(d);p.cursor=0;p.top=0;p.selected={};loadP(p);}}catch(e){}
}

// ---- drawing ----
function drawPanel(p,x0,x1,y0,h){
  var W=x1-x0+1,iw=W-2,es=p.rows,ia=(p===act),cursor=p.cursor,top=p.top;
  if(cursor<top)top=cursor;
  if(cursor>=top+h)top=cursor-h+1;
  top=Math.max(0,top);
  var sty="\x1b[38;2;0;215;215m";
  sb(x0,y0,sty+B.TL+B.HZ+" "+pad(p.path,iw-3)+B.HZ+B.TR+"\x1b[0m");
  var hl="\x1b[38;2;255;255;0m\x1b[1m";
  sb(x0,y0+1,sty+B.VT+" "+hl+pad("Nome",iw-30)+pad("Dimens.",8)+pad("Data",8)+pad("Ora",5)+pad("Attrib.",9)+"\x1b[0m"+sty+B.VT+"\x1b[0m");
  for(var i=0;i<h;i++){
    var idx=top+i,y=y0+2+i;
    if(idx>=es.length){sb(x0,y,sty+B.VT+Array(iw+1).join(" ")+B.VT+"\x1b[0m");continue;}
    var e=es[idx],isCur=(idx===cursor&&ia),isSel=!!p.selected[e.name];
    var st=sty+B.VT;
    if(isCur)st+="\x1b[48;2;0;80;80m\x1b[38;2;0;200;200m\x1b[1m";
    else if(isSel)st+="\x1b[48;2;0;100;200m\x1b[38;2;212;212;212m";
    else if(e.isDir)st+="\x1b[38;2;255;255;0m";
    else st+="\x1b[38;2;212;212;212m";
    var line=pad((isSel?"[*] ":"    ")+e.name,iw-34)+pad(e.isDir?"<DIR>":fmtSize(e.size),8)+pad(fmtDate(e.mtime),8)+pad(fmtTime(e.mtime),5)+pad(e.mode||"",9);
    sb(x0,y,st+pad(line,iw)+"\x1b[0m"+sty+B.VT+"\x1b[0m");
  }
  sb(x0,y0+2+h,sty+B.BL+rp(B.HZ,iw)+B.BR+"\x1b[0m");
  var sn=0,k;for(k in p.selected)if(p.selected[k])sn++;
  sb(x0,y0+3+h,"\x1b[38;2;128;128;128m\x1b[48;2;0;0;210m "+pad(p.path+"  file: "+p.entries.length+"  selezionati: "+sn,iw+1)+"\x1b[0m");
  p.top=top;
}
function draw(){
  var W=tw,H=th,hf=Math.max(25,Math.floor((W-3)/2)),lh=Math.max(4,H-11);
  sbI();
  for(var y=0;y<H;y++)sf(y," ");
  var b="croc-ui.tuxlab.site",bx=Math.floor((W-b.length)/2);
  sb(0,0,"\x1b[48;2;0;0;0m\x1b[38;2;0;215;215m\x1b[1m"+rp(" ",bx)+b+"\x1b[0m");
  sb(0,1,"\x1b[48;2;0;0;0m Sinistra  File  Comandi  Opzioni  Destra\x1b[0m");
  drawPanel(pl,0,hf,2,lh);
  drawPanel(pr,hf+3,W-1,2,lh);
  for(var y=2;y<H;y++)sb(hf+1,y,"\x1b[48;2;0;215;215m \x1b[0m");
  var p2=act,sn=0,k;for(k in p2.selected)if(p2.selected[k])sn++;
  var st=" "+p2.path+"  file: "+p2.entries.length+"  selezionati: "+sn;
  if(relay)st+="  Relay: "+relay;if(custom)st+="  Codice: "+custom;
  sb(0,H-4,"\x1b[38;2;128;128;128m\x1b[48;2;0;0;210m"+pad(st,W)+"\x1b[0m");
  sb(0,H-3,"\x1b[38;2;255;255;0m "+act.path+"> \x1b[0m");
  var ks=[["1","Aiuto"],["2","Edit"],["3","Visualizza"],["4","Info"],["5","Invia"],["6","Ricevi"],["7","Codice"],["8","Relay"],["9","Menu"],["10","Esci"]];
  for(var i=0;i<10;i++){var x=i*(W/10);sb(x,H-1,"\x1b[48;2;0;200;200m\x1b[38;2;0;0;0m "+ks[i][0]+" \x1b[0m");sb(x+3,H-1,"  "+ks[i][1]+"\x1b[0m");}
  flush();
}
function redraw(){loadBoth();cls();hideCur();draw();}

// ---- menu ----
function drawMenu(){
  var items=MENUS[MENU_NAMES[mIdx]];var bw=0;
  for(var i=0;i<items.length;i++)if(items[i].length+2>bw)bw=items[i].length+2;
  var x=mIdx*10;
  for(var i=0;i<items.length;i++){sb(x,1+i,(i===mCur?"\x1b[48;2;0;100;200m\x1b[38;2;212;212;212m":"\x1b[48;2;0;0;210m\x1b[38;2;212;212;212m")+pad(" "+items[i],bw)+"\x1b[0m");}
  flush();
}
function closeMenu(){mOpen=false;draw();}
function openMenu(){mOpen=true;mIdx=0;mCur=0;drawMenu();}
function execMenu(){
  var name=MENU_NAMES[mIdx],item=MENUS[name][mCur];
  mOpen=false;
  if(name==="File"){
    if(item==="Invia file")actionSend();else if(item==="Ricevi file")actionRecv();
    else if(item==="Codice personalizzato")actionCode();else if(item==="Imposta relay")actionRelay();
    else if(item==="Vedi"||item==="Modifica")actionView();else if(item==="Info file")actionInfo();
    return;
  }
  if(name==="Comandi"){
    if(item==="Scambia pannelli"){var t=pl.path;pl.path=pr.path;pr.path=t;loadBoth();draw();return;}
    if(item==="Info sistema")actionSysInfo();else if(item==="Aiuto")actionHelp();else if(item==="Esci")cleanup();
    else showMsg("Info",item+"\nNon implementato.");
    return;
  }
  if(item==="Rileggi"){loadP(act);draw();return;}
  if(item==="Drive"){cdP(act,"/");draw();return;}
  showMsg("Menu",item+"\nNon implementato.");
}

// ---- dialogs ----
function showMsg(title,text){
  msgTitle=title;msgLines=String(text).split("\n");mode="msg";msgScroll=0;drawMsg(0);
}
function drawMsg(soff){
  var lines=msgLines,bw=msgTitle.length+2;
  for(var i=0;i<lines.length;i++){var l=lines[i].length+4;if(l>bw)bw=l;}
  bw=Math.min(bw,tw-4);var maxL=Math.min(lines.length,th-6);var bh=maxL+4;
  var x0=Math.max(0,Math.floor((tw-bw)/2)),y0=Math.max(0,Math.floor((th-bh)/2));
  soff=Math.max(0,Math.min(soff,lines.length-maxL));msgScroll=soff;
  for(var y=0;y<bh;y++)sb(0,y0+y,rp(" ",bw));
  sb(x0+1,y0,"\x1b[48;2;0;0;0m\x1b[1m\x1b[38;2;255;255;0m"+pad(msgTitle,bw-2)+"\x1b[0m");
  for(var i=0;i<maxL&&(soff+i)<lines.length;i++)
    sb(x0+2,y0+2+i,"\x1b[48;2;0;0;170m\x1b[38;2;212;212;212m"+pad(lines[soff+i],bw-4)+"\x1b[0m");
  var foot=" Premere un tasto";
  if(soff>0||soff+maxL<lines.length)foot+=" (su/giu per scorrere)";
  sb(x0+1,y0+bh-1,"\x1b[38;2;255;255;0m"+foot+"..."+"\x1b[0m");
  flush();
}


function startPrompt(label,def,cb){pLabel=label;pBuf=def||"";pCb=cb;mode="prompt";drawPrompt();}
function drawPrompt(){
  sb(0,th-3,"\x1b[38;2;255;255;0m"+pLabel+" "+pBuf+rp(" ",60)+"\x1b[0m");flush();
}

// ---- croc ops ----
function selFiles(){
  var out=[],p=act;
  for(var i=0;i<p.entries.length;i++){var e=p.entries[i];if(p.selected[e.name]&&!e.isDir)out.push(jn(p.path,e.name));}
  if(!out.length){var cur=p.rows[p.cursor];if(cur&&!cur.isDir&&cur.name!=="."&&cur.name!=="..")out.push(jn(p.path,cur.name));}
  return out;
}
function crocSend(files,cb){
  detectCroc();if(!CROC){cb(false,"croc non trovato");return;}
  var env=Object.assign({},process.env);
  if(relay)env.CROC_RELAY=relay;if(relayPass)env.CROC_PASS=relayPass;
  var args;
  if(CROC_MAJOR>=10){
    args=["--yes","--ignore-stdin","send"];if(custom)env.CROC_SECRET=custom;args=args.concat(files);
  }else{args=["send"];if(custom)args.push("--code",custom);args=args.concat(files);}
  var proc=cp.spawn(CROC,args,{env:env,stdio:["ignore","pipe","pipe"]});var out="";
  proc.stdout.on("data",function(d){out+=d.toString();});
  proc.stderr.on("data",function(d){out+=d.toString();});
  proc.on("close",function(code){if(code===0){var m=out.match(/Code is: (\S+)/);cb(true,m?m[1]:"");}else cb(false,"codice "+code);});
  proc.on("error",function(e){cb(false,e.message);});
}
function crocRecv(code,dest,cb){
  detectCroc();if(!CROC){cb(false,"croc non trovato");return;}
  var env=Object.assign({},process.env);
  if(relay)env.CROC_RELAY=relay;if(relayPass)env.CROC_PASS=relayPass;
  var args;
  if(CROC_MAJOR>=10){args=["--yes","--ignore-stdin","--out",dest];env.CROC_SECRET=code;}
  else{args=["--yes",code];if(relay)args.push("--relay",relay);}
  var proc=cp.spawn(CROC,args,{env:env,stdio:["ignore","pipe","pipe"],cwd:dest});
  proc.on("close",function(code){if(code===0)cb(true,"OK");else cb(false,"codice "+code);});
  proc.on("error",function(e){cb(false,e.message);});
}

// ---- actions ----
function actionSend(){
  var f=selFiles();if(!f.length){showMsg("Errore","Nessun file selezionato.\nUsare Spazio per selezionare.");return;}
  showMsg("Invio file","Invio in corso...");
  crocSend(f,function(ok,info){showMsg("Invio",ok?"OK! Codice: "+info:"ERRORE: "+info);});
}
function actionRecv(){
  startPrompt("Codice ricezione:","",function(c){
    if(!c){mode="browse";draw();return;}
    showMsg("Ricezione","Ricezione in corso...");
    crocRecv(c,act.path,function(ok,info){
      showMsg("Ricezione",ok?"OK! File ricevuti.":"ERRORE: "+info);loadBoth();draw();
    });
  });
}
function actionCode(){startPrompt("Codice personalizzato:",custom,function(c){custom=c.toUpperCase();mode="browse";draw();});}
function actionRelay(){
  startPrompt("Relay (host:porta):",relay,function(a){relay=a;
    startPrompt("Password relay:",relayPass,function(p){relayPass=p;mode="browse";draw();});});
}
function actionInfo(){
  var e=act.rows[act.cursor];if(!e){showMsg("Info","Nessun file");return;}
  var name=e.name,full;
  if(name===".")full=act.path;else if(name==="..")full=path.dirname(path.resolve(act.path));else full=jn(act.path,name);
  try{var st=fs.statSync(full);
    showMsg("Info file","Nome:       "+(name==="."?path.basename(full):name)+"\nPercorso:   "+full+"\nDimensione: "+(st.isDirectory()?"<DIR>":fmtSize(st.size))+"\nModificato: "+(st.mtime?new Date(st.mtime).toLocaleString():"-")+"\nAttributi:  "+modeStr(st.mode)+"\n\nCreato da ReverseLoo-Dev\ncroc-ui.tuxlab.site");
  }catch(err){showMsg("Info","Errore: "+err.message);}
}
function actionSysInfo(){
  showMsg("Info sistema","Host:     "+os.hostname()+"\nSO:       "+os.platform()+" "+os.release()+"\nArch:     "+os.arch()+"\nCPU:      "+os.cpus().length+" core\nMemoria:  "+fmtSize(os.totalmem())+" totale\nHome:     "+os.homedir()+"\n\nCreato da ReverseLoo-Dev\ncroc-ui.tuxlab.site");
}
function actionHelp(){
  showMsg("Aiuto","Croc Commander DOS - retro dual-pane file manager\n\nTab          Cambia pannello\nFrecce       Sposta cursore\nInvio        Entra cartella\nBackspace    Cartella superiore\nSpazio/Ins   Seleziona file\nF1           Aiuto\nF2           Modifica file\nF3           Visualizza file\nF4           Info file\nF5           Invia file (croc)\nF6           Ricevi file (croc)\nF7           Codice personalizzato\nF8           Imposta relay\nF9           Menu a tendina\nF10 / Esc    Esci\n\ncroc-ui.tuxlab.site\nCreato da ReverseLoo-Dev");
}
function actionView(){
  var e=act.rows[act.cursor];if(!e||e.isDir||e.name==="."||e.name==="..")return;
  var full=jn(act.path,e.name);
  try{var c=fs.readFileSync(full,"utf8").slice(0,4096);showMsg("Visualizza: "+e.name,c);}catch(err){showMsg("Errore",err.message);}
}

// ---- key handling ----
function handleKey(key){
  var p=act,e;
  if(mode==="msg"){
    if(key.name==="up"&&msgScroll>0){drawMsg(msgScroll-1);return;}
    if(key.name==="down"){drawMsg(msgScroll+1);return;}
    mode="browse";draw();return;
  }
  if(mode==="prompt"){
    if(key.name==="return"){var v=pBuf;mode="browse";if(pCb)pCb(v);return;}
    if(key.name==="escape"){mode="browse";if(pCb)pCb("");return;}
    if(key.name==="backspace"){if(pBuf.length)pBuf=pBuf.slice(0,-1);drawPrompt();return;}
    if(key.sequence&&key.sequence.length===1&&key.sequence>=" "&&key.sequence<="~"){pBuf+=key.sequence;drawPrompt();return;}
    return;
  }
  if(mOpen){
    if(key.name==="escape"){closeMenu();return;}
    if(key.name==="left"){mIdx=(mIdx+4)%5;mCur=0;drawMenu();return;}
    if(key.name==="right"){mIdx=(mIdx+1)%5;mCur=0;drawMenu();return;}
    if(key.name==="down"){mCur=Math.min(mCur+1,MENUS[MENU_NAMES[mIdx]].length-1);drawMenu();return;}
    if(key.name==="up"){mCur=Math.max(0,mCur-1);drawMenu();return;}
    if(key.name==="return"){execMenu();return;}
    return;
  }
  if(key.name==="escape"||key.name==="f10"){cleanup();return;}
  if(key.ctrl&&key.name==="c"){cleanup();return;}
  if(key.name==="tab"){act=(act===pl)?pr:pl;draw();return;}
  if(key.name==="up"){if(p.cursor>0){p.cursor--;draw();}return;}
  if(key.name==="down"){if(p.cursor<p.rows.length-1){p.cursor++;draw();}return;}
  if(key.name==="pageup"){p.cursor=Math.max(0,p.cursor-20);draw();return;}
  if(key.name==="pagedown"){p.cursor=Math.min(p.rows.length-1,p.cursor+20);draw();return;}
  if(key.name==="home"){p.cursor=0;draw();return;}
  if(key.name==="end"){p.cursor=p.rows.length-1;draw();return;}
  if(key.name==="return"||key.name==="right"){e=p.rows[p.cursor];if(e&&e.isDir){if(e.name==="..")cdP(p,path.dirname(path.resolve(p.path)));else if(e.name!==".")cdP(p,jn(p.path,e.name));draw();}return;}
  if(key.name==="backspace"||key.name==="left"){cdP(p,path.dirname(path.resolve(p.path)));draw();return;}
  if(key.name==="space"||key.name==="insert"){e=p.rows[p.cursor];if(e&&e.name!=="."&&e.name!==".."){if(p.selected[e.name])delete p.selected[e.name];else p.selected[e.name]=true;if(p.cursor<p.rows.length-1)p.cursor++;draw();}return;}
  if(key.name==="f1"){actionHelp();return;}
  if(key.name==="f2"||key.name==="f3"){actionView();return;}
  if(key.name==="f4"){actionInfo();return;}
  if(key.name==="f5"){actionSend();return;}
  if(key.name==="f6"){actionRecv();return;}
  if(key.name==="f7"){actionCode();return;}
  if(key.name==="f8"){actionRelay();return;}
  if(key.name==="f9"){openMenu();return;}
}
function cleanup(){
  try{process.stdin.setRawMode(false);}catch(e){}
  showCur();process.stdout.write("\x1b[0m\nCroc Commander DOS terminato.\ncroc-ui.tuxlab.site  |  Creato da ReverseLoo-Dev\n\n");
  process.exit(0);
}

// ---- main ----
function main(){
  try{tw=process.stdout.columns||80;th=process.stdout.rows||25;}catch(e){}
  readline.emitKeypressEvents(process.stdin);
  try{process.stdin.setRawMode(true);}catch(e){}
  process.stdin.on("keypress",function(str,key){if(!key)key={name:str,sequence:str,ctrl:false};handleKey(key);});
  process.stdout.on("resize",function(){try{tw=process.stdout.columns||80;th=process.stdout.rows||25;}catch(e){}if(mode==="browse"||mode==="msg")draw();});
  redraw();
}
main();