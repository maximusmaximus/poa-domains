// One controller per strip. Fractional position is retained: slow motion must not round to zero each frame.
const controllers=new WeakMap();
export function itemStep(el,gap=12){
 const n=el?.nextElementSibling,p=el?.previousElementSibling;
 if(n)return n.getBoundingClientRect().left-el.getBoundingClientRect().left;
 if(p)return el.getBoundingClientRect().left-p.getBoundingClientRect().left;
 return(el?.getBoundingClientRect().width||0)+gap;
}
export function autoScroll(node,{speed=20,direction=1,advance,onScroll,onScrollSettle}={}){
 if(!node)return;
 const prior=controllers.get(node);
 if(prior){prior.speed=speed;prior.direction=direction<0?-1:1;prior.advance=advance;prior.onScroll=onScroll;prior.onScrollSettle=onScrollSettle;return prior;}
 const media=globalThis.matchMedia?.("(prefers-reduced-motion: reduce)"),noHover=globalThis.matchMedia?.("(hover: none)");
 let hovered=false,touching=false,dragging=false,dragMoved=false,dragStartX=0,dragLastX=0,suppressClickUntil=0,focusFromPointer=false,lastTouchAt=-Infinity,until=0,settleTimer=null,last=performance.now(),position=node.scrollLeft,expectedScroll=node.scrollLeft;
 const hasKbFocus=()=>node.contains(document.activeElement)&&!focusFromPointer;
 const state={
  speed,direction:direction<0?-1:1,advance,onScroll,onScrollSettle,
  interacting:()=>hovered||touching||dragging||hasKbFocus()||performance.now()<until,
  paused:()=>state.interacting()||document.hidden,
  reset(next=0){const t=typeof next==="number"&&Number.isFinite(next)?Math.max(0,next):0;position=expectedScroll=node.scrollLeft=t;},
 };
 const pause=()=>{until=performance.now()+1800;position=expectedScroll=node.scrollLeft;};
 const applyAdjust=dir=>{
  if(!state.onScroll)return;
  const next=state.onScroll(node,node.scrollLeft,dir);
  if(typeof next==="number"&&Number.isFinite(next)){if(Math.abs(next-node.scrollLeft)>0.5)node.scrollLeft=next;position=expectedScroll=node.scrollLeft;}
 };
 const scheduleSettle=()=>{
  clearTimeout(settleTimer);if(!state.onScrollSettle)return;
  settleTimer=setTimeout(()=>{
   if(!node.isConnected||touching||dragging||hovered)return;
   const next=state.onScrollSettle(node,node.scrollLeft);
   if(typeof next==="number"&&Number.isFinite(next)){if(Math.abs(next-node.scrollLeft)>0.5)node.scrollLeft=next;position=expectedScroll=node.scrollLeft;}
  },140);
 };
 const beginTouch=()=>{touching=true;hovered=false;focusFromPointer=true;lastTouchAt=performance.now();clearTimeout(settleTimer);pause();};
 const endTouch=()=>{if(!touching)return;touching=false;hovered=false;lastTouchAt=performance.now();pause();scheduleSettle();};
 const endDrag=()=>{if(!dragging)return;const moved=dragMoved;dragging=false;dragMoved=false;node.classList.remove("is-dragging");if(moved){suppressClickUntil=performance.now()+250;pause();scheduleSettle();}};
 const onTouchEnd=e=>{if(e.type==="touchend"&&(e.touches?.length??0)>0)return;endTouch();};
 const onMove=e=>{
  if(!dragging)return;
  if(!dragMoved&&Math.abs(e.clientX-dragStartX)>6){dragMoved=true;node.classList.add("is-dragging");pause();}
  if(!dragMoved)return;
  const step=e.clientX-dragLastX;dragLastX=e.clientX;
  if(step!==0){
   const dir=step<0?1:-1;
   if((dir<0&&node.scrollLeft<=2)||(dir>0&&node.scrollLeft>=node.scrollWidth-node.clientWidth-2))applyAdjust(dir);
   node.scrollLeft-=step;expectedScroll=position=node.scrollLeft;applyAdjust(dir);pause();
  }
 };
 const onPtrEnd=e=>{if(!e.pointerType||e.pointerType==="touch")endTouch();endDrag();};
 const onKey=()=>{focusFromPointer=false;};
 const onReset=()=>{hovered=false;endDrag();endTouch();};
 node.addEventListener("pointerenter",e=>{if(e.pointerType!=="mouse"||performance.now()-lastTouchAt<1200||noHover?.matches)return;hovered=true;});
 node.addEventListener("pointerleave",e=>{if(hovered||e.pointerType==="mouse")hovered=false;});
 node.addEventListener("touchstart",beginTouch,{passive:true});
 node.addEventListener("touchmove",beginTouch,{passive:true});
 node.addEventListener("pointerdown",e=>{
  focusFromPointer=true;
  if(e.pointerType==="touch")beginTouch();
  else{if(e.pointerType==="mouse"&&e.button===0){dragging=true;dragMoved=false;dragStartX=dragLastX=e.clientX;}pause();}
 },{passive:true});
 node.addEventListener("click",e=>{if(performance.now()<suppressClickUntil){e.preventDefault();e.stopPropagation();}},true);
 node.addEventListener("dragstart",e=>e.preventDefault());
 for(const t of["touchend","touchcancel"])globalThis.addEventListener?.(t,onTouchEnd,{passive:true});
 globalThis.addEventListener?.("pointermove",onMove,{passive:true});
 for(const t of["pointerup","pointercancel"])globalThis.addEventListener?.(t,onPtrEnd,{passive:true});
 globalThis.addEventListener?.("keydown",onKey,{passive:true});
 globalThis.addEventListener?.("blur",onReset,{passive:true});
 document.addEventListener?.("visibilitychange",onReset,{passive:true});
 document.documentElement?.addEventListener?.("mouseleave",onReset,{passive:true});
 node.addEventListener("wheel",e=>{
  const dx=e.deltaX||(e.shiftKey?e.deltaY:0);
  if(dx!==0){
   const dir=dx>0?1:-1;
   if((dir<0&&node.scrollLeft<=2)||(dir>0&&node.scrollLeft>=node.scrollWidth-node.clientWidth-2))applyAdjust(dir);
   if(e.shiftKey&&!e.deltaX){e.preventDefault();node.scrollLeft+=dx;expectedScroll=position=node.scrollLeft;}
   applyAdjust(dir);
  }
  pause();scheduleSettle();
 },{passive:false});
 for(const t of["keydown","focusout"])node.addEventListener(t,()=>{if(t==="focusout"&&!node.contains(document.activeElement))focusFromPointer=false;pause();},{passive:true});
 node.addEventListener("scroll",()=>{
  const cur=node.scrollLeft,delta=cur-expectedScroll;
  if(Math.abs(delta)>2){const dir=delta>0?1:-1;pause();if(!touching&&!dragging&&!hovered&&Math.abs(delta)>24)applyAdjust(dir);if(!touching&&!dragging)scheduleSettle();}
 },{passive:true});
 const tick=now=>{
  if(!node.isConnected){
   clearTimeout(settleTimer);
   for(const t of["touchend","touchcancel"])globalThis.removeEventListener?.(t,onTouchEnd);
   globalThis.removeEventListener?.("pointermove",onMove);
   for(const t of["pointerup","pointercancel"])globalThis.removeEventListener?.(t,onPtrEnd);
   globalThis.removeEventListener?.("keydown",onKey);
   globalThis.removeEventListener?.("blur",onReset);
   document.removeEventListener?.("visibilitychange",onReset);
   document.documentElement?.removeEventListener?.("mouseleave",onReset);
   controllers.delete(node);return;
  }
  const dt=Math.min(64,now-last);last=now;
  if(state.paused()||!node.getClientRects().length){position=expectedScroll=node.scrollLeft;node.dataset.motion="paused";}
  else{
   node.dataset.motion="running";
   const dir=state.direction<0?-1:1,rate=media?.matches?Math.min(state.speed,12):state.speed;
   position+=(dir*dt*rate)/1000;
   if(state.advance)position=state.advance(node,position,dir);
   else if(node.scrollWidth>node.clientWidth){const max=node.scrollWidth-node.clientWidth;if(dir>0&&position>=max)position=0;else if(dir<0&&position<=0)position=max;}
   node.scrollLeft=position;expectedScroll=node.scrollLeft;
  }
  state.raf=requestAnimationFrame(tick);
 };
 state.raf=requestAnimationFrame(tick);controllers.set(node,state);return state;
}
