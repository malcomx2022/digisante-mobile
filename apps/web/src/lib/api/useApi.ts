import { useEffect, useState } from 'react';

import { ApiRequestError } from '@/lib/api/client';

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Statut HTTP de l'erreur quand elle provient de l'API (ex. 403). Source primaire
   *  fiable pour distinguer les cas (point 3) — évite le parsing fragile du message. */
  errorStatus?: number;
}

/** Hook de chargement de données API avec états loading/erreur. */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ data: null, loading: true, error: null });

  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: null, errorStatus: undefined }));
    fetcher()
      .then((data) => active && setState({ data, loading: false, error: null, errorStatus: undefined }))
      .catch(
        (e: unknown) =>
          active &&
          setState({
            data: null,
            loading: false,
            error: e instanceof Error ? e.message : 'Erreur',
            errorStatus: e instanceof ApiRequestError ? e.status : undefined,
          }),
      );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
