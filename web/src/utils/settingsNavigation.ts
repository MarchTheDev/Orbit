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
  // Settings shows one card at a time and swaps it in place, so there is
  // nothing to travel to: a page already at its top is showing the card that
  // was asked for, and scrolling it under the bar would only hide the heading.
  if (scroller.scrollTop <= 0 && elementTop >= 0) return;
  const top = Math.max(0, scroller.scrollTop + elementTop - clearSpace);
  scroller.scrollTo({ top, behavior });
}
