'use strict';

/* ═══════════════════════════════════════════════════════════════════
   STEWARD CHARACTER CSS — injected verbatim from steward.html
   design system. Do not modify without updating steward.html too.
═══════════════════════════════════════════════════════════════════ */
(function injectCharacterStyles() {
  const style = document.createElement('style');
  style.textContent = `
/* ── ROOT TOKENS (character only) ─────────────────────────────────── */
.steward-wrap {
  --coat:#214839; --coat-deep:#143025;
  --vest:#d1a14a; --shirt:#f7f3ec;
  --skin:#f4dfbe; --hat:#163326; --hat-band:#d0a14c;
  --ink:#143126;
  --scene-scale:1.15; --scene-shift-x:0px; --scene-shift-y:-10px;
  --capsule-top:10px; --capsule-side:8px; --capsule-bottom:-2px;
  --capsule-radius:46px;
  --capsule-fill-top:rgba(255,255,255,0.16);
  --capsule-fill-bottom:rgba(255,255,255,0.04);
  --capsule-border:rgba(255,255,255,0.12);
  --money-opacity:0.14; --money-scale:0.82; --money-tilt:-4deg;
  --sparkle-opacity:0.14; --sign-opacity:0; --coin-opacity:0.2;
  --car-opacity:0; --car-shift-x:56px; --car-shift-y:20px;
  --car-scale:0.66; --ring-opacity:0; --coin-shower-opacity:0;
  --dog-opacity:0; --dog-scale:1; --dog-shift-x:0px; --dog-shift-y:0px;
  --ornament-opacity:0;
  --ledger-opacity:0; --coinup-opacity:0; --blueprint-opacity:0;
  --watch-opacity:0; --bowtie-opacity:1;
  --car-body:#113829; --car-body-deep:#0b251b;
  --car-accent:#d4a643; --car-window:rgba(208,231,238,0.92);
  --car-wheel:#23282d;
  --ground-scale-x:1.1; --ground-scale-y:1.05; --ground-lift:0px;
  --pose-rotate:-1.5deg; --pose-y:0px; --pose-scale:0.98;
  --stance:17px; --hat-tilt:-2deg;
  --arm-l:17deg; --arm-r:-18deg;
  --leg-l:1deg; --leg-r:-1deg;
  --shoe-lift-l:0px; --shoe-lift-r:0px;
  --mono-opacity:0.88; --mono-chain-opacity:0.72; --mono-tilt:0deg;
  --wear-vignette:0.22; --coat-shred:0.25; --lapel-gloss:0.34;
  --stache-l:5deg; --stache-r:-5deg;
  --cane-opacity:0.38; --cane-angle:7deg; --cane-x:0px;
  --cheek-opacity:0.18; --idle-ms:3.15s; --tail-flare:0.68;
  --coat-sheen:0.14; --mouth-w:17px; --mouth-y:1px;
  --mouth-scale-y:0.85; --mouth-rotate:0deg;
  --eye-open:0.88; --brow-l:6deg; --brow-r:-6deg;
  --glow:rgba(245,209,137,0.2);
  --upper-drop:0px; --chest-tilt:0deg; --head-tilt:0deg;
  --thigh-l:0deg; --thigh-r:0deg; --calf-l:0deg; --calf-r:0deg;
  --foot-l:0deg; --foot-r:0deg; --forearm-l:0deg; --forearm-r:0deg;
  --cane-y-nudge:0px; --torso-shift-x:0px;
  --character-scale:1;
  --character-bottom:18px;
  position:relative; width:158px; height:268px; overflow:visible;
  transform:translate3d(calc(var(--scene-shift-x) + var(--optical-x,0px)),calc(var(--scene-shift-y) + var(--optical-y,0px)),0) scale(var(--scene-scale));
  transform-origin:center bottom;
  will-change:transform;
  transition:transform 260ms cubic-bezier(0.22,1,0.36,1);
}
.steward-wrap::before {
  content:"";
  position:absolute;
  inset:var(--capsule-top) var(--capsule-side) var(--capsule-bottom);
  border-radius:var(--capsule-radius);
  background:
    linear-gradient(180deg, var(--capsule-fill-top) 0%, var(--capsule-fill-bottom) 68%, rgba(255,255,255,0.02) 100%),
    radial-gradient(circle at 50% 14%, var(--glow), rgba(255,255,255,0) 62%),
    radial-gradient(circle at 50% 100%, rgba(16,41,32,0.14), rgba(16,41,32,0) 58%);
  border:1px solid var(--capsule-border);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.16),
    0 18px 38px rgba(16,41,32,0.14);
  z-index:0;
  pointer-events:none;
}
.steward-sparkles,.steward-money,.sw-racecar,.steward-sign,
.steward-coin,.steward-coinfall{position:absolute;}
.sw-pose,.sw-ground,.sw-rig,.sw-upper-stack,.sw-pelvis,
.sw-hat,.sw-hat-shadow,.sw-hat-crown,.sw-hat-band,.sw-hat-brim,
.sw-hat-ding,.sw-head,.sw-cheek,.sw-eyebrow,.sw-eye,.sw-pupil,
.sw-eye-shine,.sw-lid,.sw-monocle,.sw-mono-rim,.sw-mono-glass,
.sw-mono-chain,.sw-mono-glint,.sw-nose,.sw-mustache,.sw-stache,
.sw-mouth,.sw-neck,.sw-collar,.sw-bowtie,.sw-bow-knot,
.sw-body,.sw-shoulder,.sw-coat-back,.sw-coat,.sw-lapel,.sw-vest,
.sw-btn,.sw-pocket,.sw-arm,.sw-upper-arm,.sw-forearm,
.sw-forearm-wrap,.sw-cuff,.sw-hand,.sw-thumb,.sw-cane,
.sw-cane-knob,.sw-cane-shaft,.sw-tails,.sw-tail,.sw-legs,
.sw-leg,.sw-thigh,.sw-calf,.sw-foot,.sw-shoe,.sw-sole-shadow,
.sw-held,.sw-blueprint,.sw-watch,.sw-watch-chain,
.sm-c,.sm-b,.sm-d,.rc-body,.rc-cabin,.rc-win-driver,
.rc-win-passenger,.rc-windshield,.rc-rear-win,.rc-spoiler,
.rc-stripe,.rc-headlight,.rc-taillight,.rc-grille,.rc-ornament,
.rc-orn-base,.rc-orn-post,.rc-orn-figure,.rc-orn-head,.rc-orn-body,
.rc-orn-wing-l,.rc-orn-wing-r,.rc-wheel,.rc-puff,.rc-coin,
.rc-ring,.rc-dollar,.rc-dog,.rc-dog-head,.rc-dog-head-wrap,
.rc-dog-body,.rc-dog-ear,.rc-dog-eye,.rc-dog-pupil,.rc-dog-shine,
.rc-dog-cheek,.rc-dog-snout,.rc-dog-nose,.rc-dog-tongue,
.rc-dog-hat-wrap,.rc-dog-hat-brim,.rc-dog-hat-body,.rc-dog-hat-band,
.wealthy-mansion,.wmn-body,.wmn-roof,.wmn-chimney,.wmn-wing,.wmn-wing-roof,
.wmn-col,.wmn-pediment,.wmn-door,.wmn-door-arch,.wmn-window,.wmn-steps,
.wmn-lantern,.wealthy-merc,.wmerc-shadow,.wmerc-body,.wmerc-hood,
.wmerc-grille,.wmerc-star,.wmerc-hl,.wmerc-drl,.wmerc-bumper,
.wmerc-intake,.wmerc-splitter,.wmerc-fender,.wmerc-reflect{position:absolute;}
.steward-character{position:absolute;left:50%;bottom:var(--character-bottom,18px);width:108px;height:236px;transform:translateX(-50%) scale(var(--character-scale,1));transform-origin:center bottom;z-index:3;transition:transform 0.28s ease;}
.sw-pose{inset:0;transform-origin:50% 100%;transform:translateY(var(--pose-y)) rotate(var(--pose-rotate)) scale(var(--pose-scale));will-change:transform;}
.sw-ground{left:50%;bottom:0;width:92px;height:12px;transform:translateX(-50%) translateY(var(--ground-lift)) scaleX(var(--ground-scale-x)) scaleY(var(--ground-scale-y));transform-origin:center center;border-radius:50%;background:radial-gradient(ellipse at 50% 40%,rgba(16,41,32,0.22),rgba(16,41,32,0) 72%);z-index:0;pointer-events:none;}
.sw-rig{left:50%;bottom:4px;width:108px;height:228px;margin-left:-54px;z-index:2;}
.sw-upper-stack{left:0;right:0;top:0;height:176px;transform-origin:50% 100%;transform:translateY(var(--upper-drop)) rotate(var(--chest-tilt));z-index:4;overflow:visible;}
.sw-pelvis{left:50%;top:159px;width:56px;height:19px;margin-left:-28px;border-radius:999px;background:linear-gradient(180deg,#1e3c30,#0f221a);box-shadow:inset 0 2px 0 rgba(255,255,255,0.07),inset 0 -4px 8px rgba(0,0,0,0.28);z-index:3;}
.steward-wrap[data-motion="rock"] .sw-pose{animation:swMotionRock var(--idle-ms) ease-in-out infinite;}
.steward-wrap[data-motion="broke"] .sw-pose{animation:swMotionBroke var(--idle-ms) ease-in-out infinite;}
.steward-wrap[data-motion="struggle"] .sw-pose{animation:swMotionStruggle var(--idle-ms) ease-in-out infinite;}
.steward-wrap[data-motion="survive"] .sw-pose{animation:swMotionSurvive var(--idle-ms) ease-in-out infinite;}
.steward-wrap[data-motion="stabilize"] .sw-pose{animation:swMotionStabilize var(--idle-ms) ease-in-out infinite;}
.steward-wrap[data-motion="stable"] .sw-pose{animation:swMotionStable var(--idle-ms) ease-in-out infinite;}
.steward-wrap[data-motion="build"] .sw-pose{animation:swMotionBuild var(--idle-ms) ease-in-out infinite;}
.steward-wrap[data-motion="thrive"] .sw-pose{animation:swMotionThrive var(--idle-ms) ease-in-out infinite;}
.steward-wrap[data-motion="win"] .sw-pose{animation:swMotionWin var(--idle-ms) ease-in-out infinite;}
.steward-wrap[data-motion="luxury"] .sw-pose{animation:swMotionLuxury var(--idle-ms) ease-in-out infinite;}
@keyframes swMotionRock{0%,100%{transform:translateY(var(--pose-y)) rotate(calc(var(--pose-rotate)+0.4deg)) translateX(-0.7px) scale(var(--pose-scale));}40%{transform:translateY(calc(var(--pose-y)+2px)) rotate(calc(var(--pose-rotate)-0.6deg)) translateX(0.9px) scale(calc(var(--pose-scale)*0.993));}72%{transform:translateY(calc(var(--pose-y)+1px)) rotate(calc(var(--pose-rotate)+0.3deg)) translateX(-0.9px) scale(var(--pose-scale));}}
@keyframes swMotionBroke{0%,100%{transform:translateY(var(--pose-y)) rotate(calc(var(--pose-rotate)+0.2deg)) translateX(-0.4px) scale(var(--pose-scale));}50%{transform:translateY(calc(var(--pose-y)+1px)) rotate(calc(var(--pose-rotate)-0.25deg)) translateX(0.4px) scale(var(--pose-scale));}}
@keyframes swMotionStruggle{0%,100%{transform:translateY(var(--pose-y)) rotate(calc(var(--pose-rotate)+0.25deg)) translateX(-0.4px) scale(var(--pose-scale));}33%{transform:translateY(calc(var(--pose-y)+0.8px)) rotate(calc(var(--pose-rotate)-0.28deg)) translateX(0.5px) scale(var(--pose-scale));}66%{transform:translateY(calc(var(--pose-y)+0.2px)) rotate(calc(var(--pose-rotate)+0.12deg)) translateX(-0.3px) scale(var(--pose-scale));}}
@keyframes swMotionSurvive{0%,100%{transform:translateY(var(--pose-y)) rotate(var(--pose-rotate)) scale(var(--pose-scale));}50%{transform:translateY(calc(var(--pose-y)-0.8px)) rotate(calc(var(--pose-rotate)+0.1deg)) scale(var(--pose-scale));}}
@keyframes swMotionStabilize{0%,100%{transform:translateY(var(--pose-y)) rotate(var(--pose-rotate)) scale(var(--pose-scale));}50%{transform:translateY(calc(var(--pose-y)-1.1px)) rotate(calc(var(--pose-rotate)+0.07deg)) scale(var(--pose-scale));}}
@keyframes swMotionStable{0%,100%{transform:translateY(var(--pose-y)) rotate(var(--pose-rotate)) scale(var(--pose-scale));}50%{transform:translateY(calc(var(--pose-y)-1.3px)) rotate(calc(var(--pose-rotate)+0.05deg)) scale(var(--pose-scale));}}
@keyframes swMotionBuild{0%,100%{transform:translateY(0) rotate(var(--pose-rotate)) scale(var(--pose-scale));}25%{transform:translateY(-4px) rotate(calc(var(--pose-rotate)+0.22deg)) scale(calc(var(--pose-scale)*1.004));}60%{transform:translateY(-1.5px) rotate(calc(var(--pose-rotate)-0.06deg)) scale(var(--pose-scale));}}
@keyframes swMotionThrive{0%,100%{transform:translateY(0) rotate(var(--pose-rotate)) scale(var(--pose-scale));}20%{transform:translateY(-6px) rotate(calc(var(--pose-rotate)+0.32deg)) scale(calc(var(--pose-scale)*1.007));}55%{transform:translateY(-3px) rotate(calc(var(--pose-rotate)-0.10deg)) scale(var(--pose-scale));}}
@keyframes swMotionWin{0%,100%{transform:translateY(0) rotate(var(--pose-rotate)) scale(var(--pose-scale));}50%{transform:translateY(-2.5px) rotate(calc(var(--pose-rotate)+0.06deg)) scale(calc(var(--pose-scale)*1.003));}}
@keyframes swMotionLuxury{0%,100%{transform:translateY(0) rotate(var(--pose-rotate)) scale(var(--pose-scale));}50%{transform:translateY(-2px) rotate(calc(var(--pose-rotate)+0.04deg)) scale(calc(var(--pose-scale)*1.002));}}
@keyframes swTremble1{0%,100%{transform:translateY(var(--pose-y)) rotate(calc(var(--pose-rotate)+0.4deg)) scale(var(--pose-scale));}11%{transform:translateY(calc(var(--pose-y)+1.8px)) rotate(calc(var(--pose-rotate)-1.7deg)) translateX(-1.8px) scale(var(--pose-scale));}23%{transform:translateY(calc(var(--pose-y)+0.7px)) rotate(calc(var(--pose-rotate)+1.4deg)) translateX(1.6px) scale(calc(var(--pose-scale)*0.993));}36%{transform:translateY(calc(var(--pose-y)+2.5px)) rotate(calc(var(--pose-rotate)-1.0deg)) translateX(-1.2px) scale(var(--pose-scale));}48%{transform:translateY(calc(var(--pose-y)+1.3px)) rotate(calc(var(--pose-rotate)+0.7deg)) translateX(1.9px) scale(var(--pose-scale));}61%{transform:translateY(calc(var(--pose-y)+2.2px)) rotate(calc(var(--pose-rotate)-1.5deg)) translateX(-1.4px) scale(calc(var(--pose-scale)*0.995));}74%{transform:translateY(calc(var(--pose-y)+0.6px)) rotate(calc(var(--pose-rotate)+1.1deg)) translateX(1.1px) scale(var(--pose-scale));}87%{transform:translateY(calc(var(--pose-y)+1.7px)) rotate(calc(var(--pose-rotate)-0.5deg)) translateX(-0.8px) scale(var(--pose-scale));}}
.steward-wrap[data-state="rock_bottom"] .sw-pose{animation:swTremble1 2.1s ease-in-out infinite;}
.steward-wrap[data-state="broke"] .sw-pose{animation:swTremble1 2.7s ease-in-out infinite;}
.steward-wrap[data-state="struggling"] .sw-pose{animation:swTremble1 3.5s ease-in-out infinite;}
.steward-wrap[data-state="building"] .sw-pose{animation:swMotionBuild var(--idle-ms) ease-in-out infinite;}
.steward-wrap[data-state="thriving"] .sw-pose{animation:swMotionThrive var(--idle-ms) ease-in-out infinite;}
.steward-wrap[data-state="winning"] .sw-pose{animation:swMotionWin var(--idle-ms) ease-in-out infinite;}
.steward-wrap[data-state="wealthy"] .sw-pose{animation:swMotionWin var(--idle-ms) ease-in-out infinite;}
.sw-hat{top:-14px;left:50%;width:58px;height:56px;transform:translateX(-50%) rotate(var(--hat-tilt));transform-origin:50% 80%;z-index:5;animation:swHatSettle var(--idle-ms) ease-in-out infinite;}
@keyframes swHatSettle{0%,100%{transform:translateX(-50%) rotate(calc(var(--hat-tilt)+0deg));}50%{transform:translateX(-50%) rotate(calc(var(--hat-tilt)+0.22deg));}}
.sw-hat-shadow{inset:4px 12px 10px;border-radius:14px 14px 8px 8px;background:linear-gradient(180deg,rgba(0,0,0,0.22),transparent 55%);mix-blend-mode:multiply;opacity:0.55;pointer-events:none;}
.sw-hat-crown{inset:0 6px 12px;background:linear-gradient(120deg,rgba(255,255,255,0.12),transparent 42%),linear-gradient(180deg,color-mix(in srgb,var(--hat) 86%,#000),var(--hat));border-radius:10px 10px 6px 6px;box-shadow:inset 0 -10px 14px rgba(0,0,0,0.22),inset 0 2px 0 rgba(255,255,255,0.08);}
.sw-hat-band{left:8px;right:8px;top:36px;height:9px;background:linear-gradient(180deg,color-mix(in srgb,var(--hat-band) 88%,#fff),var(--hat-band));border-radius:3px;box-shadow:0 1px 0 rgba(0,0,0,0.18);}
.sw-hat-brim{left:-4px;right:-4px;bottom:0;height:12px;background:linear-gradient(180deg,#0f231b,#050c09);border-radius:999px;box-shadow:0 4px 8px rgba(0,0,0,0.28);}
.sw-hat-ding{top:8px;left:12px;width:16px;height:8px;border-radius:999px;background:radial-gradient(circle at 30% 30%,rgba(255,255,255,0.35),rgba(255,255,255,0) 62%);opacity:0.55;pointer-events:none;}
.sw-head{top:34px;left:50%;width:56px;height:62px;transform:translateX(-50%) rotate(var(--head-tilt));background:linear-gradient(180deg,color-mix(in srgb,var(--skin) 88%,#fff),var(--skin));border-radius:24px 24px 20px 20px;box-shadow:inset 0 -10px 16px rgba(180,120,70,0.12),0 10px 14px rgba(16,41,32,0.12);z-index:4;}
.sw-head::after{content:"";position:absolute;inset:0;border-radius:inherit;background:radial-gradient(circle at 50% 18%,rgba(0,0,0,0),rgba(20,10,8,calc(var(--wear-vignette)*0.55)) 72%,rgba(10,6,6,calc(var(--wear-vignette)*0.75)) 100%);mix-blend-mode:multiply;pointer-events:none;}
.sw-cheek{top:38px;width:10px;height:7px;border-radius:50%;background:radial-gradient(circle,rgba(230,120,110,0.35),rgba(230,120,110,0));opacity:var(--cheek-opacity);filter:blur(0.2px);}
.sw-cheek-l{left:6px;}.sw-cheek-r{right:6px;}
.sw-eyebrow{top:18px;width:13px;height:3px;background:var(--ink);border-radius:999px;opacity:0.92;}
.sw-eyebrow-l{left:9px;transform:rotate(var(--brow-l));transform-origin:80% 50%;}
.sw-eyebrow-r{right:9px;transform:rotate(var(--brow-r));transform-origin:20% 50%;}
.sw-eye{top:28px;width:9px;height:11px;background:rgba(250,248,242,0.96);border-radius:50%;overflow:hidden;box-shadow:inset 0 -2px 0 rgba(0,0,0,0.08);}
.sw-eye-l{left:11px;}.sw-eye-r{right:11px;}
.sw-pupil{left:50%;top:50%;width:6px;height:8px;transform:translate(-50%,-50%) scaleY(var(--eye-open));transform-origin:50% 40%;background:radial-gradient(circle at 35% 28%,#2a2a2a,var(--ink));border-radius:50%;}
.sw-eye-shine{left:3px;top:3px;width:3px;height:2px;border-radius:50%;background:rgba(255,255,255,0.85);opacity:0.85;}
.sw-lid{left:-1px;right:-1px;top:-1px;z-index:3;height:120%;background:linear-gradient(180deg,var(--skin) 0 52%,rgba(244,223,190,0) 53%);transform-origin:top center;transform:scaleY(0);animation:swBlink 5.4s ease-in-out infinite;pointer-events:none;}
.sw-eye-r .sw-lid{animation-delay:0.14s;}
@keyframes swBlink{0%,90%,100%{transform:scaleY(0);}92%,96%{transform:scaleY(1);}}
.sw-monocle{top:24px;right:5px;width:21px;height:21px;transform:rotate(var(--mono-tilt));opacity:var(--mono-opacity);filter:drop-shadow(0 2px 2px rgba(0,0,0,0.18));}
.sw-mono-rim{inset:0;border-radius:50%;border:2.2px solid color-mix(in srgb,#e8c46a 70%,#7a5520);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.12),inset 0 -3px 6px rgba(0,0,0,0.18);}
.sw-mono-glass{inset:4px;border-radius:50%;background:radial-gradient(circle at 28% 28%,rgba(255,255,255,0.55),rgba(255,255,255,0) 42%),linear-gradient(160deg,rgba(190,220,230,0.35),rgba(255,255,255,0.08));opacity:0.9;}
.sw-mono-chain{right:-2px;top:19px;width:2px;height:18px;border-radius:999px;background:repeating-linear-gradient(180deg,rgba(212,170,80,0.95) 0 3px,rgba(120,90,40,0.55) 3px 4px);transform:rotate(-22deg);transform-origin:top center;opacity:var(--mono-chain-opacity);}
.sw-mono-glint{top:6px;left:7px;width:10px;height:3px;border-radius:999px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,0.75),rgba(255,255,255,0));opacity:0;animation:swMonoGlint 4.2s ease-in-out infinite;}
.steward-wrap[data-motion="rock"] .sw-mono-glint,.steward-wrap[data-motion="broke"] .sw-mono-glint{animation:none;opacity:0;}
@keyframes swMonoGlint{0%,70%,100%{opacity:0;transform:translateX(-2px);}78%{opacity:0.85;transform:translateX(3px);}}
.sw-nose{top:38px;left:50%;width:8px;height:10px;transform:translateX(-50%);background:linear-gradient(180deg,rgba(236,200,160,0.95),rgba(210,170,130,0.85));border-radius:999px;box-shadow:0 2px 3px rgba(0,0,0,0.12);}
.sw-mustache{top:46px;left:50%;width:30px;height:11px;transform:translateX(-50%);}
.sw-stache{top:0;width:15px;height:10px;background:var(--ink);}
.sw-stache-l{left:0;border-radius:5px 18px 14px 18px;transform:rotate(var(--stache-l));transform-origin:100% 50%;}
.sw-stache-r{right:0;border-radius:18px 5px 18px 14px;transform:rotate(var(--stache-r));transform-origin:0% 50%;}
.sw-mouth{top:56px;left:50%;width:var(--mouth-w);height:7px;transform:translate(-50%,var(--mouth-y)) rotate(var(--mouth-rotate)) scaleY(var(--mouth-scale-y));transform-origin:50% 0;border-bottom:2.5px solid rgba(95,49,42,0.88);border-radius:0 0 999px 999px;}
.sw-neck{top:92px;left:50%;width:30px;height:20px;transform:translateX(-50%);z-index:3;}
.sw-collar{top:0;width:16px;height:18px;background:linear-gradient(180deg,var(--shirt),color-mix(in srgb,var(--shirt) 70%,#cfc8bd));box-shadow:inset 0 -2px 0 rgba(0,0,0,0.06);}
.sw-collar-l{left:0;clip-path:polygon(0 0,100% 0,100% 100%,14% 58%);}
.sw-collar-r{right:0;clip-path:polygon(0 0,100% 0,86% 58%,0 100%);}
.sw-bowtie{top:7px;left:50%;width:26px;height:12px;transform:translateX(-50%);opacity:var(--bowtie-opacity,1);}
.sw-bowtie::before,.sw-bowtie::after{content:"";position:absolute;top:0;width:11px;height:12px;background:linear-gradient(180deg,#e8c97a,#a66f22);box-shadow:inset 0 1px 0 rgba(255,255,255,0.35);}
.sw-bowtie::before{left:0;clip-path:polygon(0 50%,100% 0,100% 100%);}
.sw-bowtie::after{right:0;clip-path:polygon(0 0,100% 50%,0 100%);}
.sw-bow-knot{left:50%;top:2px;width:8px;height:8px;transform:translateX(-50%) rotate(45deg);background:linear-gradient(135deg,#f0d48c,#b27a24);border-radius:2px;box-shadow:0 1px 2px rgba(0,0,0,0.2);}
.sw-body{top:110px;left:50%;width:84px;height:70px;transform:translateX(calc(-50% + var(--torso-shift-x)));z-index:2;}
.sw-shoulder{top:1px;width:18px;height:13px;border-radius:50% 50% 38% 38%;background:linear-gradient(180deg,color-mix(in srgb,var(--coat) 75%,#000),var(--coat));box-shadow:inset 0 2px 0 rgba(255,255,255,0.08),inset 0 -3px 4px rgba(0,0,0,0.2);z-index:1;}
.sw-shoulder-l{left:2px;transform:rotate(8deg);}.sw-shoulder-r{right:2px;transform:rotate(-8deg);}
.sw-coat-back{left:50%;top:6px;width:58px;height:48px;transform:translateX(-50%);background:radial-gradient(ellipse at 50% 0,var(--coat-deep),transparent 70%);opacity:0.55;filter:blur(0.2px);}
.sw-coat{top:0;width:35px;height:68px;background:linear-gradient(180deg,color-mix(in srgb,var(--coat) 88%,#fff),var(--coat));box-shadow:inset 6px 0 10px rgba(255,255,255,calc(var(--coat-sheen)*0.08)),inset -8px 0 14px rgba(0,0,0,0.18);}
.sw-coat-l{left:0;border-radius:14px 8px 12px 12px;clip-path:polygon(0 0,100% 0,88% 100%,0 100%);}
.sw-coat-r{right:0;border-radius:8px 14px 12px 12px;clip-path:polygon(0 0,100% 0,100% 100%,12% 100%);}
.sw-lapel{top:4px;width:14px;height:44px;background:linear-gradient(95deg,rgba(255,255,255,calc(var(--lapel-gloss)*0.06)),rgba(0,0,0,0) 46%,rgba(0,0,0,0.12));mix-blend-mode:soft-light;opacity:0.85;}
.sw-lapel-l{left:18px;clip-path:polygon(0 0,100% 8%,70% 100%,0 86%);}
.sw-lapel-r{right:18px;clip-path:polygon(0 8%,100% 0,100% 86%,30% 100%);}
.sw-vest{top:4px;left:50%;width:26px;height:58px;transform:translateX(-50%);background:linear-gradient(180deg,color-mix(in srgb,var(--vest) 82%,#fff),var(--vest));border-radius:9px 9px 14px 14px;box-shadow:inset 0 0 0 1px rgba(0,0,0,0.08),inset 0 -10px 16px rgba(0,0,0,0.12);z-index:2;}
.sw-btn{left:50%;width:5px;height:5px;transform:translateX(-50%);background:radial-gradient(circle at 30% 25%,rgba(255,255,255,0.35),#6a4610);border-radius:50%;box-shadow:0 1px 1px rgba(0,0,0,0.25);}
.sw-btn:nth-of-type(1){top:18px;}.sw-btn:nth-of-type(2){top:30px;}.sw-btn:nth-of-type(3){top:42px;}
.sw-pocket{top:34px;right:10px;width:16px;height:12px;border-radius:4px 4px 8px 8px;border:1px solid rgba(255,255,255,0.12);background:linear-gradient(180deg,rgba(0,0,0,0.12),rgba(255,255,255,0.04));opacity:0.55;}
/* ── Signature held/worn props (one per mid tier) ─────────────────── */
.sw-held{pointer-events:none;}
.sw-held-ledger{bottom:-11px;left:50%;width:22px;height:16px;margin-left:-11px;opacity:var(--ledger-opacity,0);transform:rotate(-8deg);border-radius:2px 3px 3px 2px;background:linear-gradient(180deg,#8a5a28,#6b4318);box-shadow:inset 0 0 0 1px rgba(0,0,0,0.18),0 2px 3px rgba(0,0,0,0.20);z-index:7;}
.sw-held-ledger::before{content:"";position:absolute;inset:2px 2px 2px 5px;background:linear-gradient(180deg,#f7f0e2,#e8dcc4);border-radius:1px;}
.sw-held-ledger::after{content:"";position:absolute;left:8px;right:5px;top:5px;height:7px;background:repeating-linear-gradient(180deg,rgba(90,70,40,0.45) 0 1px,transparent 1px 3px);}
.sw-held-coin{bottom:-13px;left:50%;width:15px;height:15px;margin-left:-7.5px;opacity:var(--coinup-opacity,0);border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff8dc,#f2cf7b 38%,#d39a35 72%,#9a6818 100%);box-shadow:0 0 8px rgba(242,207,123,0.55),inset 0 0 0 1.5px rgba(255,246,216,0.40);z-index:7;}
.sw-held-coin::after{content:"$";position:absolute;inset:0;display:grid;place-items:center;font-size:9px;font-weight:800;color:rgba(123,86,19,0.95);}
.sw-blueprint{top:35px;left:-11px;width:30px;height:9px;opacity:var(--blueprint-opacity,0);transform:rotate(-16deg);border-radius:999px;background:linear-gradient(180deg,#dce9f4,#a9c4dc 70%,#8fb0cc);box-shadow:inset 0 -2px 3px rgba(30,70,110,0.25),0 2px 3px rgba(0,0,0,0.18);z-index:3;}
.sw-blueprint::before{content:"";position:absolute;right:-1px;top:1px;width:7px;height:7px;border-radius:50%;background:radial-gradient(circle at 40% 40%,#f2f8fc,#b9d2e6 60%,#7fa3c2);}
.sw-blueprint::after{content:"";position:absolute;left:4px;right:9px;top:3.5px;height:2.5px;border-radius:999px;background:repeating-linear-gradient(90deg,rgba(50,100,150,0.45) 0 3px,transparent 3px 6px);}
.sw-watch{top:31px;right:14px;width:11px;height:11px;opacity:var(--watch-opacity,0);border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff4cf,#ecc76a 45%,#b98a2c 100%);box-shadow:inset 0 0 0 1.5px rgba(122,85,32,0.60),0 1px 2px rgba(0,0,0,0.25);z-index:6;}
.sw-watch::after{content:"";position:absolute;left:50%;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:50%;background:rgba(90,60,20,0.80);}
.sw-watch-chain{top:23px;right:18px;width:15px;height:12px;opacity:var(--watch-opacity,0);border-bottom:1.8px dotted rgba(212,170,80,0.95);border-radius:0 0 60% 40%;transform:rotate(6deg);z-index:6;}
.sw-arm{top:8px;width:18px;height:58px;transform-origin:50% 6px;z-index:4;}
.sw-arm-l{left:-6px;transform:rotate(var(--arm-l));}.sw-arm-r{right:-6px;transform:rotate(var(--arm-r));}
.sw-upper-arm{top:0;left:50%;width:15px;height:28px;margin-left:-7.5px;border-radius:999px;background:linear-gradient(90deg,rgba(255,255,255,0.06),rgba(0,0,0,0.12)),var(--coat);box-shadow:inset 0 0 0 1px rgba(0,0,0,0.08);}
.sw-forearm{top:24px;left:50%;width:13px;height:26px;margin-left:-6.5px;border-radius:10px 10px 12px 12px;transform-origin:top center;background:linear-gradient(90deg,rgba(255,255,255,0.05),rgba(0,0,0,0.10)),var(--coat);box-shadow:inset 0 -2px 3px rgba(0,0,0,0.15);}
.sw-forearm-l{transform:rotate(var(--forearm-l));}
.sw-forearm-wrap{top:24px;left:50%;width:20px;height:32px;margin-left:-10px;transform-origin:top center;transform:rotate(var(--forearm-r));}
.sw-cuff{top:17px;left:50%;width:16px;height:7px;margin-left:-8px;background:linear-gradient(180deg,var(--shirt),color-mix(in srgb,var(--shirt) 70%,#c8c2b8));border-radius:999px;box-shadow:0 1px 0 rgba(0,0,0,0.12);}
.sw-forearm-wrap .sw-cuff{top:15px;}
.sw-hand{bottom:-1px;left:50%;width:17px;height:15px;margin-left:-8.5px;border-radius:46% 46% 42% 42%;background:radial-gradient(circle at 32% 22%,#fffdf7,#ead9c4 55%,#c9b59a);box-shadow:inset 0 -2px 2px rgba(0,0,0,0.12),0 2px 3px rgba(0,0,0,0.14);z-index:6;}
.sw-thumb{bottom:4px;left:0;width:6px;height:10px;border-radius:40% 60% 50% 45%;background:linear-gradient(120deg,#f3e6d4,#d2bc9f);box-shadow:0 1px 1px rgba(0,0,0,0.12);z-index:7;}
.sw-cane{left:50%;top:calc(14px + var(--cane-y-nudge));width:10px;height:84px;margin-left:-5px;opacity:var(--cane-opacity);transform:rotate(var(--cane-angle)) translateX(var(--cane-x));transform-origin:50% 10px;z-index:3;pointer-events:none;}
.sw-cane-shaft{left:50%;top:12px;bottom:0;width:4px;margin-left:-2px;border-radius:999px;background:linear-gradient(90deg,#6b4a1c,#c4933f 45%,#4a3312);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.12),1px 0 2px rgba(0,0,0,0.15);}
.sw-cane-knob{left:50%;top:0;width:13px;height:13px;margin-left:-6.5px;border-radius:50%;border:2.5px solid #a56f24;background:radial-gradient(circle at 32% 25%,#fff0d0,#c8923a 55%,#5c4014);box-shadow:0 2px 4px rgba(0,0,0,0.22);}
.sw-forearm-wrap .sw-forearm{top:4px;left:50%;margin-left:-6.5px;z-index:4;}
.sw-hand-r{bottom:-1px;z-index:8;}
@keyframes swCaneSettle{0%,100%{transform:rotate(var(--cane-angle)) translateX(var(--cane-x));}50%{transform:rotate(calc(var(--cane-angle)+0.5deg)) translateX(calc(var(--cane-x)-0.4px));}}
.steward-wrap[data-motion="stable"] .sw-cane,.steward-wrap[data-motion="build"] .sw-cane,.steward-wrap[data-motion="thrive"] .sw-cane,.steward-wrap[data-motion="win"] .sw-cane,.steward-wrap[data-motion="luxury"] .sw-cane{animation:swCaneSettle var(--idle-ms) ease-in-out infinite;}
.sw-tails{top:155px;left:50%;width:86px;height:26px;transform:translateX(-50%);z-index:1;animation:swTailSway var(--idle-ms) ease-in-out infinite;}
@keyframes swTailSway{0%,100%{transform:translateX(-50%) skewX(0deg);}50%{transform:translateX(-50%) skewX(calc(var(--tail-flare)*0.7deg));}}
.sw-tail{bottom:0;width:22px;height:22px;background:linear-gradient(180deg,var(--coat),var(--coat-deep));border-radius:10px 10px 4px 4px;opacity:0.92;box-shadow:0 6px 8px rgba(0,0,0,0.14);}
.sw-tail-l{left:8px;transform:rotate(calc(-12deg - var(--tail-flare)*6deg));transform-origin:top center;}
.sw-tail-r{right:8px;transform:rotate(calc(12deg + var(--tail-flare)*6deg));transform-origin:top center;}
.sw-legs{position:absolute;left:50%;top:168px;width:calc(58px + var(--stance));height:76px;transform:translateX(-50%);display:flex;justify-content:space-between;align-items:flex-start;z-index:3;}
.sw-leg{position:relative;width:30px;height:72px;transform-origin:50% 6px;z-index:2;}
.sw-leg-l{transform:rotate(var(--leg-l));}.sw-leg-r{transform:rotate(var(--leg-r));}
.sw-thigh{position:relative;left:50%;width:22px;height:34px;margin-left:-11px;border-radius:12px 12px 9px 9px;transform-origin:50% 4px;background:linear-gradient(90deg,#2a4538,#152a22);box-shadow:inset 2px 0 4px rgba(255,255,255,0.04),inset -3px 0 6px rgba(0,0,0,0.28);}
.sw-thigh-l{transform:rotate(var(--thigh-l));}.sw-thigh-r{transform:rotate(var(--thigh-r));}
.sw-calf{position:absolute;top:26px;left:50%;width:18px;height:28px;margin-left:-9px;border-radius:8px 8px 12px 12px;transform-origin:50% 0;background:linear-gradient(90deg,#24362c,#101c17);box-shadow:inset -2px 0 4px rgba(0,0,0,0.25);}
.sw-calf-l{transform:rotate(var(--calf-l));}.sw-calf-r{transform:rotate(var(--calf-r));}
.sw-foot{position:absolute;left:50%;bottom:-3px;width:34px;height:19px;margin-left:-17px;transform-origin:50% 6px;}
.sw-foot-l{transform:rotate(var(--foot-l)) translateY(var(--shoe-lift-l));}.sw-foot-r{transform:rotate(var(--foot-r)) translateY(var(--shoe-lift-r));}
.sw-shoe{bottom:0;left:50%;width:34px;height:17px;margin-left:-17px;border-radius:13px 16px 11px 12px;background:linear-gradient(175deg,#5a4232 0%,#2e1f14 55%,#1a100c 100%);box-shadow:inset 0 2px 0 rgba(255,255,255,0.10),0 5px 8px rgba(0,0,0,0.42);}
.sw-shoe::after{content:"";position:absolute;left:5px;right:5px;top:4px;height:4px;border-radius:999px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent);}
.sw-sole-shadow{bottom:-5px;left:50%;width:42px;height:9px;margin-left:-21px;border-radius:50%;background:radial-gradient(ellipse at 50%,rgba(0,0,0,0.32),transparent 72%);z-index:0;}
.steward-sparkles{inset:2px 8px auto 8px;height:64px;opacity:var(--sparkle-opacity);z-index:1;}
.sparkle{position:absolute;color:rgba(255,216,129,0.95);font-size:20px;text-shadow:0 0 10px rgba(255,220,140,0.45);animation:sparkleFloat 2.8s ease-in-out infinite;}
.sparkle.s1{left:12px;top:8px;animation-delay:0s;}.sparkle.s2{right:18px;top:0;font-size:16px;animation-delay:0.5s;}.sparkle.s3{left:48%;top:20px;font-size:13px;animation-delay:0.9s;}
@keyframes sparkleFloat{0%,100%{transform:translateY(0) scale(1);opacity:0.72;}50%{transform:translateY(-8px) scale(1.12);opacity:1;}}
.steward-coin{right:16px;top:22px;width:22px;height:22px;opacity:var(--coin-opacity);border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff8dc,#f1cb75 38%,#ca9132 72%,#8d6119 100%);box-shadow:inset 0 0 0 2px rgba(255,246,216,0.26);z-index:1;}
.steward-coin::after{content:"$";position:absolute;inset:0;display:grid;place-items:center;font-size:13px;font-weight:800;color:rgba(123,86,19,0.96);}
.steward-sign{left:-18px;bottom:76px;padding:9px 11px;max-width:80px;font-size:0.62rem;font-weight:700;line-height:1.3;color:#5a3626;background:linear-gradient(160deg,#f7e8c4,#e2c090);border:1.5px solid rgba(110,72,38,0.3);border-radius:6px 8px 8px 6px;box-shadow:0 3px 0 rgba(110,72,38,0.18),0 6px 18px rgba(79,45,26,0.18);transform:rotate(-9deg);opacity:var(--sign-opacity);z-index:4;}
.steward-sign::before{content:"";position:absolute;top:-6px;left:50%;width:2px;height:8px;margin-left:-1px;background:#b07840;border-radius:1px;}
.steward-money{inset:0;opacity:var(--money-opacity);transform:scale(var(--money-scale));z-index:2;}
.steward-wrap[data-money-tier="sparse"] .steward-money .sm-d,.steward-wrap[data-money-tier="sparse"] .steward-money .sm-b{opacity:0!important;visibility:hidden;}
.steward-wrap[data-money-tier="sparse"] .steward-money .sm-c3,.steward-wrap[data-money-tier="sparse"] .steward-money .sm-c4,.steward-wrap[data-money-tier="sparse"] .steward-money .sm-c5{opacity:0!important;visibility:hidden;}
.steward-wrap[data-money-tier="medium"] .steward-money .sm-d5,.steward-wrap[data-money-tier="medium"] .steward-money .sm-d6,.steward-wrap[data-money-tier="medium"] .steward-money .sm-d7,.steward-wrap[data-money-tier="medium"] .steward-money .sm-d8,.steward-wrap[data-money-tier="medium"] .steward-money .sm-b3,.steward-wrap[data-money-tier="medium"] .steward-money .sm-c5{opacity:0!important;visibility:hidden;}
.sm-c,.rc-coin{width:16px;height:16px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff8dc,#f2cf7b 38%,#d39a35 72%,#9a6818 100%);}
.sm-b{width:22px;height:12px;border-radius:4px;background:linear-gradient(180deg,#dff7d9,#85c78a);border:1px solid rgba(33,109,52,0.18);}
.sm-b::after{content:"$";position:absolute;inset:0;display:grid;place-items:center;font-size:9px;font-weight:800;color:#245536;}
.sm-d{position:absolute;font-size:16px;font-weight:900;color:rgba(212,166,70,0.92);text-shadow:0 3px 10px rgba(156,113,25,0.16);animation:moneyFloat 3.2s ease-in-out infinite;}
.sm-c1{left:14px;top:148px;animation:moneyFloat 3.1s ease-in-out infinite;}.sm-c2{right:12px;top:138px;animation:moneyFloat 3.4s ease-in-out infinite 0.3s;}.sm-c3{left:50%;top:36px;margin-left:18px;animation:moneyFloat 2.9s ease-in-out infinite 0.6s;}.sm-c4{left:50%;top:160px;margin-left:-34px;animation:moneyFloat 3.3s ease-in-out infinite 0.4s;}.sm-c5{left:8px;top:72px;animation:moneyFloat 3s ease-in-out infinite 0.8s;}
.sm-b1{left:10px;top:106px;transform:rotate(-6deg);}.sm-b2{right:10px;top:120px;transform:rotate(4deg);}.sm-b3{left:50%;top:90px;margin-left:16px;transform:rotate(7deg);}
.sm-d1{left:6px;top:52px;animation-delay:0.1s;}.sm-d2{right:6px;top:60px;animation-delay:0.5s;}.sm-d3{left:50%;top:20px;margin-left:-10px;animation-delay:0.9s;}.sm-d4{left:8px;top:176px;animation-delay:0.2s;}.sm-d5{right:8px;top:172px;animation-delay:0.7s;}.sm-d6{left:50%;top:152px;margin-left:26px;animation-delay:1.1s;}.sm-d7{left:50%;top:26px;margin-left:26px;animation-delay:0.4s;}.sm-d8{right:2px;top:92px;animation-delay:0.8s;}
@keyframes moneyFloat{0%,100%{transform:translateY(0) rotate(var(--money-tilt));}50%{transform:translateY(-7px) rotate(calc(var(--money-tilt)*-1));}}
.steward-coinfall{inset:0;pointer-events:none;z-index:2;opacity:0;}
.steward-wrap[data-state="winning"] .steward-coinfall{opacity:0.92;}
.steward-wrap[data-state="wealthy"] .steward-coinfall{opacity:0.82;}
.scf-c{position:absolute;width:15px;height:15px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff8dc,#f2cf7b 38%,#d39a35 72%,#9a6818 100%);animation:scfCoinFall 2.2s linear infinite;}
.scf-d{position:absolute;font-size:19px;font-weight:900;color:rgba(218,180,58,0.96);text-shadow:0 0 8px rgba(200,160,40,0.4);animation:scfDollarFall 2.7s linear infinite;}
.scf-c1{left:6px;top:0;animation-delay:0.0s;}.scf-c2{left:26px;top:0;animation-delay:0.45s;}.scf-c3{left:50%;top:0;animation-delay:0.8s;}.scf-c4{left:72%;top:0;animation-delay:1.2s;}.scf-c5{left:90%;top:0;animation-delay:1.65s;}.scf-c6{left:38%;top:0;animation-delay:2.0s;}
.scf-d1{left:16%;top:-4px;animation-delay:0.25s;}.scf-d2{right:14%;top:-4px;animation-delay:0.9s;}.scf-d3{left:55%;top:-4px;animation-delay:1.5s;}.scf-d4{left:34%;top:-4px;animation-delay:2.1s;}
@keyframes scfCoinFall{0%{transform:translateY(-20px) rotate(0deg) scale(0.6);opacity:0;}8%{opacity:1;}88%{opacity:1;}100%{transform:translateY(280px) rotate(420deg) scale(1.05);opacity:0;}}
@keyframes scfDollarFall{0%{transform:translateY(-28px) rotate(-6deg);opacity:0;}10%{opacity:0.92;}90%{opacity:0.92;}100%{transform:translateY(275px) rotate(9deg);opacity:0;}}
.sw-racecar{display:none;left:50%;bottom:10px;width:150px;height:84px;opacity:var(--car-opacity);transform:translate(calc(-50% + var(--car-shift-x)),var(--car-shift-y)) scale(var(--car-scale));transform-origin:center bottom;z-index:1;}
.rc-body{left:18px;right:12px;bottom:18px;height:34px;background:linear-gradient(180deg,var(--car-body),var(--car-body-deep) 62%,var(--car-body-deep));border-radius:18px 28px 12px 12px;}
.rc-body::before{content:"";position:absolute;left:-8px;bottom:0;width:54px;height:24px;background:inherit;border-radius:18px 0 12px 10px;}
.rc-gold-trim{left:10px;right:14px;top:4px;height:2px;background:linear-gradient(90deg,rgba(245,215,139,0.2),var(--car-accent),rgba(245,215,139,0.2));}
.rc-cabin{left:56px;bottom:26px;width:46px;height:24px;background:var(--car-body);border-radius:18px 18px 6px 6px;}
.rc-win-driver,.rc-win-passenger,.rc-windshield,.rc-rear-win{background:var(--car-window);}
.rc-win-driver{left:62px;bottom:31px;width:15px;height:14px;border-radius:5px 5px 3px 3px;}
.rc-win-passenger{left:80px;bottom:31px;width:15px;height:14px;border-radius:5px 5px 3px 3px;}
.rc-windshield{left:54px;bottom:28px;width:8px;height:16px;transform:skew(-18deg);border-radius:4px 0 0 3px;}
.rc-rear-win{right:54px;bottom:30px;width:10px;height:14px;transform:skew(16deg);border-radius:0 4px 3px 0;}
.rc-spoiler{right:14px;bottom:38px;width:18px;height:7px;background:var(--car-body-deep);border-radius:5px 8px 2px 2px;}
.rc-stripe{left:42px;right:38px;bottom:30px;height:3px;background:linear-gradient(90deg,transparent,var(--car-accent),transparent);}
.rc-headlight{left:-4px;bottom:14px;width:10px;height:10px;background:radial-gradient(circle,#fff8d5,#ffd46d 64%,#c18a2c 100%);border-radius:50%;}
.rc-taillight{right:0;bottom:18px;width:8px;height:8px;background:radial-gradient(circle,#ffd7d7,#e66d61 58%,#8f2c26 100%);border-radius:50%;}
.rc-grille{left:-10px;bottom:9px;width:18px;height:12px;background:linear-gradient(180deg,#9fabb3,#68747d);border-radius:4px 10px 4px 6px;}
.rc-grille::before{content:"";position:absolute;inset:2px 3px;background:repeating-linear-gradient(90deg,rgba(40,48,53,0.95) 0 2px,rgba(150,164,171,0.2) 2px 4px);border-radius:2px 8px 2px 4px;}
.rc-ornament{left:18px;bottom:33px;width:22px;height:18px;opacity:var(--ornament-opacity);}
.rc-orn-base{left:8px;bottom:0;width:7px;height:4px;background:#c6d0d5;border-radius:999px;}
.rc-orn-post{left:11px;bottom:3px;width:1.5px;height:8px;background:#dfe7eb;}
.rc-orn-figure{left:4px;bottom:9px;width:14px;height:8px;}
.rc-orn-head{left:5px;top:0;width:4px;height:4px;background:#edf4f6;border-radius:50%;}
.rc-orn-body{left:6px;top:3px;width:2px;height:4px;background:#edf4f6;}
.rc-orn-wing-l,.rc-orn-wing-r{top:3px;width:6px;height:2px;background:#edf4f6;}
.rc-orn-wing-l{left:0;transform:rotate(-26deg);}.rc-orn-wing-r{right:0;transform:rotate(26deg);}
.rc-wheel{bottom:2px;width:23px;height:23px;background:radial-gradient(circle,#8a98a0 0 22%,var(--car-wheel) 24% 52%,#090d10 53% 100%);border-radius:50%;box-shadow:inset 0 0 0 3px rgba(157,173,182,0.16);}
.rc-wheel::after{content:"";position:absolute;inset:6px;border:2px solid rgba(210,220,225,0.26);border-radius:50%;}
.rc-wf{left:26px;}.rc-wr{right:22px;}
.rc-exhaust{position:absolute;left:5px;bottom:22px;width:34px;height:22px;}
.rc-puff{background:radial-gradient(circle,rgba(235,239,241,0.95),rgba(235,239,241,0));border-radius:50%;animation:puffDrift 2.4s ease-out infinite;}
.rp1{left:0;bottom:0;width:14px;height:14px;}.rp2{left:10px;bottom:8px;width:11px;height:11px;animation-delay:0.4s;}.rp3{left:20px;bottom:14px;width:8px;height:8px;animation-delay:0.8s;}
.rc-dollar{position:absolute;font-size:15px;font-weight:900;color:rgba(223,187,93,0.92);animation:dollarBounce 2.8s ease-in-out infinite;}
.rc-d1{left:18px;top:6px;animation-delay:0.2s;}.rc-d2{left:44px;top:-4px;animation-delay:0.7s;}.rc-d3{right:34px;top:2px;animation-delay:0.5s;}.rc-d4{right:10px;top:14px;animation-delay:0.9s;}
.rc-coin-shower{position:absolute;inset:-14px 16px auto auto;width:56px;height:48px;opacity:var(--coin-shower-opacity);}
.rc-coin{animation:coinFall 3.1s linear infinite;}
.rcc1{left:0;top:0;}.rcc2{left:18px;top:6px;animation-delay:0.3s;}.rcc3{left:36px;top:2px;animation-delay:0.5s;}.rcc4{left:54px;top:8px;animation-delay:0.8s;}.rcc5{left:8px;top:20px;animation-delay:1.1s;}.rcc6{left:28px;top:22px;animation-delay:1.4s;}.rcc7{left:46px;top:18px;animation-delay:1.7s;}.rcc8{left:16px;top:38px;animation-delay:2.0s;}
.rc-ring{bottom:-1px;width:56px;height:16px;border:1.8px solid rgba(242,208,112,0.72);border-radius:50%;opacity:var(--ring-opacity);}
.rc-ring-1{left:20px;}.rc-ring-2{left:44px;}.rc-ring-3{left:68px;}
.steward-dog-svg{display:none;position:absolute;left:-8px;bottom:32px;width:62px;height:72px;opacity:var(--dog-opacity);transform:translate(var(--dog-shift-x),var(--dog-shift-y)) scale(var(--dog-scale));transform-origin:left bottom;z-index:4;pointer-events:none;transition:opacity 0.3s ease,transform 0.3s ease;}
.steward-wrap[data-state="wealthy"] .steward-dog-svg{display:block;opacity:var(--dog-opacity);}
.dog-tail{transform-origin:0px 0px;}
.steward-wrap[data-state="wealthy"] .dog-tail{animation:wagTail 0.5s ease-in-out infinite;}
@keyframes wagTail{0%,100%{transform:rotate(-15deg);}50%{transform:rotate(15deg);}}
.dog-paw-wave{transform-origin:0px 0px;}
.steward-wrap[data-state="wealthy"] .dog-paw-wave{animation:svgDogPawWave 1.1s ease-in-out infinite;}
@keyframes svgDogPawWave{0%,60%,100%{transform:rotate(0deg);}25%{transform:rotate(56deg);}}
.steward-wrap[data-state="rock_bottom"] .steward-character{filter:saturate(0.04) brightness(0.62);}
.steward-wrap[data-state="broke"] .steward-character{filter:saturate(0.16) brightness(0.80);}
.steward-wrap[data-state="struggling"] .steward-character{filter:saturate(0.56) brightness(0.93);}
.steward-wrap[data-state="rock_bottom"] .sw-hat-crown,.steward-wrap[data-state="broke"] .sw-hat-crown{clip-path:polygon(0 0,88% 0,100% 22%,100% 100%,74% 96%,65% 80%,58% 100%,48% 76%,38% 98%,28% 82%,18% 100%,0 100%);}
.steward-wrap[data-state="rock_bottom"] .sw-coat-l,.steward-wrap[data-state="rock_bottom"] .sw-coat-r,.steward-wrap[data-state="broke"] .sw-coat-l,.steward-wrap[data-state="broke"] .sw-coat-r{clip-path:polygon(0 0,100% 0,100% 78%,86% 100%,66% 84%,50% 100%,34% 84%,18% 100%,0 78%);}
.steward-wrap[data-state="rock_bottom"] .sw-pupil{background:transparent;}
.steward-wrap[data-state="rock_bottom"] .sw-eye{overflow:visible;}
.steward-wrap[data-state="rock_bottom"] .sw-eye-l::before,.steward-wrap[data-state="rock_bottom"] .sw-eye-r::before{content:"";position:absolute;inset:-2px;z-index:2;border-top:2px solid #1a1818;transform:rotate(40deg);}
.steward-wrap[data-state="rock_bottom"] .sw-eye-l::after,.steward-wrap[data-state="rock_bottom"] .sw-eye-r::after{content:"";position:absolute;inset:-2px;z-index:2;border-top:2px solid #1a1818;transform:rotate(-40deg);}
.steward-wrap[data-state="rock_bottom"] .sw-mouth,.steward-wrap[data-state="broke"] .sw-mouth{height:10px;border-bottom-width:3px;border-radius:0 0 5px 5px;}
.steward-wrap[data-state="rock_bottom"] .sparkle,.steward-wrap[data-state="broke"] .sparkle,.steward-wrap[data-state="struggling"] .sparkle{color:rgba(155,148,142,0.7);text-shadow:none;animation:dustFloat 3.8s ease-in-out infinite;}
.steward-wrap[data-state="rock_bottom"] .sparkle{font-size:7px;}.steward-wrap[data-state="broke"] .sparkle{font-size:9px;}.steward-wrap[data-state="struggling"] .sparkle{font-size:12px;}
.steward-wrap[data-state="rock_bottom"] .steward-sparkles{opacity:0.6;}.steward-wrap[data-state="broke"] .steward-sparkles{opacity:0.4;}.steward-wrap[data-state="struggling"] .steward-sparkles{opacity:0.25;}
@keyframes dustFloat{0%,100%{transform:translateY(0) rotate(0deg);opacity:0.38;}50%{transform:translateY(-5px) rotate(12deg);opacity:0.06;}}
.steward-wrap[data-state="rock_bottom"]::before{background:linear-gradient(180deg,var(--capsule-fill-top) 0%,var(--capsule-fill-bottom) 68%,rgba(0,0,0,0.08) 100%),radial-gradient(circle at 50% 40%,rgba(88,38,50,0.44),transparent 46%),radial-gradient(circle at 50% 100%,rgba(14,6,10,0.32),transparent 46%);}
.steward-wrap[data-state="broke"]::before{background:linear-gradient(180deg,var(--capsule-fill-top) 0%,var(--capsule-fill-bottom) 68%,rgba(0,0,0,0.06) 100%),radial-gradient(circle at 50% 42%,rgba(105,105,108,0.38),transparent 48%),radial-gradient(circle at 50% 100%,rgba(14,14,14,0.26),transparent 48%);}
.steward-wrap[data-state="struggling"]::before{background:linear-gradient(180deg,var(--capsule-fill-top) 0%,var(--capsule-fill-bottom) 68%,rgba(0,0,0,0.04) 100%),radial-gradient(circle at 50% 42%,rgba(160,110,100,0.30),transparent 50%),radial-gradient(circle at 50% 100%,rgba(14,10,8,0.20),transparent 50%);}
.steward-wrap[data-state="building"]::before{background:linear-gradient(180deg,var(--capsule-fill-top) 0%,var(--capsule-fill-bottom) 68%,rgba(255,255,255,0.02) 100%),radial-gradient(circle at 50% 40%,rgba(77,134,199,0.46),transparent 62%),radial-gradient(circle at 50% 100%,rgba(16,41,32,0.14),transparent 52%);}
@keyframes thriveAuraPulse{0%,100%{opacity:0.82;transform:scale(1);}50%{opacity:1;transform:scale(1.05);}}
.steward-wrap[data-state="thriving"]::before{background:linear-gradient(180deg,var(--capsule-fill-top) 0%,var(--capsule-fill-bottom) 68%,rgba(255,255,255,0.02) 100%),radial-gradient(circle at 50% 38%,rgba(139,103,216,0.55),transparent 62%),radial-gradient(circle at 50% 100%,rgba(16,41,32,0.14),transparent 52%);animation:thriveAuraPulse 1.9s ease-in-out infinite;}
.steward-wrap[data-state="thriving"]::after{content:"";position:absolute;left:5px;right:5px;top:-5px;bottom:-2px;border-radius:44px;border:1.5px solid rgba(151,118,224,0.45);pointer-events:none;z-index:0;animation:thriveHalo 1.9s ease-in-out infinite;}
@keyframes thriveHalo{0%,100%{opacity:0.42;}50%{opacity:0.88;}}
@keyframes winAuraPulse{0%,100%{opacity:0.78;transform:scale(1);}50%{opacity:1;transform:scale(1.07);}}
.steward-wrap[data-state="winning"]::before{background:linear-gradient(180deg,var(--capsule-fill-top) 0%,var(--capsule-fill-bottom) 68%,rgba(255,255,255,0.02) 100%),radial-gradient(circle at 50% 36%,rgba(228,200,52,0.70),transparent 58%),radial-gradient(circle at 50% 100%,rgba(16,28,10,0.14),transparent 52%);animation:winAuraPulse 1.65s ease-in-out infinite;}
.steward-wrap[data-state="winning"]::after{content:"";position:absolute;left:3px;right:3px;top:-8px;bottom:-3px;border-radius:48px;border:2px solid rgba(235,200,58,0.54);pointer-events:none;z-index:0;animation:winHalo 1.65s ease-in-out infinite;}
@keyframes winHalo{0%,100%{opacity:0.55;transform:scale(1);}50%{opacity:0.94;transform:scale(1.025);}}
@keyframes wealthAuraPulse{0%,100%{opacity:0.82;transform:scale(1);}50%{opacity:0.96;transform:scale(1.04);}}
.steward-wrap[data-state="wealthy"]::before{inset:var(--capsule-top) var(--capsule-side) var(--capsule-bottom);background:linear-gradient(180deg,var(--capsule-fill-top) 0%,var(--capsule-fill-bottom) 68%,rgba(255,255,255,0.02) 100%),radial-gradient(circle at 50% 42%,rgba(255,248,200,0.32),transparent 48%),radial-gradient(circle at 72% 55%,rgba(255,218,55,0.90),transparent 40%),radial-gradient(circle at 50% 100%,rgba(16,22,6,0.06),transparent 52%);animation:wealthAuraPulse 2.0s ease-in-out infinite;}
.steward-wrap[data-state="wealthy"]::after{content:"";position:absolute;left:1px;right:1px;top:-14px;bottom:-6px;border-radius:54px;border:2.5px solid rgba(248,215,62,0.55);pointer-events:none;z-index:0;animation:wealthHalo 2.0s ease-in-out infinite;}
@keyframes wealthHalo{0%,100%{opacity:0.55;transform:scale(1);}50%{opacity:0.88;transform:scale(1.02);}}
.wealthy-mansion,.wealthy-merc{display:none;opacity:0;pointer-events:none;transition:opacity 0.3s ease;}
.steward-wrap[data-state="wealthy"] .wealthy-mansion{display:block;opacity:0.42;filter:blur(0.6px) saturate(0.92) brightness(0.97);}
.steward-wrap[data-state="wealthy"] .wealthy-merc{opacity:0;}
.wealthy-mansion{left:50%;bottom:42px;width:340px;height:280px;transform:translateX(-50%);z-index:0;}
.wmn-body{left:30px;right:30px;bottom:0;height:110px;background:linear-gradient(180deg,#f5efe6,#e8dfd2 40%,#ddd4c5);border-radius:3px 3px 0 0;box-shadow:inset 0 2px 0 rgba(255,255,255,0.40),0 4px 20px rgba(0,0,0,0.18);}
.wmn-body::before{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;background:linear-gradient(180deg,rgba(0,0,0,0.06),rgba(0,0,0,0.12));pointer-events:none;}
.wmn-body::after{content:"";position:absolute;left:6px;right:6px;top:3px;height:1px;background:rgba(180,160,130,0.30);pointer-events:none;}
.wmn-roof{left:22px;right:22px;bottom:108px;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:42px solid #3a3028;filter:drop-shadow(0 -2px 4px rgba(0,0,0,0.12));}
.wmn-roof::before{content:"";position:absolute;top:42px;left:-8px;right:-8px;height:5px;background:linear-gradient(180deg,#4a3e32,#3a3028);border-radius:0 0 1px 1px;}
.wmn-chimney{bottom:140px;width:10px;height:22px;background:linear-gradient(180deg,#5a4e42,#4a3e32);border-radius:2px 2px 0 0;}
.wmn-ch-l{left:48px;}
.wmn-ch-r{right:48px;}
.wmn-chimney::before{content:"";position:absolute;top:-3px;left:-2px;right:-2px;height:4px;background:#6a5e52;border-radius:2px;}
.wmn-wing{bottom:0;width:34px;height:78px;background:linear-gradient(180deg,#ebe3d8,#ddd4c5);border-radius:2px 2px 0 0;box-shadow:0 2px 10px rgba(0,0,0,0.12);}
.wmn-wing-l{left:0;}
.wmn-wing-r{right:0;}
.wmn-wing::before{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(0,0,0,0.08);}
.wmn-wing-roof{bottom:76px;width:42px;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:22px solid #3a3028;}
.wmn-wr-l{left:-2px;}
.wmn-wr-r{right:-2px;}
.wmn-col{bottom:0;width:7px;height:65px;background:linear-gradient(90deg,#e8e0d5,#f2ebe2 40%,#ddd6ca);border-radius:2px 2px 0 0;box-shadow:1px 0 2px rgba(0,0,0,0.08);}
.wmn-col-l{left:70px;}
.wmn-col-r{right:70px;}
.wmn-col::before{content:"";position:absolute;top:-2px;left:-2px;right:-2px;height:5px;background:#d4ccc0;border-radius:2px;}
.wmn-col::after{content:"";position:absolute;bottom:0;left:-2px;right:-2px;height:4px;background:#d4ccc0;border-radius:0 0 2px 2px;}
.wmn-pediment{left:65px;right:65px;bottom:64px;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:18px solid #ebe3d8;filter:drop-shadow(0 -1px 2px rgba(0,0,0,0.06));}
.wmn-door{left:50%;bottom:0;width:20px;height:38px;transform:translateX(-50%);background:linear-gradient(180deg,#2a2420,#1e1a16);border-radius:10px 10px 0 0;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06),0 0 8px rgba(0,0,0,0.20);}
.wmn-door-arch{top:0;left:0;right:0;height:12px;border-radius:10px 10px 0 0;background:linear-gradient(180deg,rgba(255,230,160,0.50),rgba(255,215,80,0.20));}
.wmn-door::before{content:"";position:absolute;left:50%;top:20px;width:3px;height:3px;border-radius:50%;background:#c8a040;transform:translateX(-50%);box-shadow:0 0 4px rgba(200,160,64,0.60);}
.wmn-window{width:14px;height:16px;background:linear-gradient(180deg,rgba(255,230,150,0.70),rgba(255,200,80,0.55));border:1px solid rgba(140,120,80,0.30);border-radius:1px;box-shadow:0 0 8px rgba(255,210,100,0.35),inset 0 0 3px rgba(255,240,180,0.30);}
.wmn-window::before{content:"";position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(140,120,80,0.22);transform:translateX(-50%);}
.wmn-window::after{content:"";position:absolute;top:50%;left:0;right:0;height:1px;background:rgba(140,120,80,0.22);}
.wmn-w1{left:40px;bottom:62px;}
.wmn-w2{left:66px;bottom:62px;}
.wmn-w3{right:66px;bottom:62px;}
.wmn-w4{right:40px;bottom:62px;}
.wmn-w5{left:40px;bottom:28px;}
.wmn-w6{left:66px;bottom:28px;}
.wmn-w7{right:66px;bottom:28px;}
.wmn-w8{right:40px;bottom:28px;}
.wmn-steps{left:50%;bottom:-2px;width:40px;height:6px;transform:translateX(-50%);background:linear-gradient(180deg,#d4ccc0,#c8bfb2);border-radius:0 0 2px 2px;}
.wmn-steps::before{content:"";position:absolute;top:-3px;left:4px;right:4px;height:3px;background:#ddd6ca;border-radius:1px;}
.wmn-lantern{bottom:36px;width:4px;height:6px;background:radial-gradient(circle,rgba(255,230,140,0.95),rgba(255,200,60,0.60));border-radius:50%;box-shadow:0 0 8px rgba(255,210,80,0.50),0 0 16px rgba(255,200,60,0.25);animation:wmnLanternGlow 2.4s ease-in-out infinite;}
.wmn-lan-l{left:62px;}
.wmn-lan-r{right:62px;}
@keyframes wmnLanternGlow{0%,100%{box-shadow:0 0 8px rgba(255,210,80,0.50),0 0 16px rgba(255,200,60,0.25);}50%{box-shadow:0 0 12px rgba(255,210,80,0.70),0 0 24px rgba(255,200,60,0.40);}}
@keyframes wmnWindowFlicker{0%,90%,100%{opacity:1;}92%{opacity:0.75;}95%{opacity:1;}97%{opacity:0.82;}}
.wmn-w2,.wmn-w5{animation:wmnWindowFlicker 6s ease-in-out infinite;}
.wmn-w4,.wmn-w7{animation:wmnWindowFlicker 6s ease-in-out infinite 2.5s;}
.wealthy-merc{left:50%;bottom:-48px;width:210px;height:62px;transform:translateX(-50%);z-index:1;}
.wmerc-shadow{left:50%;bottom:0;width:230px;height:14px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(ellipse,rgba(0,0,0,0.40),rgba(0,0,0,0) 68%);}
.wmerc-body{left:2px;right:2px;bottom:8px;height:24px;background:linear-gradient(180deg,#c8ccd0 0%,#a8aeb4 35%,#8a9298 100%);border-radius:3px 8px 3px 3px;box-shadow:0 2px 10px rgba(0,0,0,0.30),inset 0 1px 0 rgba(255,255,255,0.45);}
.wmerc-body::before{content:"";position:absolute;left:14px;right:14px;top:10px;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.40),rgba(255,255,255,0.55),rgba(255,255,255,0.40),transparent);pointer-events:none;}
.wmerc-hood{left:52px;right:38px;bottom:30px;height:20px;background:linear-gradient(180deg,#b4bac0 0%,#a0a8ae 100%);border-radius:2px 10px 0 0;box-shadow:inset 0 1px 0 rgba(255,255,255,0.40);}
.wmerc-hood::before{content:"";position:absolute;left:0;top:0;width:1px;height:100%;background:rgba(255,255,255,0.30);border-radius:1px;}
.wmerc-hood::after{content:"";position:absolute;left:6px;right:6px;top:1px;height:2px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent);border-radius:2px;}
.wmerc-grille{left:-2px;bottom:14px;width:6px;height:10px;transform:none;background:radial-gradient(circle,rgba(255,255,255,0.95),rgba(200,220,255,0.80));border-radius:2px 1px 1px 2px;border:none;overflow:visible;box-shadow:0 0 8px 3px rgba(200,220,255,0.60),0 0 20px 6px rgba(180,200,240,0.35),0 0 40px 10px rgba(160,190,240,0.15);animation:wmercHeadlightFlash 3s ease-in-out infinite;}
.wmerc-slat{display:none;}
.wmerc-slat:first-child{margin-left:0;}
.wmerc-star{left:100px;bottom:18px;width:8px;height:8px;transform:none;background:radial-gradient(circle,rgba(220,220,230,0.85),rgba(180,180,190,0.60));border-radius:50%;border:1px solid rgba(160,160,170,0.25);z-index:2;font-size:4px;color:rgba(40,40,50,0.70);display:flex;align-items:center;justify-content:center;line-height:1;box-shadow:0 0 4px rgba(200,200,210,0.25);}
.wmerc-hl{bottom:1px;width:28px;height:28px;background:radial-gradient(circle at 42% 40%,#4a4a56,#2a2a34 50%,#111118 100%);border-radius:50% !important;box-shadow:0 0 0 3px rgba(60,60,68,0.95),0 0 0 5px rgba(30,30,36,0.90),0 0 0 6px rgba(160,160,170,0.20),0 2px 8px rgba(0,0,0,0.50);overflow:hidden;}
.wmerc-hl-l{left:30px;}
.wmerc-hl-r{right:30px;}
.wmerc-drl{position:absolute;top:50%;left:50%;width:12px;height:12px;transform:translate(-50%,-50%);background:radial-gradient(circle,rgba(220,220,230,0.85) 20%,rgba(160,160,172,0.50) 60%,rgba(100,100,112,0.30) 100%);border-radius:50%;box-shadow:0 0 4px rgba(200,200,210,0.35);border:1px solid rgba(180,180,190,0.25);}
.wmerc-hl::after{content:"";position:absolute;inset:3px;border-radius:50%;background:conic-gradient(from 0deg,rgba(200,200,210,0.22),transparent 20deg,rgba(200,200,210,0.18) 60deg,transparent 80deg,rgba(200,200,210,0.22) 120deg,transparent 140deg,rgba(200,200,210,0.18) 180deg,transparent 200deg,rgba(200,200,210,0.22) 240deg,transparent 260deg,rgba(200,200,210,0.18) 300deg,transparent 320deg,rgba(200,200,210,0.22) 360deg);animation:wmercWheelSpin 6s linear infinite;}
@keyframes wmercHlSweep{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}
.steward-wrap[data-state="wealthy"] .wmerc-hl{animation:none;}
@keyframes wmercHlPulse{0%,100%{box-shadow:0 0 0 2.5px rgba(160,160,170,0.30),0 0 0 4px rgba(30,30,40,0.90),0 2px 6px rgba(0,0,0,0.40);}50%{box-shadow:0 0 0 2.5px rgba(180,180,190,0.40),0 0 0 4px rgba(30,30,40,0.90),0 2px 8px rgba(0,0,0,0.50);}}
.wmerc-bumper{left:4px;right:4px;bottom:6px;height:3px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.04),rgba(255,255,255,0.06),rgba(255,255,255,0.04),transparent);border-radius:1px;box-shadow:none;}
.wmerc-bumper::before{content:"";position:absolute;left:80px;top:-14px;width:3px;height:3px;border-radius:50%;background:rgba(200,200,210,0.30);transform:none;box-shadow:0 0 2px rgba(200,200,210,0.20);}
.wmerc-intake{display:none;}
.wmerc-intake::before{display:none;}
.wmerc-int-l{left:19px;}
.wmerc-int-r{right:19px;}
.wmerc-splitter{left:auto;right:-2px;bottom:14px;width:6px;height:8px;background:radial-gradient(circle,rgba(255,60,60,0.95),rgba(220,30,30,0.70));border-radius:1px 2px 2px 1px;box-shadow:0 0 6px 2px rgba(255,40,40,0.55),0 0 16px 4px rgba(220,30,30,0.30);animation:wmercTaillightPulse 3s ease-in-out infinite;}
.wmerc-fender{display:none;}
.wmerc-fn-l{display:none;}
.wmerc-fn-r{display:none;}
.wmerc-reflect{left:54px;right:40px;bottom:32px;height:16px;background:linear-gradient(180deg,rgba(10,12,18,0.82),rgba(15,18,28,0.72) 50%,rgba(20,24,35,0.60));border-radius:2px 6px 0 0;pointer-events:none;animation:none;box-shadow:inset 0 1px 0 rgba(255,255,255,0.08),0 0 6px rgba(0,0,0,0.20);}
@keyframes wmercReflect{0%,100%{opacity:0.5;}50%{opacity:0.9;}}
@keyframes wmercWheelSpin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}
@keyframes wmercHeadlightFlash{0%,3%{opacity:1;box-shadow:0 0 10px 4px rgba(200,220,255,0.70),0 0 25px 8px rgba(180,200,240,0.45),0 0 50px 14px rgba(160,190,240,0.20);}4%{opacity:0;box-shadow:none;}7%{opacity:1;box-shadow:0 0 10px 4px rgba(200,220,255,0.70),0 0 25px 8px rgba(180,200,240,0.45),0 0 50px 14px rgba(160,190,240,0.20);}8%{opacity:0;box-shadow:none;}11%{opacity:1;box-shadow:0 0 10px 4px rgba(200,220,255,0.70),0 0 25px 8px rgba(180,200,240,0.45),0 0 50px 14px rgba(160,190,240,0.20);}12%{opacity:0;box-shadow:none;}18%,28%{opacity:0;box-shadow:none;}30%{opacity:1;box-shadow:0 0 10px 4px rgba(200,220,255,0.70),0 0 25px 8px rgba(180,200,240,0.45),0 0 50px 14px rgba(160,190,240,0.20);}31%{opacity:0;box-shadow:none;}34%{opacity:1;box-shadow:0 0 10px 4px rgba(200,220,255,0.70),0 0 25px 8px rgba(180,200,240,0.45),0 0 50px 14px rgba(160,190,240,0.20);}35%{opacity:0;box-shadow:none;}40%,100%{opacity:0;box-shadow:none;}}
@keyframes wmercTaillightPulse{0%,3%{opacity:1;box-shadow:0 0 8px 3px rgba(255,40,40,0.65),0 0 20px 6px rgba(220,30,30,0.40);}4%{opacity:0;box-shadow:none;}7%{opacity:1;box-shadow:0 0 8px 3px rgba(255,40,40,0.65),0 0 20px 6px rgba(220,30,30,0.40);}8%{opacity:0;box-shadow:none;}11%{opacity:1;box-shadow:0 0 8px 3px rgba(255,40,40,0.65),0 0 20px 6px rgba(220,30,30,0.40);}12%{opacity:0;box-shadow:none;}18%,28%{opacity:0;box-shadow:none;}30%{opacity:1;box-shadow:0 0 8px 3px rgba(255,40,40,0.65),0 0 20px 6px rgba(220,30,30,0.40);}31%{opacity:0;box-shadow:none;}34%{opacity:1;box-shadow:0 0 8px 3px rgba(255,40,40,0.65),0 0 20px 6px rgba(220,30,30,0.40);}35%{opacity:0;box-shadow:none;}40%,100%{opacity:0;box-shadow:none;}}
.steward-wrap[data-state="thriving"] .sw-monocle{filter:drop-shadow(0 0 4px rgba(255,220,78,0.65));}
.steward-wrap[data-state="winning"] .sw-monocle{filter:drop-shadow(0 0 7px rgba(255,218,55,0.95)) drop-shadow(0 0 14px rgba(240,198,48,0.55));}
.steward-wrap[data-state="wealthy"] .sw-monocle{filter:drop-shadow(0 0 11px rgba(255,222,60,1)) drop-shadow(0 0 24px rgba(240,198,50,0.72));}
.steward-wrap[data-state="winning"] .sw-cane{filter:drop-shadow(0 0 3px rgba(212,175,52,0.68));}
.steward-wrap[data-state="wealthy"] .sw-cane{filter:drop-shadow(0 0 7px rgba(228,188,58,0.88));}
.steward-wrap[data-state="wealthy"] .sw-hat{filter:drop-shadow(0 -3px 10px rgba(255,222,65,0.78));}
.steward-wrap[data-state="thriving"] .sw-vest{box-shadow:inset 0 0 0 1px rgba(0,0,0,0.05),0 0 16px rgba(218,178,52,0.34);}
.steward-wrap[data-state="winning"] .sw-vest{box-shadow:0 0 24px rgba(230,192,62,0.58),inset 0 2px 0 rgba(255,255,255,0.14);}
@keyframes vestGlow{0%,100%{box-shadow:0 0 28px rgba(244,206,66,0.62),inset 0 2px 0 rgba(255,255,255,0.16);}50%{box-shadow:0 0 38px rgba(255,220,78,0.82),inset 0 2px 0 rgba(255,255,255,0.22);}}
.steward-wrap[data-state="wealthy"] .sw-vest{animation:vestGlow 2.0s ease-in-out infinite;}
.steward-wrap[data-state="wealthy"] .sw-body{filter:contrast(1.06) drop-shadow(0 2px 6px rgba(0,0,0,0.18));}
.steward-wrap[data-state="wealthy"] .sw-head{filter:drop-shadow(0 1px 3px rgba(0,0,0,0.10));}
.steward-wrap[data-state="winning"] .steward-sparkles::before,.steward-wrap[data-state="wealthy"] .steward-sparkles::before{content:"✦";position:absolute;right:2px;top:24px;font-size:30px;color:rgba(255,216,129,0.95);text-shadow:0 0 12px rgba(255,220,140,0.6);animation:sparkleFloat 2.4s ease-in-out infinite 1.1s;}
.steward-wrap[data-state="winning"] .steward-sparkles::after,.steward-wrap[data-state="wealthy"] .steward-sparkles::after{content:"✧";position:absolute;left:22px;top:10px;font-size:24px;color:rgba(255,216,129,0.88);text-shadow:0 0 8px rgba(255,220,140,0.5);animation:sparkleFloat 3.1s ease-in-out infinite 0.55s;}
.steward-wrap[data-state="thriving"] .steward-sparkles::before{content:"✦";position:absolute;right:5px;top:18px;font-size:22px;color:rgba(255,216,129,0.82);text-shadow:0 0 8px rgba(255,220,140,0.4);animation:sparkleFloat 2.7s ease-in-out infinite 0.8s;}
.steward-wrap[data-state="building"] .sm-c{animation:coinBounceUp 1.7s ease-in-out infinite;}
.steward-wrap[data-state="thriving"] .sm-c{animation:coinBounceUp 1.2s ease-in-out infinite;}
@keyframes coinBounceUp{0%,100%{transform:translateY(0) rotate(0deg);}35%{transform:translateY(-14px) rotate(22deg);}65%{transform:translateY(-6px) rotate(-9deg);}}
.steward-wrap[data-state="winning"] .sm-d,.steward-wrap[data-state="wealthy"] .sm-d{font-size:21px;color:rgba(228,188,55,1);text-shadow:0 0 8px rgba(218,175,42,0.5);}
@keyframes coinShimmer{0%,100%{opacity:0.65;transform:scale(1) rotate(0deg);}50%{opacity:1;transform:scale(1.1) rotate(14deg);}}
.steward-wrap[data-state="thriving"] .steward-coin,.steward-wrap[data-state="winning"] .steward-coin,.steward-wrap[data-state="wealthy"] .steward-coin{animation:coinShimmer 2.0s ease-in-out infinite;}
.steward-wrap[data-state="winning"]:hover .steward-character{transform:translateX(-50%) scale(calc(var(--character-scale) * 1.055));}
@keyframes swHatGlint{0%,82%,100%{opacity:0.55;}88%{opacity:0.96;}}
.steward-wrap[data-motion="thrive"] .sw-hat-ding,.steward-wrap[data-motion="win"] .sw-hat-ding,.steward-wrap[data-motion="luxury"] .sw-hat-ding{animation:swHatGlint 5.2s ease-in-out infinite;}
@keyframes puffDrift{0%{transform:translate(0,0) scale(0.7);opacity:0.7;}100%{transform:translate(-12px,-10px) scale(1.3);opacity:0;}}
@keyframes dollarBounce{0%,100%{transform:translateY(0) rotate(0deg);}50%{transform:translateY(-6px) rotate(6deg);}}
@keyframes coinFall{0%,100%{transform:translateY(0) rotate(0deg);}50%{transform:translateY(8px) rotate(25deg);}}
/* ── Racecar rides along at "winning" — racing the last miles ─────── */
.steward-wrap[data-state="winning"] .sw-racecar{display:block;}
/* ── Signature idle beats (one per upper tier) ────────────────────── */
@keyframes swBreatheEase{0%,100%{transform:translateY(var(--upper-drop)) rotate(var(--chest-tilt));}50%{transform:translateY(calc(var(--upper-drop) - 1.4px)) rotate(calc(var(--chest-tilt) - 0.4deg));}}
.steward-wrap[data-state="stabilizing"] .sw-upper-stack{animation:swBreatheEase 3.25s ease-in-out infinite;}
@keyframes swCaneTap{0%,76%,96%,100%{transform:rotate(var(--cane-angle)) translateX(var(--cane-x));}82%{transform:rotate(calc(var(--cane-angle) - 5deg)) translateX(var(--cane-x)) translateY(-2px);}88%{transform:rotate(calc(var(--cane-angle) + 1.5deg)) translateX(var(--cane-x));}}
.steward-wrap[data-state="stable"] .sw-cane{animation:swCaneTap 3.4s ease-in-out infinite;}
@keyframes swLapelAdjust{0%,78%,96%,100%{transform:rotate(var(--forearm-l));}84%,91%{transform:rotate(calc(var(--forearm-l) + 52deg));}87%{transform:rotate(calc(var(--forearm-l) + 46deg));}}
.steward-wrap[data-state="thriving"] .sw-forearm-l{animation:swLapelAdjust 7.2s ease-in-out infinite;}
@keyframes swHatTip{0%,86%,97%,100%{transform:translateX(-50%) rotate(var(--hat-tilt));}90%,94%{transform:translateX(-52%) translateY(-5px) rotate(calc(var(--hat-tilt) - 11deg));}}
.steward-wrap[data-state="winning"] .sw-hat{animation:swHatTip 8.4s ease-in-out infinite;}
@keyframes swCoinFlip{0%,66%,92%,100%{transform:translateY(0) rotate(0deg) scale(1);}73%{transform:translateY(-15px) rotate(200deg) scale(1.08);}80%{transform:translateY(-3px) rotate(330deg) scale(1);}86%{transform:translateY(-8px) rotate(360deg) scale(1.02);}}
.steward-wrap[data-state="wealthy"] .steward-coin{animation:swCoinFlip 4.6s ease-in-out infinite;}
/* ── Hover micro-reactions ────────────────────────────────────────── */
@media (hover:hover){
.steward-wrap:hover .sw-mono-glint{animation:swMonoGlint 1.4s ease-in-out infinite;}
@keyframes swSignWiggle{0%,100%{transform:rotate(-9deg);}30%{transform:rotate(-3deg);}65%{transform:rotate(-13deg);}}
.steward-wrap[data-state="rock_bottom"]:hover .steward-sign,.steward-wrap[data-state="broke"]:hover .steward-sign,.steward-wrap[data-state="struggling"]:hover .steward-sign{animation:swSignWiggle 0.9s ease;}
@keyframes swHatTipQuick{0%,100%{transform:translateX(-50%) rotate(var(--hat-tilt));}40%,70%{transform:translateX(-52%) translateY(-5px) rotate(calc(var(--hat-tilt) - 12deg));}}
.steward-wrap[data-state="thriving"]:hover .sw-hat,.steward-wrap[data-state="winning"]:hover .sw-hat{animation:swHatTipQuick 0.9s ease;}
@keyframes swDogHop{0%,100%{transform:translate(var(--dog-shift-x),var(--dog-shift-y)) scale(var(--dog-scale));}35%{transform:translate(var(--dog-shift-x),calc(var(--dog-shift-y) - 8px)) scale(var(--dog-scale));}60%{transform:translate(var(--dog-shift-x),var(--dog-shift-y)) scale(var(--dog-scale));}80%{transform:translate(var(--dog-shift-x),calc(var(--dog-shift-y) - 3px)) scale(var(--dog-scale));}}
.steward-wrap[data-state="wealthy"]:hover .steward-dog-svg{animation:swDogHop 0.8s ease;}
}
/* ── Offscreen cards pause their ~60 animations (IntersectionObserver adds the class) ── */
.steward-wrap.steward-offscreen *{animation-play-state:paused !important;}
/* ── Respect reduced-motion: freeze every idle/prop animation ─────── */
@media (prefers-reduced-motion: reduce){
.steward-wrap,.steward-wrap::before,.steward-wrap::after,
.steward-wrap *,.steward-wrap *::before,.steward-wrap *::after{animation:none !important;transition:none !important;}
}
  `;
  document.head.appendChild(style);
})();

