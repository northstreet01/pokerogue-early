// Display-only loading barrier. Never changes or acknowledges the rule model.
let sequence=0;
export function beginLoading(label, loader, doc=globalThis.document) {
 if(!doc?.createElement)return {complete(){},fail(){}};
 let panel=doc.getElementById('game-loading');
 if(!panel){panel=doc.createElement('aside');panel.id='game-loading';doc.body.append(panel);}
 const owner=++sequence;panel.dataset.owner=String(owner);panel.hidden=false;
 panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');
 Object.assign(panel.style,{position:'fixed',inset:'0',zIndex:'2000',background:'#111b2b',color:'#fff',display:'grid',placeContent:'center',padding:'24px',textAlign:'center',font:'16px/1.7 system-ui'});
 const text=doc.createElement('div');text.textContent=label;
 const detail=doc.createElement('div');detail.textContent='正在准备素材，请稍候…';
 panel.replaceChildren(text,detail);
 const current=()=>panel.dataset.owner===String(owner);
 const progress=value=>{if(current())detail.textContent='素材加载 '+Math.floor(value*100)+'%；首次远程加载可能较慢';};
 loader?.on?.('progress',progress);
 const clean=()=>loader?.off?.('progress',progress);
 return {complete(){clean();if(current()){panel.hidden=true;panel.style.display='none';}},
 fail(message){clean();if(!current())return;detail.textContent='加载未完成：'+message;
 const retry=doc.createElement('button');retry.type='button';retry.textContent='重试加载（保留存档与房间）';retry.onclick=()=>globalThis.location.reload();panel.append(retry);}};
}
