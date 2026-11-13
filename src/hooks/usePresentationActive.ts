import { createContext, useContext, useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

/** Presentation only. Hidden panes stay mounted; gameplay continues in the Chef. */
export const PresentationActiveContext = createContext(true);

function subscribeVisibility(listener: () => void): () => void {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

const documentVisible = () => !document.hidden;

export function usePresentationActive(): boolean {
  const paneActive = useContext(PresentationActiveContext);
  const pageActive = useSyncExternalStore(subscribeVisibility, documentVisible);
  return paneActive && pageActive;
}

/** Also suspend a stage that has scrolled out of its pane's viewport. */
export function useStageVisible(ref: RefObject<HTMLElement | null>): boolean {
  const active = usePresentationActive();
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return active && inView;
}
