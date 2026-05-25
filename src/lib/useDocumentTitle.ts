import { useEffect } from 'react';

const SITE_NAME = 'Mnemis Connect';

export function useDocumentTitle(title: string | undefined | null) {
  useEffect(() => {
    document.title = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  }, [title]);
}
