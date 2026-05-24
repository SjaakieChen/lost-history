import { getApiKey } from '../../server/config.js';

export function hasLiveApiKey(): boolean {
  return Boolean(getApiKey());
}
