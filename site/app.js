/* TinyJS App Studio — landing page interactions */
(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- reveal on scroll ---- */
  const revealEls = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window && !reducedMotion) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("in"));
  }

  /* ---- nav state + scroll progress + hero parallax ---- */
  const nav = document.getElementById("nav");
  const progress = document.getElementById("progress");
  const heroVisual = document.querySelector(".hero-visual");
  let ticking = false;

  const onScroll = () => {
    const y = window.scrollY;
    nav.classList.toggle("scrolled", y > 12);

    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (max > 0 ? (y / max) * 100 : 0) + "%";

    if (!reducedMotion && heroVisual && y < window.innerHeight) {
      heroVisual.style.transform = `translateY(${y * 0.06}px)`;
      document.querySelector(".hero-copy").style.transform = `translateY(${y * 0.03}px)`;
    }
    ticking = false;
  };

  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(onScroll);
      }
    },
    { passive: true }
  );
  onScroll();

  /* ---- 3D tilt on frames ---- */
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (canHover && !reducedMotion) {
    document.querySelectorAll(".frame-tilt").forEach((el) => {
      el.addEventListener("pointermove", (ev) => {
        const r = el.getBoundingClientRect();
        const px = (ev.clientX - r.left) / r.width - 0.5;
        const py = (ev.clientY - r.top) / r.height - 0.5;
        el.style.setProperty("--ty", `${px * 7 - 2}deg`);
        el.style.setProperty("--tx", `${py * -5}deg`);
      });
      el.addEventListener("pointerleave", () => {
        el.style.setProperty("--ty", "-5deg");
        el.style.setProperty("--tx", "0deg");
      });
    });
  }

  /* ---- copy button ---- */
  const copyBtn = document.getElementById("copybtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const cmd = "git clone https://github.com/slabbdev/tinyjsapp-studio\ncd tinyjsapp-studio\ntinyjs dev";
      try {
        await navigator.clipboard.writeText(cmd);
        copyBtn.textContent = "copied ✓";
        copyBtn.classList.add("done");
      } catch {
        copyBtn.textContent = "⌘C";
      }
      setTimeout(() => {
        copyBtn.textContent = "copy";
        copyBtn.classList.remove("done");
      }, 1800);
    });
  }

  /* ---- latest release version ---- */
  const dlVer = document.getElementById("dl-ver");
  const dlVer2 = document.getElementById("dl-ver2");
  if (dlVer) {
    fetch("https://api.github.com/repos/slabbdev/tinyjsapp-studio/releases/latest")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        if (d && d.tag_name) {
          dlVer.textContent = d.tag_name;
          if (dlVer2) dlVer2.textContent = d.tag_name;
        }
      })
      .catch(() => {
        /* keep the hardcoded version */
      });
  }
})();
