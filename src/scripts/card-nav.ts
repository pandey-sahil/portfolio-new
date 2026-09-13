import { gsap } from 'gsap';

function calculateHeight(navEl: HTMLElement, contentEl: HTMLElement): number {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (!isMobile) return 260;

  const wasVisibility = contentEl.style.visibility;
  const wasPointerEvents = contentEl.style.pointerEvents;
  const wasPosition = contentEl.style.position;
  const wasHeight = contentEl.style.height;

  contentEl.style.visibility = 'visible';
  contentEl.style.pointerEvents = 'auto';
  contentEl.style.position = 'static';
  contentEl.style.height = 'auto';

  // Force layout so scrollHeight reflects the temporarily-visible content.
  void contentEl.offsetHeight;

  const topBar = 60;
  const padding = 16;
  const contentHeight = contentEl.scrollHeight;

  contentEl.style.visibility = wasVisibility;
  contentEl.style.pointerEvents = wasPointerEvents;
  contentEl.style.position = wasPosition;
  contentEl.style.height = wasHeight;

  return topBar + contentHeight + padding;
}

function initCardNav(root: HTMLElement) {
  const navEl = root.querySelector<HTMLElement>('.card-nav');
  const hamburger = root.querySelector<HTMLElement>('.hamburger-menu');
  const contentEl = root.querySelector<HTMLElement>('.card-nav-content');
  const cards = Array.from(root.querySelectorAll<HTMLElement>('.nav-card'));
  if (!navEl || !hamburger || !contentEl) return;

  let isExpanded = false;
  let tl: gsap.core.Timeline | null = null;

  function createTimeline() {
    gsap.set(navEl!, { height: 60, overflow: 'hidden' });
    gsap.set(cards, { y: 50, opacity: 0 });

    const timeline = gsap.timeline({ paused: true });
    timeline.to(navEl!, {
      height: () => calculateHeight(navEl!, contentEl!),
      duration: 0.4,
      ease: 'power3.out',
    });
    timeline.to(cards, { y: 0, opacity: 1, duration: 0.4, ease: 'power3.out', stagger: 0.08 }, '-=0.1');
    return timeline;
  }

  tl = createTimeline();

  function toggleMenu() {
    if (!tl) return;
    if (!isExpanded) {
      isExpanded = true;
      hamburger!.classList.add('open');
      navEl!.classList.add('open');
      hamburger!.setAttribute('aria-expanded', 'true');
      hamburger!.setAttribute('aria-label', 'Close menu');
      contentEl!.setAttribute('aria-hidden', 'false');
      tl.play(0);
    } else {
      hamburger!.classList.remove('open');
      hamburger!.setAttribute('aria-expanded', 'false');
      hamburger!.setAttribute('aria-label', 'Open menu');
      tl.eventCallback('onReverseComplete', () => {
        isExpanded = false;
        navEl!.classList.remove('open');
        contentEl!.setAttribute('aria-hidden', 'true');
      });
      tl.reverse();
    }
  }

  hamburger.addEventListener('click', toggleMenu);
  hamburger.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleMenu();
    }
  });

  function handleResize() {
    if (!tl) return;
    if (isExpanded) {
      const newHeight = calculateHeight(navEl!, contentEl!);
      gsap.set(navEl!, { height: newHeight });
      tl.kill();
      tl = createTimeline();
      tl.progress(1);
    } else {
      tl.kill();
      tl = createTimeline();
    }
  }

  window.addEventListener('resize', handleResize);
}

document.querySelectorAll<HTMLElement>('.card-nav-container').forEach(initCardNav);
