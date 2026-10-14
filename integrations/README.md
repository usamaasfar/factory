# Integration

Integrations connect Factory to the services your team uses. Events bring work
into Factory, and resources let agents read information and take action.
Workflows choose which events to follow and which resources agents can use.

## GitHub

Connect Factory to GitHub to review pull requests, discuss changes, manage
reviewers, and respond to feedback.

### Configuration

| Variable | Description |
| --- | --- |
| `GITHUB_APP_ID` | Your GitHub App's ID |
| `GITHUB_PRIVATE_KEY` | The app's private key |
| `GITHUB_WEBHOOK_SECRET` | The secret configured for the app's webhook |
| `GITHUB_INSTALLATION_ID` | The app installation to use |
| `GITHUB_REPOSITORY_ID` | The repository Factory works with |

### Resources

| Resource | Supported actions |
| --- | --- |
| `pull_requests` | Create, read, list, and update pull requests; check merge status; read commits and changed files; post conversation comments |
| `pull_requests` | Create, read, list, update, and submit reviews; delete pending reviews; create, read, list, update, delete, and reply to review comments |
| `pull_requests` | List, request, and remove reviewers |
| `reactions` | Add, list, and remove reactions on pull requests and their comments |

### Events

Use these event names in a workflow's `on` section.

| Event prefix | Supported actions |
| --- | --- |
| `github.pull_request` | `opened`, `reopened`, `synchronize`, `ready_for_review`, `closed`, `edited`, `converted_to_draft` |
| `github.pull_request` | `assigned`, `unassigned`, `labeled`, `unlabeled`, `milestoned`, `demilestoned`, `locked`, `unlocked` |
| `github.pull_request` | `review_requested`, `review_request_removed`, `auto_merge_enabled`, `auto_merge_disabled`, `enqueued`, `dequeued` |
| `github.pull_request_review` | `submitted`, `edited`, `dismissed` |
| `github.pull_request_review_comment` | `created`, `edited`, `deleted` |
| `github.pull_request_review_thread` | `resolved`, `unresolved` |
| `github.issue_comment` | `created`, `edited`, `deleted` — pull request comments only |


## Slack

Connect Factory to Slack to discuss engineering work, share files, maintain
working documents, and manage useful channel bookmarks.

### Configuration

| Variable | Description |
| --- | --- |
| `SLACK_TOKEN` | The Slack app's API token |
| `SLACK_SIGNING_SECRET` | The app's signing secret |


### Resources

| Resource | Supported actions |
| --- | --- |
| `conversations` | Discover channels; read channel information, history, members, and threads; join public channels; create a channel canvas |
| `chat` | Post channel messages and thread replies; update your own messages; get message links |
| `bookmarks` | Add link bookmarks; edit, list, and remove channel bookmarks |
| `emoji` | List workspace custom emoji and aliases; optionally include Unicode emoji categories |
| `reactions` | Add reactions to messages; get an item and its reactions; remove reactions |
| `users` | Get user information, list workspace users, and find users by email |
| `assistant` | Search discussions, files, channels, and users; check semantic-search availability |
| `files` | Read file metadata; list files; request an upload URL; complete and share uploads |
| `canvases` | Create documents; read markdown or HTML; find sections; insert or replace content; rename documents |

### Events

| Event | When it happens |
| --- | --- |
| `slack.app_mention` | A user mentions the app in a message or canvas body |
| `slack.message` | A user replies or edits a reply in a public or private channel thread |
| `slack.reaction_added` | A user adds an emoji reaction |
| `slack.reaction_removed` | A user removes an emoji reaction |
| `slack.file_shared` | A user shares an accessible file |

Subscribe to the corresponding events in the Slack app, then select the
`slack.` names in a workflow. For channel messages, enable `message.channels`
and `message.groups` in Slack; both deliver the native `message` event, selected
as `slack.message` in workflows. DMs are ignored. The example workflow follows
mentions and channel thread messages; reactions and standalone file-sharing
notifications are opt-in.

Message events include attachment IDs and replies broadcast to the channel.
Edits retain the original reply's thread; metadata-only changes are ignored.
Canvas-body mentions identify the canvas and section, while mentions in threaded
canvas comments use the normal mention event. These are payload cases, not
additional subscriptions.

Message reactions join the parent thread conversation. File sharing and file
reactions identify the file instead of guessing a message thread.
Use standalone file-sharing notifications only when they should start separate
file work, rather than duplicating attachment work in an existing thread.

### Slack permissions

Workflow resource permissions and Slack app scopes are separate. Enable the
scopes required by the actions you want to use.

| Actions | Slack scopes |
| --- | --- |
| Receive mentions | `app_mentions:read` |
| Discover channels, read channel information and members | `channels:read`, `groups:read` for private channels |
| Read channel history and receive channel messages | `channels:history`, `groups:history` for private channels |
| Join public channels | `channels:join` for bot tokens; `channels:write` for user tokens |
| Post and update messages | `chat:write` |
| Manage bookmarks | `bookmarks:read`, `bookmarks:write` |
| List emoji | `emoji:read` |
| Read reactions and receive reaction events | `reactions:read` |
| Add and remove reactions | `reactions:write` |
| Read user information and list users | `users:read` |
| Find users by email or include their email addresses | `users:read.email` |
| Read file metadata, list files, receive file-sharing events | `files:read` |
| Request upload URLs and complete uploads | `files:write` |
| Read canvases and find sections | `canvases:read` |
| Create and edit canvases, including channel canvases | `canvases:write` |
| Search public content and check search availability | `search:read.public` |
| Search files or users | `search:read.files`, `search:read.users` respectively |

Private channels require an invitation. Posting normally requires channel
membership; `chat:write.public` permits posting to public channels without joining.
Updates can only change messages created by the token's own identity.
Channel and user lists use cursors; file lists use `count` and `page`.
Channel history and the thread reader accept at most 15 messages per request.

### Search

The [real-time search API](https://docs.slack.dev/apis/web-api/real-time-search-api.md)
requires an eligible AI-enabled app: an internal app or a directory-published app.
Bot searches require the `action_token` supplied by a triggering message or
mention event. When present, it is included in the agent's event context for use
with the search tool. Keep it private; never include it in a Slack response,
canvas, or uploaded artifact. Ordinary public-channel replies do not necessarily
supply a fresh action token.

Accessible results depend on the app's scopes, token, triggering conversation,
and the requesting user's permissions. User-token searches can additionally use
`search:read.private`, `search:read.im`, and `search:read.mpim` where authorized.
There is no legacy search fallback. Search availability reports
`is_ai_search_enabled`; it does not grant access to content. Semantic search
depends on the workspace's Slack plan.

### Files and canvases

File tools expose individual upload steps, not an automatic file-transfer tool:

1. Request an upload URL with the filename and byte length.
2. Send the file bytes to that URL in a separate HTTP request.
3. Complete the upload, optionally specifying a channel and parent thread.

Private file download URLs also require a separate authorized HTTP request.
These tools return metadata and URLs; they do not upload bytes or download
file content. Do not expose the Slack API token or private content to people who
cannot access it.

Create a dedicated channel canvas through `conversations`; this fails rather
than replacing a canvas that already exists. A standalone canvas can be added
to a channel tab. Free workspaces require a channel for standalone creation and
limit canvas tabs.

Canvas edits apply one change per request. Supported changes insert content,
replace a section or the whole document, or rename it. Canvas deletion, section
deletion, and access management are intentionally unavailable. Reading and
editing require the appropriate canvas permissions.

References: [methods](https://docs.slack.dev/reference/methods.md) and
[events](https://docs.slack.dev/reference/events.md).
