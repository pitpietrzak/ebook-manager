import { supabase } from './supabase';

type InvokeOptions = Parameters<typeof supabase.functions.invoke>[1];

function isTransientInvokeError(error: unknown): boolean {
  if (!error) return false;

  const message = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : typeof error === 'object' && 'message' in error
        ? String((error as any).message || '')
        : '';

  const name = typeof error === 'object' && error && 'name' in error
    ? String((error as any).name || '')
    : '';

  return (
    name === 'FunctionsFetchError' ||
    name === 'FetchError' ||
    message.includes('Failed to send a request to the Edge Function') ||
    message.includes('Network request failed') ||
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('The operation was aborted')
  );
}

export async function invokeEdgeFunctionWithRetry<T>(
  functionName: string,
  options?: InvokeOptions,
  retries = 1,
  delayMs = 750
): Promise<{ data: T | null; error: any }> {
  let lastError: any = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { data, error } = await supabase.functions.invoke<T>(functionName, options as any);

    if (!error) {
      return { data, error: null };
    }

    lastError = error;
    if (!isTransientInvokeError(error) || attempt === retries) {
      return { data, error };
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
  }

  return { data: null, error: lastError };
}