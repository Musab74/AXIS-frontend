import { isMobileDevice } from '@/lib/useIsMobile';

/**
 * Open a public PDF in a new tab on desktop; navigate in-place on mobile.
 *
 * Do not pass `noopener` in windowFeatures — browsers then return `null` even
 * when the tab opened successfully, which incorrectly triggers the in-place
 * fallback and navigates the current page too.
 */
export function openPublicPdf(url: string): void {
  if (isMobileDevice()) {
    window.location.href = url;
    return;
  }
  const opened = window.open(url, '_blank');
  if (opened) {
    opened.opener = null;
    return;
  }
  // Popup blocked — last resort
  window.location.href = url;
}
