/**
 * State Machine Module
 *
 * Exports the state machine types, handlers, and orchestrator
 * for use in the approval handler.
 */

export {
  ApprovalState,
  TERMINAL_STATES,
  isTerminalState,
  createInitialContext,
  type RuleResult,
  type StateTransition,
  type StateError,
  type StateContext,
  type StateHandlerResult,
  type StateHandler,
  type StateMachineResult,
  type StateMachineConfig,
} from './types.js';

export { createStateHandlers, getStateHandler } from './handlers.js';

export {
  createStateMachineOrchestrator,
  type StateMachineLogger,
  type OrchestratorConfig,
  type StateMachineOrchestrator,
} from './orchestrator.js';
