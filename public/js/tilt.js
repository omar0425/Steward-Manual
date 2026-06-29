'use strict';

/* ── 3D tilt ─────────────────────────────────────────────────────────────────
   Gives the hero tier card a subtle parallax lean toward the pointer, for depth.
   Skipped on touch/coarse pointers (no hover) and for reduced-motion users. The
   inline transform is cleared on leave so the CSS hover/base state resumes. */

const MAX_DEG = 6;

function supported() {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if (window.matchMedia('(hover: none)').matches) return false; // touch
    return true;
  } catch (_) { return false; }
}

export function initHeroTilt() {
  const card = document.getElementById('hero-state-card');
  if (!card || card.dataset.tiltBound === '1' || !supported()) return;
  card.dataset.tiltBound = '1';

  let raf = null;
  const onMove = (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;   // 0..1
      const py = (e.clientY - r.top) / r.height;   // 0..1
      const ry = (px - 0.5) * 2 * MAX_DEG;         // left/right
      const rx = (0.5 - py) * 2 * MAX_DEG;         // up/down
      card.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-2px)`;
    });
  };
  const reset = () => {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    card.style.transform = '';
  };

  card.addEventListener('pointermove', onMove);
  card.addEventListener('pointerleave', reset);
}
