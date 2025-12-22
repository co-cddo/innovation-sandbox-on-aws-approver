# Story 1.1: Project Initialization with TypeScript and Testing Framework

Status: done

## Story

As a **developer**,
I want **a fully configured Node.js 20 TypeScript project with Vitest testing and ESLint/Prettier**,
So that **I can begin implementing Lambda handler code with type safety and automated quality checks**.

## Acceptance Criteria

1. **AC1: Dependencies install successfully**
   - Given a fresh clone of the repository
   - When I run `npm install`
   - Then all dependencies install without errors

2. **AC2: Project structure follows Deployer patterns**
   - Given the project is initialized
   - When I inspect the directory structure
   - Then it matches:
   ```
   /
   ├── src/
   │   └── handler.ts (stub handler)
   ├── test/
   │   └── handler.test.ts (passing stub test)
   ├── cdk/
   │   └── (placeholder for Story 1.2)
   ├── package.json
   ├── tsconfig.json
   ├── vitest.config.ts
   ├── eslint.config.mjs
   └── .prettierrc
   ```

3. **AC3: TypeScript compiles with strict mode**
   - Given the project is set up
   - When I run `npm run build`
   - Then TypeScript compiles successfully
   - And esbuild bundles the Lambda handler to `dist/`

4. **AC4: Tests pass with coverage thresholds**
   - Given the project is set up
   - When I run `npm test`
   - Then Vitest runs the stub test and passes
   - And coverage report is generated with thresholds:
     - 90% line coverage target
     - 100% branch coverage on scoring logic (future)

5. **AC5: Linting and formatting pass**
   - Given the project is set up
   - When I run `npm run lint`
   - Then ESLint checks pass
   - And Prettier formatting is verified

6. **AC6: Stub handler logs and responds**
   - Given the stub handler is invoked
   - When it receives any event
   - Then it logs the event as structured JSON
   - And returns `{ statusCode: 200, body: "OK" }`

## Tasks / Subtasks

