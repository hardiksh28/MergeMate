/**
 * MergeMate Gemini Key Rotator
 * Manages pool of Gemini API keys and automatically rotates to the next key
 * when a HTTP 429 Rate Limit or Quota Exhausted error is encountered.
 */

export interface KeyRotationStatus {
  totalKeys: number;
  currentIndex: number;
  activeKeyMasked: string;
  keysAvailable: boolean;
}

// Track current key index in memory
let currentKeyIndex = 0;

/**
 * Gather all configured Gemini keys from process.env or user overrides
 */
export function getGeminiKeyPool(userKeys?: string[]): string[] {
  const keys: string[] = [];

  // Add user-provided keys from request if available
  if (userKeys && Array.isArray(userKeys) && userKeys.length > 0) {
    userKeys.forEach(k => {
      if (k && k.trim() && !keys.includes(k.trim())) {
        keys.push(k.trim());
      }
    });
  }

  // Add keys from environment variables
  const envKeyNames = ['GEMINI_KEY_1', 'GEMINI_KEY_2', 'GEMINI_KEY_3', 'GEMINI_KEY_4', 'GEMINI_KEY_5', 'GEMINI_API_KEY'];
  envKeyNames.forEach(keyName => {
    const val = process.env[keyName];
    if (val && val.trim() && !val.includes('your_gemini_key') && !keys.includes(val.trim())) {
      keys.push(val.trim());
    }
  });

  return keys;
}

/**
 * Get current rotation status metadata for UI display
 */
export function getRotationStatus(userKeys?: string[]): KeyRotationStatus {
  const pool = getGeminiKeyPool(userKeys);
  const total = pool.length;
  if (total === 0) {
    return {
      totalKeys: 0,
      currentIndex: 0,
      activeKeyMasked: 'None configured',
      keysAvailable: false,
    };
  }

  const safeIndex = currentKeyIndex % total;
  const key = pool[safeIndex];
  const masked = key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : 'Invalid';

  return {
    totalKeys: total,
    currentIndex: safeIndex,
    activeKeyMasked: masked,
    keysAvailable: true,
  };
}

/**
 * Rotate to the next available API key in the pool
 */
export function rotateKey(userKeys?: string[]): string {
  const pool = getGeminiKeyPool(userKeys);
  if (pool.length === 0) {
    throw new Error('No Gemini API keys found. Please configure GEMINI_KEY_1 in environment variables.');
  }

  currentKeyIndex = (currentKeyIndex + 1) % pool.length;
  console.log(`[GeminiRotator] Rotated to key index ${currentKeyIndex}/${pool.length}`);
  return pool[currentKeyIndex];
}

/**
 * Get current active API key
 */
export function getActiveKey(userKeys?: string[]): string {
  const pool = getGeminiKeyPool(userKeys);
  if (pool.length === 0) {
    // Return empty string or fallback placeholder
    return process.env.GEMINI_KEY_1 || process.env.GEMINI_API_KEY || '';
  }
  const safeIndex = currentKeyIndex % pool.length;
  return pool[safeIndex];
}

/**
 * Intercepts Gemini API calls and automatically rotates key on 429 / Rate Limit
 */
export async function executeWithRotation<T>(
  operation: (apiKey: string) => Promise<T>,
  userKeys?: string[]
): Promise<T> {
  const pool = getGeminiKeyPool(userKeys);
  const maxAttempts = Math.max(pool.length, 1);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const apiKey = getActiveKey(userKeys);
    
    if (!apiKey) {
      throw new Error('Gemini API key is missing. Please set GEMINI_KEY_1 or GEMINI_API_KEY in .env');
    }

    try {
      return await operation(apiKey);
    } catch (error: any) {
      lastError = error;
      const errorMessage = String(error?.message || error || '').toLowerCase();
      const status = error?.status || error?.statusCode || error?.response?.status;

      // Check if error is rate limit related (429 or quota limit)
      const isRateLimit =
        status === 429 ||
        errorMessage.includes('429') ||
        errorMessage.includes('rate limit') ||
        errorMessage.includes('resource_exhausted') ||
        errorMessage.includes('quota') ||
        errorMessage.includes('too many requests');

      if (isRateLimit && pool.length > 1) {
        console.warn(`[GeminiRotator] Rate limit hit (429). Swapping key attempt ${attempt + 1}/${maxAttempts}...`);
        rotateKey(userKeys);
        continue;
      }

      // If not rate limit or no more keys to rotate, rethrow error
      throw error;
    }
  }

  throw lastError || new Error('All Gemini API keys in pool failed due to rate limits.');
}
