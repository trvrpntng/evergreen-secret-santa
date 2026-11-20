# Evergreen Secret Santa

## Local development

Run locally with Node.js 24 or newer. There are no dependencies to install.

```sh
npm start
```

Open `http://127.0.0.1:3000`. The local server stores draws in `data/draws.sqlite`. Start it with `npm.cmd start` if PowerShell blocks the npm script. Run `npm test` to check assignments, duplicate names, simultaneous claims and persistence.

## How the draw works

Add at least three Santas with unique names. Names match regardless of capitalisation and extra spaces. If two people have the same first name, give them distinct initials or nicknames and tell them what to enter. Once the draw is ready, send the same invitation link to everyone in the group.

The organiser's screen shows the link and participant count. Each participant can reveal one recipient once, then continue to the gift ideas page. Anyone who has the link and knows a participant's name can claim first, so share the link only with the group.

## Deploy to Cloudflare Workers

The app uses a Cloudflare Worker and a persistent D1 database. Run these commands from the repository root to sign in to your Cloudflare account and create your D1 database.

```sh
npx wrangler login
npx wrangler d1 create evergreen-secret-santa
```

If Wrangler offers to add a new binding, decline and update the existing binding in `wrangler.jsonc`. Replace the placeholder `database_id` with the UUID printed by Wrangler. Keep the binding name `DB`. If you reuse a database with a different name, update `database_name` as well. [Wrangler D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/)

Apply the database migration, build the app, and deploy it.

```sh
npx wrangler d1 migrations apply DB --remote
npm run build
npx wrangler deploy
```

Open the public Worker URL printed by Wrangler. A new database starts with no draws. Invitations created on a previous instance still use its original URL and database. [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)

### Automatic deployments from GitHub

Commit the updated `wrangler.jsonc` to your repository. In **Workers & Pages**, open the `evergreen-secret-santa` Worker and connect the repo under **Settings → Builds**. The Worker name must match `name` in `wrangler.jsonc`. Use the production branch and project root, with `npm run build` as the build command and `npx wrangler deploy` as the deploy command. [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)

## Configure affiliate links

In **Workers & Pages**, open your Worker and add `GIFT_AFFILIATE_LINKS` as a **Text** variable under **Settings → Variables and Secrets**. Deploy the variable change to make it available to the gift ideas page. For local development, set the same environment variable before starting the Node server. [Worker runtime variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)

The value is a JSON object. Use one or more of the categories `cosy`, `food`, `games`, `books`, `desk` and `experiences`. Paste the full HTTPS affiliate URLs from your own programme in place of the examples.

```json
{
  "cosy": "https://example.com/your-cosy-gift-link",
  "books": "https://example.com/your-book-link"
}
```

The links are visible to visitors. Keep API tokens and account credentials out of this variable.
