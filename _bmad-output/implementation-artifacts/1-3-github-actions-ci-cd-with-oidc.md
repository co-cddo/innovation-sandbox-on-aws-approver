# Story 1.3: GitHub Actions CI/CD with OIDC

Status: done

## Story

As a **developer**,
I want **GitHub Actions workflows that test and deploy on push to main using OIDC authentication**,
So that **deployments happen automatically without long-lived AWS credentials**.

## Acceptance Criteria

1. **AC1: Workflow triggers on push to main**
   - Given a push to the `main` branch
   - When GitHub Actions workflow triggers
   - Then the following steps execute in sequence:
     1. Checkout code
     2. Setup Node.js 20
     3. Install dependencies (`npm ci`)
     4. Run linting (`npm run lint`)
     5. Run tests with coverage (`npm test -- --coverage`)
     6. Verify coverage thresholds pass (90% lines, 100% branch on scoring)
     7. If all pass: Authenticate via OIDC to AWS
     8. Deploy CDK stack (`cdk deploy --require-approval never`)

2. **AC2: OIDC authentication configured**
   - Given OIDC authentication is configured
   - When the workflow authenticates to AWS
   - Then it assumes `GitHubActionsApproverRole` via OpenID Connect
   - And no long-lived secrets (access keys) are stored in GitHub

3. **AC3: Failed tests block deployment**
   - Given tests or coverage thresholds fail
   - When the workflow reaches those steps
   - Then deployment is skipped
   - And the workflow fails with clear error output

4. **AC4: Successful deployment updates Lambda**
   - Given deployment succeeds
   - When the workflow completes
   - Then the Lambda function is updated in us-west-2
   - And the workflow reports success with stack outputs

## Tasks / Subtasks

- [x] Task 1: Create GitHub Actions workflow file (AC: 1, 3)
  - [x] Create `.github/workflows/deploy.yml`
  - [x] Configure trigger on push to `main` branch
  - [x] Add checkout step
  - [x] Add Node.js 20 setup step
  - [x] Add `npm ci` step for dependency installation
  - [x] Add `npm run lint` step
  - [x] Add `npm run test -- --coverage` step
  - [x] Add coverage threshold verification

- [x] Task 2: Configure OIDC authentication (AC: 2)
  - [x] Add `aws-actions/configure-aws-credentials@v4` action
  - [x] Configure role-to-assume with GitHub OIDC
  - [x] Set AWS region to us-west-2
  - [x] Document required IAM role trust policy

- [x] Task 3: Add CDK deploy step (AC: 4)
  - [x] Add `cdk deploy --require-approval never` step
  - [x] Ensure build runs before deploy (`npm run build`)
  - [x] Capture and display stack outputs

- [x] Task 4: Add workflow documentation (AC: 1, 2)
  - [x] Document IAM role setup requirements
  - [x] Document OIDC identity provider configuration
  - [x] Add workflow status badge to README (if exists) - N/A: No README file in project

## Dev Notes

### Architecture Patterns & Constraints

**From Architecture Document:**
- **Region:** us-west-2 (co-located with existing ISB deployment)
- **IaC:** AWS CDK - deploy via `cdk deploy`
- **Runtime:** Node.js 20.x
- **Test Framework:** Vitest with coverage thresholds

### Prerequisites (Must be done manually before workflow works)

**AWS IAM OIDC Identity Provider:**
```
Provider URL: https://token.actions.githubusercontent.com
Audience: sts.amazonaws.com
```

**IAM Role: GitHubActionsApproverRole**

Trust Policy:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::568672915267:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:*/innovation-sandbox-on-aws-approver:*"
        }
      }
    }
  ]
}
```

**Required IAM Permissions for GitHubActionsApproverRole:**
- CloudFormation: Full access (for CDK)
- Lambda: Full access (for function deployment)
- IAM: PassRole, CreateRole, AttachRolePolicy, etc. (for CDK resource creation)
- S3: Full access (for CDK assets and DomainListBucket)
- DynamoDB: Full access (for IdempotencyTable creation)
- SQS: Full access (for DelayQueue creation)
- EventBridge: Full access (for rules and scheduler)
- CloudWatch: Full access (for logs and alarms)
- Secrets Manager: Read access (for Lambda to access secrets)
- Bedrock: InvokeModel (passed to Lambda role)
- SSM: GetParameter (for CDK bootstrap)

Recommended: Use `AdministratorAccess` for initial setup, then scope down based on CloudFormation role findings.

### GitHub Actions Workflow Structure

```yaml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  id-token: write   # Required for OIDC
  contents: read    # Required for checkout

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm test -- --coverage
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::568672915267:role/GitHubActionsApproverRole
          aws-region: us-west-2
      - run: npm run cdk:deploy
