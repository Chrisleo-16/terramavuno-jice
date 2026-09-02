/**
 * Africa's Talking SMS client.
 *
 * The messaging endpoint takes `application/x-www-form-urlencoded` with the key in an `apiKey`
 * header, and returns `{ SMSMessageData: { Message, Recipients: [...] } }`. Sandbox uses the
 * literal username `sandbox` against the sandbox host; production uses your account username.
 *
 * Verify the endpoint path and response shape against your dashboard before going live — AT has
 * more than one messaging route documented and the newer bulk route takes JSON.
 */
export interface AfricasTalkingConfig {
  username: string;
  apiKey: string;
  /** Sender ID / shortcode. Optional: on sandbox AT uses a default sender. */
  from?: string;
  environment: 'sandbox' | 'production';
}

export interface SmsRecipientResult {
  number: string; status: string; statusCode: number; messageId: string; cost: string;
}

export interface SendSmsResult {
  delivered: boolean;
  /** Absent when the provider is not configured — the caller decides whether that is fatal. */
  providerMessage?: string;
  recipients: SmsRecipientResult[];
  skippedReason?: string;
}

const HOSTS = {
  sandbox: 'https://api.sandbox.africastalking.com',
  production: 'https://api.africastalking.com'
} as const;

export function loadAfricasTalkingConfig(env: NodeJS.ProcessEnv = process.env): AfricasTalkingConfig | null {
  const username = env.AFRICASTALKING_USERNAME?.trim();
  const apiKey = env.AFRICASTALKING_API_KEY?.trim();
  if (!username || !apiKey) return null;
  const declared = env.AFRICASTALKING_ENV?.trim().toLowerCase();
  // Fall back to the username convention: AT's sandbox account is literally named "sandbox".
  const environment = declared === 'production' || declared === 'sandbox'
    ? declared
    : username === 'sandbox' ? 'sandbox' : 'production';
  return {username, apiKey, from: env.AFRICASTALKING_SHORTCODE?.trim() || undefined, environment};
}

/** E.164 for Kenya. AT rejects local formats, and a silent reformat is better than a failed send. */
export function toE164(msisdn: string, defaultCountryCode = '254'): string | null {
  const digits = msisdn.replace(/[^\d+]/g, '');
  if (/^\+\d{7,15}$/.test(digits)) return digits;
  const bare = digits.replace(/^\+/, '');
  if (/^0\d{9}$/.test(bare)) return `+${defaultCountryCode}${bare.slice(1)}`;
  if (/^\d{9}$/.test(bare)) return `+${defaultCountryCode}${bare}`;
  if (new RegExp(`^${defaultCountryCode}\\d{9}$`).test(bare)) return `+${bare}`;
  return null;
}

export async function sendSms(
  config: AfricasTalkingConfig | null,
  to: string[],
  message: string,
  fetchImpl: typeof fetch = fetch
): Promise<SendSmsResult> {
  if (!config) return {delivered: false, recipients: [], skippedReason: 'Africa\'s Talking is not configured (AFRICASTALKING_USERNAME / AFRICASTALKING_API_KEY missing)'};
  const numbers = to.map(n => toE164(n)).filter((n): n is string => n !== null);
  if (numbers.length === 0) return {delivered: false, recipients: [], skippedReason: 'No recipient resolved to E.164'};

  const body = new URLSearchParams({username: config.username, to: numbers.join(','), message});
  if (config.from) body.set('from', config.from);

  const res = await fetchImpl(`${HOSTS[config.environment]}/version1/messaging`, {
    method: 'POST',
    headers: {apiKey: config.apiKey, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'},
    body
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Africa's Talking send failed (${res.status}): ${text.slice(0, 300)}`);

  let parsed: {SMSMessageData?: {Message?: string; Recipients?: SmsRecipientResult[]}} = {};
  try { parsed = JSON.parse(text) as typeof parsed; } catch { throw new Error(`Unparseable Africa's Talking response: ${text.slice(0, 300)}`); }
  const recipients = parsed.SMSMessageData?.Recipients ?? [];
  return {
    // AT uses 100 (processed) / 101 (sent) / 102 (queued) for accepted messages.
    delivered: recipients.some(r => r.statusCode >= 100 && r.statusCode < 200),
    providerMessage: parsed.SMSMessageData?.Message,
    recipients
  };
}
