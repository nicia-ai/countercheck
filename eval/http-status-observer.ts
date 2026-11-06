export type HttpStatusObservation = { sequence: number; status: number | null };

/** Observe status only; leave request, response body, and provider error handling untouched. */
export function observeHttpStatus(
  send: typeof fetch,
  record: (value: HttpStatusObservation) => void,
): typeof fetch {
  let sequence = 0;
  return async (input, init) => {
    const current = ++sequence;
    let response: Response;
    try {
      response = await send(input, init);
    } catch (error) {
      record({ sequence: current, status: null });
      throw error;
    }
    record({ sequence: current, status: response.status });
    return response;
  };
}
