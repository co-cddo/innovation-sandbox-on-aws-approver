---
stepsCompleted: [1, 2, 3]
inputDocuments: []
session_topic: 'Additional scoring rules for Innovation Sandbox Approver'
session_goals: 'Generate 10+ new scoring rules to consider for the risk assessment system'
selected_approach: 'Random Technique Selection'
techniques_used: ['Alien Anthropologist', 'Pirate Code Brainstorm']
ideas_generated: [11]
context_file: '_bmad-output/approver-requirements.md'
---

# Brainstorming Session Results

**Facilitator:** Cns
**Date:** 2025-12-22

## Session Overview

**Topic:** Additional scoring rules for Innovation Sandbox Approver

**Goals:** Generate 10+ new scoring rules to consider for the risk assessment system

### Context Guidance

This session builds on the existing Approver requirements:
- **Current scoring rules:** Expired leases (+2), budget exceeded (+5), first-time user (+5), suspicious email (+20), local government (-5)
- **Auto-approve threshold:** Score < 20
- **Integration:** EventBridge events, DynamoDB lease history, Bedrock AI analysis
- **Constraints:** Must work with existing ISB data model, no modifications to ISB core

### Session Setup

**Approach Selected:** Random Technique Selection - Using unexpected creative methods to discover novel scoring rules that might not emerge from conventional analysis.

## Technique Selection

**Approach:** Random Technique Selection
**Selection Method:** Serendipitous discovery from 62 techniques across 10 categories

### Randomly Selected Techniques:

1. **Alien Anthropologist** (Theatrical): Looking at scoring rules through completely foreign eyes to reveal hidden assumptions
2. **Five Whys** (Deep Analysis): Skipped
3. **Pirate Code Brainstorm** (Wild): Taking what works from other domains and remixing without permission

## Technique Execution Results

### Alien Anthropologist - Key Discoveries

By examining the approval system through "alien eyes," we surfaced hidden assumptions and discovered 11 new scoring rule candidates:

**Theme 1: Template Behavior**
- Familiarity with templates indicates competence
- Template hopping suggests unfocused intent

**Theme 2: Request Sizing**
- Budget and duration should scale scoring - higher stakes = more scrutiny
- Conservative requests (small budget, short duration) indicate cautious users

**Theme 3: Timing Signals**
- End-of-window requests suggest genuine urgency (not gaming the system)
- Cooldown periods prevent rapid-fire retry behavior

**Theme 4: Domain & Identity Verification**
- Target audience (local gov) should be verified, not just pattern-matched
- WHOIS, certificates, and webpage analysis provide stronger signals
- Users outside target audience warrant human review

**Theme 5: Behavioral History**
- Manual early termination demonstrates responsibility
- Organizational patterns matter - colleagues' behavior is predictive

### Pirate Code Brainstorm

Explored credit scoring, spam detection, gaming reputation, airline loyalty, and enterprise IAM systems. No additional rules adopted - the Alien Anthropologist technique had already captured the most relevant patterns.

## Generated Scoring Rules

### New Rules Summary

| # | Rule | Points | Signal | Data Source |
|---|------|--------|--------|-------------|
| 1 | Familiar template (previously used successfully) | -1 | Competence | Lease history |
| 2 | Template hopper (never/rarely repeats templates) | +2 | Unfocused | Lease history |
| 3 | Budget requested | +1 per $10 | Stakes | Lease template |
| 4 | Duration requested | +1 per 8hrs | Exposure | Lease template |
| 5 | End-of-window request (6-7pm London) | -5 | Genuine urgency | Request time |
| 6 | Cooldown enforcement (1hr min between conclusion and new request) | Block/+X | Prevent gaming | Request time + history |
| 7 | Outside target audience domain | +10 | Unexpected user | Email domain |
| 8 | Domain verification (WHOIS/cert/webpage + Bedrock analysis) | varies | Verified identity | External lookups |
| 9 | Manual early termination history | -2 each | Responsibility | Lease history |
| 10 | Org has recent negative outcomes (30 days) | +3 | Org risk pattern | Domain-wide history |
| 11 | Org has clean track record (90 days) | -2 | Org reputation | Domain-wide history |

### Existing Rules (for reference)

| Rule | Points | Signal |
|------|--------|--------|
| Leases expired by time (30 days) | +2 each | Past behavior |
| Leases exceeded budget (30 days) | +5 each | Past behavior |
| First-time user | +5 | Unknown quantity |
| First-time + suspicious email (AI) | +20 | High risk |
| Local government domain (AI) | -5 | Target audience |

### Rule Implementation Notes

**Rule 6 (Cooldown):** Decision needed - hard block vs. soft scoring penalty. Soft penalty provides intelligence about who attempts to circumvent.

**Rule 8 (Domain Verification):** Implementation approach:
- For `*.gov.uk`: HTTP GET homepage → Bedrock analyzes if page "looks like local authority"
- For non-gov.uk: WHOIS lookup + HTTPS certificate info → Bedrock analyzes ownership
- Scoring: Verified local authority (-5), Ambiguous (+5), Clearly outside audience (+10)

**Rule 9 (Manual Termination):** Note that self-service termination is not currently a feature; users ask the team to terminate. Future feature opportunity.

## Session Summary

**Goal:** Generate 10+ new scoring rules
**Result:** 11 new rules generated ✅

**Key Insight:** The most valuable rules came from questioning assumptions about what data we have vs. what we're actually using. The "alien" perspective revealed that email pattern matching is a proxy for accountability, and there are stronger signals available in lease history and organizational patterns.

**Techniques Used:**
- Alien Anthropologist: Highly effective - generated all 11 rules
- Pirate Code: Explored but no additional rules adopted

**Creative Journey:** Starting with naive "why do humans do this?" questioning led to breakthrough insights about template behavior, request sizing, timing signals, and organizational reputation - none of which were in the original requirements.