/* ═══════════════════════════════════════════════════════════════════
   STATE → CSS VARIABLE MAPS (verbatim from steward.html)
═══════════════════════════════════════════════════════════════════ */
const STEWARD_STATE = {
  rock_bottom:{motion:"rock",moneyTier:"sparse",vars:{"--character-scale":"1.05","--character-bottom":"26px","--scene-scale":"1.18","--scene-shift-x":"5px","--scene-shift-y":"-8px","--capsule-top":"18px","--capsule-side":"18px","--capsule-bottom":"10px","--capsule-radius":"40px","--ground-scale-x":"0.90","--ground-scale-y":"0.92","--coat":"#3d2c31","--coat-deep":"#24161a","--vest":"#7a5a38","--shirt":"#dfd4cc","--skin":"#e4cdb2","--hat":"#1c1216","--hat-band":"#5a4330","--ink":"#160f12","--pose-rotate":"-13deg","--pose-y":"2px","--pose-scale":"0.92","--stance":"30px","--hat-tilt":"-18deg","--upper-drop":"14px","--chest-tilt":"12deg","--head-tilt":"-8deg","--torso-shift-x":"-4px","--arm-l":"44deg","--arm-r":"-18deg","--forearm-l":"7deg","--forearm-r":"14deg","--leg-l":"9deg","--leg-r":"-14deg","--thigh-l":"5deg","--thigh-r":"-9deg","--calf-l":"-14deg","--calf-r":"-16deg","--foot-l":"10deg","--foot-r":"-6deg","--cane-opacity":"0.52","--cane-angle":"22deg","--cane-x":"2px","--cane-y-nudge":"5px","--mono-opacity":"0","--mono-chain-opacity":"0","--mono-tilt":"-7deg","--bowtie-opacity":"0","--wear-vignette":"0.68","--coat-shred":"1","--lapel-gloss":"0.09","--stache-l":"15deg","--stache-r":"-15deg","--money-opacity":"0.02","--money-scale":"0.60","--money-tilt":"-6deg","--sparkle-opacity":"0","--sign-opacity":"1","--coin-opacity":"0.04","--car-opacity":"0","--glow":"rgba(208,107,134,0.15)","--eye-open":"0.52","--brow-l":"26deg","--brow-r":"-26deg","--mouth-y":"5px","--mouth-scale-y":"0.42","--mouth-rotate":"180deg","--mouth-w":"22px","--cheek-opacity":"0.38","--idle-ms":"2.5s","--tail-flare":"0.94","--coat-sheen":"0.04","--shoe-lift-l":"1px","--shoe-lift-r":"0px"}},
  broke:{motion:"broke",moneyTier:"sparse",vars:{"--character-scale":"1.08","--character-bottom":"24px","--scene-scale":"1.18","--scene-shift-x":"4px","--scene-shift-y":"-10px","--capsule-top":"16px","--capsule-side":"16px","--capsule-bottom":"8px","--capsule-radius":"42px","--ground-scale-x":"0.95","--ground-scale-y":"0.94","--coat":"#4a4c48","--coat-deep":"#2d2f2c","--vest":"#8f8774","--shirt":"#eae4dc","--skin":"#e6cfae","--hat":"#32342f","--hat-band":"#7a6e58","--ink":"#141a16","--pose-rotate":"-9deg","--pose-y":"2px","--pose-scale":"0.94","--stance":"26px","--hat-tilt":"-13deg","--upper-drop":"9px","--chest-tilt":"9deg","--head-tilt":"-6deg","--torso-shift-x":"-2px","--arm-l":"37deg","--arm-r":"-17deg","--forearm-l":"5deg","--forearm-r":"13deg","--leg-l":"6deg","--leg-r":"-10deg","--thigh-l":"3deg","--thigh-r":"-6deg","--calf-l":"-10deg","--calf-r":"-12deg","--foot-l":"7deg","--foot-r":"-4deg","--cane-opacity":"0.58","--cane-angle":"16deg","--cane-x":"1px","--cane-y-nudge":"3px","--mono-opacity":"0","--mono-chain-opacity":"0","--mono-tilt":"-4deg","--bowtie-opacity":"0","--wear-vignette":"0.52","--coat-shred":"0.88","--lapel-gloss":"0.16","--stache-l":"11deg","--stache-r":"-11deg","--money-opacity":"0.05","--money-scale":"0.68","--money-tilt":"-5deg","--sparkle-opacity":"0.03","--sign-opacity":"0.80","--coin-opacity":"0.09","--car-opacity":"0","--glow":"rgba(177,143,122,0.18)","--eye-open":"0.70","--brow-l":"18deg","--brow-r":"-18deg","--mouth-y":"4px","--mouth-scale-y":"0.58","--mouth-rotate":"180deg","--mouth-w":"21px","--cheek-opacity":"0.28","--idle-ms":"2.9s","--tail-flare":"0.84","--coat-sheen":"0.07","--shoe-lift-l":"0px","--shoe-lift-r":"0px"}},
  struggling:{motion:"struggle",moneyTier:"medium",vars:{"--character-scale":"1.10","--character-bottom":"22px","--scene-scale":"1.18","--scene-shift-x":"2px","--scene-shift-y":"-12px","--capsule-top":"14px","--capsule-side":"14px","--capsule-bottom":"6px","--capsule-radius":"44px","--ground-scale-x":"1.00","--ground-scale-y":"0.98","--coat":"#5c3f38","--coat-deep":"#3a2622","--vest":"#a87645","--shirt":"#f2ebe3","--skin":"#e9d2b4","--hat":"#3a241f","--hat-band":"#c99547","--ink":"#1a1412","--pose-rotate":"-6deg","--pose-y":"1px","--pose-scale":"0.96","--stance":"22px","--hat-tilt":"-8deg","--upper-drop":"6px","--chest-tilt":"6deg","--head-tilt":"-4deg","--torso-shift-x":"-1px","--arm-l":"28deg","--arm-r":"-14deg","--forearm-l":"3deg","--forearm-r":"11deg","--leg-l":"4deg","--leg-r":"-7deg","--thigh-l":"1.5deg","--thigh-r":"-3.5deg","--calf-l":"-7deg","--calf-r":"-9deg","--foot-l":"5deg","--foot-r":"-3deg","--cane-opacity":"0.68","--cane-angle":"11deg","--cane-x":"0px","--cane-y-nudge":"1px","--mono-opacity":"0","--mono-chain-opacity":"0","--mono-tilt":"-2deg","--bowtie-opacity":"0","--wear-vignette":"0.38","--coat-shred":"0.58","--lapel-gloss":"0.24","--stache-l":"8deg","--stache-r":"-8deg","--money-opacity":"0.10","--money-scale":"0.78","--money-tilt":"-4deg","--sparkle-opacity":"0.07","--sign-opacity":"0.50","--coin-opacity":"0.15","--car-opacity":"0","--glow":"rgba(207,141,125,0.18)","--eye-open":"0.86","--brow-l":"-11deg","--brow-r":"11deg","--mouth-y":"4px","--mouth-scale-y":"0.30","--mouth-rotate":"0deg","--mouth-w":"14px","--cheek-opacity":"0.22","--idle-ms":"3.0s","--tail-flare":"0.76","--coat-sheen":"0.09","--shoe-lift-l":"0px","--shoe-lift-r":"0px"}},
  surviving:{motion:"survive",moneyTier:"medium",vars:{"--character-scale":"1.12","--character-bottom":"20px","--scene-scale":"1.17","--scene-shift-x":"1px","--scene-shift-y":"-14px","--coat":"#214839","--coat-deep":"#143025","--vest":"#c99745","--shirt":"#f7f3ec","--skin":"#f0dcb8","--hat":"#163326","--hat-band":"#d0a14c","--ink":"#143126","--pose-rotate":"-2.5deg","--pose-y":"0px","--pose-scale":"0.98","--stance":"22px","--hat-tilt":"-3deg","--upper-drop":"3px","--chest-tilt":"3deg","--head-tilt":"-1.5deg","--torso-shift-x":"0px","--arm-l":"24deg","--arm-r":"-20deg","--forearm-l":"8deg","--forearm-r":"6deg","--leg-l":"4deg","--leg-r":"-5deg","--thigh-l":"6deg","--thigh-r":"-5deg","--calf-l":"-11deg","--calf-r":"-10deg","--foot-l":"3deg","--foot-r":"-2deg","--cane-opacity":"0.48","--cane-angle":"6deg","--cane-x":"-1px","--cane-y-nudge":"0px","--mono-opacity":"1","--mono-chain-opacity":"0.85","--mono-tilt":"0deg","--wear-vignette":"0.24","--coat-shred":"0.28","--lapel-gloss":"0.32","--stache-l":"6deg","--stache-r":"-6deg","--money-opacity":"0.13","--money-scale":"0.82","--money-tilt":"-3deg","--sparkle-opacity":"0.12","--sign-opacity":"0","--coin-opacity":"0.18","--car-opacity":"0","--glow":"rgba(240,205,132,0.20)","--eye-open":"0.88","--brow-l":"7deg","--brow-r":"-7deg","--mouth-y":"1px","--mouth-scale-y":"0.84","--mouth-rotate":"0deg","--mouth-w":"17px","--cheek-opacity":"0.17","--idle-ms":"3.15s","--tail-flare":"0.70","--coat-sheen":"0.13","--shoe-lift-l":"0px","--shoe-lift-r":"0px"}},
  stabilizing:{motion:"stabilize",moneyTier:"medium",vars:{"--character-scale":"1.13","--scene-scale":"1.18","--scene-shift-y":"-16px","--capsule-top":"8px","--capsule-side":"7px","--capsule-bottom":"-4px","--capsule-radius":"48px","--ground-scale-x":"1.12","--ground-scale-y":"1.06","--coat":"#1f4a3b","--coat-deep":"#123228","--vest":"#cf9f4a","--shirt":"#f9f6f0","--skin":"#f2deb9","--hat":"#153629","--hat-band":"#d9ae55","--ink":"#132a22","--pose-rotate":"-1deg","--pose-y":"0px","--pose-scale":"1.0","--stance":"16px","--hat-tilt":"-1deg","--upper-drop":"1.5px","--chest-tilt":"1.5deg","--head-tilt":"-0.5deg","--torso-shift-x":"0px","--arm-l":"-4deg","--arm-r":"-10deg","--forearm-l":"78deg","--forearm-r":"6deg","--leg-l":"1deg","--leg-r":"-2deg","--thigh-l":"0deg","--thigh-r":"0deg","--calf-l":"-2deg","--calf-r":"-3deg","--foot-l":"2deg","--foot-r":"-1deg","--cane-opacity":"0.80","--cane-angle":"1deg","--cane-x":"-2px","--cane-y-nudge":"0px","--mono-opacity":"0.94","--mono-chain-opacity":"0.82","--mono-tilt":"1deg","--wear-vignette":"0.16","--coat-shred":"0.14","--lapel-gloss":"0.40","--stache-l":"4deg","--stache-r":"-4deg","--money-opacity":"0.30","--money-scale":"0.92","--money-tilt":"-2deg","--sparkle-opacity":"0.28","--sign-opacity":"0","--coin-opacity":"0.28","--car-opacity":"0","--ledger-opacity":"1","--glow":"rgba(165,210,142,0.24)","--eye-open":"0.92","--brow-l":"4deg","--brow-r":"-4deg","--mouth-y":"0px","--mouth-scale-y":"0.90","--mouth-rotate":"0deg","--mouth-w":"16px","--cheek-opacity":"0.15","--idle-ms":"3.25s","--tail-flare":"0.64","--coat-sheen":"0.17","--shoe-lift-l":"0px","--shoe-lift-r":"0px"}},
  stable:{motion:"stable",moneyTier:"medium",vars:{"--character-scale":"1.15","--scene-scale":"1.20","--scene-shift-y":"-18px","--capsule-top":"8px","--capsule-side":"6px","--capsule-bottom":"-5px","--capsule-radius":"50px","--ground-scale-x":"1.16","--ground-scale-y":"1.08","--coat":"#1b4638","--coat-deep":"#102f26","--vest":"#d4a54e","--shirt":"#faf7f2","--skin":"#f3deb9","--hat":"#143224","--hat-band":"#ddb45d","--ink":"#11281f","--pose-rotate":"0deg","--pose-y":"0px","--pose-scale":"1.02","--stance":"15px","--hat-tilt":"1deg","--upper-drop":"0px","--chest-tilt":"0deg","--head-tilt":"0deg","--torso-shift-x":"0px","--arm-l":"-26deg","--arm-r":"-10deg","--forearm-l":"74deg","--forearm-r":"4deg","--leg-l":"0deg","--leg-r":"0deg","--thigh-l":"0deg","--thigh-r":"0deg","--calf-l":"-1deg","--calf-r":"-1deg","--foot-l":"1deg","--foot-r":"0deg","--cane-opacity":"0.84","--cane-angle":"0deg","--cane-x":"-3px","--cane-y-nudge":"-1px","--mono-opacity":"1","--mono-chain-opacity":"0.90","--mono-tilt":"2deg","--wear-vignette":"0.08","--coat-shred":"0","--lapel-gloss":"0.48","--stache-l":"3deg","--stache-r":"-3deg","--money-opacity":"0.40","--money-scale":"1.0","--money-tilt":"-1deg","--sparkle-opacity":"0.18","--sign-opacity":"0","--coin-opacity":"0.38","--car-opacity":"0","--coinup-opacity":"1","--glow":"rgba(108,182,120,0.24)","--eye-open":"0.96","--brow-l":"1deg","--brow-r":"-1deg","--mouth-y":"-1px","--mouth-scale-y":"1.0","--mouth-rotate":"0deg","--mouth-w":"15px","--cheek-opacity":"0.13","--idle-ms":"3.4s","--tail-flare":"0.58","--coat-sheen":"0.20","--shoe-lift-l":"0px","--shoe-lift-r":"0px"}},
  building:{motion:"build",moneyTier:"full",vars:{"--character-scale":"1.15","--scene-scale":"1.24","--scene-shift-x":"-1px","--scene-shift-y":"-20px","--capsule-top":"6px","--capsule-side":"4px","--capsule-bottom":"-7px","--capsule-radius":"52px","--ground-scale-x":"1.22","--ground-scale-y":"1.10","--coat":"#194435","--coat-deep":"#0e2c23","--vest":"#dbaf58","--shirt":"#fcfaf6","--skin":"#f5e0bc","--hat":"#122f24","--hat-band":"#e3bc68","--ink":"#0f241c","--pose-rotate":"1.0deg","--pose-y":"0px","--pose-scale":"1.07","--stance":"24px","--hat-tilt":"3deg","--upper-drop":"-3px","--chest-tilt":"-4deg","--head-tilt":"1.5deg","--torso-shift-x":"1px","--arm-l":"7deg","--arm-r":"-20deg","--forearm-l":"-1deg","--forearm-r":"2deg","--leg-l":"-1.5deg","--leg-r":"1.5deg","--thigh-l":"-1deg","--thigh-r":"1deg","--calf-l":"0deg","--calf-r":"0deg","--foot-l":"0deg","--foot-r":"0deg","--cane-opacity":"0.78","--cane-angle":"-2deg","--cane-x":"-4px","--cane-y-nudge":"-1px","--mono-opacity":"1","--mono-chain-opacity":"0.95","--mono-tilt":"3deg","--wear-vignette":"0.04","--coat-shred":"0","--lapel-gloss":"0.56","--stache-l":"2deg","--stache-r":"-2deg","--money-opacity":"0.50","--money-scale":"1.02","--money-tilt":"0deg","--sparkle-opacity":"0.28","--sign-opacity":"0","--coin-opacity":"0.52","--car-opacity":"0","--blueprint-opacity":"1","--glow":"rgba(77,134,199,0.38)","--eye-open":"1","--brow-l":"-1deg","--brow-r":"1deg","--mouth-y":"-1px","--mouth-scale-y":"1.06","--mouth-rotate":"-7deg","--mouth-w":"16px","--cheek-opacity":"0.17","--idle-ms":"3.05s","--tail-flare":"0.52","--coat-sheen":"0.26","--shoe-lift-l":"0px","--shoe-lift-r":"0px"}},
  thriving:{motion:"thrive",moneyTier:"full",vars:{"--character-scale":"1.16","--scene-scale":"1.24","--scene-shift-x":"-2px","--scene-shift-y":"-15px","--capsule-top":"4px","--capsule-side":"1px","--capsule-bottom":"-10px","--capsule-radius":"56px","--capsule-fill-top":"rgba(255,255,255,0.18)","--capsule-fill-bottom":"rgba(255,255,255,0.06)","--ground-scale-x":"1.28","--ground-scale-y":"1.12","--coat":"#173f32","--coat-deep":"#0c281f","--vest":"#e3b86a","--shirt":"#fffdf9","--skin":"#f7e3c4","--hat":"#102b21","--hat-band":"#e8c678","--ink":"#0d1f18","--pose-rotate":"2.0deg","--pose-y":"0px","--pose-scale":"1.12","--stance":"32px","--hat-tilt":"5deg","--upper-drop":"-4px","--chest-tilt":"-7deg","--head-tilt":"2.5deg","--torso-shift-x":"1.5px","--arm-l":"2deg","--arm-r":"-28deg","--forearm-l":"-1deg","--forearm-r":"0deg","--leg-l":"-2deg","--leg-r":"2deg","--thigh-l":"-1.5deg","--thigh-r":"1.5deg","--calf-l":"1deg","--calf-r":"1deg","--foot-l":"-0.5deg","--foot-r":"0.5deg","--cane-opacity":"0.86","--cane-angle":"-4deg","--cane-x":"-5px","--cane-y-nudge":"-2px","--mono-opacity":"1","--mono-chain-opacity":"1","--mono-tilt":"4deg","--wear-vignette":"0","--coat-shred":"0","--lapel-gloss":"0.64","--stache-l":"1deg","--stache-r":"-1deg","--money-opacity":"0.55","--money-scale":"1.04","--money-tilt":"0deg","--sparkle-opacity":"0.55","--sign-opacity":"0","--coin-opacity":"0.62","--car-opacity":"0","--watch-opacity":"1","--glow":"rgba(139,103,216,0.50)","--eye-open":"1","--brow-l":"-2deg","--brow-r":"2deg","--mouth-y":"-2px","--mouth-scale-y":"1.10","--mouth-rotate":"0deg","--mouth-w":"17px","--cheek-opacity":"0.21","--idle-ms":"2.9s","--tail-flare":"0.46","--coat-sheen":"0.32","--shoe-lift-l":"0px","--shoe-lift-r":"0px"}},
  winning:{motion:"win",moneyTier:"full",vars:{"--character-scale":"1.12","--scene-scale":"1.28","--scene-shift-x":"-3px","--scene-shift-y":"-28px","--capsule-top":"2px","--capsule-side":"-2px","--capsule-bottom":"-12px","--capsule-radius":"58px","--capsule-fill-top":"rgba(255,251,219,0.20)","--capsule-fill-bottom":"rgba(255,243,170,0.08)","--capsule-border":"rgba(255,234,163,0.24)","--ground-scale-x":"1.36","--ground-scale-y":"1.16","--shirt":"#ffffff","--skin":"#f8e6c8","--hat":"#0e271e","--hat-band":"#edcd82","--ink":"#0b1c16","--pose-rotate":"2.5deg","--pose-y":"0px","--pose-scale":"1.16","--stance":"38px","--hat-tilt":"6.5deg","--upper-drop":"-5px","--chest-tilt":"-11deg","--head-tilt":"4.0deg","--torso-shift-x":"1.5px","--arm-l":"-5deg","--arm-r":"-34deg","--forearm-l":"-2deg","--forearm-r":"-1deg","--leg-l":"-2.5deg","--leg-r":"2.5deg","--thigh-l":"-1.5deg","--thigh-r":"1.5deg","--calf-l":"1.5deg","--calf-r":"1.5deg","--foot-l":"-1deg","--foot-r":"1deg","--cane-opacity":"0.94","--cane-angle":"-8deg","--cane-x":"-6px","--cane-y-nudge":"-2px","--mono-opacity":"1","--mono-chain-opacity":"1","--mono-tilt":"5.5deg","--wear-vignette":"0","--coat-shred":"0","--lapel-gloss":"0.72","--stache-l":"0deg","--stache-r":"0deg","--money-opacity":"0.58","--money-scale":"1.05","--money-tilt":"1deg","--sparkle-opacity":"0.62","--sign-opacity":"0","--coin-opacity":"0.58","--car-opacity":"0.55","--car-shift-x":"46px","--car-shift-y":"-4px","--car-scale":"0.55","--ring-opacity":"0","--glow":"rgba(218,192,48,0.62)","--eye-open":"1","--brow-l":"-3deg","--brow-r":"3deg","--mouth-y":"-2px","--mouth-scale-y":"1.14","--mouth-rotate":"0deg","--mouth-w":"18px","--cheek-opacity":"0.24","--idle-ms":"3.2s","--tail-flare":"0.40","--coat-sheen":"0.38","--shoe-lift-l":"0px","--shoe-lift-r":"0px"}},
  wealthy:{motion:"win",moneyTier:"full",vars:{"--character-scale":"1.14","--scene-scale":"1.30","--scene-shift-x":"-3px","--scene-shift-y":"-28px","--capsule-top":"0px","--capsule-side":"-4px","--capsule-bottom":"-14px","--capsule-radius":"60px","--capsule-fill-top":"rgba(255,251,219,0.22)","--capsule-fill-bottom":"rgba(255,243,170,0.08)","--capsule-border":"rgba(255,234,163,0.26)","--ground-scale-x":"1.44","--ground-scale-y":"1.18","--ground-lift":"2px","--dog-opacity":"0.82","--dog-scale":"1.18","--dog-shift-x":"8px","--dog-shift-y":"6px","--vest":"#e8c678","--shirt":"#fffdf9","--skin":"#f8e6c8","--hat":"#0e271e","--hat-band":"#edcd82","--ink":"#0b1c16","--pose-rotate":"2.5deg","--pose-y":"0px","--pose-scale":"1.16","--stance":"38px","--hat-tilt":"6.5deg","--upper-drop":"-5px","--chest-tilt":"-11deg","--head-tilt":"4.0deg","--torso-shift-x":"1.5px","--arm-l":"-5deg","--arm-r":"-34deg","--forearm-l":"-2deg","--forearm-r":"-1deg","--leg-l":"-2.5deg","--leg-r":"2.5deg","--thigh-l":"-1.5deg","--thigh-r":"1.5deg","--calf-l":"1.5deg","--calf-r":"1.5deg","--foot-l":"-1deg","--foot-r":"1deg","--cane-opacity":"0.94","--cane-angle":"-8deg","--cane-x":"-6px","--cane-y-nudge":"-2px","--mono-opacity":"1","--mono-chain-opacity":"1","--mono-tilt":"5.5deg","--wear-vignette":"0","--coat-shred":"0","--lapel-gloss":"0.72","--stache-l":"0deg","--stache-r":"0deg","--money-opacity":"0.42","--money-scale":"1.02","--money-tilt":"1deg","--sparkle-opacity":"0.36","--sign-opacity":"0","--coin-opacity":"0.60","--car-opacity":"0","--ring-opacity":"0","--coin-shower-opacity":"0","--ornament-opacity":"0","--glow":"rgba(218,192,48,0.42)","--eye-open":"0.74","--brow-l":"-3deg","--brow-r":"3deg","--mouth-y":"-2px","--mouth-scale-y":"1.14","--mouth-rotate":"0deg","--mouth-w":"18px","--cheek-opacity":"0.32","--idle-ms":"3.2s","--tail-flare":"0.40","--coat-sheen":"0.38","--shoe-lift-l":"0px","--shoe-lift-r":"0px"}},
};

