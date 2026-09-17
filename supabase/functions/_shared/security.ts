export class SecurityLimit extends Error {
  constructor(public code: string, public status = 429, public retryAfter = 60) { super(code); }
}

export async function reserveModelCall(workspace: string, actor: string | null, inputBytes: number, outputTokens: number) {
  const base = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key || !workspace) throw new SecurityLimit('usage_check_unavailable', 503);
  try {
    const response = await fetch(base + '/rest/v1/rpc/reserve_ai_budget', {
      method: 'POST', headers: {apikey:key, Authorization:'Bearer '+key, 'Content-Type':'application/json'},
      body: JSON.stringify({p_workspace:workspace,p_actor:actor,p_input_bytes:inputBytes,p_output_tokens:outputTokens}),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new SecurityLimit('usage_check_unavailable', 503);
    const result = await response.json();
    if (result?.allowed !== true) {
      const code = ['usage_limit','ai_paused','beta_access_required','input_too_large'].includes(result?.code) ? result.code : 'usage_check_unavailable';
      throw new SecurityLimit(code, code==='beta_access_required'?403:code==='input_too_large'?413:code==='usage_check_unavailable'?503:429, result?.retry_after||60);
    }
  } catch (error) {
    if (error instanceof SecurityLimit) throw error;
    throw new SecurityLimit('usage_check_unavailable', 503);
  }
}

export function securityMessage(code: string) {
  return code==='beta_access_required' ? 'This account does not have approved beta access.'
    : code==='ai_paused' ? 'AI processing is temporarily paused by the administrator. Your saved work is unchanged.'
    : code==='usage_limit' ? 'The beta AI usage limit has been reached. Try later or contact the administrator. Your saved work is unchanged.'
    : code==='input_too_large' ? 'This request is too large to process.'
    : 'Usage limits could not be checked. Please try again shortly.';
}

// Stream rather than buffering an unlimited request body before validation.
export async function boundedJSON(request: Request, maximum = 800000): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > maximum) throw new SecurityLimit('input_too_large',413);
  const reader=request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing JSON');
  const chunks:Uint8Array[]=[];let size=0;
  try {
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;
      if(size>maximum){await reader.cancel();throw new SecurityLimit('input_too_large',413);}chunks.push(part.value);}
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
