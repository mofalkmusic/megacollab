# Mega Collab

### A web-based collaborative audio editing tool.

Haven't you always wanted to make music together with 20 other people? -- no?
Well now you can! 😆

Each producer contributes to the same song. With only a few clicks, you can upload your audio files and place them where they fit best. Then try to convince the others to let your contribution live and make the final output.

### Try out the [_public beta_](https://mega.mofalk.com) right now! ✨

<p align="center">
  <a target="_blank" href="https://mega.mofalk.com">
    <img alt="showcase" src="https://mega.mofalk.com/preview_github_1.jpg">
  </a>
</p>

## Feedback & Contributing

This project is still very much under contruction. If you find bugs, I will fix them asap if you report them in the [GitHub Issues](https://github.com/mofalkmusic/megacollab/issues) or send a message in the [Community Discord](https://discord.mofalk.com).

Or if you're a developer and want to contribute, feel free to open a pull request.
Below you'll find everything to get you started I hope.

## Development Setup

You will need [Bun](https://bun.sh) installed on at least version `1.3.3`.
I also recommend installing the official [Vue extension](https://open-vsx.org/extension/Vue/volar).

After cloning the repo, run:

```bash
$ bun install
```

And you're good to go! ⚡️

High level overview of dependencies used:

- [Vue](https://vuejs.org/) Frontend
- [Typescript](https://www.typescriptlang.org/) because who uses just javascript?
- [Vite](https://vitejs.dev/) and its [Rolldown](https://rolldown.rs/) for fast dev
- [ESLint](https://eslint.org/) and [Prettier](https://prettier.io/) for code quality
- [Hono](https://hono.dev/) + [Socket.io](https://socket.io/) for the server

## Available Commands

Here are the commands you'll most likely need during development:

| Command               | Description                                                                                                                                                     |
| :-------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **bun run dev**       | **Start here!** Simultaneously runs Vite to host the _Vue_ frontend and bun to host the backend server.                                                         |
| **bun run typecheck** | Runs TypeScript type checking across the entire codebase. To check the Vue app only run `bun run typecheck:vue` or `bun run typecheck:backend` for the backend. |
| **bun run format**    | Auto-formats the entire codebase using Prettier.                                                                                                                |
| **bun run lint**      | Lints the codebase using ESLint.                                                                                                                                |
| **bun run cleanup**   | Removes temporary files, build artifacts, and local databases. _Helpful if you encounter strange database or state issues._                                     |
| **bun run build**     | Builds the entire codebase after typechecking. _Won't work unless you specify a bunch of environment variables._                                                |

## Project Structure

The project is organized into a monorepo-style structure with clear separation of concerns:

- **`src/`** Frontend Vue app
    - **`socket/`**: Client-side [Socket.IO](https://socket.io/) event handlers and setup.
    - **`composables/`**: Custom Vue composables for shared state logic.
    - **`state.ts`**: DIY global state management **without** Pinia.
- **`server/`** Backend
    - **`server.ts`**: Main entry point using [Hono](https://hono.dev/) and [Bun](https://bun.sh).
    - **`database.ts`**: Database connection and queries using PostgreSQL.
    - **`socket.ts`**: Socket.IO server initialization and middleware.
    - **`store.ts`**: File storage/uploads via R2 or local file system in dev.

- **`shared/`** Shared
    - **`schema.ts`**: [Zod](https://zod.dev/) schemas used for validation and type inference on both ends.
    - **`events.ts`**: Typed definitions for Socket.IO events to ensure type safety.

## Development Environment

To not have to worry about setting up of external services, the development environment mimics production infrastructure locally. Also no need for a `.env` file in development.

<dl>
  <dt><strong>Authentication</strong></dt>
  <dd>
    Authentication is mocked in development. You don't need to set up Clerk; the app automatically uses a local mock user.
  </dd>

  <dt><strong>Database</strong></dt>
  <dd>
    Instead of connecting to a remote PostgreSQL instance, we use <a href="https://pglite.dev/">PGlite</a> (Postgres in WASM) to run a fully functional Postgres database locally in the file system.
  </dd>

  <dt><strong>File Uploads/Storage</strong></dt>
  <dd>
    File uploads are stored locally in the <code>dev.audiofiles/</code> directory instead of being uploaded to an R2 bucket. This requires some dryn't code in the <code>store.ts</code> and additional file upload handlers in the Hono server.
  </dd>

  <dt><strong>Ports</strong></dt>
  <dd>
    The dev Hono server runs on port <code>3000</code> by default, you can change the port in <code>shared/constants.ts</code>.
  </dd>
</dl>

## Workflow

1.  **Fork & Clone**: Fork the repo and clone it locally.

2.  **Branching**: Create a new branch for your specific feature or fix.
    - `git checkout -b feature/my-cool-feature`
    - `git checkout -b fix/annoying-bug`

3.  **Development**: Make your changes.
    - Please have a look at the existing code first, follow the style roughtly of the existing code.

4.  **Verification**: Before committing, ensure your code passes all checks:
    - `bun run typecheck`
    - `bun run format`
    - `bun run lint`

5.  **Commit**: Please use descriptive commit messages.
    - _Good_: `feat: add real-time user cursors to canvas`
    - _Bad_: `wip` or `fix stuff`

6.  **Push & PR**: Push to your fork and submit a Pull Request to the `main` branch.

## Code Style

- **Typescript**:
    - Avoid `any` when possible: use `unknown` or proper types.
    - Avoid interfaces, use types instead.
- **Icons**: Use `lucide-vue-next` for icons where possible.
- Will add more here as they come up if they come up :)

## Cool Things I Built

All events from `shared/events.ts` are automatically typed on both ends.

```typescript
// shared/events.ts
export const EVENTS = {
  CLIENT_REQUESTS:
    'get:world': {
		req: { hello: string },
		res: { world: string }
	}
}

// Automatically guaranteed through Zod
// parsing and validation middleware on both ends.

// Client must emits with correct payload
const { world: string } = await socket.emit('get:world', { hello: string })

// Server must respond with correct payload
socket.on('get:world', ({ hello: string }, cb) => cb({ world: string }))

// File based typed eventHandlers on the client side.
export default defineSocketHandler({
	event: 'server:ready',
	handler: async ({ client, user }) => {
        // ...
	},
})

// Very nice 😋
```

### Disclaimer

This is my first time managing anything public on Github, if you see anything that could be improved, please let me know! I'm happy to learn and improve.

This project is licensed under GPL‑3.0.
Third‑party dependencies are licensed under their respective terms.
Some build‑time tools and datasets use non‑MIT
licenses and are not part of the distributed code.
