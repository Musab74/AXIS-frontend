import { AxiosError } from 'axios';
import { getApiErrorCode } from '@/services/api';
import { isMobileDevice } from '@/lib/useIsMobile';

function errorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const code = getApiErrorCode(error);
    const payload = error.response?.data as { message?: unknown } | undefined;
    const message =
      typeof payload?.message === 'string'
        ? payload.message
        : payload?.message && typeof payload.message === 'object' && 'message' in payload.message
          ? String((payload.message as { message?: unknown }).message ?? '')
          : '';
    if (code === 'SESSION_SUPERSEDED') return message || '세션이 만료되었습니다. 다시 로그인해 주세요.';
    return message || 'PDF를 불러오지 못했습니다.';
  }
  return 'PDF를 불러오지 못했습니다.';
}

export async function openProtectedPdf(
  fetchBlob: () => Promise<Blob>,
  fileName: string,
): Promise<void> {
  let url: string | null = null;
  try {
    const blob = await fetchBlob();
    url = URL.createObjectURL(blob);
    if (isMobileDevice()) {
      window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url!), 60_000);
      return;
    }
    // Do not pass `noopener` in windowFeatures — browsers return null even when
    // the tab opened, which would falsely trigger the download fallback.
    const popup = window.open(url, '_blank');
    if (popup) {
      popup.opener = null;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url!), 60_000);
  } catch (error) {
    if (url) URL.revokeObjectURL(url);
    window.alert(errorMessage(error));
  }
}