/* ── Per-card optical centering nudges (px) ────────────────────────
   Applied AFTER all existing layout math as a final visual correction.
   Positive x = nudge right, positive y = nudge down.
   Tuned card-by-card against the showcase grid. ──────────────────── */
const OPTICAL_OFFSETS = {
  rock_bottom:  { x: 3, y: -6 },
  broke:        { x: 2, y: -4 },
  struggling:   { x: 1, y: -3 },
  surviving:    { x: 0, y: -2 },
  stabilizing:  { x: 0, y: -1 },
  stable:       { x: 0, y: 0 },
  building:     { x: -1, y: 0 },
  thriving:     { x: -1, y: 0 },
  winning:      { x: -2, y: 0 },
  wealthy:      { x: -1, y: 0 },
};

const DEFAULT_VARS = {"--character-scale":"1","--character-bottom":"18px","--scene-scale":"1.15","--scene-shift-x":"0px","--scene-shift-y":"-10px","--capsule-top":"10px","--capsule-side":"8px","--capsule-bottom":"-2px","--capsule-radius":"46px","--capsule-fill-top":"rgba(255,255,255,0.16)","--capsule-fill-bottom":"rgba(255,255,255,0.04)","--capsule-border":"rgba(255,255,255,0.12)","--upper-drop":"0px","--chest-tilt":"0deg","--head-tilt":"0deg","--thigh-l":"0deg","--thigh-r":"0deg","--calf-l":"0deg","--calf-r":"0deg","--foot-l":"0deg","--foot-r":"0deg","--forearm-l":"0deg","--forearm-r":"0deg","--cane-y-nudge":"0px","--torso-shift-x":"0px","--money-tilt":"-4deg","--car-shift-x":"56px","--car-shift-y":"20px","--car-scale":"0.66","--ring-opacity":"0","--coin-shower-opacity":"0","--dog-opacity":"0","--dog-scale":"1","--dog-shift-x":"0px","--dog-shift-y":"0px","--ground-scale-x":"1.1","--ground-scale-y":"1.05","--ground-lift":"0px","--ornament-opacity":"0","--ledger-opacity":"0","--coinup-opacity":"0","--blueprint-opacity":"0","--watch-opacity":"0","--bowtie-opacity":"1","--car-body":"#113829","--car-body-deep":"#0b251b","--car-accent":"#d4a643","--car-window":"rgba(208,231,238,0.92)","--car-wheel":"#23282d"};

