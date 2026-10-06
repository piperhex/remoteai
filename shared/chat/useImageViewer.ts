import { useCallback, useEffect, useRef, useState } from 'react';

export function useImageViewer(load: () => Promise<string>) {
  const loader = useRef(load);
  loader.current = load;
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const current = useRef<string>();
  const pending = useRef<Promise<string>>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const loadOriginal = useCallback(() => {
    if (current.current) return Promise.resolve(current.current);
    if (pending.current) return pending.current;
    setError(false);
    setLoading(true);
    pending.current = Promise.resolve().then(() => loader.current()).then(result => {
      current.current = result;
      if (mounted.current) setUrl(result);
      return result;
    }, cause => {
      if (mounted.current) setError(true);
      throw cause;
    }).finally(() => {
      pending.current = undefined;
      if (mounted.current) setLoading(false);
    });
    return pending.current;
  }, []);
  const fail = () => { current.current = undefined; setUrl(undefined); setError(true); };
  // The error is presented by the viewer; event handlers must not leak rejected promises.
  const request = () => { void loadOriginal().catch(() => undefined); };
  return { url, error, loading, loadOriginal, request, fail };
}