- [x] Task 1: Initialize package.json (AC: 1)
  - [x] Create package.json with name, version, type: "module"
  - [x] Add all runtime dependencies (@aws-sdk/*, @aws-lambda-powertools/*, zod)
  - [x] Add all dev dependencies (typescript, vitest, esbuild, eslint, prettier)
  - [x] Add npm scripts (build, test, lint, typecheck, check)

- [x] Task 2: Configure TypeScript (AC: 3)
  - [x] Create tsconfig.json with strict mode
  - [x] Configure ES2022 target, NodeNext module
  - [x] Set up path aliases if needed
  - [x] Exclude node_modules, dist, coverage

- [x] Task 3: Configure ESLint and Prettier (AC: 5)
  - [x] Create eslint.config.mjs (flat config)
  - [x] Configure @typescript-eslint/eslint-plugin
  - [x] Create .prettierrc with standard settings
  - [x] Add .prettierignore for dist, coverage, node_modules

- [x] Task 4: Configure Vitest (AC: 4)
  - [x] Create vitest.config.ts
  - [x] Configure coverage with v8 provider
  - [x] Set up coverage thresholds (90% line, 100% branch on scoring)
  - [x] Configure test file patterns

- [x] Task 5: Create source directory structure (AC: 2)
  - [x] Create src/ directory
  - [x] Create src/handler.ts stub
  - [x] Create placeholder directories (scoring/, services/, lib/)

- [x] Task 6: Implement stub handler (AC: 6)
  - [x] Create handler.ts with Lambda Powertools logger
  - [x] Log incoming event as structured JSON
  - [x] Return { statusCode: 200, body: "OK" }
  - [x] Export handler function

- [x] Task 7: Create test file (AC: 4)
  - [x] Create test/handler.test.ts
  - [x] Write passing test for stub handler
  - [x] Verify logging mock works

- [x] Task 8: Verify all npm scripts work (AC: 1, 3, 4, 5)
  - [x] Run `npm run build` - should succeed
  - [x] Run `npm test` - should pass
  - [x] Run `npm run lint` - should pass
  - [x] Run `npm run typecheck` - should pass
  - [x] Run `npm run check` - should pass (all combined)

## Dev Notes

### Architecture Patterns & Constraints

**From Architecture Document:**
- **Language:** TypeScript 5.3+ (strict mode) - Source: architecture.md#Starter-Template-Evaluation
- **Runtime:** Node.js 20.x - Source: architecture.md#Architectural-Decisions-Locked-In
- **Module system:** ES Modules (`"type": "module"` in package.json) - Source: architecture.md
- **Bundler:** esbuild for Lambda packaging - Source: architecture.md#Package.json-Scripts
- **Test framework:** Vitest 4.x - Source: architecture.md#Key-Dependencies

**Build Command:**
```bash
esbuild src/handler.ts --bundle --platform=node --target=node20 --outdir=dist --format=esm --external:@aws-sdk/*
```

### Project Structure Notes

**Final directory structure (from Architecture):**
```
innovation-sandbox-on-aws-approver/
├── src/
│   ├── handler.ts                 # Single EventBridge handler (THIS STORY)
│   ├── state-machine.ts           # Decision orchestration (Story 2.2)
│   ├── scoring/
│   │   ├── engine.ts              # Orchestrates rules (Story 2.3)
│   │   ├── rules.ts               # All 16 rules (Story 2.3)
│   │   └── types.ts
│   ├── services/
│   │   ├── dynamodb.ts            # (Story 3.1+)
│   │   ├── eventbridge.ts         # (Story 2.1)
│   │   ├── bedrock.ts             # (Story 3.4)
│   │   ├── slack.ts               # (Story 5.2)
│   │   └── domain-cache.ts        # (Story 3.3)
│   ├── lib/
│   │   ├── config.ts              # (Story 1.2 config)
│   │   ├── logger.ts              # (THIS STORY)
│   │   ├── business-hours.ts      # (Story 4.1)
│   │   └── types.ts               # (THIS STORY - basic types)
├── cdk/                           # (Story 1.2)
├── test/
│   └── handler.test.ts            # (THIS STORY)
├── package.json                   # (THIS STORY)
├── tsconfig.json                  # (THIS STORY)
├── vitest.config.ts               # (THIS STORY)
├── eslint.config.mjs              # (THIS STORY)
├── .prettierrc                    # (THIS STORY)
└── README.md                      # (optional)
```

### Dependencies to Install

**Runtime Dependencies:**
```json
{
  "@aws-sdk/client-dynamodb": "^3.x",
  "@aws-sdk/lib-dynamodb": "^3.x",
  "@aws-sdk/client-eventbridge": "^3.x",
  "@aws-sdk/client-bedrock-runtime": "^3.x",
  "@aws-sdk/client-s3": "^3.x",
  "@aws-sdk/client-sqs": "^3.x",
  "@aws-sdk/client-secrets-manager": "^3.x",
  "@aws-sdk/client-appconfigdata": "^3.x",
  "@aws-lambda-powertools/idempotency": "^2.x",
  "@aws-lambda-powertools/logger": "^2.x",
  "@aws-lambda-powertools/parameters": "^2.x",
  "zod": "^3.x"
}
```

**Dev Dependencies:**
```json
{
  "typescript": "^5.3",
  "vitest": "^2.0",
  "@vitest/coverage-v8": "^2.0",
  "esbuild": "^0.24",
  "@types/node": "^20",
  "@types/aws-lambda": "^8.x",
  "eslint": "^9.x",
  "@typescript-eslint/eslint-plugin": "^8.x",
  "@typescript-eslint/parser": "^8.x",
  "prettier": "^3.x",
  "tsx": "^4.x"
}
```

**Note:** Use latest stable versions as of December 2025. Check npm for exact current versions.

### Logging Pattern

**Use AWS Lambda Powertools for structured logging:**
```typescript
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'approver' });

export const handler = async (event: unknown) => {
  logger.info('Event received', { event });
  return { statusCode: 200, body: 'OK' };
};
```

### TypeScript Configuration

**tsconfig.json essentials:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "coverage", "cdk"]
}
```

### Vitest Configuration

**vitest.config.ts:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/types.ts'],
      thresholds: {
        lines: 90,
        branches: 100,
        functions: 90,
        statements: 90
      }
    }
  }
});
```

### ESLint Configuration (Flat Config)

**eslint.config.mjs:**
```javascript
import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    ignores: ['dist/', 'coverage/', 'node_modules/', 'cdk.out/']
  }
];
```

### References

- [Source: architecture.md#Starter-Template-Evaluation] - Project setup approach
- [Source: architecture.md#Package.json-Scripts] - npm scripts
- [Source: architecture.md#Key-Dependencies] - Dependency list
- [Source: architecture.md#Logging-Pattern] - Powertools logger usage
- [Source: architecture.md#Testing-Strategy] - Coverage targets
- [Source: deployer-pattern-reference.md] - Existing ISB Deployer patterns

### Critical Warnings

1. **DO NOT use CommonJS** - Project must use ES Modules (`"type": "module"`)
2. **DO NOT skip strict mode** - TypeScript strict mode is mandatory
3. **DO NOT use Jest** - Use Vitest as specified in architecture
4. **DO NOT bundle AWS SDK** - Use `--external:@aws-sdk/*` in esbuild

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- npm install: 339 packages, 6 moderate vulnerabilities (non-blocking)
- npm run build: dist/handler.js 321b, 3ms
- npm run typecheck: Passed
- npm run lint: Passed
- npm run format:check: All matched files use Prettier code style
- npm test: 3 tests passed in 284ms

### Completion Notes List

- All 8 tasks completed successfully
- All 6 acceptance criteria verified passing
- Project structure matches architecture specification
- TypeScript strict mode enabled with additional safety options (noUncheckedIndexedAccess, noImplicitReturns)
- Tests use proper EventBridge event structure and Lambda context mocking
- Logger properly mocked in tests to avoid Powertools initialization issues

### File List

Files created:
- package.json
- tsconfig.json
- vitest.config.ts
- eslint.config.mjs
- .prettierrc
- .prettierignore
- .gitignore
- src/handler.ts
- src/lib/types.ts
- src/lib/logger.ts
- test/handler.test.ts

Directories created:
- src/
- src/lib/
- src/scoring/
- src/services/
- test/
- cdk/

## Senior Developer Review (AI)

**Reviewer:** Claude Opus 4.5
**Date:** 2025-12-22
**Outcome:** APPROVED (after fixes)

### Issues Found and Fixed

| Severity | Issue | Resolution |
|----------|-------|------------|
| HIGH | Missing `src/lib/logger.ts` - architecture specified centralized logger | Created `src/lib/logger.ts` with Powertools Logger |
| HIGH | tsconfig.json `rootDir` conflicted with test includes | Removed `rootDir` to allow type-checking tests |
| MEDIUM | vitest.config.ts missing explicit `include` pattern | Added `include: ['test/**/*.test.ts']` |
| MEDIUM | ESLint ignores too broad (`*.js`) | Changed to `dist/**` pattern |
| MEDIUM | Handler imported Logger directly instead of centralized | Updated to use `./lib/logger.js` import |

### Verification

- `npm run check` - All checks pass (typecheck, lint, format, test)
- `npm run build` - Successfully bundles to 390b
- `npm run test:coverage` - 100% coverage on handler.ts

### Remaining Notes

- LOW: Could add `tsx` to devDependencies per architecture doc (not needed for Story 1.1)
- Test file uses `.js` extension for import (correct ESM behavior)
