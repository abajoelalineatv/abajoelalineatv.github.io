// «Quiénes somos»: índice de capítulos, archivo con visor y animaciones con GSAP.
// Lo básico (índice, archivo, visor) funciona sin GSAP. El movimiento solo se agrega si GSAP cargó
// y la persona no pidió reducir el movimiento.
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
  const alturaFija = () => (cabecera ? cabecera.offsetHeight : 0) + (indice ? indice.offsetHeight : 0);

  // ---------- Índice: marca el capítulo que se está leyendo ----------
  const enlaces = new Map($$('a', indice).map((a) => [a.hash.slice(1), a]));
  const lista = $('ol', indice);
  const marcar = (id) => {
    enlaces.forEach((a, k) => (k === id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
    const a = enlaces.get(id);
    if (a && lista) lista.scrollTo({ left: a.offsetLeft - 16, behavior: 'smooth' });
  };
  // El capítulo actual es el último cuyo comienzo ya pasó el 45% de la pantalla (ninguno antes del primero).
  const secciones = [...enlaces.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  let marcado = null;
  let esperando = false;
  const revisar = () => {
    esperando = false;
    const linea = innerHeight * 0.45;
    let id = null;
    for (const s of secciones) if (s.getBoundingClientRect().top <= linea) id = s.id;
    if (id !== marcado) { marcado = id; marcar(id); }
  };
  addEventListener('scroll', () => { if (!esperando) { esperando = true; requestAnimationFrame(revisar); } }, { passive: true });
  revisar();

  // ---------- Archivo: carrusel con botones y contador ----------
  const carrusel = $('.ab-carrusel', raiz);
  if (carrusel) {
    const ctrl = $('.ab-archivo-ctrl', raiz);
    const [ant, sig] = $$('[data-mover]', ctrl);
    const contador = $('.ab-contador', ctrl);
    const items = $$('li', carrusel);
    ctrl.hidden = false;
    const paso = () => (items[1] ? items[1].offsetLeft - items[0].offsetLeft : carrusel.clientWidth);
    const actualizar = () => {
      const i = Math.round(carrusel.scrollLeft / paso());
      const visibles = Math.max(1, Math.floor((carrusel.clientWidth + 20) / paso()));
      contador.textContent = `${Math.min(i + 1, items.length)}–${Math.min(i + visibles, items.length)} de ${items.length}`;
      ant.disabled = carrusel.scrollLeft < 4;
      sig.disabled = carrusel.scrollLeft + carrusel.clientWidth >= carrusel.scrollWidth - 4;
    };
    let pendiente = false;
    carrusel.addEventListener('scroll', () => {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(() => { pendiente = false; actualizar(); });
    }, { passive: true });
    $$('[data-mover]', ctrl).forEach((b) => b.addEventListener('click', () => {
      carrusel.scrollBy({ left: Number(b.dataset.mover) * paso(), behavior: 'smooth' });
    }));
    addEventListener('resize', actualizar);
    actualizar();

    // ---------- Visor: foto ampliada con anterior/siguiente, teclado y deslizar ----------
    const visor = $('.ab-visor', raiz);
    const fotos = items.map((li) => ({ src: $('img', li).getAttribute('src'), pie: $('figcaption', li)?.textContent || '' }));
    const vImg = $('img', visor);
    const vPie = $('figcaption', visor);
    let actual = 0;
    let origen = null;
    const mostrar = (i) => {
      actual = (i + fotos.length) % fotos.length;
      vImg.src = fotos[actual].src;
      vImg.alt = fotos[actual].pie;
      vPie.textContent = `${fotos[actual].pie} (${actual + 1} de ${fotos.length})`;
    };
    $$('.ab-foto-btn', carrusel).forEach((b) => b.addEventListener('click', () => {
      origen = b;
      mostrar(Number(b.dataset.i));
      visor.showModal();
    }));
    $('.ab-visor-ant', visor).addEventListener('click', () => mostrar(actual - 1));
    $('.ab-visor-sig', visor).addEventListener('click', () => mostrar(actual + 1));
    $('.ab-visor-cerrar', visor).addEventListener('click', () => visor.close());
    visor.addEventListener('click', (e) => { if (e.target === visor) visor.close(); });
    visor.addEventListener('close', () => origen?.focus());
    visor.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') mostrar(actual - 1);
      if (e.key === 'ArrowRight') mostrar(actual + 1);
    });
    let x0 = null;
    visor.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
    visor.addEventListener('pointerup', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 50) mostrar(actual + (dx < 0 ? 1 : -1));
    });
  }

  // ---------- Movimiento con GSAP ----------
  const avance = $('.ab-avance', raiz);
  const avanceSimple = () => {
    if (!avance) return;
    const r = raiz.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight)));
    avance.style.transform = `scaleX(${p})`;
  };
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) {
    addEventListener('scroll', avanceSimple, { passive: true });
    avanceSimple();
    return;
  }
  gsap.registerPlugin(ScrollTrigger);

  // Barra de avance del recorrido (también con movimiento reducido: no es una animación, es un indicador).
  if (avance) {
    gsap.to(avance, { scaleX: 1, ease: 'none', scrollTrigger: { trigger: raiz, start: 'top top', end: 'bottom bottom', scrub: true } });
  }

  const mm = gsap.matchMedia();
  mm.add({ mov: '(prefers-reduced-motion: no-preference)', compu: '(min-width: 961px)' }, (ctx) => {
    const { mov, compu } = ctx.conditions;
    if (!mov) return;

    // Portada: un solo momento de entrada. La foto se asienta y el título sube línea por línea.
    // Si la pestaña se abrió en segundo plano, se omite la entrada para no dejar el título a medias.
    const portadaImg = $('.ab-portada-img', raiz);
    if (!document.hidden && scrollY < innerHeight / 2) {
      const entrada = gsap.timeline({ defaults: { ease: 'power3.out' } });
      if (portadaImg) entrada.from(portadaImg, { scale: 1.08, duration: 1.8, ease: 'power2.out' }, 0);
      entrada.from($$('.ab-lin > span', raiz), { yPercent: 105, duration: 1, stagger: 0.12 }, 0.15)
        .from($('.ab-bajada', raiz), { autoAlpha: 0, y: 18, duration: 0.8 }, 0.55);
    }
    if (portadaImg) {
      gsap.to(portadaImg, { yPercent: 10, ease: 'none', scrollTrigger: { trigger: '.ab-portada', start: 'top top', end: 'bottom top', scrub: true } });
    }

    // El riel se ilumina a medida que se recorre cada capítulo.
    $$('.ab-riel-luz', raiz).forEach((luz) => {
      gsap.fromTo(luz, { scaleY: 0 }, { scaleY: 1, ease: 'none', scrollTrigger: { trigger: luz.closest('.ab-cap'), start: 'top 75%', end: 'bottom 75%', scrub: true } });
    });

    // Capítulo 1: la lectura recorre la portada real del periódico (solo en computador, donde queda fija).
    const doc = $('.ab-doc-marco img', raiz);
    if (doc && compu) {
      const focos = {
        todo: { scale: 1, transformOrigin: '50% 50%' },
        cabecera: { scale: 2.1, transformOrigin: '50% 8%' },
        linea: { scale: 2.3, transformOrigin: '40% 91%' },
      };
      gsap.set(doc, focos.todo);
      $$('.ab-paso', raiz).forEach((p) => {
        ScrollTrigger.create({
          trigger: p, start: 'top 62%', end: 'bottom 38%',
          onToggle: (st) => { if (st.isActive) gsap.to(doc, { ...(focos[p.dataset.foco] || focos.todo), duration: 1, ease: 'power2.inOut', overwrite: true }); },
        });
      });
    }

    // Capítulo 2: el esquema se arma con el desplazamiento; la línea roja se dibuja.
    $$('.ab-corte svg', raiz).forEach((svg) => {
      const frontera = $('.c-frontera', svg);
      gsap.set(frontera, { strokeDasharray: 1, strokeDashoffset: 1 });
      gsap.timeline({ scrollTrigger: { trigger: svg, start: 'top 80%', end: 'center 45%', scrub: 0.6 } })
        .from($$('.c-edif rect', svg), { yPercent: 40, autoAlpha: 0, stagger: 0.05, duration: 0.5 }, 0)
        .to(frontera, { strokeDashoffset: 0, duration: 1, ease: 'none' }, 0.2)
        .from($$('.c-casas path', svg), { y: 26, autoAlpha: 0, stagger: 0.06, duration: 0.5 }, 0.5)
        .from($('.c-rio', svg), { autoAlpha: 0, duration: 0.5 }, 0.8)
        .from($$('text', svg), { autoAlpha: 0, stagger: 0.04, duration: 0.4 }, 0.6);
    });

    // Capítulo 3: en computador, la cronología queda fija y los hitos avanzan en horizontal.
    const crono = $('.ab-crono', raiz);
    const pista = $('.ab-crono-pista', raiz);
    if (crono && pista && compu && pista.children.length > 1) {
      crono.classList.add('ab-crono-h');
      const distancia = () => Math.max(0, pista.scrollWidth - innerWidth);
      gsap.timeline({
        scrollTrigger: {
          trigger: crono, pin: true, scrub: 0.8, invalidateOnRefresh: true, anticipatePin: 1,
          start: () => `top top+=${alturaFija()}`, end: () => `+=${distancia()}`,
        },
      })
        .to(pista, { x: () => -distancia(), ease: 'none' }, 0)
        .to($('.ab-crono-barra span', crono), { scaleX: 1, ease: 'none' }, 0);
      return () => crono.classList.remove('ab-crono-h');
    }
  });

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    // Capítulo 4: parallax moderado en la foto del estudio.
    const foto = $('.ab-paralaje img', raiz);
    if (foto) {
      gsap.fromTo(foto, { yPercent: -6, scale: 1.14 }, { yPercent: 6, scale: 1.14, ease: 'none', scrollTrigger: { trigger: foto.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } });
    }
    // Manifiesto: las palabras se encienden una a una al leer.
    const pals = $$('.ab-manifiesto .ab-pal', raiz);
    if (pals.length) {
      gsap.fromTo(pals, { opacity: 0.22 }, { opacity: 1, stagger: 0.1, ease: 'none', scrollTrigger: { trigger: '.ab-manifiesto h2', start: 'top 85%', end: 'bottom 50%', scrub: true } });
    }
    // Cierre: la foto de fondo se desplaza levemente.
    const fondo = $('.ab-cierre-fondo', raiz);
    if (fondo) {
      gsap.fromTo(fondo, { yPercent: -6 }, { yPercent: 6, ease: 'none', scrollTrigger: { trigger: '.ab-cierre', start: 'top bottom', end: 'bottom top', scrub: true } });
    }
  });

  // Las fotos y fuentes cambian alturas: recalcular cuando todo cargó.
  addEventListener('load', () => ScrollTrigger.refresh());
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
})();