```

### Previous Story Learnings (Story 1.2)

**From Story 1.2 implementation:**
- CDK requires `CDK_DEFAULT_ACCOUNT` environment variable (no hardcoded fallback)
- `npm run cdk:deploy` runs `npm run build && cdk deploy --require-approval never`
- All 27 tests pass including CDK snapshot test
- IAM policies use least-privilege (no wildcards except where required)
- cdk.json uses `npx tsx cdk/bin/approver.ts` for TypeScript execution

**Existing npm scripts:**
- `npm run build` - esbuild bundle
- `npm run test` - Vitest run
- `npm run lint` - ESLint check
- `npm run check` - typecheck + lint + format:check + test
- `npm run cdk:synth` - build + cdk synth
- `npm run cdk:deploy` - build + cdk deploy --require-approval never

**Files from Story 1.2 (don't modify unless necessary):**
- cdk.json
- cdk/bin/approver.ts
- cdk/lib/approver-stack.ts
- cdk/lib/constructs/approver-lambda.ts
- cdk/config/environments.ts
- cdk/test/approver-stack.test.ts

### Coverage Threshold Configuration

**From vitest.config.ts:**
```typescript
thresholds: {
  lines: 90,
  branches: 100,
  functions: 90,
  statements: 90,
}
```

The workflow should fail if these thresholds are not met.

### Environment Variables for CDK Deploy

The workflow must set `CDK_DEFAULT_ACCOUNT` for CDK to work properly.
This can be obtained from the OIDC credential context or set explicitly.

```yaml
- run: npm run cdk:deploy
  env:
    CDK_DEFAULT_ACCOUNT: ${{ secrets.AWS_ACCOUNT_ID }}
```

Or let CDK infer from credentials:
```yaml
- run: npm run cdk:deploy
```

### References

- [Source: epics.md#Story-1.3] - Acceptance criteria
- [Source: architecture.md#Deployment-&-Resilience] - Region and IaC requirements
- [AWS OIDC Documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)

### Critical Warnings

1. **MUST configure OIDC identity provider in AWS before workflow works**
2. **MUST create GitHubActionsApproverRole with correct trust policy**
3. **DO NOT store AWS access keys in GitHub secrets** - use OIDC only
4. **MUST use Node.js 20** - same version as Lambda runtime
5. **MUST deploy to us-west-2** - co-located with ISB
6. **Workflow will fail on first run if IAM is not pre-configured** - this is expected

### File Structure

```
.github/
└── workflows/
    └── deploy.yml
```

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- No issues encountered during implementation
- All existing tests (27) continue to pass
- `npm run check` passes (typecheck, lint, format, test)

### Completion Notes List

1. Created `.github/workflows/deploy.yml` with complete CI/CD pipeline
2. Workflow triggers on push to `main` branch only
3. Workflow steps execute in sequence:
   - Checkout code (actions/checkout@v4)
   - Setup Node.js 20 (actions/setup-node@v4 with npm cache)
   - Install dependencies (npm ci)
   - Run linting (npm run lint)
   - Run typecheck (npm run typecheck)
   - Run tests with coverage (npm run test -- --coverage)
   - Configure AWS credentials via OIDC (aws-actions/configure-aws-credentials@v4)
   - Deploy CDK stack (npm run cdk:deploy)
4. OIDC authentication configured with:
   - Permission `id-token: write` for OIDC
   - Permission `contents: read` for checkout
   - Role ARN: `arn:aws:iam::568672915267:role/GitHubActionsApproverRole`
   - Region: us-west-2
5. Coverage thresholds enforced by Vitest configuration (90% lines, 100% branches)
6. IAM prerequisites documented in Dev Notes section of story file

### Code Review Fixes Applied

- **MEDIUM-1**: Added missing `npm run typecheck` step before tests
- **LOW-1**: Clarified README badge task as N/A (no README file exists)

### File List

Files created:
- .github/workflows/deploy.yml

Files modified:
- (none)
