import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  isActive: boolean,
  onClose?: () => void,
) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!isActive || !ref.current) return;

    previousFocus.current = document.activeElement as HTMLElement;

    // Focus first focusable element or the container itself
    const focusable = ref.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      ref.current.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' && closeRef.current) {
        e.preventDefault();
        closeRef.current();
        return;
      }

      if (e.key !== 'Tab' || !ref.current) return;

      const focusableEls = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(element => !element.closest('[inert], [aria-hidden="true"]'));
      if (focusableEls.length === 0) return;

      const first = focusableEls[0];
      const last = focusableEls[focusableEls.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus
      if (previousFocus.current && previousFocus.current.isConnected) {
        previousFocus.current.focus();
      }
    };
  }, [isActive, ref]);
}
