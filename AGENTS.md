# AGENTS.md

## Verification instructions

- Always verify implemented changes by running `bun run typecheck`, `bun run lint`, and `bun run format` before concluding the task.
- Explicitly add this as a final step to your tasks/plans when you create them.

## Import Aliases

- `@/` → `src/` (Vue frontend)
- `~/` → `shared/` (shared code)

Always use these aliases instead of relative paths when importing across directories.

## TypeScript

- Avoid using `interface`. Use `type` for all object and component definitions to maintain consistency across the codebase.
- Use `unknown` instead of `any` wherever possible and avoid `as any`.

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

## Snapping

- Respect the `altKeyPressed` state from `@/state.ts` to allow users to bypass quantization when it makes sense to do so.
