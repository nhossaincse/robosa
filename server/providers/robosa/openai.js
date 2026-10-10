export const ROBOSA_CHAT_MODEL_DEFAULT = 'gpt-5-nano';

export function chatConfiguration(apiKey = process.env.OPENAI_API_KEY) {
  const provider = ['auto', 'openai', 'local'].includes(
    process.env.ROBOSA_CHAT_PROVIDER,
  )
    ? process.env.ROBOSA_CHAT_PROVIDER
    : 'auto';
  const keyConfigured = Boolean(
    apiKey && !/^(replace-with-|your[-_ ]|<)/i.test(apiKey),
  );
  return {
    provider,
    model: process.env.ROBOSA_OPENAI_MODEL || ROBOSA_CHAT_MODEL_DEFAULT,
    keyConfigured,
    activeProvider: provider !== 'local' && keyConfigured ? 'openai' : 'local',
  };
}

// Never return a provider's raw error message: it can contain credentials or input.
export function openAiFailure({ status, code, incompleteReason, error } = {}) {
  if (error?.name === 'TypeError')
    return {
      code: 'connection_failed',
      message:
        'The OpenAI connection failed. Check the server network and try again.',
    };
  if (
    code === 'insufficient_quota' ||
    /(?:billing|spend|usage)_limit|quota/.test(code || '')
  )
    return {
      code: 'quota_exceeded',
      message: 'OpenAI API credits or spending limits need attention.',
    };
  if (status === 401)
    return {
      code: 'authentication_failed',
      message:
        'OpenAI rejected the API key. Update OPENAI_API_KEY and restart the server.',
    };
  if (status === 403 || code === 'model_not_found')
    return {
      code: 'access_denied',
      message:
        'The configured OpenAI project cannot access this model. Check model access and ROBOSA_OPENAI_MODEL.',
    };
  if (status === 429)
    return {
      code: 'rate_limited',
      message: 'OpenAI is rate-limiting requests. Try again shortly.',
    };
  if (incompleteReason === 'max_output_tokens')
    return {
      code: 'output_limit',
      message:
        'OpenAI reached the answer token limit before completing its reply.',
    };
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError')
    return {
      code: 'timeout',
      message: 'OpenAI took too long to respond. Try again.',
    };
  if (status >= 500)
    return {
      code: 'provider_unavailable',
      message: 'OpenAI is temporarily unavailable. Try again shortly.',
    };
  if (status === 400)
    return {
      code: 'request_rejected',
      message:
        'OpenAI rejected the request settings. Check the configured model.',
    };
  return {
    code: 'invalid_response',
    message: 'OpenAI did not return a complete, valid answer. Try again.',
  };
}
