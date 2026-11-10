// One controller per strip. Fractional position is retained: slow motion must not round to zero each frame.
const controllers=new WeakMap();
export function autoScroll(node,{speed=20,advance}={}) {
 if(!node)return;const prior=controllers.get(node);if(prior){prior.advance=advance;return prior;}
 const media=globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");let hovered=false,until=0,last=performance.now(),position=node.scrollLeft;
 const state={advance,paused:()=>hovered||node.contains(document.activeElement)||performance.now()<until||!!media?.matches||document.hidden};
 const pause=()=>{until=performance.now()+1800;position=node.scrollLeft;};
 node.addEventListener("pointerenter",e=>{if(e.pointerType!=="touch")hovered=true;});node.addEventListener("pointerleave",()=>{hovered=false;pause();});
 for(const type of ["wheel","touchstart","touchmove","touchend","pointerdown","pointerup","keydown","focusout"])node.addEventListener(type,pause,{passive:true});
 const tick=now=>{if(!node.isConnected){controllers.delete(node);return;}const dt=Math.min(64,now-last);last=now;if(state.paused()||!node.getClientRects().length){position=node.scrollLeft;node.dataset.motion=media?.matches?"reduced":"paused";}else{node.dataset.motion="running";position+=dt*speed/1000;node.scrollLeft=position;if(state.advance)position=state.advance(node,position);else if(node.scrollWidth>node.clientWidth&&position>=node.scrollWidth-node.clientWidth)position=node.scrollLeft=0;}
  state.raf=requestAnimationFrame(tick);
 };state.raf=requestAnimationFrame(tick);controllers.set(node,state);return state;
}
