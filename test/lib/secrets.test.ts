/**
 * Secrets Manager Utilities Tests (Story 5.2)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSlackWebhookUrl } from '../../src/lib/secrets.js';

// Mock the @aws-lambda-powertools/parameters module
vi.mock('@aws-lambda-powertools/parameters/secrets', () => ({
  getSecret: vi.fn(),
}));

import { getSecret } from '@aws-lambda-powertools/parameters/secrets';

const mockGetSecret = vi.mocked(getSecret);

describe('Secrets Utilities (Story 5.2)', () => {
  beforeEach(() => {
    mockGetSecret.mockReset();
  });

  describe('getSlackWebhookUrl (AC1)', () => {
    it('should return webhook URL on success', async () => {
      const webhookUrl = 'https://hooks.slack.com/triggers/T123/456/abc';
      mockGetSecret.mockResolvedValueOnce(webhookUrl);

      const result = await getSlackWebhookUrl();

      expect(result.success).toBe(true);
      expect(result.webhookUrl).toBe(webhookUrl);
      expect(result.error).toBeUndefined();
    });

    it('should call getSecret with default secret name', async () => {
      mockGetSecret.mockResolvedValueOnce('https://hooks.slack.com/triggers/T123/456/abc');

      await getSlackWebhookUrl();

      expect(mockGetSecret).toHaveBeenCalledWith(
        '/approver/slack-webhook-url',
        expect.objectContaining({ maxAge: 300 })
      );
    });

    it('should support custom secret name', async () => {
      mockGetSecret.mockResolvedValueOnce('https://hooks.slack.com/triggers/T123/456/abc');

      await getSlackWebhookUrl('/custom/secret-name');

      expect(mockGetSecret).toHaveBeenCalledWith(
        '/custom/secret-name',
        expect.any(Object)
      );
    });

    it('should support custom cache TTL', async () => {
      mockGetSecret.mockResolvedValueOnce('https://hooks.slack.com/triggers/T123/456/abc');

      await getSlackWebhookUrl('/approver/slack-webhook-url', 600);

      expect(mockGetSecret).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxAge: 600 })
      );
    });

    it('should return error for empty secret', async () => {
      mockGetSecret.mockResolvedValueOnce('');

      const result = await getSlackWebhookUrl();

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty or invalid');
      expect(result.webhookUrl).toBeUndefined();
    });

    it('should return error for null secret', async () => {
      mockGetSecret.mockResolvedValueOnce(null as unknown as string);

      const result = await getSlackWebhookUrl();

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty or invalid');
    });

    it('should return error for undefined secret', async () => {
      mockGetSecret.mockResolvedValueOnce(undefined);

      const result = await getSlackWebhookUrl();

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty or invalid');
    });

    it('should return error for non-string secret', async () => {
      mockGetSecret.mockResolvedValueOnce({ url: 'test' } as unknown as string);

      const result = await getSlackWebhookUrl();

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty or invalid');
    });

    it('should validate URL format starts with https://hooks.slack.com/', async () => {
      mockGetSecret.mockResolvedValueOnce('https://example.com/webhook');

      const result = await getSlackWebhookUrl();

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid format');
    });

    it('should handle secrets manager error', async () => {
      mockGetSecret.mockRejectedValueOnce(new Error('Access denied'));

      const result = await getSlackWebhookUrl();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Access denied');
    });

    it('should handle network timeout error', async () => {
      mockGetSecret.mockRejectedValueOnce(new Error('Connection timeout'));

      const result = await getSlackWebhookUrl();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection timeout');
    });

    it('should handle non-Error exception in catch block (line 68)', async () => {
      mockGetSecret.mockRejectedValueOnce('String error'); // Non-Error exception

      const result = await getSlackWebhookUrl();

      expect(result.success).toBe(false);
      expect(result.error).toContain('String error');
    });

    it('should accept valid Slack workflow webhook URL format', async () => {
      // Workflow webhook URLs use /triggers/ path
      const webhookUrl = 'https://hooks.slack.com/triggers/T12345678/1234567890/abcdefghij';
      mockGetSecret.mockResolvedValueOnce(webhookUrl);

      const result = await getSlackWebhookUrl();

      expect(result.success).toBe(true);
      expect(result.webhookUrl).toBe(webhookUrl);
    });

    it('should accept valid Slack incoming webhook URL format', async () => {
      // Traditional incoming webhooks use /services/ path (should also work)
      const webhookUrl = 'https://hooks.slack.com/services/T12345678/B12345678/abcdefghij';
      mockGetSecret.mockResolvedValueOnce(webhookUrl);

      const result = await getSlackWebhookUrl();

      expect(result.success).toBe(true);
      expect(result.webhookUrl).toBe(webhookUrl);
    });
  });
});
