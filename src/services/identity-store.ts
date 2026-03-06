/**
 * Identity Store Service
 *
 * Checks pre-approved group membership via AWS Identity Center.
 * Cross-account: assumes role in management account to query Identity Store.
 * Fail-closed: returns false on any error.
 */

import {
  IdentitystoreClient,
  ListUsersCommand,
  IsMemberInGroupsCommand,
} from '@aws-sdk/client-identitystore';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';

export interface IdentityStoreServiceConfig {
  identityStoreId: string;
  roleArn: string;
  groupId: string;
  region?: string;
}

export interface IdentityStoreService {
  isPreapproved(email: string): Promise<boolean>;
}

/**
 * Creates an Identity Store service that checks pre-approved group membership.
 *
 * @param stsClient - STS client for cross-account role assumption
 * @param config - Identity Store configuration
 * @returns Identity Store service
 */
export const createIdentityStoreService = (
  stsClient: STSClient,
  config: IdentityStoreServiceConfig
): IdentityStoreService => {
  const { identityStoreId, roleArn, groupId, region = 'us-west-2' } = config;

  let cachedCredentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration: Date;
  } | null = null;

  const getCredentials = async () => {
    // Refresh if credentials expire within 5 minutes
    if (cachedCredentials && cachedCredentials.expiration.getTime() - Date.now() > 5 * 60 * 1000) {
      return cachedCredentials;
    }

    const response = await stsClient.send(
      new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: 'approver-identity-store',
        DurationSeconds: 900,
      })
    );

    if (!response.Credentials?.AccessKeyId || !response.Credentials?.SecretAccessKey || !response.Credentials?.SessionToken) {
      throw new Error('STS AssumeRole returned incomplete credentials');
    }

    cachedCredentials = {
      accessKeyId: response.Credentials.AccessKeyId,
      secretAccessKey: response.Credentials.SecretAccessKey,
      sessionToken: response.Credentials.SessionToken,
      expiration: response.Credentials.Expiration ?? new Date(Date.now() + 900 * 1000),
    };

    return cachedCredentials;
  };

  const getClient = async (): Promise<IdentitystoreClient> => {
    const creds = await getCredentials();
    return new IdentitystoreClient({
      region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });
  };

  const isPreapproved = async (email: string): Promise<boolean> => {
    try {
      const client = await getClient();

      // Find user by email
      const listUsersResponse = await client.send(
        new ListUsersCommand({
          IdentityStoreId: identityStoreId,
          Filters: [
            {
              AttributePath: 'UserName',
              AttributeValue: email,
            },
          ],
        })
      );

      const users = listUsersResponse.Users ?? [];
      if (users.length === 0) {
        return false;
      }

      const userId = users[0]!.UserId;
      if (!userId) {
        return false;
      }

      // Check group membership
      const membershipResponse = await client.send(
        new IsMemberInGroupsCommand({
          IdentityStoreId: identityStoreId,
          MemberId: { UserId: userId },
          GroupIds: [groupId],
        })
      );

      const results = membershipResponse.Results ?? [];
      return results.some((r) => r.GroupId === groupId && r.MembershipExists === true);
    } catch {
      // Fail-closed: any error means not pre-approved
      return false;
    }
  };

  return { isPreapproved };
};
