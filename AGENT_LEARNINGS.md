# Agent Learnings

This file tracks project-specific patterns, architectural decisions, and bug fixes to ensure consistency across agent sessions.

## [Formatting]

### Agent Learning Structure

- **Learning**: All new entries in `AGENT_LEARNINGS.md` must follow a categorized structure: `## [Category]`, then `### Title`, followed by `- **Learning**:` and `- **Context**:` bullets.
- **Context**: Standardized formatting allows agents (and humans) to quickly identify and apply relevant patterns across sessions. This section can contain code blocks, file paths, or other useful information to provide deeper understanding.

## [Meta]

### Contradictory Learning Management

- **Learning**: If the user request or discovery contradicts an existing learning, verify its current relevance. If outdated, do not delete it; instead, move the title and a brief "reason for removal" to the **[Deprecated/Changelog]** section.
- **Context**: This prevents "re-learning" old mistakes and maintains a clear history of architectural evolution.

## [Workflow]

### Mandatory Verification

- **Learning**: Always verify implemented changes by running `bun run typecheck`, `bun run lint`, and `bun run format` before concluding the task.
- **Context**: Ensuring the codebase remains type-safe, linted, and formatted is a hard requirement for all changes to prevent regression and maintain quality.

### Knowledge Preservation

- **Learning**: Include a final step/task to add learnings to `AGENT_LEARNINGS.md` if it makes sense to keep knowledge about whatever was done in this knowledgebase.
- **Context**: Continuous updates to `AGENT_LEARNINGS.md` are essential for maintaining a "collective memory" of the project's specific quirks and patterns.

## [TypeScript & Code Style]

### Interface Avoidance

- **Learning**: Avoid using `interface`. Use `type` for all object and component definitions to maintain consistency across the codebase.
- **Context**: TypeScript `type` aliases offer better flexibility for union and intersection types and are the preferred style for this repository.

### Explicit Units in Variable Names

- **Learning**: Always suffix measurement variable names with their units: `Px`, `Beats`, `Sec`, or `Ms` (e.g., `startBeat`, `offsetSec`, `widthPx`).
- **Context**: This prevents unit mismatch bugs in complex math and makes the code self-documenting.

### Template Refs

- **Learning**: Use the Vue 3.5+ `useTemplateRef('refName')` composable for DOM element access instead of legacy ref patterns.
- **Context**: Modern Vue 3.5 pattern that provides better developer experience and cleaner template binding.

### Icon Usage

- **Learning**: Use `lucide-vue-next` for all iconography. Avoid individual SVG imports or third-party icon sets unless specifically requested.
- **Context**: Standardizing on Lucide ensures a consistent visual language and reduced bundle complexity.

## [Architecture]

### Mobile Device Support

- **Learning**: The platform is currently not suitable for mobile devices.
- **Context**: DAW workflows require high precision and screen space not typically available on mobile.

### Centralized Math Conversions

- **Learning**: Use conversions from `@/utils/mathUtils.ts` (e.g., `px_to_beats`, `beats_to_sec`) instead of manual calculations.
- **Context**: Centralizing conversion logic ensures consistency and prevents precision errors across the timeline and audio engine.

## [UI/UX]

### Dynamic Cursor Alignment

- **Learning**: Calculate user cursor positions by factoring in the `TimelineHeader` height and current scroll offsets.
- **Context**: Standard coordinate systems might not account for fixed headers or varying track heights in the scrolling timeline.

### Quantization Bypass

- **Learning**: Always respect the `altKeyPressed` state from `@/state.ts` to allow users to bypass snapping (quantization) during drag/resize operations.
- **Context**: Standard DAW behavior where the `Alt` key provides high-precision control by disabling the grid.

## [Communication]

### Typed Socket Events

- **Learning**: All socket events must be defined and typed in `shared/events.ts`. Use `socket.emitWithAck` for request-response flows.
- **Context**: Ensures full-stack type safety and reliable message delivery between client and server.

### Socket Error Handling

- **Learning**: Always check the `res.success` flag in socket response objects and handle `false` values by reverting optimistic updates or showing toasts.
- **Context**: Prevents the UI from getting out of sync with the server and ensures robust error states.

---

## [Deprecated/Changelog]

_No entries yet._