/* ── Cardboard sign text per low tier (sign is invisible above struggling) ── */
const SIGN_TEXT = {
  rock_bottom: 'Will budget for food',
  broke:       'Every dollar counts',
  struggling:  'Not done yet',
};

/* ── Apply variables to a wrap element ────────────────────────────── */
function applyStewardTheme(wrap, stateId) {
  const entry = STEWARD_STATE[stateId];
  const vars  = { ...DEFAULT_VARS, ...(entry?.vars || {}) };
  for (const [k, v] of Object.entries(vars)) wrap.style.setProperty(k, String(v));
  if (entry?.motion) wrap.dataset.motion = entry.motion;
  wrap.dataset.moneyTier = entry?.moneyTier || 'medium';

  const sign = wrap.querySelector('.steward-sign');
  if (sign && SIGN_TEXT[stateId]) sign.textContent = SIGN_TEXT[stateId];

  const nudge = OPTICAL_OFFSETS[stateId];
  if (nudge) {
    wrap.style.setProperty('--optical-x', `${nudge.x}px`);
    wrap.style.setProperty('--optical-y', `${nudge.y}px`);
  }
}

/* ── Pause offscreen mascots — each card runs ~60 infinite animations,
   so the 10-card gallery burns CPU for characters nobody can see. ── */
