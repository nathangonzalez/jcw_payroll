/**
 * Google Cloud Secret Manager integration
 * Loads secrets at startup for production environment
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'jcw-2-android-estimator';

let client;

function getClient() {
  if (!client) {
    client = new SecretManagerServiceClient();
  }
  return client;
}

/**
 * Load a secret from Google Cloud Secret Manager
 * @param {string} secretName - Name of the secret
 * @returns {Promise<string|null>} - Secret value or null if not found
 */
export async function getSecret(secretName) {
  if (process.env.NODE_ENV !== 'production') {
    // In development, use environment variables directly
    return process.env[secretName] || null;
  }

  try {
    const name = `projects/${PROJECT_ID}/secrets/${secretName}/versions/latest`;
    const [version] = await getClient().accessSecretVersion({ name });
    const payload = version.payload.data.toString('utf8').trim();
    return payload;
  } catch (err) {
    console.error(`[secrets] Failed to load secret ${secretName}:`, err.message);
    return null;
  }
}

/**
 * Load all required secrets and set them as environment variables
 */
export async function loadSecrets() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[secrets] Skipping secret loading in non-production');
    return;
  }

  console.log('[secrets] Loading secrets from Secret Manager...');
  
  const secretNames = ['SMTP_USER', 'SMTP_PASS', 'OPENAI_API_KEY'];
  const loaded = [];
  const missing = [];

  for (const name of secretNames) {
    if (!process.env[name]) {
      const value = await getSecret(name);
      if (value) {
        process.env[name] = value;
        loaded.push(name);
        console.log(`[secrets] Loaded ${name}`);
      } else {
        missing.push(name);
      }
    } else {
      loaded.push(name);
    }
  }

  if (loaded.length) console.log(`[secrets] Secrets loaded: ${loaded.join(', ')}`);
  if (missing.length) console.warn(`[secrets] Missing secrets: ${missing.join(', ')}; related features may be disabled.`);
}
