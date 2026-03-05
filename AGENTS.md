# AGENTS.md

## Plan Mode

- Make the plan extremely concise. Sacrifice grammar for the sake of concision.
- At the end of each plan, give me a list of unresolved questions to answer, if any.

## Verification instructions

- Always verify implemented changes by running `bun run typecheck`, `bun run lint`, `bun run format` before concluding the task.
- Explicitly add these as a final step to your tasks/plans when you create them.

## Tooling

- Use `bun` instead of `npm` for all package management and script execution tasks (installing dependencies, running scripts, etc.).

## Import Aliases

- `@/` → `src/` (Vue frontend)
- `~/` → `shared/` (shared code)

Always use these aliases instead of relative paths when importing across directories.

## TypeScript

- Avoid using `interface`. Use `type` for all object and component definitions to maintain consistency across the codebase.
- Use `unknown` instead of `any` wherever possible and avoid `as any`.
- Prefer `instanceof HTMLElement` checks over type casting (e.g., `as HTMLElement`) when dealing with DOM elements (especially `event.target`).

## Zod & Schema Patterns

- Define `Server*Schema` for DB row shape, then extend with `Client*Schema` for joined display fields (e.g., `creator_display_name`).

## Vue

- Use the Vue 3.5+ `useTemplateRef('refName')` composable for DOM element access.
- Use `<script setup lang="ts">` for all components.
- Use VueUse composables whenever feasible (`useEventListener`, `useElementBounding`, `watchThrottled`, etc.).

## State Management

- Global state lives in `src/state.ts` as exported refs/reactive Maps.

## Events

- All socket events must be defined and typed in `shared/events.ts`.
- Use `socket.emitWithAck` for request-response flows.
- Check the `res.success` flag in response objects and handle `false` values by reverting optimistic updates or showing toasts.
- Client event handlers live in `src/socket/eventHandlers/` as separate files exporting a `defineSocketHandler(...)` call.
- Always check whether the server uses `socket.broadcast.emit` or `io.emit` to determine if a local state update is needed immediately alongside the `emitWithAck`.
- Infer from the scenario and related code whether an update should be performed optimistically or strictly sequentially.

## Snapping

- Respect the `altKeyPressed` state from `@/state.ts` to allow users to bypass quantization when it makes sense to do so.

## Consistency

- If you must perform an action that contradicts this AGENTS.md, notify the user.

## Continuous Improvement

- The user wants to improve their own abilities and workflow.
- Proactively suggest improvements to code patterns, tooling, or processes when relevant.
- Flag potential optimizations or better practices the user may not be aware of.
