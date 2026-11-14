/**
 * Scroll a Settings card below the sticky category bar.
 *
 * `scrollIntoView` has browser-dependent behavior when the target is inside the
 * app's own overflow scroller and there is a sticky sibling above it. Measure
 * against the actual scroll root instead, so both the in-page category buttons
 * and cross-page Settings links land at the same, predictable top position.
 */
export function scrollSettingsSectionToTop(element: HTMLElement, behavior: ScrollBehavior = 'smooth') {
  const scroller = element.closest<HTMLElement>('.orbit-scroll');
  if (!scroller) {
    element.scrollIntoView({ behavior, block: 'start' });
    return;
  }

  const nav = scroller.querySelector<HTMLElement>('.orbit-sticky');
  const navTop = nav ? Number.parseFloat(window.getComputedStyle(nav).top) || 0 : 0;
  const clearSpace = nav ? navTop + nav.offsetHeight + 12 : 0;
  const elementTop = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const top = Math.max(0, scroller.scrollTop + elementTop - clearSpace);
  scroller.scrollTo({ top, behavior });
}