let stewardViewObserver = null;
function observeStewardVisibility(wrap) {
  if (typeof IntersectionObserver === 'undefined') return;
  if (!stewardViewObserver) {
    stewardViewObserver = new IntersectionObserver(entries => {
      for (const e of entries) e.target.classList.toggle('steward-offscreen', !e.isIntersecting);
    }, { rootMargin: '80px' });
  }
  stewardViewObserver.observe(wrap);
}

/* ── Build a Steward element from template ────────────────────────── */
export function buildSteward(stateId) {
  const template = document.getElementById('steward-template');
  if (!template) return null;
  const node     = template.content.firstElementChild.cloneNode(true);
  node.dataset.state = stateId;
  applyStewardTheme(node, stateId);
  observeStewardVisibility(node);
  return node;
}

/* ── Mount hero character ─────────────────────────────────────────── */
let heroWrap = null;
const HERO_SCENE_SCALE_MULTIPLIER = 1.12;
const STEWARD_WRAP_HEIGHT = 268;

function heroCenteredSceneShiftY(baseSceneScale, heroSceneScale) {
  const addedVisualHeight = (heroSceneScale - baseSceneScale) * STEWARD_WRAP_HEIGHT;
  return Math.round(addedVisualHeight / 2 + (baseSceneScale - 1) * 73 + 5);
}

