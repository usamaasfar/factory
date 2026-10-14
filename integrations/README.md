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

Connect Factory to Slack to ask questions, discuss engineering work in threads,
and manage useful channel bookmarks.

### Configuration

| Variable | Description |
| --- | --- |
| `SLACK_TOKEN` | The Slack app's API token |
| `SLACK_SIGNING_SECRET` | The app's signing secret |


### Resources

| Resource | Supported actions |
| --- | --- |
| `conversations` | Read a page of messages in a thread |
| `chat` | Reply to a thread |
| `bookmarks` | Add link bookmarks; edit, list, and remove channel bookmarks |
| `emoji` | List workspace custom emoji and aliases; optionally include Unicode emoji categories |
| `reactions` | Add reactions to messages; get an item and its reactions; remove reactions |

### Events

| Event | When it happens |
| --- | --- |
| `slack.app_mention` | A user mentions the app |
| `slack.message.channels` | A user replies in a public channel thread |
| `slack.message.groups` | A user replies in a private channel thread |
| `slack.reaction_added` | A user adds an emoji reaction |
| `slack.reaction_removed` | A user removes an emoji reaction |

Listing emoji requires the `emoji:read` scope. Reading reactions and receiving
reaction events requires `reactions:read`; adding and removing reactions requires
`reactions:write`. Subscribe to `reaction_added` and `reaction_removed` in the
Slack app to receive reaction events. Message reactions join the parent thread
conversation.
