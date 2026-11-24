// «Quiénes somos»: índice de capítulos, archivo con visor y movimiento mínimo con GSAP.
// Lo básico (índice, archivo, visor) funciona sin GSAP. El movimiento solo se agrega si GSAP cargó
// y la persona no pidió reducir el movimiento. Nada se fija en pantalla salvo el periódico, que acompaña
// la lectura de su propio capítulo sin moverse ni alargar el recorrido.
(() => {
  const raiz = document.querySelector('.ab-especial');
  if (!raiz) return;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // Alto real del encabezado fijo (cambia entre computador y celular).
  const cabecera = $('.topbar');
  const indice = $('.ab-indice', raiz);
  const medir = () => raiz.style.setProperty('--cab', `${cabecera ? cabecera.offsetHeight : 0}px`);
  medir();
  addEventListener('resize', medir);

  // ---------- Índice: marca el capítulo que se está leyendo ----------
  const enlaces = new Map($$('a', indice).map((a) => [a.hash.slice(1), a]));
  const lista = $('ol', indice);
  const secciones = [...enlaces.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  let marcado = null;
  let esperando = false;
  const revisar = () => {
    esperando = false;
    const linea = innerHeight * 0.45;
    let id = null;
    for (const s of secciones) if (s.getBoundingClientRect().top <= linea) id = s.id;
    if (id === marcado) return;
    marcado = id;
    enlaces.forEach((a, k) => (k === id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
    const a = enlaces.get(id);
    if (a && lista) lista.scrollTo({ left: a.offsetLeft - 16, behavior: 'smooth' });
  };
  addEventListener('scroll', () => { if (!esperando) { esperando = true; requestAnimationFrame(revisar); } }, { passive: true });
  revisar();

  // ---------- Archivo: pieza destacada, miniaturas y visor a pantalla completa ----------
  const datos = $('#ab-archivo-datos');
  const archivo = $('.ab-archivo', raiz);
  if (datos && archivo) {
    const piezas = JSON.parse(datos.textContent);
    const escena = $('.ab-escena-foto', archivo);
    const eImg = $('img', escena);
    const ePie = $('.ab-escena-pie', archivo);
    const eMeta = $('.ab-escena-meta', archivo);
    const ctrl = $('.ab-escena-ctrl', archivo);
    const contador = $('.ab-contador', archivo);
    const minis = $$('.ab-mini', archivo);
    const visor = $('.ab-visor', raiz);
    const vImg = $('img', visor);
    let actual = 0;
    ctrl.hidden = false;

    const elegir = (i, { enfocar = false } = {}) => {
      actual = (i + piezas.length) % piezas.length;
      const p = piezas[actual];
      const figura = escena.closest('.ab-escena');
      eImg.style.opacity = '0';
      figura.classList.add('ab-cambiando');
      const nueva = new Image();
      nueva.onload = nueva.onerror = () => {
        eImg.src = p.src;
        eImg.alt = p.pie;
        ePie.textContent = p.pie;
        eMeta.textContent = p.meta;
        eImg.style.opacity = '1';
        figura.classList.remove('ab-cambiando');
      };
      nueva.src = p.src;
      escena.href = p.src;
      contador.textContent = `${actual + 1} de ${piezas.length}`;
      minis.forEach((m, k) => (k === actual ? m.setAttribute('aria-current', 'true') : m.removeAttribute('aria-current')));
      // La miniatura elegida queda centrada en la tira.
      const m = minis[actual];
      const tira = m.closest('.ab-miniaturas');
      tira.scrollTo({ left: m.parentElement.offsetLeft - (tira.clientWidth - m.offsetWidth) / 2, behavior: 'smooth' });
      if (enfocar) m.focus({ preventScroll: true });
      if (visor.open) mostrarVisor();
    };
    const mostrarVisor = () => {
      const p = piezas[actual];
      vImg.src = p.src;
      vImg.alt = p.pie;
      $('.ab-visor-pie', visor).textContent = `${p.pie} (${actual + 1} de ${piezas.length})`;
      $('.ab-visor-meta', visor).textContent = p.meta;
    };

    minis.forEach((m) => m.addEventListener('click', (e) => { e.preventDefault(); elegir(Number(m.dataset.i)); }));
    $('.ab-miniaturas', archivo).addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); elegir(actual + (e.key === 'ArrowRight' ? 1 : -1), { enfocar: true }); }
    });
    $$('[data-mover]', ctrl).forEach((b) => b.addEventListener('click', () => elegir(actual + Number(b.dataset.mover))));
    escena.addEventListener('click', (e) => { e.preventDefault(); mostrarVisor(); visor.showModal(); });

    $('.ab-visor-ant', visor).addEventListener('click', () => elegir(actual - 1));
    $('.ab-visor-sig', visor).addEventListener('click', () => elegir(actual + 1));
    $('.ab-visor-cerrar', visor).addEventListener('click', () => visor.close());
    visor.addEventListener('click', (e) => { if (e.target === visor) visor.close(); });
    visor.addEventListener('close', () => escena.focus({ preventScroll: true }));
    visor.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') elegir(actual - 1);
      if (e.key === 'ArrowRight') elegir(actual + 1);
    });
    // Deslizar con el dedo en la foto destacada y en el visor.
    [escena, visor].forEach((zona) => {
      let x0 = null;
      zona.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
      zona.addEventListener('pointerup', (e) => {
        if (x0 === null) return;
        const dx = e.clientX - x0;
        x0 = null;
        if (Math.abs(dx) > 50) { elegir(actual + (dx < 0 ? 1 : -1)); zona.dataset.deslizo = '1'; }
      });
      zona.addEventListener('click', (e) => { if (zona.dataset.deslizo) { e.preventDefault(); e.stopImmediatePropagation(); delete zona.dataset.deslizo; } }, true);
    });
  }

  // ---------- Movimiento con GSAP ----------
  const avance = $('.ab-avance', raiz);
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) {
    // Sin GSAP: barra de avance simple y todas las marcas de la cronología encendidas.
    $$('.ab-hito', raiz).forEach((h) => h.classList.add('ab-alcanzado'));
    if (avance) {
      const actualizar = () => {
        const r = raiz.getBoundingClientRect();
        avance.style.transform = `scaleX(${Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight)))})`;
      };
      addEventListener('scroll', actualizar, { passive: true });
      actualizar();
    }
    return;
  }
  gsap.registerPlugin(ScrollTrigger);

  // Barra de avance del recorrido: es un indicador, se mantiene también con movimiento reducido.
  if (avance) {
    gsap.to(avance, { scaleX: 1, ease: 'none', scrollTrigger: { trigger: raiz, start: 'top top', end: 'bottom bottom', scrub: true } });
  }

  const mm = gsap.matchMedia();
  mm.add({ mov: '(prefers-reduced-motion: no-preference)' }, (ctx) => {
    const { mov } = ctx.conditions;
    if (!mov) {
      $$('.ab-hito', raiz).forEach((h) => h.classList.add('ab-alcanzado'));
      return;
    }

    // Portada: un único momento de entrada, breve. Se omite si la pestaña se abrió en segundo plano.
    if (!document.hidden && scrollY < innerHeight / 2) {
      gsap.timeline({ defaults: { ease: 'power2.out' } })
        .from($$('.ab-lin > span', raiz), { yPercent: 100, duration: 0.65, stagger: 0.1 })
        .from($('.ab-bajada', raiz), { autoAlpha: 0, y: 10, duration: 0.5 }, 0.3);
    }

    // El riel se ilumina a medida que se recorre cada capítulo: indica en qué parte de la historia vas.
    $$('.ab-riel-luz', raiz).forEach((luz) => {
      gsap.fromTo(luz, { scaleY: 0 }, { scaleY: 1, ease: 'none', scrollTrigger: { trigger: luz.closest('.ab-cap'), start: 'top 70%', end: 'bottom 70%', scrub: true } });
    });

    // Cronología: cada marca se enciende cuando la lectura llega a su hito.
    $$('.ab-hito', raiz).forEach((h) => {
      ScrollTrigger.create({ trigger: h, start: 'top 68%', onEnter: () => h.classList.add('ab-alcanzado'), onLeaveBack: () => h.classList.remove('ab-alcanzado') });
    });

    // Capítulo 2: el esquema se arma en un tramo corto del desplazamiento y la línea roja se dibuja.
    $$('.ab-corte svg', raiz).forEach((svg) => {
      const frontera = $('.c-frontera', svg);
      gsap.set(frontera, { strokeDasharray: 1, strokeDashoffset: 1 });
      gsap.timeline({ scrollTrigger: { trigger: svg, start: 'top 85%', end: 'top 35%', scrub: 0.5 } })
        .to(frontera, { strokeDashoffset: 0, duration: 1, ease: 'none' }, 0)
        .from($$('.c-casas path', svg), { y: 18, autoAlpha: 0, stagger: 0.05, duration: 0.4 }, 0.3)
        .from($('.c-rio', svg), { autoAlpha: 0, duration: 0.4 }, 0.5);
    });
  });

  // Las fotos y fuentes cambian alturas: recalcular cuando todo cargó.
  addEventListener('load', () => ScrollTrigger.refresh());
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
})();