/**
 * Build a Steward at hero scale and place it into `mount`. Shared by the live
 * dashboard and the animation gallery so both render identically.
 */
export function mountHeroCharacterInto(mount, stateId) {
  if (!mount) return null;
  mount.innerHTML = '';
  const wrap = buildSteward(stateId);

  // Hero gets a stronger whole-scene scale so props and capsule stay proportional.
  const baseSceneScale = parseFloat(wrap.style.getPropertyValue('--scene-scale') || '1');
  const baseGroundX = parseFloat(wrap.style.getPropertyValue('--ground-scale-x') || '1');
  const baseGroundY = parseFloat(wrap.style.getPropertyValue('--ground-scale-y') || '1');

  const heroSceneScale = baseSceneScale * HERO_SCENE_SCALE_MULTIPLIER;
  wrap.style.setProperty('--scene-scale', String(heroSceneScale.toFixed(3)));
  wrap.style.setProperty('--scene-shift-y', `${heroCenteredSceneShiftY(baseSceneScale, heroSceneScale)}px`);
  wrap.style.setProperty('--ground-scale-x', String((baseGroundX * 1.08).toFixed(3)));
  wrap.style.setProperty('--ground-scale-y', String((baseGroundY * 1.08).toFixed(3)));

  mount.appendChild(wrap);
  return wrap;
}

export function mountHeroCharacter(stateId) {
  // Update card wrapper data-state so backgrounds/glows/gradients apply
  const card = document.getElementById('hero-state-card');
  if (card) card.dataset.state = stateId;

  const mount = document.getElementById('hero-steward-mount');
  if (!mount) return;
  // Re-mounting rebuilds a heavy SVG and restarts all ~60 mascot animations
  // from frame 0 — a visible reset on every dashboard refresh. Skip it when the
  // stage hasn't actually changed; the existing character keeps animating.
  if (mount.dataset.mountedState === stateId && mount.firstElementChild) return;
  mount.dataset.mountedState = stateId;
  heroWrap = mountHeroCharacterInto(mount, stateId);
}

export function mountStartScreenSteward() {
  const host = document.getElementById('start-game-character');
  const template = document.getElementById('steward-template');
  if (!host || !template) return;

  host.textContent = '';
  const root = document.createElement('div');
  root.className = 'start-game-steward-root';
  const breathe = document.createElement('div');
  breathe.className = 'start-game-steward-breathe';
  breathe.appendChild(buildSteward('stable'));
  root.appendChild(breathe);
  host.appendChild(root);
}
